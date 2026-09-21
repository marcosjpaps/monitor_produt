param(
    [Parameter(Mandatory=$true)][string]$InputFile,
    [Parameter(Mandatory=$true)][string]$OutputFile
)

$ErrorActionPreference = "Stop"

try {
    if (-not (Test-Path -LiteralPath $InputFile)) {
        [Console]::Error.WriteLine("Input file does not exist: $InputFile")
        exit 1
    }

    [xml]$xml = Get-Content -LiteralPath $InputFile -Raw -Encoding UTF8
    $placemark = $xml.kml.Document.Placemark
    if (-not $placemark) {
        [Console]::Error.WriteLine("No Placemark found in KML: $InputFile")
        exit 1
    }

    # Extract ExtendedData key-values
    $dataDict = @{}
    if ($placemark.ExtendedData -and $placemark.ExtendedData.Data) {
        foreach ($item in $placemark.ExtendedData.Data) {
            $name = $item.name.Trim()
            $val = if ($item.value) { $item.value.Trim() } else { "" }
            $dataDict[$name] = $val
        }
    }

    $aircraftName = if ($dataDict["Aircraft Name"]) { $dataDict["Aircraft Name"] } else { "Drone" }
    $fcId = if ($dataDict["Flight Controller ID"]) { $dataDict["Flight Controller ID"] } else { "Nao especificado" }
    $pilotName = if ($dataDict["Pilot Name"]) { $dataDict["Pilot Name"] } else { "Nao especificado" }
    $flightTimeMs = if ($dataDict["Flight Time"]) { [double]($dataDict["Flight Time"]) } else { 0.0 }
    $flightTimeSec = if ($flightTimeMs -gt 0) { $flightTimeMs / 1000.0 } else { 0.0 }
    $mode = if ($dataDict["Mode Selection"]) { $dataDict["Mode Selection"] } else { "Auto" }
    $height = if ($dataDict["Height"]) { [double]($dataDict["Height"]) } else { 0.0 }
    $routeSpacing = if ($dataDict["Route Spacing"]) { [double]($dataDict["Route Spacing"]) } else { 0.0 }
    $taskSpeedMs = if ($dataDict["Task Flight Speed"]) { [double]($dataDict["Task Flight Speed"]) } else { 0.0 }
    $taskSpeedKmh = $taskSpeedMs * 3.6
    $taskAreaHa = if ($dataDict["Task Area"]) { [double]($dataDict["Task Area"]) } else { 0.0 }
    $sprayAmountMl = if ($dataDict["Spray amount"]) { [double]($dataDict["Spray amount"]) } else { 0.0 }
    $sprayLiters = $sprayAmountMl / 1000.0
    $sprayRateLHa = if ($taskAreaHa -gt 0.001 -and $sprayLiters -gt 0.0) { $sprayLiters / $taskAreaHa } else { 0.0 }

    # Extract date/time from filename: YYYYMMDDHHMMSS
    $fileName = [System.IO.Path]::GetFileName($InputFile)
    $startTimeIso = ""
    $displayDate = ""
    if ($fileName -match '(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})') {
        $startTimeIso = "$($matches[1])-$($matches[2])-$($matches[3])T$($matches[4]):$($matches[5]):$($matches[6])Z"
        $displayDate = "$($matches[3])/$($matches[2])/$($matches[1]) $($matches[4]):$($matches[5])"
    } else {
        $startTimeIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        $displayDate = (Get-Date).ToString("dd/MM/yyyy HH:mm")
    }

    # Extract Coordinates (format in KML: lon,lat,alt separated by spaces)
    $coordsRaw = $placemark.LineString.coordinates
    if (-not $coordsRaw) {
        [Console]::Error.WriteLine("No coordinates found in KML: $InputFile")
        exit 1
    }

    $coordTokens = $coordsRaw.Trim() -split '\s+'
    $pointList = [System.Collections.Generic.List[PSCustomObject]]::new()
    $invCulture = [System.Globalization.CultureInfo]::InvariantCulture

    foreach ($tok in $coordTokens) {
        $tok = $tok.Trim()
        if (-not $tok) { continue }
        $parts = $tok -split ','
        if ($parts.Count -ge 2) {
            $lon = [double]::Parse($parts[0], $invCulture)
            $lat = [double]::Parse($parts[1], $invCulture)
            $alt = if ($parts.Count -ge 3) { [double]::Parse($parts[2], $invCulture) } else { 0.0 }
            if ($alt -eq 0.0 -and $height -gt 0.0) {
                $alt = $height
            }
            $pointList.Add([PSCustomObject]@{ Lon = $lon; Lat = $lat; Alt = $alt })
        }
    }

    if ($pointList.Count -eq 0) {
        [Console]::Error.WriteLine("Zero valid coordinates found in $InputFile")
        exit 1
    }

    # Haversine distance function in meters
    function Get-HaversineDist($lat1, $lon1, $lat2, $lon2) {
        $r = 6371000.0 # Earth radius in meters
        $dLat = ($lat2 - $lat1) * [Math]::PI / 180.0
        $dLon = ($lon2 - $lon1) * [Math]::PI / 180.0
        $a = [Math]::Sin($dLat / 2.0) * [Math]::Sin($dLat / 2.0) +
             [Math]::Cos($lat1 * [Math]::PI / 180.0) * [Math]::Cos($lat2 * [Math]::PI / 180.0) *
             [Math]::Sin($dLon / 2.0) * [Math]::Sin($dLon / 2.0)
        $c = 2.0 * [Math]::Atan2([Math]::Sqrt($a), [Math]::Sqrt(1.0 - $a))
        return $r * $c
    }

    # Calculate cumulative distances and distance to home
    $homeLat = $pointList[0].Lat
    $homeLon = $pointList[0].Lon
    $cumDists = [double[]]::new($pointList.Count)
    $distToHomes = [double[]]::new($pointList.Count)
    $cumDists[0] = 0.0
    $distToHomes[0] = 0.0

    for ($i = 1; $i -lt $pointList.Count; $i++) {
        $stepDist = Get-HaversineDist $pointList[$i-1].Lat $pointList[$i-1].Lon $pointList[$i].Lat $pointList[$i].Lon
        $cumDists[$i] = $cumDists[$i-1] + $stepDist
        $distToHomes[$i] = Get-HaversineDist $homeLat $homeLon $pointList[$i].Lat $pointList[$i].Lon
    }
    $totalDist = $cumDists[$pointList.Count - 1]

    # Calculate timestamps
    $times = [double[]]::new($pointList.Count)
    if ($flightTimeSec -le 0.0) {
        if ($taskSpeedMs -gt 0.0 -and $totalDist -gt 0.0) {
            $flightTimeSec = $totalDist / $taskSpeedMs
        } else {
            $flightTimeSec = [Math]::Max(1.0, ($pointList.Count - 1) * 1.0)
        }
    }

    for ($i = 0; $i -lt $pointList.Count; $i++) {
        if ($pointList.Count -eq 1) {
            $times[$i] = 0.0
        } elseif ($totalDist -gt 0.0) {
            $times[$i] = ($cumDists[$i] / $totalDist) * $flightTimeSec
        } else {
            $times[$i] = ($i / [double]($pointList.Count - 1)) * $flightTimeSec
        }
    }

    $flMin = [int]($flightTimeSec / 60)
    $flRemSec = [int]($flightTimeSec % 60)
    $flTimeFormatted = "{0}m {1:D2}s" -f $flMin, $flRemSec

    # Display Name in Open DroneLog
    $displayName = "[{0}] Calda: {1:F2}L | Area: {2:F2}ha" -f $aircraftName, $sprayLiters, $taskAreaHa
    if ($sprayRateLHa -gt 0.0) {
        $displayName += " ({0:F1} L/ha)" -f $sprayRateLHa
    }

    # Full structured notes showing ALL attributes
    $sbNotes = [System.Text.StringBuilder]::new()
    [void]$sbNotes.AppendLine("=== DADOS DE PULVERIZACAO E VOO (KML) ===")
    [void]$sbNotes.AppendLine(([string]::Format($invCulture, "- Calda Pulverizada (Spray amount): {0:F2} L ({1:F0} ml)", $sprayLiters, $sprayAmountMl)))
    [void]$sbNotes.AppendLine(([string]::Format($invCulture, "- Area Aplicada (Task Area): {0:F2} ha", $taskAreaHa)))
    if ($sprayRateLHa -gt 0.0) {
        [void]$sbNotes.AppendLine(([string]::Format($invCulture, "- Taxa de Aplicacao Real: {0:F2} L/ha", $sprayRateLHa)))
    }
    [void]$sbNotes.AppendLine(([string]::Format($invCulture, "- Altura de Voo (Height): {0:F1} m", $height)))
    [void]$sbNotes.AppendLine(([string]::Format($invCulture, "- Faixa de Pulverizacao (Route Spacing): {0:F2} m", $routeSpacing)))
    [void]$sbNotes.AppendLine(([string]::Format($invCulture, "- Velocidade Tarefa: {0:F1} m/s ({1:F1} km/h)", $taskSpeedMs, $taskSpeedKmh)))
    [void]$sbNotes.AppendLine("- Drone / Aeronave: $aircraftName")
    [void]$sbNotes.AppendLine("- Piloto: $pilotName")
    [void]$sbNotes.AppendLine("- Modo de Voo: $mode")
    [void]$sbNotes.AppendLine("- ID Controladora (FC ID): $fcId")
    [void]$sbNotes.AppendLine("- Tempo de Voo: $flTimeFormatted ($([int]$flightTimeSec)s)")
    [void]$sbNotes.AppendLine("- Distancia Percorrida no Rastro: $([Math]::Round($totalDist, 1)) m")
    [void]$sbNotes.AppendLine("- Total Pontos GPS: $($pointList.Count)")
    $notesStr = $sbNotes.ToString().Trim()

    # Tags list
    $tagsArr = [System.Collections.Generic.List[hashtable]]::new()
    $tagsArr.Add(@{ tag = "KML"; tag_type = "auto" })
    $tagsArr.Add(@{ tag = $aircraftName; tag_type = "auto" })
    if ($sprayLiters -gt 0.0) {
        $tagsArr.Add(@{ tag = ("Calda: {0:F1}L" -f $sprayLiters); tag_type = "auto" })
    }
    if ($taskAreaHa -gt 0.0) {
        $tagsArr.Add(@{ tag = ("Area: {0:F2}ha" -f $taskAreaHa); tag_type = "auto" })
    }
    if ($sprayRateLHa -gt 0.0) {
        $tagsArr.Add(@{ tag = ("Taxa: {0:F1}L/ha" -f $sprayRateLHa); tag_type = "auto" })
    }
    if ($pilotName -and $pilotName -ne "Nao especificado") {
        $tagsArr.Add(@{ tag = $pilotName; tag_type = "manual" })
    }
    if ($routeSpacing -gt 0.0) {
        $tagsArr.Add(@{ tag = ("Faixa: {0:F1}m" -f $routeSpacing); tag_type = "auto" })
    }

    $metadataObj = @{
        display_name    = $displayName
        drone_model     = $aircraftName
        aircraft_name   = $aircraftName
        drone_serial    = $fcId
        start_time      = $startTimeIso
        home_lat        = $homeLat
        home_lon        = $homeLon
        notes           = $notesStr
        tags            = $tagsArr
    }
    $metadataJson = $metadataObj | ConvertTo-Json -Compress -Depth 4
    # Escape quotes for CSV
    $metadataEscaped = $metadataJson.Replace('"', '""')

    # Build CSV Lines
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine("time_s,lat,lng,alt_m,distance_to_home_m,speed_ms,flight_mode,Metadata")

    for ($i = 0; $i -lt $pointList.Count; $i++) {
        $t = $times[$i].ToString("F2", $invCulture)
        $lat = $pointList[$i].Lat.ToString("F8", $invCulture)
        $lon = $pointList[$i].Lon.ToString("F8", $invCulture)
        $alt = $pointList[$i].Alt.ToString("F2", $invCulture)
        $dist = $distToHomes[$i].ToString("F2", $invCulture)

        # Speed calculation
        $spd = 0.0
        if ($i -gt 0) {
            $dt = $times[$i] - $times[$i-1]
            $ds = $cumDists[$i] - $cumDists[$i-1]
            if ($dt -gt 0.001) {
                $spd = $ds / $dt
            } else {
                $spd = $taskSpeedMs
            }
        } else {
            $spd = if ($taskSpeedMs -gt 0.0) { $taskSpeedMs } else { 0.0 }
        }
        $spdStr = $spd.ToString("F2", $invCulture)

        $metaCell = if ($i -eq 0) { "`"$metadataEscaped`"" } else { "" }
        [void]$sb.AppendLine("$t,$lat,$lon,$alt,$dist,$spdStr,$mode,$metaCell")
    }

    # Ensure target directory exists
    $outDir = [System.IO.Path]::GetDirectoryName($OutputFile)
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
        [void][System.IO.Directory]::CreateDirectory($outDir)
    }

    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($OutputFile, $sb.ToString(), $utf8NoBom)
    exit 0
} catch {
    [Console]::Error.WriteLine("Error parsing KML: $_")
    exit 1
}
