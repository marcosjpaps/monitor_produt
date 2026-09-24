"""
Parser e Módulo de Leitura de Dados Trimble / Jacto AgGPS (CFX-750, FmX, GFX, Otmis)
Lê nativamente os arquivos da pasta AgGPS:
- Coverage.shp / Coverage.dbf (Polígonos de Cobertura e Aplicação)
- Swaths.shp / Swaths.dbf (Linhas e Curvas de Piloto Automático AB)
- EventHistory.dbf (Histórico detalhado de sessões, durações, volumes, operadores)
- CoverageHistory.xml (Áreas cobertas por sessão)
- implements_CFX.xml (Configurações de implemento e largura de faixa)
- origin.kml (Origem do talhão)
"""

import os
import glob
import json
import xml.etree.ElementTree as ET
from typing import Dict, Any, List, Optional
from osgeo import ogr

try:
    ogr.UseExceptions()
except Exception:
    pass

DEFAULT_AGGPS_PATH = os.environ.get(
    "AGGPS_DATA_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "AgGPS_Data")
)
SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "aggps_settings.json")

def get_active_aggps_path() -> str:
    """Retorna o caminho ativo configurado ou autodetectado para dados AgGPS."""
    # 1. Verifica configuração persistida em aggps_settings.json
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                custom_path = data.get("active_path")
                if custom_path and os.path.exists(custom_path):
                    return os.path.abspath(custom_path)
        except Exception:
            pass

    # 2. Caminhos candidatos conhecidos com prioridade
    candidates = [
        r"C:\Users\Topologia\Desktop\tratones minac\jactor\AgGPS",
        r"C:\Users\Topologia\Desktop\tratones minac\jactor",
        r"C:\Users\Topologia\Desktop\AgData",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "AgGPS_Data"),
        r"D:\AgGPS",
    ]
    for c in candidates:
        if os.path.exists(c):
            # Se tem subpasta Data ou arquivos dbf/shp diretamente
            if os.path.exists(os.path.join(c, "Data")) or glob.glob(os.path.join(c, "**", "*.dbf"), recursive=True):
                return os.path.abspath(c)

    return DEFAULT_AGGPS_PATH

def set_active_aggps_path(new_path: str) -> Dict[str, Any]:
    """Define e salva um novo caminho raiz para os dados AgGPS."""
    if not new_path:
        return {"success": False, "message": "O caminho não pode ser vazio."}
    new_path = new_path.strip().strip('"').strip("'")
    if not os.path.exists(new_path):
        return {"success": False, "message": f"O diretório não foi encontrado: {new_path}"}

    resolved_data_dir = _find_aggps_dir(new_path)
    events = glob.glob(os.path.join(resolved_data_dir, "**", "EventHistory.dbf"), recursive=True)
    coverages = glob.glob(os.path.join(resolved_data_dir, "**", "Coverage.shp"), recursive=True)

    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump({"active_path": os.path.abspath(new_path)}, f, indent=2, ensure_ascii=False)
    except Exception as e:
        return {"success": False, "message": f"Falha ao persistir configuração: {e}"}

    return {
        "success": True,
        "path": os.path.abspath(new_path),
        "data_dir": resolved_data_dir,
        "events_count": len(events),
        "coverages_count": len(coverages),
        "message": f"Pasta AgGPS conectada! {len(events)} eventos e {len(coverages)} polígonos/arquivos de cobertura detectados."
    }

def list_candidate_aggps_paths() -> List[Dict[str, Any]]:
    """Descobre e lista todas as pastas no sistema com dados AgGPS."""
    candidates = [
        r"C:\Users\Topologia\Desktop\tratones minac\jactor\AgGPS",
        r"C:\Users\Topologia\Desktop\tratones minac\jactor",
        r"C:\Users\Topologia\Desktop\AgData",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "AgGPS_Data"),
        r"D:\AgGPS",
    ]
    desktop = r"C:\Users\Topologia\Desktop"
    if os.path.exists(desktop):
        try:
            for entry in os.scandir(desktop):
                if entry.is_dir() and entry.path not in candidates:
                    name_l = entry.name.lower()
                    if "aggps" in name_l or "jacto" in name_l:
                        candidates.append(entry.path)
        except Exception:
            pass

    results = []
    current = get_active_aggps_path()
    for p in candidates:
        exists = os.path.exists(p)
        info = {
            "path": p,
            "exists": exists,
            "is_active": (os.path.abspath(p).lower() == os.path.abspath(current).lower()) if exists and current else False,
            "has_data": False,
            "events_count": 0,
            "coverages_count": 0
        }
        if exists:
            d = _find_aggps_dir(p)
            evs = glob.glob(os.path.join(d, "**", "EventHistory.dbf"), recursive=True)
            covs = glob.glob(os.path.join(d, "**", "Coverage.shp"), recursive=True)
            info["events_count"] = len(evs)
            info["coverages_count"] = len(covs)
            info["has_data"] = (len(evs) > 0 or len(covs) > 0)
        results.append(info)
    return results

def _find_aggps_dir(root_dir: Optional[str] = None) -> str:
    """Valida ou busca a pasta Data dentro do diretório AgGPS."""
    if not root_dir:
        root_dir = get_active_aggps_path()
    
    root_dir = os.path.abspath(root_dir.strip().strip('"').strip("'"))
    
    # 1. Se tem pasta 'Data' dentro
    p_data = os.path.join(root_dir, "Data")
    if os.path.exists(p_data):
        return p_data
        
    # 2. Se o próprio diretório já é a pasta 'Data'
    if os.path.basename(root_dir).lower() == "data" and os.path.exists(root_dir):
        return root_dir

    # 3. Se o próprio diretório já contém EventHistory.dbf ou Coverage.shp
    if os.path.exists(root_dir):
        if glob.glob(os.path.join(root_dir, "**", "EventHistory.dbf"), recursive=True):
            return root_dir

    return os.path.join(root_dir, "Data")

def get_aggps_farms_and_fields(root_dir: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retorna lista de fazendas e talhões disponíveis na pasta AgGPS."""
    data_dir = _find_aggps_dir(root_dir)
    if not os.path.exists(data_dir):
        return []

    farms_map = {}
    for eh_path in glob.glob(os.path.join(data_dir, "**", "EventHistory.dbf"), recursive=True):
        field_dir = os.path.dirname(eh_path)
        farm_dir = os.path.dirname(field_dir)
        farm_name = os.path.basename(farm_dir)
        field_name = os.path.basename(field_dir)

        if farm_name not in farms_map:
            farms_map[farm_name] = {
                "fazenda": farm_name,
                "talhoes": set(),
                "total_area_ha": 0.0
            }
        farms_map[farm_name]["talhoes"].add(field_name)

        # Soma área do talhão
        ds = ogr.Open(eh_path)
        if ds:
            layer = ds.GetLayer()
            for feat in layer:
                area_m2 = feat.GetField("Cover_Area") or 0.0
                farms_map[farm_name]["total_area_ha"] += (area_m2 / 10000.0)

    result = []
    for fz, d in farms_map.items():
        result.append({
            "fazenda": fz,
            "total_area_ha": round(d["total_area_ha"], 2),
            "area_ha": round(d["total_area_ha"], 2),
            "total_talhoes": len(d["talhoes"]),
            "talhoes": sorted(list(d["talhoes"]))
        })
    result.sort(key=lambda x: x["total_area_ha"], reverse=True)
    return result

def get_aggps_kpis(
    root_dir: Optional[str] = None,
    fazenda: Optional[str] = None,
    talhao: Optional[str] = None,
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None
) -> Dict[str, Any]:
    """Calcula os KPIs consolidados para Jacto / Trimble AgGPS."""
    data_dir = _find_aggps_dir(root_dir)
    if not os.path.exists(data_dir):
        return {
            "has_data": False,
            "summary": {"total_area_ha": 0, "total_polygons": 0, "total_events": 0, "total_swaths": 0},
            "operation": {"largura_m": 21.7, "avg_rate": 0, "avg_speed": 0, "total_volume": 0},
            "operator": "Nenhum"
        }

    total_area_ha = 0.0
    total_volume = 0.0
    total_distance_km = 0.0
    total_duration_hours = 0.0
    total_events = 0
    operators = set()
    implement_widths = []

    # Lê eventos
    for eh_path in glob.glob(os.path.join(data_dir, "**", "EventHistory.dbf"), recursive=True):
        field_dir = os.path.dirname(eh_path)
        farm_dir = os.path.dirname(field_dir)
        farm_name = os.path.basename(farm_dir)
        field_name = os.path.basename(field_dir)

        if fazenda and fazenda != "all" and farm_name != fazenda:
            continue
        if talhao and talhao != "all" and field_name != talhao:
            continue

        # Implement width do XML
        for xml_path in glob.glob(os.path.join(field_dir, "**", "implements_CFX.xml"), recursive=True):
            try:
                tree = ET.parse(xml_path)
                root = tree.getroot()
                for item in root.findall(".//item[@name='width']"):
                    implement_widths.append(float(item.text))
            except Exception:
                pass

        ds = ogr.Open(eh_path)
        if ds:
            layer = ds.GetLayer()
            for feat in layer:
                d_open = feat.GetField("Date_Open") or ""
                # Filtro de data
                d_clean = d_open.replace("/", "-")
                if data_inicio and d_clean < data_inicio:
                    continue
                if data_fim and d_clean > data_fim:
                    continue

                area_m2 = feat.GetField("Cover_Area") or 0.0
                dur_s = feat.GetField("Duration") or 0.0
                vol = feat.GetField("Cover_Vol") or 0.0
                dist_m = feat.GetField("Cover_Dist") or 0.0
                op = feat.GetField("Operator") or ""

                if area_m2 > 0 or dur_s > 0:
                    total_area_ha += (area_m2 / 10000.0)
                    total_volume += vol
                    total_distance_km += (dist_m / 1000.0)
                    total_duration_hours += (dur_s / 3600.0)
                    total_events += 1
                    if op and op != "Default_Operator":
                        operators.add(op)
                    elif op:
                        operators.add("Operador Padrão")

    # Contagem de polígonos e médias
    total_polygons = 0
    speeds = []
    rates = []

    for cov_path in glob.glob(os.path.join(data_dir, "**", "Coverage.shp"), recursive=True):
        cov_event_dir = os.path.dirname(cov_path)
        cov_field_dir = os.path.dirname(cov_event_dir)
        cov_farm_dir = os.path.dirname(cov_field_dir)
        c_farm = os.path.basename(cov_farm_dir)
        c_field = os.path.basename(cov_field_dir)

        if fazenda and fazenda != "all" and c_farm != fazenda:
            continue
        if talhao and talhao != "all" and c_field != talhao:
            continue

        ds = ogr.Open(cov_path)
        if ds:
            layer = ds.GetLayer()
            total_polygons += layer.GetFeatureCount()
            for feat in layer:
                s = feat.GetField("Speed")
                r = feat.GetField("AppldRate")
                if s is not None and s > 0: speeds.append(s)
                if r is not None and r > 0: rates.append(r)

    # Contagem de linhas AB
    total_swaths = 0
    for sw_path in glob.glob(os.path.join(data_dir, "**", "Swaths.shp"), recursive=True):
        ds = ogr.Open(sw_path)
        if ds:
            total_swaths += ds.GetLayer().GetFeatureCount()

    avg_speed = (sum(speeds) / len(speeds)) if speeds else 3.5
    avg_rate = (sum(rates) / len(rates)) if rates else 120.0
    largura_m = implement_widths[0] if implement_widths else 21.7

    return {
        "has_data": True,
        "summary": {
            "total_area_ha": round(total_area_ha, 2),
            "total_polygons": total_polygons,
            "total_events": total_events,
            "total_swaths": total_swaths,
            "total_distance_km": round(total_distance_km, 2),
            "total_duration_hours": round(total_duration_hours, 2),
            "total_volume": round(total_volume, 1)
        },
        "operation": {
            "largura_trabalho_m": round(largura_m, 2),
            "avg_rate": round(avg_rate, 1),
            "avg_speed_kmh": round(avg_speed, 1),
            "tipo_operacao": "Pulverização / Distribuição de Calda"
        },
        "operators": sorted(list(operators)) if operators else ["SIUMAR", "Operador Padrão"],
        "client": "usina G5"
    }

def get_aggps_events_list(
    root_dir: Optional[str] = None,
    fazenda: Optional[str] = None,
    talhao: Optional[str] = None,
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Retorna a lista de sessões/eventos para a tabela do dock inferior."""
    data_dir = _find_aggps_dir(root_dir)
    if not os.path.exists(data_dir):
        return []

    events_list = []

    for eh_path in sorted(glob.glob(os.path.join(data_dir, "**", "EventHistory.dbf"), recursive=True)):
        field_dir = os.path.dirname(eh_path)
        farm_dir = os.path.dirname(field_dir)
        client_dir = os.path.dirname(farm_dir)

        client_name = os.path.basename(client_dir)
        farm_name = os.path.basename(farm_dir)
        field_name = os.path.basename(field_dir)

        if fazenda and fazenda != "all" and farm_name != fazenda:
            continue
        if talhao and talhao != "all" and field_name != talhao:
            continue

        # Largura do implemento no XML
        width = 21.7
        for xml_path in glob.glob(os.path.join(field_dir, "**", "implements_CFX.xml"), recursive=True):
            try:
                tree = ET.parse(xml_path)
                for item in tree.getroot().findall(".//item[@name='width']"):
                    width = float(item.text)
            except Exception:
                pass

        ds = ogr.Open(eh_path)
        if ds:
            layer = ds.GetLayer()
            for feat in layer:
                d_open = feat.GetField("Date_Open") or ""
                t_open = feat.GetField("Time_Open") or ""
                d_close = feat.GetField("Date_Close") or ""
                t_close = feat.GetField("Time_Close") or ""

                d_clean = d_open.replace("/", "-")
                if data_inicio and d_clean < data_inicio: continue
                if data_fim and d_clean > data_fim: continue

                area_m2 = feat.GetField("Cover_Area") or 0.0
                dur_s = feat.GetField("Duration") or 0.0
                vol = feat.GetField("Cover_Vol") or 0.0
                dist_m = feat.GetField("Cover_Dist") or 0.0
                op = feat.GetField("Operator") or "Operador Padrão"
                ev_name = feat.GetField("Event") or ""

                area_ha = round(area_m2 / 10000.0, 2)
                dur_h = round(dur_s / 3600.0, 2)

                if area_ha > 0 or dur_s > 0:
                    events_list.append({
                        "client": client_name,
                        "farm": farm_name,
                        "field": field_name,
                        "event": ev_name,
                        "operator": op if op != "Default_Operator" else "Operador Padrão",
                        "area_ha": area_ha,
                        "volume_l_kg": round(vol, 1),
                        "distance_km": round(dist_m / 1000.0, 2),
                        "duration_hours": dur_h,
                        "largura_m": round(width, 2),
                        "date_open": f"{d_open} {t_open}",
                        "date_close": f"{d_close} {t_close}",
                        "date": d_open
                    })

    events_list.sort(key=lambda x: x["date_open"], reverse=True)
    return events_list

def get_aggps_coverage_geojson(
    root_dir: Optional[str] = None,
    fazenda: Optional[str] = None,
    talhao: Optional[str] = None,
    event_name: Optional[str] = None,
    max_features: int = 15000
) -> Dict[str, Any]:
    """
    Retorna os polígonos reais de cobertura (Coverage.shp) em formato GeoJSON para o Leaflet.
    Aplica amostragem inteligente caso o total de polígonos seja muito alto para manter 60 FPS.
    """
    data_dir = _find_aggps_dir(root_dir)
    features = []
    bounds = {"min_lat": 90, "max_lat": -90, "min_lon": 180, "max_lon": -180}

    for cov_path in glob.glob(os.path.join(data_dir, "**", "Coverage.shp"), recursive=True):
        cov_event_dir = os.path.dirname(cov_path)
        cov_field_dir = os.path.dirname(cov_event_dir)
        cov_farm_dir = os.path.dirname(cov_field_dir)
        c_farm = os.path.basename(cov_farm_dir)
        c_field = os.path.basename(cov_field_dir)
        c_event = os.path.basename(cov_event_dir)

        if fazenda and fazenda != "all" and c_farm != fazenda: continue
        if talhao and talhao != "all" and c_field != talhao: continue
        if event_name and event_name != "all" and c_event != event_name: continue

        ds = ogr.Open(cov_path)
        if not ds: continue
        layer = ds.GetLayer()
        total_feats = layer.GetFeatureCount()
        step = max(1, total_feats // max_features) if total_feats > max_features else 1

        ext = layer.GetExtent()
        bounds["min_lon"] = min(bounds["min_lon"], ext[0])
        bounds["max_lon"] = max(bounds["max_lon"], ext[1])
        bounds["min_lat"] = min(bounds["min_lat"], ext[2])
        bounds["max_lat"] = max(bounds["max_lat"], ext[3])

        idx = 0
        for feat in layer:
            if idx % step == 0:
                geom = feat.GetGeometryRef()
                if geom:
                    geom_json = json.loads(geom.ExportToJson())
                    rate = feat.GetField("AppldRate") or 0.0
                    spd = feat.GetField("Speed") or 0.0
                    dt = feat.GetField("DateClosed") or ""
                    tm = feat.GetField("TimeClosed") or ""

                    features.append({
                        "type": "Feature",
                        "geometry": geom_json,
                        "properties": {
                            "rate": round(rate, 1),
                            "speed": round(spd, 1),
                            "date": dt,
                            "time": tm,
                            "farm": c_farm,
                            "field": c_field,
                            "event": c_event
                        }
                    })
            idx += 1

    return {
        "type": "FeatureCollection",
        "features": features,
        "total_polygons": len(features),
        "bounds": bounds if bounds["min_lat"] <= bounds["max_lat"] else None
    }

def get_aggps_swaths_geojson(
    root_dir: Optional[str] = None,
    fazenda: Optional[str] = None,
    talhao: Optional[str] = None
) -> Dict[str, Any]:
    """Retorna as linhas e curvas de piloto automático (Swaths.shp) em GeoJSON."""
    data_dir = _find_aggps_dir(root_dir)
    features = []

    for sw_path in glob.glob(os.path.join(data_dir, "**", "Swaths.shp"), recursive=True):
        sw_field_dir = os.path.dirname(sw_path)
        sw_farm_dir = os.path.dirname(sw_field_dir)
        c_farm = os.path.basename(sw_farm_dir)
        c_field = os.path.basename(sw_field_dir)

        if fazenda and fazenda != "all" and c_farm != fazenda: continue
        if talhao and talhao != "all" and c_field != talhao: continue

        ds = ogr.Open(sw_path)
        if not ds: continue
        layer = ds.GetLayer()
        for feat in layer:
            geom = feat.GetGeometryRef()
            if geom:
                geom_json = json.loads(geom.ExportToJson())
                name = feat.GetField("Name") or "Linha AB"
                length = feat.GetField("Length") or 0.0
                dt = feat.GetField("Date") or ""
                tm = feat.GetField("Time") or ""

                features.append({
                    "type": "Feature",
                    "geometry": geom_json,
                    "properties": {
                        "name": name,
                        "length_m": round(length, 1),
                        "date": dt,
                        "time": tm,
                        "farm": c_farm,
                        "field": c_field
                    }
                })

    return {
        "type": "FeatureCollection",
        "features": features,
        "total_swaths": len(features)
    }
