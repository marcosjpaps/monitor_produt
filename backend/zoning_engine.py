# -*- coding: utf-8 -*-
"""
Motor de Zoneamento Agronômico & Interpolação Espacial em Grade (Zoning Engine)
Inspirado na arquitetura do TwinYields/farmingpy (zoning.py e ddi.py).
Converte nuvens de pontos de telemetria (JDL, ISOBUS, Shapefiles) em:
1. Grade regular discretizada (Raster / Vector Grid de 5m, 10m ou 20m)
2. Zonas homogêneas de manejo agronômico (Sub-dose, Ideal, Alta e Crítica)
3. Indicadores estatísticos de precisão (Coeficiente de Variação CV%, Aderência à Prescrição)
"""

import math
import numpy as np
from typing import List, Dict, Any, Optional

def compute_agronomic_zoning(
    points: List[Dict[str, Any]],
    target_rate: Optional[float] = None,
    grid_size_m: float = 10.0,
    max_cells: int = 1500
) -> Dict[str, Any]:
    """
    Recebe lista de pontos [{lat, lng, rate, ...}] e gera a grade de zoneamento agronômico.
    """
    if not points or len(points) < 5:
        return {
            "success": False,
            "message": "Número insuficiente de pontos para gerar zoneamento."
        }

    valid_pts = []
    for p in points:
        lat = p.get("lat") if p.get("lat") is not None else p.get("latitude")
        lng = p.get("lng") if p.get("lng") is not None else p.get("longitude")
        rate = p.get("rate") if p.get("rate") is not None else p.get("taxa_aplicacao")
        if lat is not None and lng is not None and rate is not None:
            valid_pts.append({"lat": float(lat), "lng": float(lng), "rate": float(rate)})

    if len(valid_pts) < 5:
        return {
            "success": False,
            "message": "Nenhum ponto válido com coordenadas e taxa encontrada."
        }

    lats = np.array([p["lat"] for p in valid_pts], dtype=np.float64)
    lngs = np.array([p["lng"] for p in valid_pts], dtype=np.float64)
    rates = np.array([p["rate"] for p in valid_pts], dtype=np.float64)

    # Coordenadas médias para projeção local plana em metros (Equiretangular local)
    mean_lat = float(np.mean(lats))
    lat_deg_len = 111132.954  # metros por grau latitude
    lng_deg_len = 111412.84 * math.cos(math.radians(mean_lat))

    # Converte para metros relativos
    x_m = (lngs - np.min(lngs)) * lng_deg_len
    y_m = (lats - np.min(lats)) * lat_deg_len

    min_x, max_x = float(np.min(x_m)), float(np.max(x_m))
    min_y, max_y = float(np.min(y_m)), float(np.max(y_m))

    width_m = max_x - min_x
    height_m = max_y - min_y

    # Ajusta o tamanho da célula se a área for muito grande para respeitar max_cells
    cols = max(int(math.ceil(width_m / grid_size_m)), 1)
    rows = max(int(math.ceil(height_m / grid_size_m)), 1)

    if (cols * rows) > max_cells:
        scale = math.sqrt((cols * rows) / max_cells)
        grid_size_m = round(grid_size_m * scale, 1)
        cols = max(int(math.ceil(width_m / grid_size_m)), 1)
        rows = max(int(math.ceil(height_m / grid_size_m)), 1)

    # Matrizes para acumular soma de taxas e contagem por célula
    grid_sum = np.zeros((rows, cols), dtype=np.float64)
    grid_count = np.zeros((rows, cols), dtype=np.int32)

    col_indices = np.clip((x_m / grid_size_m).astype(np.int32), 0, cols - 1)
    row_indices = np.clip((y_m / grid_size_m).astype(np.int32), 0, rows - 1)

    for r_idx, c_idx, val in zip(row_indices, col_indices, rates):
        if val > 0:
            grid_sum[r_idx, c_idx] += val
            grid_count[r_idx, c_idx] += 1

    # Células ativas (onde houve trabalho)
    active_mask = grid_count > 0
    if not np.any(active_mask):
        return {
            "success": False,
            "message": "Nenhuma célula com taxa de trabalho positiva identificada."
        }

    grid_mean = np.zeros((rows, cols), dtype=np.float64)
    grid_mean[active_mask] = grid_sum[active_mask] / grid_count[active_mask]

    active_rates = grid_mean[active_mask]
    mean_rate = float(np.mean(active_rates))
    std_rate = float(np.std(active_rates))
    cv_percent = round((std_rate / mean_rate * 100.0) if mean_rate > 0 else 0.0, 1)

    # Determina a taxa alvo (se não fornecida, usa a mediana ou média)
    if target_rate is None or target_rate <= 0:
        target_rate = float(np.median(active_rates))

    # Limites das 4 Zonas de Manejo Agronômico:
    # Zona 1: Sub-dose (< 85% do alvo)
    # Zona 2: Ideal / Aderente (85% a 115% do alvo)
    # Zona 3: Alta (115% a 135% do alvo)
    # Zona 4: Crítica / Excesso (> 135% do alvo)
    t_low = target_rate * 0.85
    t_high = target_rate * 1.15
    t_crit = target_rate * 1.35

    cell_area_ha = (grid_size_m * grid_size_m) / 10000.0

    zone_stats = {
        "zona_1_baixa": {"label": "Sub-dose (<85%)", "cor": "#38bdf8", "celulas": 0, "area_ha": 0.0, "pct": 0.0},
        "zona_2_ideal": {"label": "Ideal (85-115%)", "cor": "#10b981", "celulas": 0, "area_ha": 0.0, "pct": 0.0},
        "zona_3_alta": {"label": "Alta (115-135%)", "cor": "#f59e0b", "celulas": 0, "area_ha": 0.0, "pct": 0.0},
        "zona_4_critica": {"label": "Crítica (>135%)", "cor": "#ef4444", "celulas": 0, "area_ha": 0.0, "pct": 0.0},
    }

    features = []
    min_lng = float(np.min(lngs))
    min_lat = float(np.min(lats))

    for r in range(rows):
        for c in range(cols):
            if not active_mask[r, c]:
                continue

            rate_val = round(float(grid_mean[r, c]), 2)
            pts_cnt = int(grid_count[r, c])

            # Classifica zona
            if rate_val < t_low:
                zk = "zona_1_baixa"
                zone_num = 1
            elif rate_val <= t_high:
                zk = "zona_2_ideal"
                zone_num = 2
            elif rate_val <= t_crit:
                zk = "zona_3_alta"
                zone_num = 3
            else:
                zk = "zona_4_critica"
                zone_num = 4

            zone_stats[zk]["celulas"] += 1
            zone_color = zone_stats[zk]["cor"]

            # Converte coordenadas da célula de volta para Lat/Lng WGS84
            cell_x0 = min_x + c * grid_size_m
            cell_x1 = cell_x0 + grid_size_m
            cell_y0 = min_y + r * grid_size_m
            cell_y1 = cell_y0 + grid_size_m

            lon0 = min_lng + (cell_x0 / lng_deg_len)
            lon1 = min_lng + (cell_x1 / lng_deg_len)
            lat0 = min_lat + (cell_y0 / lat_deg_len)
            lat1 = min_lat + (cell_y1 / lat_deg_len)

            polygon_coords = [
                [round(lon0, 7), round(lat0, 7)],
                [round(lon1, 7), round(lat0, 7)],
                [round(lon1, 7), round(lat1, 7)],
                [round(lon0, 7), round(lat1, 7)],
                [round(lon0, 7), round(lat0, 7)]
            ]

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [polygon_coords]
                },
                "properties": {
                    "rate": rate_val,
                    "target_rate": round(target_rate, 2),
                    "deviation_pct": round(((rate_val - target_rate) / target_rate) * 100.0, 1),
                    "zone": zone_num,
                    "zone_label": zone_stats[zk]["label"],
                    "color": zone_color,
                    "points_count": pts_cnt,
                    "area_m2": round(grid_size_m * grid_size_m, 1)
                }
            })

    total_active_cells = len(features)
    total_area_ha = round(total_active_cells * cell_area_ha, 2)

    for zk, st in zone_stats.items():
        st["area_ha"] = round(st["celulas"] * cell_area_ha, 2)
        st["pct"] = round((st["celulas"] / max(total_active_cells, 1)) * 100.0, 1)

    adherence_pct = zone_stats["zona_2_ideal"]["pct"]

    return {
        "success": True,
        "grid_size_m": grid_size_m,
        "total_cells": total_active_cells,
        "total_area_ha": total_area_ha,
        "metrics": {
            "target_rate": round(target_rate, 2),
            "mean_rate": round(mean_rate, 2),
            "min_rate": round(float(np.min(active_rates)), 2),
            "max_rate": round(float(np.max(active_rates)), 2),
            "std_rate": round(std_rate, 2),
            "cv_percent": cv_percent,
            "adherence_percent": adherence_pct
        },
        "zones": zone_stats,
        "geojson": {
            "type": "FeatureCollection",
            "features": features
        }
    }
