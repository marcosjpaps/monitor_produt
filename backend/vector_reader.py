"""Leitor SHP/DBF portátil. Converte explicitamente o CRS para WGS84."""
import json
from pathlib import Path
import shapefile
from shapely.geometry import shape, mapping
from shapely.ops import transform
from pyproj import CRS, Transformer

class Geometry:
    def __init__(self, geometry): self.geometry = geometry
    def ExportToJson(self): return json.dumps(mapping(self.geometry))
    def GetX(self): return self.geometry.x
    def GetY(self): return self.geometry.y

class Feature:
    def __init__(self, record, geometry=None): self.record, self.geometry = record, geometry
    def GetField(self, name):
        value = self.record.get(name)
        if hasattr(value, 'isoformat'): return value.isoformat()
        return value
    def GetGeometryRef(self): return Geometry(self.geometry) if self.geometry is not None else None

class Field:
    def __init__(self, name): self.name = name
    def GetName(self): return self.name

class Layer:
    def __init__(self, file):
        file = Path(file)
        reader = shapefile.Reader(dbf=str(file), encoding='utf-8', encodingErrors='replace') if file.suffix.lower()=='.dbf' else shapefile.Reader(str(file), encoding='utf-8', encodingErrors='replace')
        self.names = [f[0] for f in reader.fields[1:]]
        self.features = []
        transformer = None
        prj = file.with_suffix('.prj')
        if prj.exists():
            crs = CRS.from_wkt(prj.read_text(errors='replace'))
            transformer = Transformer.from_crs(crs, 4326, always_xy=True).transform
        try:
            for i, record in enumerate(reader.iterRecords()):
                geom = None
                if file.suffix.lower() != '.dbf':
                    raw = reader.shape(i)
                    if raw.shapeType != 0:
                        geom = shape(raw.__geo_interface__)
                        if transformer: geom = transform(transformer, geom)
                        elif any(abs(v)>limit for v,limit in zip(geom.bounds,(180,90,180,90))):
                            raise ValueError('Shapefile projetado sem .prj. Inclua a projeção do arquivo.')
                self.features.append(Feature(dict(zip(self.names, record)), geom))
        finally: reader.close()
    def __iter__(self): return iter(self.features)
    def GetFeatureCount(self): return len(self.features)
    def GetLayerDefn(self): return self
    def GetFieldCount(self): return len(self.names)
    def GetFieldDefn(self, i): return Field(self.names[i])
    def GetExtent(self):
        bounds=[f.geometry.bounds for f in self.features if f.geometry is not None and not f.geometry.is_empty]
        if not bounds: return (0,0,0,0)
        return (min(b[0] for b in bounds),max(b[2] for b in bounds),min(b[1] for b in bounds),max(b[3] for b in bounds))

class Dataset:
    def __init__(self, file): self.layer = Layer(file)
    def GetLayer(self): return self.layer

def Open(file): return Dataset(file) if Path(file).exists() else None

def UseExceptions(): pass
