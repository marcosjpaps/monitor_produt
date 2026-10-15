"""Bloqueio de importações sem aplicação comprovada (server-side).
Não substitui o conversor agronômico: ISOXML/TLG e OEM proprietário requerem parser.
"""
from __future__ import annotations
import io
import json
import re
import struct
import zipfile
from dataclasses import dataclass

ACTUAL = {"APPLIEDRAT", "APPLIEDRATE", "APPLDRATE", "APPRATE", "TAXA_APLIC", "TAXA_APL", "DOSEAPLIC", "ACTRATE", "TXAPLIC"}
SPEED = {"VEHICLSPE", "VEHICLSPEED", "SPEED", "VELOCIDADE", "GPS_SPEED", "VELOCID"}
FLOW = {"FLOWRATE", "FLOW", "VAZAO", "ACTFLOW", "VAZ_LMIN"}
GUIDANCE = re.compile(r"(?:BORDAD|BOUNDAR|LIMIT|LINHA.?AB|GUIDANCE|SWATH|HEADLAND|PRESCRI|RX|ZONE)", re.I)
MAX_FILES = 300
MAX_UNPACK = 160 * 1024 * 1024


def _dbf(raw: bytes):
    if len(raw) < 65:
        raise ValueError("Cabeçalho DBF incompleto")
    count, header, step = struct.unpack_from("<IHH", raw, 4)
    if count < 1 or count > 5_000_000 or header < 65 or step < 2 or header + count * step > len(raw):
        raise ValueError("DBF com registros inconsistentes")
    columns = {}
    pos = 1
    terminated = False
    for at in range(32, header, 32):
        if raw[at] == 13:
            terminated = True
            break
        if at + 32 > header:
            break
        field = raw[at:at + 11].split(b"\0", 1)[0].decode("cp1252", errors="replace").strip()
        length = raw[at + 16]
        if not field or not length or pos + length > step:
            raise ValueError("Descritor DBF inválido")
        columns[re.sub(r"[^A-Z0-9]", "", field.upper())] = (pos, length)
        pos += length
    if not terminated or not columns:
        raise ValueError("DBF sem colunas válidas")
    return columns, count, header, step


def _field(columns, names):
    return next((columns[k] for k in [re.sub(r"[^A-Z0-9]", "", x.upper()) for x in names] if k in columns), None)


def _positive(raw, column, count, header, step):
    if not column:
        return False
    pos, width = column
    for idx in range(min(count, 1000)):
        row = header + idx * step
        if raw[row] == 42:
            continue
        value = raw[row + pos:row + pos + width].strip().decode("ascii", errors="ignore").replace(",", ".")
        try:
            if float(value) > 0:
                return True
        except ValueError:
            pass
    return False


def _valid_shape(shp: bytes, shx: bytes, count: int):
    if len(shp) < 100 or len(shx) < 100 or struct.unpack_from(">I", shp)[0] != 9994:
        raise ValueError("Cabeçalho SHP/SHX inválido")
    kind = struct.unpack_from("<I", shp, 32)[0]
    allowed = {1, 3, 5, 8, 11, 13, 15, 18, 21, 23, 25, 28}
    if kind not in allowed or struct.unpack_from("<I", shx, 32)[0] != kind:
        raise ValueError("Tipo geométrico SHP inválido")
    if (len(shx) - 100) // 8 != count or (len(shx) - 100) % 8:
        raise ValueError("Quantidade de geometrias SHX diferente do DBF")
    west, south, east, north = struct.unpack_from("<dddd", shp, 36)
    if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
        raise ValueError("Coordenadas inválidas para EPSG:4326")


def _valid_prj(raw: bytes):
    text = raw.decode("utf-8", "replace").upper()
    if re.search(r"PROJCS\s*\[|PROJCRS\s*\[|PROJECTEDCRS\s*\[", text):
        return False
    return bool(re.search(r"WGS[_ ]?84|GCS_WGS_1984|EPSG[^\d]*4326", text) and
                re.search(r"GEOGCS|GEOGCRS|GEOGRAPHICCRS", text))


@dataclass
class CheckedArchive:
    raw: bytes
    features: int
    work_layers: list[str]
    skipped: list[str]


def inspect_application_zip(filename: str, raw: bytes, module: str) -> CheckedArchive:
    """Retorna ZIP saneado, só com camadas de aplicação e metadados relevantes."""
    if module not in ("jacto", "massey"):
        raise ValueError("Sem conversor GIS de operação para este módulo")
    if not filename.lower().endswith(".zip"):
        raise ValueError("Envie um ZIP Shapefile completo; KML e binários isolados não são aplicação")
    if not raw or len(raw) > 50 * 1024 * 1024:
        raise ValueError("Arquivo vazio ou superior a 50 MB")
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except (zipfile.BadZipFile, ValueError):
        raise ValueError("ZIP corrompido") from None
    with z:
        entries = z.infolist()
        if not entries or len(entries) > MAX_FILES or sum(f.file_size for f in entries) > MAX_UNPACK:
            raise ValueError("ZIP sem conteúdo ou acima do limite de expansão")
        names = {}
        for entry in entries:
            name = entry.filename.replace("\\", "/")
            if name.startswith("/") or ".." in name.split("/") or entry.flag_bits & 1:
                raise ValueError("ZIP com caminho inseguro ou criptografado")
            if entry.file_size > 50 * 1024 * 1024 or entry.compress_size and entry.file_size / entry.compress_size > 200:
                raise ValueError("ZIP com conteúdo grande ou suspeito")
            names[name.lower()] = entry
        shape_names = [n for n in names if n.endswith(".shp")]
        if not shape_names:
            raise ValueError("ZIP sem cobertura Shapefile. Prescrição ISOXML exige parser TLG específico.")
        approved, skipped, feature_count = [], [], 0
        for path in shape_names:
            if GUIDANCE.search(path.split("/")[-1]):
                skipped.append(path)
                continue
            stem = path[:-4]
            expected = [stem + "." + ext for ext in ("shp", "shx", "dbf", "prj")]
            if any(key not in names for key in expected):
                raise ValueError("Shapefile incompleto: arquivo SHP, SHX, DBF ou PRJ ausente em " + path)
            shp, shx, raw_dbf, projection = [z.read(names[key]) for key in expected]
            cols, count, header, rec = _dbf(raw_dbf)
            _valid_shape(shp, shx, count)
            if not _valid_prj(projection):
                raise ValueError("PRJ deve indicar WGS84 geográfico, EPSG:4326")
            rate = _field(cols, ACTUAL)
            if not rate or not _positive(raw_dbf, rate, count, header, rec):
                raise ValueError("Camada sem taxa aplicada real positiva: " + path)
            speed = _field(cols, SPEED)
            if not speed or not _positive(raw_dbf, speed, count, header, rec):
                raise ValueError("Camada sem velocidade válida: " + path)
            approved.append(stem)
            feature_count += count
        if not approved:
            raise ValueError("ZIP com apenas prescrição, linhas AB, limites ou geometrias sem taxa")
        # Copia para nova pasta compactada sem bordadura, guias ou prescriptions.
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as clean:
            for path, entry in names.items():
                stem = path.rsplit(".", 1)[0]
                if stem in approved or path.endswith((".json", ".xml", ".cpg", ".agdata")):
                    clean.writestr(entry.filename, z.read(entry))
        return CheckedArchive(raw=output.getvalue(), features=feature_count,
                              work_layers=approved, skipped=skipped)
