"""
Módulo de Integração Massey Ferguson & Trimble TMX-2050 (Precision-IQ / FmX Plus)
Conecta-se diretamente ao banco de dados SQLite e dados de telemetria.
Em produção, configure MASSEY_DB_PATH via variável de ambiente.
"""

import os
import re
import json
import sqlite3; from .pg_adapter import connect as pg_connect
import unicodedata
from typing import Dict, Any, List, Optional

# Caminhos configuráveis via variáveis de ambiente (sem hardcode de máquina)
MASSEY_DB_PATH = os.environ.get(
    "MASSEY_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "trimble_data.db")
)
DEFAULT_TRACTOR_FOLDER = os.environ.get(
    "MASSEY_TRACTOR_FOLDER",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "massey")
)

def _get_db_conn() -> Optional[sqlite3.Connection]:
    conn = pg_connect()
    return conn

def _norm_str(text: str) -> str:
    if not text:
        return ""
    return unicodedata.normalize('NFKD', str(text)).encode('ASCII', 'ignore').decode('utf-8').lower().strip()

def _extract_op_numbers(text: str) -> set:
    if not text:
        return set()
    res = set()
    t_clean = text.replace('_', ' ').replace('/', ' ').replace('\\', ' ')
    for m in re.finditer(r'(\d+)\s*(?:a|ao|ate|-)\s*(\d+)', t_clean, re.IGNORECASE):
        start, end = int(m.group(1)), int(m.group(2))
        if 0 < end - start <= 50:
            for n in range(start, end + 1):
                res.add(str(n))
    for n in re.findall(r'\b\d+\b', t_clean):
        res.add(str(int(n)))
    return res

def _get_operations_map(cur: sqlite3.Cursor) -> Dict[str, List[Dict[str, Any]]]:
    ops = cur.execute('SELECT * FROM agricultural_operations').fetchall()
    op_map = {}
    for op in ops:
        f_norm = re.sub(r'[^a-z0-9]', '', _norm_str(op["farm_name"] or "")).replace('fazenda', '')
        det_fields = []
        if op["detected_fields"]:
            try:
                det_fields = json.loads(op["detected_fields"]) if isinstance(op["detected_fields"], str) else op["detected_fields"]
            except Exception:
                pass
        op_text = f"{op['clean_name'] or ''} {op['field_name'] or ''} {' '.join(det_fields)}"
        nums = _extract_op_numbers(op_text)
        if f_norm not in op_map:
            op_map[f_norm] = []
        op_map[f_norm].append({
            "id": op["id"],
            "clean_name": op["clean_name"] or op["field_name"],
            "operation_type": op["operation_type"],
            "area_ha": op["area_ha"],
            "date": op["operation_date"],
            "nums": nums
        })
    return op_map

def get_massey_stats() -> Dict[str, Any]:
    """Retorna indicadores operacionais consolidados do trator Massey Ferguson."""
    conn = _get_db_conn()
    if not conn:
        return {
            "has_data": False,
            "total_operations": 0,
            "total_farms": 0,
            "total_fields": 0,
            "total_applied_ha": 0.0,
            "total_sig_ha": 0.0,
            "farms_list": [],
            "operation_types_distribution": {}
        }
    try:
        cur = conn.cursor()
        ops = cur.execute('SELECT * FROM agricultural_operations').fetchall()
        total_ops = len(ops)
        
        # Área total das operações
        total_applied = sum([float(op["area_ha"] or 0) for op in ops])
        
        # Fazendas de operações
        farms_ops = sorted(list({op["farm_name"] for op in ops if op["farm_name"]}))
        
        # Monitores
        monitors = sorted(list({op["device_serial"] for op in ops if op["device_serial"]}))
        
        # Tipos de operação
        type_counts = {}
        for op in ops:
            t = op["operation_type"] or "Geral"
            type_counts[t] = type_counts.get(t, 0) + 1
            
        # Talhões únicos das operações
        unique_fields_ops = set()
        for op in ops:
            det = []
            if op["detected_fields"]:
                try:
                    det = json.loads(op["detected_fields"]) if isinstance(op["detected_fields"], str) else op["detected_fields"]
                except Exception:
                    pass
            for f in det:
                unique_fields_ops.add(f)
            if op["field_name"]:
                unique_fields_ops.add(op["field_name"])
                
        # Estatísticas do SIG (farm_fields)
        fields_row = cur.execute('SELECT COUNT(*) AS total_fields, SUM(area_ha) AS area_sum FROM farm_fields').fetchone()
        total_fields_sig = fields_row['total_fields'] if fields_row else 0
        total_sig_area = float(fields_row['area_sum'] or 0) if fields_row else 0.0
        
        farms_sig = [r['farm_name'] for r in cur.execute('SELECT DISTINCT farm_name FROM farm_fields WHERE farm_name IS NOT NULL ORDER BY farm_name').fetchall()]
        
        # Veículo e Controlador padrão
        first_op = ops[0] if ops else None
        vehicle_name = first_op["vehicle_name"] if first_op and first_op["vehicle_name"] else "Não informado"
        controller_name = first_op["controller_name"] if first_op and first_op["controller_name"] else "Não informado"
        implement_name = first_op["implement_name"] if first_op and first_op["implement_name"] else "Não informado"
        device_product = first_op["device_product"] if first_op and first_op["device_product"] else "Não informado"

        return {
            "has_data": total_ops > 0,
            "total_operations": total_ops,
            "total_applied_ha": round(total_applied, 2),
            "total_farms": len(farms_sig) if farms_sig else len(farms_ops),
            "total_fields": total_fields_sig,
            "total_sig_ha": round(total_sig_area, 2),
            "farms_list": farms_sig if farms_sig else farms_ops,
            "monitors_list": monitors,
            "operation_types_distribution": type_counts,
            "machine": {
                "vehicle_name": vehicle_name,
                "controller_name": controller_name,
                "implement_name": implement_name,
                "device_product": device_product,
                "device_serial": monitors[0] if monitors else "Não informado",
                "client": first_op["client_name"] if first_op else "Não informado"
            }
        }
    finally:
        conn.close()

def get_massey_operations(
    search: Optional[str] = None,
    farm: Optional[str] = None,
    field: Optional[str] = None,
    type: Optional[str] = None,
    serial: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Retorna lista filtrada de operações do monitor TMX-2050."""
    conn = _get_db_conn()
    if not conn:
        return []
    try:
        cur = conn.cursor()
        query = "SELECT * FROM agricultural_operations WHERE 1=1"
        params = []
        
        if search:
            query += " AND (clean_name LIKE ? OR raw_name LIKE ? OR id LIKE ? OR field_name LIKE ? OR farm_name LIKE ?)"
            s = f"%{search.strip()}%"
            params.extend([s, s, s, s, s])
            
        if farm and farm != "all":
            query += " AND farm_name = ?"
            params.append(farm)
            
        if field and field != "all":
            query += " AND (field_name = ? OR clean_name LIKE ?)"
            params.extend([field, f"%{field}%"])
            
        if type and type != "all":
            query += " AND operation_type = ?"
            params.append(type)
            
        if serial and serial != "all":
            query += " AND device_serial = ?"
            params.append(serial)
            
        query += " ORDER BY imported_at DESC"
        rows = cur.execute(query, params).fetchall()
        
        result = []
        for r in rows:
            geom = None
            if r["geojson_geometry"]:
                try:
                    geom = json.loads(r["geojson_geometry"]) if isinstance(r["geojson_geometry"], str) else r["geojson_geometry"]
                except Exception:
                    pass
            det_fields = []
            if r["detected_fields"]:
                try:
                    det_fields = json.loads(r["detected_fields"]) if isinstance(r["detected_fields"], str) else r["detected_fields"]
                except Exception:
                    pass
            
            result.append({
                "uuid": r["id"],
                "raw_name": r["raw_name"],
                "clean_name": r["clean_name"],
                "operation_type": r["operation_type"],
                "client_name": r["client_name"],
                "farm_name": r["farm_name"],
                "field_name": r["field_name"],
                "detected_fields": det_fields,
                "device_product": r["device_product"],
                "device_serial": r["device_serial"],
                "vehicle_name": r["vehicle_name"] or "Não informado",
                "implement_name": r["implement_name"] or "Não informado",
                "controller_name": r["controller_name"] or "Não informado",
                "area_ha": r["area_ha"],
                "applied_rate": r["applied_rate"],
                "total_applied": r["total_applied"],
                "swath_width_m": r["swath_width_m"],
                "geojson_geometry": geom,
                "points_count": r["points_count"],
                "operation_date": r["operation_date"],
                "imported_at": r["imported_at"]
            })
        return result
    finally:
        conn.close()

def get_massey_operation_by_id(op_uuid: str) -> Optional[Dict[str, Any]]:
    """Obtém detalhes de uma operação com seu manifesto XML bruto."""
    conn = _get_db_conn()
    if not conn:
        return None
    try:
        cur = conn.cursor()
        r = cur.execute("SELECT * FROM agricultural_operations WHERE id = ?", (op_uuid,)).fetchone()
        if not r:
            return None
        geom = None
        if r["geojson_geometry"]:
            try:
                geom = json.loads(r["geojson_geometry"]) if isinstance(r["geojson_geometry"], str) else r["geojson_geometry"]
            except Exception:
                pass
        det_fields = []
        if r["detected_fields"]:
            try:
                det_fields = json.loads(r["detected_fields"]) if isinstance(r["detected_fields"], str) else r["detected_fields"]
            except Exception:
                pass
        payload_files = []
        if r["payload_files"]:
            try:
                payload_files = json.loads(r["payload_files"]) if isinstance(r["payload_files"], str) else r["payload_files"]
            except Exception:
                pass
        return {
            "uuid": r["id"],
            "raw_name": r["raw_name"],
            "clean_name": r["clean_name"],
            "operation_type": r["operation_type"],
            "client_name": r["client_name"],
            "farm_name": r["farm_name"],
            "field_name": r["field_name"],
            "detected_fields": det_fields,
            "device_product": r["device_product"],
            "device_serial": r["device_serial"],
            "vehicle_name": r["vehicle_name"],
            "implement_name": r["implement_name"],
            "controller_name": r["controller_name"],
            "crypto_key_version": r["crypto_key_version"],
            "crypto_iv": r["crypto_iv"],
            "payload_files": payload_files,
            "source_archive_path": r["source_archive_path"],
            "manifest_xml_raw": r["manifest_xml_raw"],
            "file_size_bytes": r["file_size_bytes"],
            "area_ha": r["area_ha"],
            "applied_rate": r["applied_rate"],
            "total_applied": r["total_applied"],
            "swath_width_m": r["swath_width_m"],
            "geojson_geometry": geom,
            "points_count": r["points_count"],
            "operation_date": r["operation_date"],
            "imported_at": r["imported_at"]
        }
    finally:
        conn.close()

def get_massey_farm_fields(
    farm: Optional[str] = None,
    zone: Optional[str] = None,
    variety: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 1000,
    offset: int = 0
) -> Dict[str, Any]:
    """Retorna lista de talhões cadastrais do SIG com cruzamento de operações."""
    conn = _get_db_conn()
    if not conn:
        return {"total": 0, "total_area_ha": 0, "farms": [], "varieties": [], "fields": []}
    try:
        cur = conn.cursor()
        op_map = _get_operations_map(cur)
        
        query = "SELECT * FROM farm_fields WHERE 1=1"
        count_query = "SELECT COUNT(*), SUM(area_ha) FROM farm_fields WHERE 1=1"
        params = []
        
        if farm and farm != "all":
            query += " AND farm_name = ?"
            count_query += " AND farm_name = ?"
            params.append(farm)
        if zone and zone != "all":
            query += " AND zone = ?"
            count_query += " AND zone = ?"
            params.append(zone)
        if variety and variety != "all":
            query += " AND variety = ?"
            count_query += " AND variety = ?"
            params.append(variety)
        if search:
            query += " AND (field_number LIKE ? OR field_desc LIKE ? OR farm_name LIKE ? OR variety LIKE ?)"
            count_query += " AND (field_number LIKE ? OR field_desc LIKE ? OR farm_name LIKE ? OR variety LIKE ?)"
            s = f"%{search.strip()}%"
            params.extend([s, s, s, s])
            
        stats_row = cur.execute(count_query, params).fetchone()
        total_count = stats_row['total_fields'] if stats_row else 0
        total_area = float(stats_row['area_sum'] or 0) if stats_row else 0.0
        
        farms_list = [r['farm_name'] for r in cur.execute("SELECT DISTINCT farm_name FROM farm_fields WHERE farm_name IS NOT NULL ORDER BY farm_name").fetchall()]
        varieties_list = [r['variety'] for r in cur.execute("SELECT DISTINCT variety FROM farm_fields WHERE variety IS NOT NULL ORDER BY variety").fetchall()]
        
        query += " ORDER BY farm_name, field_number LIMIT ? OFFSET ?"
        exec_params = list(params) + [limit, offset]
        rows = cur.execute(query, exec_params).fetchall()
        
        fields = []
        for r in rows:
            f_norm = re.sub(r'[^a-z0-9]', '', _norm_str(r["farm_name"] or "")).replace('fazenda', '')
            matched_ops = []
            if f_norm in op_map:
                for op in op_map[f_norm]:
                    if r["field_number"] in op["nums"]:
                        matched_ops.append({
                            "id": op["id"],
                            "name": op["clean_name"],
                            "type": op["operation_type"],
                            "area_ha": op["area_ha"],
                            "date": op["date"]
                        })
            bbox = None
            if r["bbox_json"]:
                try:
                    bbox = json.loads(r["bbox_json"]) if isinstance(r["bbox_json"], str) else r["bbox_json"]
                except Exception:
                    pass
            fields.append({
                "id": r["id"],
                "farm_name": r["farm_name"],
                "zone": r["zone"],
                "field_number": r["field_number"],
                "field_desc": r["field_desc"],
                "planting_year": r["planting_year"],
                "variety": r["variety"],
                "area_ha": f"{r['area_ha']:.2f}" if r["area_ha"] else "0.00",
                "center_lon": r["center_lon"],
                "center_lat": r["center_lat"],
                "bbox": bbox,
                "has_operations": len(matched_ops) > 0,
                "operations_count": len(matched_ops),
                "operations": matched_ops
            })
        return {
            "total": total_count,
            "total_area_ha": round(total_area, 2),
            "farms": farms_list,
            "varieties": varieties_list,
            "fields": fields
        }
    finally:
        conn.close()

def get_massey_farm_fields_geojson(
    farm: Optional[str] = None,
    search: Optional[str] = None
) -> Dict[str, Any]:
    """Retorna GeoJSON FeatureCollection com polígonos reais dos talhões do SIG."""
    conn = _get_db_conn()
    if not conn:
        return {"type": "FeatureCollection", "features": []}
    try:
        cur = conn.cursor()
        op_map = _get_operations_map(cur)
        
        query = "SELECT * FROM farm_fields WHERE 1=1"
        params = []
        if farm and farm != "all":
            query += " AND farm_name = ?"
            params.append(farm)
        if search:
            query += " AND (field_number LIKE ? OR field_desc LIKE ? OR farm_name LIKE ?)"
            s = f"%{search.strip()}%"
            params.extend([s, s, s])
            
        rows = cur.execute(query, params).fetchall()
        features = []
        for r in rows:
            feat_raw = r["boundary_geojson"]
            if not feat_raw:
                continue
            feat = None
            try:
                feat = json.loads(feat_raw) if isinstance(feat_raw, str) else feat_raw
            except Exception:
                continue
                
            f_norm = re.sub(r'[^a-z0-9]', '', _norm_str(r["farm_name"] or "")).replace('fazenda', '')
            matched_ops = []
            if f_norm in op_map:
                for op in op_map[f_norm]:
                    if r["field_number"] in op["nums"]:
                        matched_ops.append(op)
                        
            props = feat.get("properties", {}).copy() if isinstance(feat.get("properties"), dict) else {}
            props["id"] = r["id"]
            props["farm"] = r["farm_name"]
            props["zone"] = r["zone"]
            props["talhao"] = r["field_number"]
            props["desc"] = r["field_desc"]
            props["variety"] = r["variety"]
            props["planting_year"] = r["planting_year"]
            props["area_ha"] = f"{r['area_ha']:.2f}" if r["area_ha"] else "0.00"
            props["center_lon"] = r["center_lon"]
            props["center_lat"] = r["center_lat"]
            props["has_ops"] = len(matched_ops) > 0
            props["ops_count"] = len(matched_ops)
            props["ops_names"] = [op["clean_name"] for op in matched_ops]
            
            features.append({
                "type": "Feature",
                "geometry": feat.get("geometry") if "geometry" in feat else feat,
                "properties": props
            })
            
        return {
            "type": "FeatureCollection",
            "features": features
        }
    finally:
        conn.close()
