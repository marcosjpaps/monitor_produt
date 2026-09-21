param(
    [string]$SourceDir = "c:\Users\Topologia\Documents\Drone\ENC__ARQUIVOS",
    [string]$OutputDir = "c:\Users\Topologia\Documents\Drone\CSV_CONVERTIDOS",
    [switch]$ExtractZip = $false
)

$ErrorActionPreference = "Continue"

if (-not (Test-Path -LiteralPath $SourceDir)) {
    Write-Host "Diretório de origem não encontrado: $SourceDir" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $OutputDir)) {
    [void][System.IO.Directory]::CreateDirectory($OutputDir)
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   CONVERSOR EM LOTE DE KML PARA OPEN DRONELOG CSV        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Se solicitado extrair zips
if ($ExtractZip) {
    $zipFiles = Get-ChildItem -Path $SourceDir -Filter "*.zip"
    Write-Host "Encontrados $($zipFiles.Count) arquivos ZIP. Extraindo KMLs temporários..." -ForegroundColor Yellow
    $tempZipDir = Join-Path $OutputDir "_temp_zip_kml"
    if (-not (Test-Path $tempZipDir)) { [void][System.IO.Directory]::CreateDirectory($tempZipDir) }
    foreach ($z in $zipFiles) {
        try {
            Expand-Archive -LiteralPath $z.FullName -DestinationPath $tempZipDir -Force
        } catch {
            Write-Host "Erro ao extrair $($z.Name): $_" -ForegroundColor Red
        }
    }
}

$kmlFiles = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
$kmlFiles.AddRange([System.IO.FileInfo[]](Get-ChildItem -Path $SourceDir -Filter "*.kml"))
if ($ExtractZip -and (Test-Path $tempZipDir)) {
    $kmlFiles.AddRange([System.IO.FileInfo[]](Get-ChildItem -Path $tempZipDir -Filter "*.kml"))
}

Write-Host "Total de arquivos KML a processar: $($kmlFiles.Count)" -ForegroundColor Green

$parserScript = "c:\Users\Topologia\Documents\Drone\parse_kml.ps1"
$summaryList = [System.Collections.Generic.List[PSCustomObject]]::new()

$count = 0
$total = $kmlFiles.Count
$successCount = 0
$failCount = 0

$totalAreaHa = 0.0
$totalSprayLiters = 0.0
$totalFlightSec = 0.0

foreach ($file in $kmlFiles) {
    $count++
    $outCsvName = [System.IO.Path]::ChangeExtension($file.Name, ".csv")
    $outCsvPath = Join-Path $OutputDir $outCsvName

    # Executa a conversão
    $process = Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$parserScript`"", "`"$($file.FullName)`"", "`"$outCsvPath`"" `
        -NoNewWindow -Wait -PassThru

    if ($process.ExitCode -eq 0 -and (Test-Path -LiteralPath $outCsvPath)) {
        $successCount++
        
        # Leitura rápida de resumo
        try {
            [xml]$xml = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
            $placemark = $xml.kml.Document.Placemark
            $dataDict = @{}
            if ($placemark.ExtendedData -and $placemark.ExtendedData.Data) {
                foreach ($item in $placemark.ExtendedData.Data) {
                    $dataDict[$item.name.Trim()] = if ($item.value) { $item.value.Trim() } else { "" }
                }
            }

            $areaHa = if ($dataDict["Task Area"]) { [double]($dataDict["Task Area"]) } else { 0.0 }
            $sprayAmount = if ($dataDict["Spray amount"]) { [double]($dataDict["Spray amount"]) } else { 0.0 }
            $sprayL = $sprayAmount / 1000.0
            $flTimeMs = if ($dataDict["Flight Time"]) { [double]($dataDict["Flight Time"]) } else { 0.0 }
            $flSec = $flTimeMs / 1000.0

            $totalAreaHa += $areaHa
            $totalSprayLiters += $sprayL
            $totalFlightSec += $flSec

            $summaryList.Add([PSCustomObject]@{
                Arquivo      = $file.Name
                Drone        = if ($dataDict["Aircraft Name"]) { $dataDict["Aircraft Name"] } else { "" }
                Piloto       = if ($dataDict["Pilot Name"]) { $dataDict["Pilot Name"] } else { "" }
                Controladora = if ($dataDict["Flight Controller ID"]) { $dataDict["Flight Controller ID"] } else { "" }
                TempoVooMin  = [Math]::Round($flSec / 60.0, 2)
                AreaHa       = [Math]::Round($areaHa, 2)
                CaldaLitros  = [Math]::Round($sprayL, 2)
                VelocidadeMs = if ($dataDict["Task Flight Speed"]) { [Math]::Round([double]($dataDict["Task Flight Speed"]), 1) } else { 0 }
                FaixaMetros  = if ($dataDict["Route Spacing"]) { [Math]::Round([double]($dataDict["Route Spacing"]), 1) } else { 0 }
            })
        } catch { }
    } else {
        $failCount++
    }

    if ($count % 100 -eq 0 -or $count -eq $total) {
        Write-Host "Progresso: $count / $total ($([Math]::Round(($count/$total)*100, 1))%)" -ForegroundColor Yellow
    }
}

# Salvar relatório consolidado
$summaryPath = Join-Path $OutputDir "resumo_geral_voos.csv"
$summaryList | Export-Csv -LiteralPath $summaryPath -NoTypeInformation -Encoding UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "CONVERSÃO CONCLUÍDA!" -ForegroundColor Green
Write-Host "Total convertido: $successCount sucessos | $failCount falhas" -ForegroundColor Green
Write-Host "Área Total Pulverizada: $([Math]::Round($totalAreaHa, 2)) hectares" -ForegroundColor Cyan
Write-Host "Calda Total Aplicada:   $([Math]::Round($totalSprayLiters, 2)) litros" -ForegroundColor Cyan
Write-Host "Tempo Total de Voo:     $([Math]::Round($totalFlightSec / 3600.0, 2)) horas" -ForegroundColor Cyan
Write-Host "Planilha resumo salva em: $summaryPath" -ForegroundColor Cyan
Write-Host "Arquivos CSV prontos para Open DroneLog em: $OutputDir" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
