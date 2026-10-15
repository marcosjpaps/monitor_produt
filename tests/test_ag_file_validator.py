import io, struct, zipfile
from backend.ag_file_validator import validate_ag_upload as validate

def shp():
    v = bytearray(200)
    struct.pack_into('>I', v, 0, 9994)
    struct.pack_into('>I', v, 24, 100)
    struct.pack_into('<I', v, 32, 5)
    struct.pack_into('<4d', v, 36, -46.5, -18, -46.4, -17.9)
    return bytes(v)

def dbf(columns=('APPLDRATE',), records=1):
    header = 32 + 32 * len(columns) + 1
    b=bytearray(header)
    b[0]=3
    struct.pack_into('<I',b,4,records)
    struct.pack_into('<H',b,8,header)
    struct.pack_into('<H',b,10,len(columns)+1)
    for i,c in enumerate(columns):b[32+i*32:32+i*32+len(c)]=c.encode()
    b[-1]=13
    return bytes(b)

def zipfiles(named):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        for k,v in named.items():z.writestr(k,v)
    return out.getvalue()

def tri(columns=('APPLDRATE',)):
    return zipfiles({'Coverage.shp':shp(),'Coverage.shx':b'\0'*100,'Coverage.dbf':dbf(columns)})

def test_jdl_legacy_valid():
    r=validate('JOB.jdl',b'bytes', 'johndeere')
    assert r['is_valid'] and r['operation_type']=='PARSER_REQUIRED'

def test_jdl_wrong_module():
    assert not validate('a.jdl',b'x','massey')['is_valid']

def test_zip_rate_valid():
    r=validate('trimble.zip',tri(),'massey')
    assert r['is_valid'] and r['operation_type']=='AS_APPLIED_COVERAGE'
    assert r['valid_layers'][0]['mapped_columns']['applied_rate']=='APPLDRATE'

def test_missing_dbf():
    z=zipfiles({'Coverage.shp':shp(),'Coverage.shx':b'\0'*100})
    r=validate('x.zip',z,'jacto')
    assert not r['is_valid'] and 'dbf' in r['error_message'].lower()

def test_rx_invalid():
    r=validate('x.zip',tri(('TARGETRATE',)),'massey')
    assert not r['is_valid'] and 'prescrição' in r['error_message']

def test_speed_only_invalid():
    r=validate('x.zip',tri(('SPEED','SWATHWIDTH')),'massey')
    assert not r['is_valid'] and 'taxa aplicada' in r['error_message']

def test_kml_geometry_mode():
    data=b'<kml><Placemark><Point><coordinates>-46,-18</coordinates></Point></Placemark></kml>'
    assert not validate('a.kml',data,'massey')['is_valid']
    r=validate('a.kml',data,'massey',allow_geometry_only=True)
    assert r['is_valid'] and r['operation_type']=='GEOMETRY_ONLY'

def test_bad_zip():
    assert not validate('x.zip',b'bad','jacto')['is_valid']

def test_boundary():
    named={'Limite.shp':shp(),'Limite.shx':b'\0'*100,'Limite.dbf':dbf(('APPLDRATE',))}
    assert not validate('x.zip',zipfiles(named),'jacto')['is_valid']

def test_jd_zip_jdl():
    r=validate('jdl.zip',zipfiles({'GS3_2630/r1.jdl':b'hello'}),'johndeere')
    assert r['is_valid'] and r['detected_brand']=='JOHN_DEERE'