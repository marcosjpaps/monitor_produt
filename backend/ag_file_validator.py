"""Pré-validação conservadora dos arquivos de aplicação agrícola.

Adaptado de agFileValidator.ts para os parsers Python deste projeto. Não
confunde a presença de arquivos ISOXML com a capacidade de decodificar TimeLog.
A validação de cabeçalho não substitui a leitura integral pelo parser nativo.
"""
from __future__ import annotations

import io
import json
import math
import re
import struct
import zipfile
from pathlib import PurePosixPath
from xml.etree import ElementTree

MAX_UNCOMPRESSED = 500 * 1024 * 1024
MAX_ZIP_MEMBERS = 10_000
RATE = {'APPLIEDRAT', 'VRT_RATE', 'CTRLRATE', 'APPRATE', 'RATE_APPLI',
        'TAXA_APLIC', 'DOSE_APLIC', 'TAXAAPLIC', 'DOSEAPLIC', 'TX_APLIC',
        'RATE_APP', 'RATEAPPLI', 'LIQ_RATE', 'TAXA_APL', 'VOL_APLIC',
        'DOSE_REAL', 'TAXA_REAL', 'APPLDRATE', 'ACTRATE', 'ACTUALRATE', 'LOGGEDRATE'}
TARGET = {'TARGETRATE', 'TGTRATE', 'TARGETRAT', 'TARGRATE', 'TAXA_ALVO',
          'DOSE_ALVO', 'TAXAALVO', 'DOSEALVO', 'RXRATE', 'PRESCRATE', 'TAXA_PRESC'}
SPEED = {'SPEED', 'VEHICLSPEE', 'GROUNDSPD', 'PASSSPEED', 'GPSSPEED', 'SPD', 'VELOCIDADE', 'VELOC', 'VEL_KMH'}
WIDTH = {'SWATHWIDTH', 'SWATH', 'IMPLWIDTH', 'IMPLEMENTW', 'LOGGEDSWAT', 'LARGURA', 'LARG_FAIXA', 'LARG_TRAB'}
FLOW = {'FLOW', 'PRODFLOW', 'VAZAO'}  # Vazão não é dose aplicada.
TIME = {'TIME', 'ISOTIME', 'TIMESTAMP', 'UTCTIME', 'DATETIME', 'DATA_HORA', 'DATAHORA'}
PRODUCT = {'PRODUCT', 'PROD_NAME', 'TANKMIX', 'PRODUTO', 'INSUMO'}
GUIDANCE = re.compile(r'(^|[/_\\-])(linha_?ab|ab_?line|guidance|guia|pista)([/_\\.-]|$)', re.I)
BOUNDARY = re.compile(r'(^|[/_\\-])(limite|bordadura|boundary|boundaries|perimetro)([/_\\.-]|$)', re.I)


def _base(valid=False, brand='UNKNOWN', kind='INVALID_FORMAT', operation='INCOMPLETE_PACKAGE', error=None):
    return {'is_valid': valid, 'detected_brand': brand, 'container_format': kind,
            'operation_type': operation, 'valid_layers': [], 'ignored_layers': [],
            'missing_files': [], 'warnings': [], 'error_message': error}


def _brand(paths, columns=()):
    names = ' '.join(paths).lower()
    cols = set(columns)
    signatures = [
        ('JOHN_DEERE', ('jdl', 'deere', 'greenstar', 'gs3_2630', 'gen4', 'rcd/'), {'VEHICLSPEE', 'VRT_RATE'}),
        ('STARA', ('stara', 'topper'), {'TAXA_APLIC', 'TAXA_ALVO'}),
        ('CASE_IH', ('case', '.cn1', 'afs', 'index.vy1'), {'GROUNDSPD', 'PRODFLOW'}),
        ('JACTO', ('jacto', 'otmis', 'otm'), {'DOSE_APLIC', 'VOL_APLIC'}),
        ('TRIMBLE', ('trimble', 'aggps', '.agf', '.agdata'), {'APPLDRATE', 'LOGGEDSWAT'}),
    ]
    scores = [(sum(2 for token in tokens if token in names) + sum(3 for c in terms if c in cols), brand)
              for brand, tokens, terms in signatures]
    highest = max(score for score, _ in scores)
    return next(brand for score, brand in scores if score == highest) if highest else 'GENERIC_AG'


def _head(zf, member, max_bytes):
    with zf.open(member) as src:
        return src.read(max_bytes)


def _shp_head(blob):
    if len(blob) < 100 or struct.unpack_from('>I', blob)[0] != 9994:
        raise ValueError('Cabeçalho SHP inválido (assinatura 9994 ausente).')
    size_words = struct.unpack_from('>I', blob, 24)[0]
    typ = struct.unpack_from('<I', blob, 32)[0]
    bbox = struct.unpack_from('<4d', blob, 36)
    if size_words <= 50 or typ not in {1, 3, 5, 8, 11, 13, 15, 21, 23, 25}:
        raise ValueError('SHP sem geometrias válidas ou tipo não suportado.')
    if not all(math.isfinite(n) for n in bbox) or bbox[0] > bbox[2] or bbox[1] > bbox[3]:
        raise ValueError('Coordenadas/bounding box inválidas no SHP.')
    return typ, [round(n, 8) for n in bbox]


def _dbf_head(blob):
    if len(blob) < 33:
        raise ValueError('Cabeçalho DBF truncado.')
    records = struct.unpack_from('<I', blob, 4)[0]
    header_size = struct.unpack_from('<H', blob, 8)[0]
    if not records or header_size < 33 or len(blob) < header_size:
        raise ValueError('DBF vazio ou cabeçalho incompleto.')
    columns = []
    for offset in range(32, header_size - 1, 32):
        if blob[offset] == 13:
            break
        col = blob[offset:offset + 11].split(b'\0', 1)[0].decode('latin-1').strip().upper()
        if col:
            columns.append(col)
    if not columns:
        raise ValueError('DBF sem colunas de atributos.')
    return records, columns


def _geo_only(result, allow_geometry_only, detail):
    result['operation_type'] = 'GEOMETRY_ONLY'
    result['warnings'].append(detail)
    result['is_valid'] = bool(allow_geometry_only)
    result['error_message'] = None if allow_geometry_only else 'Arquivo contém somente geometria, sem prova de aplicação real. Ative a opção "Importar somente geometria" ou envie telemetria com taxa aplicada.'
    return result


def validate_ag_upload(name: str, data: bytes, module: str, allow_geometry_only: bool = False):
    """Retorna laudo e bloqueia apenas o que o parser do módulo não deve ingerir."""
    lower = name.lower()
    ext = PurePosixPath(lower).suffix
    result = _base(error='Arquivo vazio ou não suportado.')
    if not data:
        return result
    if ext == '.jdl':
        if module not in ('johndeere', 'jacto'):
            result['error_message'] = 'Arquivo JDL exige o leitor John Deere.'
            return result
        result.update(is_valid=True, detected_brand='JOHN_DEERE', container_format='PROPRIETARY_RAW', operation_type='PARSER_REQUIRED', error_message=None)
        result['warnings'].append('O parser JDL validará os registros reais antes de gravar no banco.')
        return result
    if ext == '.rar':
        if module not in ('johndeere', 'jacto'):
            result['error_message'] = 'RAR não é suportado pelo leitor deste equipamento.'
            return result
        result.update(is_valid=True, container_format='PROPRIETARY_RAW', operation_type='PARSER_REQUIRED', error_message=None)
        result['warnings'].append('Pacote RAR será verificado e processado pelo parser do servidor.')
        return result
    if ext == '.agf' and module == 'massey':
        result.update(is_valid=True, detected_brand='TRIMBLE', container_format='PROPRIETARY_RAW', operation_type='PARSER_REQUIRED', error_message=None)
        result['warnings'].append('AGF aberto será lido pelo parser; AGF criptografado será rejeitado.')
        return result
    if ext in ('.kml', '.geojson', '.json'):
        if module != 'massey' and ext != '.kml':
            return result
        result['container_format'] = 'KML_VISUAL_ONLY' if ext == '.kml' else 'GEOJSON'
        try:
            if ext == '.kml':
                root = ElementTree.fromstring(data)
                if not any(x.tag.rsplit('}', 1)[-1] == 'coordinates' and (x.text or '').strip() for x in root.iter()):
                    raise ValueError('KML sem coordenadas.')
            else:
                obj = json.loads(data)
                if obj.get('type') not in ('Feature', 'FeatureCollection') or (obj.get('type') == 'FeatureCollection' and not obj.get('features')):
                    raise ValueError('GeoJSON não contém feições.')
        except (ValueError, ElementTree.ParseError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            result['error_message'] = f'Geometria inválida: {exc}'
            return result
        return _geo_only(result, allow_geometry_only, 'KML/GeoJSON não comprovam taxa de aplicação; área e velocidade não serão inventadas.')
    if ext != '.zip':
        result['error_message'] = 'Envie ZIP com SHP/SHX/DBF, JDL para John Deere, ou arquivo geográfico aberto em modo geometria.'
        return result
    result['container_format'] = 'SHAPEFILE_ZIP'
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = [i for i in zf.infolist() if not i.is_dir() and not i.filename.startswith('__MACOSX/')]
            if not infos:
                raise ValueError('ZIP vazio.')
            if len(infos) > MAX_ZIP_MEMBERS or sum(i.file_size for i in infos) > MAX_UNCOMPRESSED:
                raise ValueError('ZIP excede limites de quantidade/tamanho descompactado.')
            for info in infos:
                p = PurePosixPath(info.filename.replace('\\', '/'))
                if p.is_absolute() or '..' in p.parts or ':' in info.filename or ((info.external_attr >> 16) & 0o170000) == 0o120000:
                    raise ValueError('ZIP contém caminho ou link inseguro.')
            paths = [i.filename for i in infos]
            result['detected_brand'] = _brand(paths)
            jdls = [p for p in paths if p.lower().endswith('.jdl')]
            if jdls and module in ('johndeere', 'jacto'):
                result.update(is_valid=True, container_format='PROPRIETARY_RAW', operation_type='PARSER_REQUIRED', error_message=None)
                result['warnings'].append(f'{len(jdls)} JDL detectado(s); parser nativo confirmará telemetria real.')
                return result
            if module == 'johndeere':
                result['error_message'] = 'O leitor John Deere atual processa JDL; ZIP de Shapefile/ISOXML ainda não tem ingestão nesse módulo.'
                return result
            task = next((p for p in paths if p.lower().endswith('taskdata.xml')), None)
            if task:
                result['container_format'] = 'ISOXML_ZIP'
                result['missing_files'] = [] if any(re.search(r'(^|/)tlg[^/]*\.bin$', p, re.I) for p in paths) else ['TLG*.BIN']
                result['error_message'] = 'ISOXML identificado, mas não há decoder de TimeLog ISOXML neste leitor. Não é possível confirmar aplicação realizada.'
                return result
            groups = {}
            for p in paths:
                match = re.match(r'^(.*)\.(shp|shx|dbf|prj)$', p, re.I)
                if match:
                    groups.setdefault(match[1].lower(), {})[match[2].lower()] = p
            columns_seen = []
            for stem, files in groups.items():
                if not set(files).intersection({'shp', 'dbf', 'shx'}):
                    continue
                if GUIDANCE.search(stem) or BOUNDARY.search(stem):
                    reason = 'Linha AB/guia sem aplicação.' if GUIDANCE.search(stem) else 'Limite ou bordadura sem aplicação.'
                    result['ignored_layers'].append({'base_name': stem, 'reason': reason})
                    continue
                missing = [f'{stem}.{extension}' for extension in ('shp', 'shx', 'dbf') if extension not in files]
                if missing:
                    result['missing_files'].extend(missing)
                    result['ignored_layers'].append({'base_name': stem, 'reason': 'Shapefile incompleto: ' + ', '.join(missing)})
                    continue
                try:
                    geom_type, bbox = _shp_head(_head(zf, files['shp'], 100))
                    dbf_info = zf.getinfo(files['dbf'])
                    if dbf_info.file_size > MAX_UNCOMPRESSED:
                        raise ValueError('DBF excede o tamanho permitido.')
                    n, cols = _dbf_head(_head(zf, files['dbf'], min(dbf_info.file_size, 65536)))
                except (ValueError, KeyError, struct.error, EOFError, RuntimeError, zipfile.BadZipFile) as exc:
                    result['ignored_layers'].append({'base_name': stem, 'reason': str(exc)})
                    continue
                columns_seen.extend(cols)
                if not all(-180 <= x <= 180 for x in (bbox[0], bbox[2])) or not all(-90 <= y <= 90 for y in (bbox[1], bbox[3])):
                    if 'prj' not in files:
                        result['ignored_layers'].append({'base_name': stem, 'reason': 'Coordenadas fora dos limites geográficos sem arquivo PRJ para reprojeção.'})
                        continue
                    result['warnings'].append(f'{stem}: coordenadas projetadas; parser converterá usando PRJ.')
                elif 'prj' not in files:
                    result['warnings'].append(f'{stem}: PRJ ausente, sistema deverá confirmar o CRS.')
                has_rate = bool(RATE.intersection(cols))
                has_target = bool(TARGET.intersection(cols))
                has_speed = bool(SPEED.intersection(cols))
                has_width = bool(WIDTH.intersection(cols))
                has_flow = bool(FLOW.intersection(cols))
                has_time = bool(TIME.intersection(cols))
                layer = {'base_name': stem, 'shape_type': geom_type, 'record_count': n, 'bbox': bbox,
                         'raw_columns': cols, 'mapped_columns': {
                             'applied_rate': next((v for v in cols if v in RATE), None),
                             'target_rate': next((v for v in cols if v in TARGET), None),
                             'speed': next((v for v in cols if v in SPEED), None),
                             'swath_width': next((v for v in cols if v in WIDTH), None),
                             'flow': next((v for v in cols if v in FLOW), None),
                             'timestamp': next((v for v in cols if v in TIME), None),
                             'product': next((v for v in cols if v in PRODUCT), None)}}
                if has_rate:
                    if not has_speed: result['warnings'].append(f'{stem}: velocidade não informada.')
                    result['valid_layers'].append(layer)
                elif has_target and not has_speed and not has_time:
                    result['ignored_layers'].append({'base_name': stem, 'reason': 'Mapa de prescrição Rx: somente taxa alvo.'})
                elif has_speed or has_width or has_flow:
                    result['ignored_layers'].append({'base_name': stem, 'reason': 'Movimento/cobertura sem taxa aplicada comprovada.'})
                else:
                    result['ignored_layers'].append({'base_name': stem, 'reason': 'Somente geometria, sem taxa de aplicação.'})
            result['detected_brand'] = _brand(paths, columns_seen)
            if result['valid_layers']:
                result.update(is_valid=True, operation_type='AS_APPLIED_COVERAGE', error_message=None)
                return result
            if result['missing_files']:
                result['error_message'] = 'Shapefile incompleto: ' + ', '.join(result['missing_files'][:8])
                return result
            if result['ignored_layers']:
                reason = '; '.join(x['reason'] for x in result['ignored_layers'][:3])
                result['error_message'] = 'Nenhuma camada de aplicação confirmada: ' + reason
                return result
            if any(p.lower().endswith('.kml') for p in paths) and module == 'massey':
                return _geo_only(result, allow_geometry_only, 'ZIP com KML apenas: sem telemetria de aplicação.')
            result['error_message'] = 'ZIP sem Shapefile de aplicação reconhecido.'
            return result
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile, EOFError) as exc:
        result['error_message'] = f'Pacote ZIP inválido: {exc}'
        return result