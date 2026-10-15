"""Importação persistente de dados abertos do Massey/Trimble.
AGF criptografado é identificado e não tratado como telemetria decodificada.
"""
import hashlib, json, sqlite3, zipfile, tempfile; from .pg_adapter import connect as pg_connect
from pathlib import Path
from datetime import datetime, timezone
from xml.etree import ElementTree as ET
from shapely.geometry import shape, mapping
from pyproj import Geod
from .massey_engine import MASSEY_DB_PATH, DEFAULT_TRACTOR_FOLDER
from .archive_utils import safe_name, safe_extract
from .vector_reader import Open

OP_COLUMNS=['raw_name','clean_name','operation_type','client_name','farm_name','field_name','detected_fields','device_product','device_serial','vehicle_name','implement_name','controller_name','crypto_key_version','crypto_iv','payload_files','source_archive_path','manifest_xml_raw','file_size_bytes','area_ha','applied_rate','total_applied','swath_width_m','geojson_geometry','points_count','operation_date','target_rate','speed_kmh','flow_rate','product_name']
FIELD_COLUMNS=['farm_name','zone','field_number','field_desc','variety','planting_year','area_ha','center_lon','center_lat','bbox_json','boundary_geojson','source']

def connect():
    # Persistência PostgreSQL: não criar caminho SQLite no runtime imutável da Vercel.
    if not __import__('os').environ.get('VERCEL'):
        Path(MASSEY_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn=pg_connect()
    
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('CREATE TABLE IF NOT EXISTS agricultural_operations(id TEXT PRIMARY KEY,'+','.join(c+' TEXT' for c in OP_COLUMNS)+',imported_at TEXT)')
    conn.execute('CREATE TABLE IF NOT EXISTS farm_fields(id TEXT PRIMARY KEY,'+','.join(c+(' REAL' if c in ('area_ha','center_lon','center_lat') else ' TEXT') for c in FIELD_COLUMNS)+')')
    # Migração PostgreSQL idempotente; erros ignorados deixam a transação abortada.
    for table,columns in [('agricultural_operations',OP_COLUMNS+['imported_at']),('farm_fields',FIELD_COLUMNS)]:
        for c in columns:
            ctype = 'DOUBLE PRECISION' if table == 'farm_fields' and c in ('area_ha','center_lon','center_lat') else 'TEXT'
            conn.execute('ALTER TABLE '+table+' ADD COLUMN IF NOT EXISTS '+c+' '+ctype)
    conn.commit()
    return conn

def _json(v): return json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v

def save_feature(conn,feature,name,operation=False,origin_brand=None):
    geometry=feature.get('geometry');props=feature.get('properties') or {}
    if not geometry: raise ValueError('Geometria ausente')
    geom=shape(geometry)
    if geom.is_empty or not geom.is_valid: raise ValueError('Geometria inválida')
    if any(abs(v)>limit for v,limit in zip(geom.bounds,(180,90,180,90))): raise ValueError('Coordenadas fora de WGS84')
    p={str(k).lower():v for k,v in props.items()}
    def field_value(*names):
        return next((p[k] for k in names if p.get(k) is not None and str(p[k]).strip() != ''), None)
    applied = field_value('applied_rate','appldrate','appliedrat','apprate','rate_app','rateappli',
                          'taxa_aplic','dose_aplic','taxa_apl','vol_aplic','dose_real','tx_aplic',
                          'vrtrate','vrt_rate','ctrlrate','actrate','loggedrate')
    target = field_value('target_rate','targetrate','tgtrate','taxa_alvo','dose_alvo','rxrate')
    speed = field_value('speed_kmh','speed','groundspd','passspeed','gpsspeed','velocidade','veloc')
    width = field_value('swath_width_m','swathwidth','swath','implwidth','largura','larg_faixa')
    flow = field_value('flow_rate','flow','prodflow','vazao')
    product = field_value('product_name','product','prod_name','produto','insumo','tankmix')
    farm=p.get('farm_name') or p.get('nome_faz') or p.get('fazenda') or ''
    field=p.get('field_name') or p.get('talhao') or p.get('field_number') or Path(name).stem
    area=abs(Geod(ellps='WGS84').geometry_area_perimeter(geom)[0])/10000 if geom.geom_type in ('Polygon','MultiPolygon') else None
    key=hashlib.sha256(json.dumps([farm,field,geometry],sort_keys=True).encode()).hexdigest()
    feature={'type':'Feature','geometry':mapping(geom),'properties':props}
    if operation or geom.geom_type not in ('Polygon','MultiPolygon') or p.get('operation_type') or applied is not None:
        values={c:p.get(c) for c in OP_COLUMNS}
        values.update(raw_name=name,clean_name=p.get('clean_name') or Path(name).stem,farm_name=farm,field_name=str(field),geojson_geometry=json.dumps({"type":"FeatureCollection","features":[feature]}),area_ha=p.get('area_ha',area),detected_fields=json.dumps([str(field)]),points_count=len(list(geom.coords)) if geom.geom_type in ('LineString','Point') else 0,source_archive_path=name,operation_type=p.get('operation_type','Importação'),device_product=field_value('device_product') or origin_brand,applied_rate=applied,target_rate=target,speed_kmh=speed,swath_width_m=width,flow_rate=flow,product_name=product,imported_at=datetime.now(timezone.utc).isoformat())
        cols=OP_COLUMNS+['imported_at'];table='agricultural_operations'
    else:
        values={c:p.get(c) for c in FIELD_COLUMNS}
        values.update(farm_name=farm,field_number=str(field),field_desc=p.get('desc_talha') or field,area_ha=p.get('area_total') or area,center_lon=geom.centroid.x,center_lat=geom.centroid.y,bbox_json=json.dumps(geom.bounds),boundary_geojson=json.dumps(feature),source=name,zone=p.get('zona'),variety=p.get('variedade'))
        cols=FIELD_COLUMNS;table='farm_fields'
    existed=conn.execute('SELECT id FROM '+table+' WHERE id=?',(key,)).fetchone()
    conn.execute('INSERT INTO '+table+'(id,'+','.join(cols)+') VALUES('+','.join('?' for _ in range(len(cols)+1))+') ON CONFLICT(id) DO UPDATE SET '+','.join(c+'=excluded.'+c for c in cols),[key]+[_json(values.get(c)) for c in cols])
    return 0 if existed else 1

def import_file(conn,file,source=None,origin_brand=None):
    file=Path(file);name=source or file.name;ext=file.suffix.lower();count=0
    if ext in ('.zip','.agf'):
        if not zipfile.is_zipfile(file): raise ValueError('AGF proprietário/criptografado: exporte KML, SHP ou GeoJSON no monitor Trimble')
        with tempfile.TemporaryDirectory() as tmp:
            with zipfile.ZipFile(file) as archive: safe_extract(archive,tmp)
            candidates=[p for p in Path(tmp).rglob('*') if p.suffix.lower() in ('.kml','.shp','.geojson','.json')]
            if not candidates: raise ValueError('Pacote sem geometria aberta. Payload criptografado exige exportação pelo monitor Trimble.')
            for p in candidates: count+=import_file(conn,p,str(Path(name)/p.relative_to(tmp)),origin_brand=origin_brand)
    elif ext in ('.geojson','.json'):
        raw=json.loads(file.read_text(encoding='utf-8-sig'))
        features=raw.get('features') if raw.get('type')=='FeatureCollection' else [raw]
        if not features or any(f.get('type')!='Feature' for f in features): raise ValueError('JSON precisa conter GeoJSON Feature ou FeatureCollection')
        for f in features: count+=save_feature(conn,f,name,origin_brand=origin_brand)
    elif ext=='.shp':
        ds=Open(file)
        for feat in ds.GetLayer():
            geometry=feat.GetGeometryRef()
            if geometry: count+=save_feature(conn,{'geometry':json.loads(geometry.ExportToJson()),'properties':feat.record},name,origin_brand=origin_brand)
    elif ext=='.kml':
        root=ET.fromstring(file.read_bytes());ns={'k':'http://www.opengis.net/kml/2.2'}
        for pm in root.findall('.//k:Placemark',ns) or root.findall('.//Placemark'):
            label=pm.findtext('k:name',default=Path(name).stem,namespaces=ns)
            for kind in ('Polygon','LineString','Point'):
                for item in pm.findall('.//k:'+kind,ns) or pm.findall('.//'+kind):
                    el=item.find('.//k:coordinates',ns)
                    if el is None: el=item.find('.//coordinates')
                    # ElementTree elements sem filhos têm bool falso.
                    if el is None: el=item.find('.//k:coordinates',ns)
                    if el is None: continue
                    points=[[float(v) for v in p.split(',')[:2]] for p in (el.text or '').split()]
                    if kind=='Polygon':
                        if points and points[0]!=points[-1]:points.append(points[0])
                        coords=[points]
                    elif kind=='Point': coords=points[0] if points else []
                    else: coords=points
                    count+=save_feature(conn,{'geometry':{'type':kind,'coordinates':coords},'properties':{'field_name':label}},name,operation=kind!='Polygon',origin_brand=origin_brand)
        if not count: # Duplicados também são válidos; verificar existência de geometria.
            if not list(root.iterfind('.//k:coordinates',ns)) and not list(root.iterfind('.//coordinates')): raise ValueError('KML sem geometria')
    else: raise ValueError('Formato não suportado: '+ext)
    return count

def import_folder(folder=None):
    folder=Path(folder or DEFAULT_TRACTOR_FOLDER)
    if not folder.is_dir(): return {'status':'empty','imported':0,'is_cloud':True,'message':'Pasta do Massey não encontrada no servidor em nuvem. Selecione a pasta pelo navegador.'}
    results=[];count=0
    with connect() as conn:
        for p in folder.rglob('*'):
            if p.suffix.lower() not in ('.zip','.agf','.kml','.shp','.geojson','.json'):continue
            try:
                conn.execute('SAVEPOINT import_file');n=import_file(conn,p);conn.execute('RELEASE import_file');count+=n;results.append({'filename':p.name,'imported':n,'status':'imported' if n else 'duplicate'})
            except Exception as e:
                conn.execute('ROLLBACK TO import_file');conn.execute('RELEASE import_file');results.append({'filename':p.name,'status':'error','message':str(e)})
    errors=sum(r['status']=='error' for r in results)
    return {'status':'partial' if errors else 'ok','imported':count,'results':results,'message':f'{count} registros novos; {errors} arquivos com erro.'}
