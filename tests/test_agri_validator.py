"""Testes unitários do gate GIS pré-upload, sem acesso ao Neon."""
import io
import struct
import unittest
import zipfile

from backend.agri_validator import inspect_application_zip


def make_package(cols=("Taxa_Aplic", "Velocidade"), layer="Topper_Trabalho",
                 crs='GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"],UNIT["Degree",0.0174532925199433]]'):
    count = 1
    rawdbf = bytearray(32 + 32 * len(cols) + 1 + (1 + 12 * len(cols)))
    rawdbf[0] = 3
    struct.pack_into("<IHH", rawdbf, 4, count, 32 + 32 * len(cols) + 1, 1 + 12 * len(cols))
    for i, name in enumerate(cols):
        desc = 32 + 32 * i
        rawdbf[desc:desc+10] = name.encode("ascii")[:10].ljust(10, b"\0")
        rawdbf[desc+11] = ord("N")
        rawdbf[desc+16] = 12
    rawdbf[32 + 32 * len(cols)] = 13
    at = 32 + 32 * len(cols) + 1
    rawdbf[at] = 32
    for i in range(len(cols)):
        rawdbf[at+1+i*12:at+1+(i+1)*12] = b"        25.0"
    # Cabeçalhos SHP e SHX geográficos com uma feição indexada.
    shape = bytearray(128)
    idx = bytearray(108)
    for data in [shape, idx]:
        struct.pack_into(">I", data, 0, 9994)
        struct.pack_into(">I", data, 24, len(data)//2)
        struct.pack_into("<I", data, 28, 1000)
        struct.pack_into("<I", data, 32, 1)
        struct.pack_into("<dddd", data, 36, -46.5, -17.8, -46.5, -17.8)
    struct.pack_into(">II", idx, 100, 50, 10)
    struct.pack_into(">II", shape, 100, 1, 10)
    struct.pack_into("<Idd", shape, 108, 1, -46.5, -17.8)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for e, content in [("shp", shape),("shx",idx),("dbf",rawdbf),("prj",crs.encode())]:
            z.writestr(layer+"."+e, content)
    return buf.getvalue()


class UploadGISRules(unittest.TestCase):
    def test_application_allowed(self):
        result = inspect_application_zip("trabalho.zip", make_package(), "jacto")
        self.assertEqual(result.features, 1)
        self.assertEqual(result.work_layers, ["topper_trabalho"])
        self.assertTrue(result.raw.startswith(b"PK"))

    def test_guidance_rejected(self):
        with self.assertRaisesRegex(ValueError, "apenas"):
            inspect_application_zip("guia.zip", make_package(layer="Linha_AB"), "jacto")

    def test_missing_speed_rejected(self):
        with self.assertRaisesRegex(ValueError, "velocidade"):
            inspect_application_zip("trabalho.zip", make_package(cols=("Taxa_Aplic",)), "massey")

    def test_projected_rejected(self):
        utm='PROJCS["WGS_1984_UTM_Zone_23S",GEOGCS["GCS_WGS_1984"]]'
        with self.assertRaisesRegex(ValueError, "EPSG:4326"):
            inspect_application_zip("trabalho.zip", make_package(crs=utm), "jacto")

    def test_kml_is_not_application(self):
        with self.assertRaisesRegex(ValueError, "ZIP"):
            inspect_application_zip("trabalho.kml", b"<kml></kml>", "jacto")


if __name__ == "__main__":
    unittest.main()
