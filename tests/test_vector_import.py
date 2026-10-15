import sqlite3,tempfile,unittest,json
from pathlib import Path
from backend.massey_import import save_feature,OP_COLUMNS,FIELD_COLUMNS,import_file
from backend.vector_reader import Open
import shapefile

class VectorImportTests(unittest.TestCase):
    def test_dbf_latin1_date_roundtrip_and_duplicate(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'field.shp'
            with shapefile.Writer(str(file),encoding='cp1252') as writer:
                writer.field('fazenda','C');writer.field('data','D')
                writer.poly([[[0,0],[0,1],[1,1],[1,0],[0,0]]]);writer.record('São José','20261015')
            file.with_suffix('.cpg').write_text('1252')
            feature=next(iter(Open(file).GetLayer()))
            self.assertEqual(feature.record['fazenda'],'São José')
            conn=sqlite3.connect(':memory:')
            conn.execute('CREATE TABLE farm_fields(id TEXT PRIMARY KEY,'+','.join(c+' TEXT' for c in FIELD_COLUMNS)+')')
            self.assertEqual(import_file(conn,file),1)
            self.assertEqual(import_file(conn,file),0)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM farm_fields').fetchone()[0],1)

if __name__=='__main__':unittest.main()
