#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JDL Parser Engine for John Deere G5 Telemetry Files
Permite parsing direto de arquivos no disco ou bytes em memória (upload HTTP).
"""

import os
import math
import struct
import hashlib
import re
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Tuple, Optional

BRT_TZ = timezone(timedelta(hours=-3))

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calcula a distância geodésica em metros entre dois pontos GPS (WGS84)."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    return 2.0 * R * math.asin(math.sqrt(a))

CANONICAL_DDIS = {
    0x0051: {"name": "Machine Ground Speed (mi/h)", "category": "speed"},
    0x0063: {"name": "Engine Fuel Rate", "category": "fuel"},
    0x0064: {"name": "Total Fuel Consumption", "category": "fuel"},
    0x00F6: {"name": "Engine Percent Load At Current Speed", "category": "engine"},
    0x00F7: {"name": "Total Engine Operating Hours (Horímetro)", "category": "engine"},
    0x010B: {"name": "Engine Coolant Temperature", "category": "engine"},
    0x010D: {"name": "Engine Oil Temperature", "category": "engine"},
    0x010F: {"name": "Actual Engine Speed (RPM)", "category": "engine"},
    0x0120: {"name": "Ambient Air Temperature", "category": "environmental"},
    0x0230: {"name": "Machine Selected Speed", "category": "speed"},
    0x0231: {"name": "Actual Ground Speed (km/h)", "category": "speed"},
    0x0232: {"name": "Percentage Parameter", "category": "status"},
    0x02DE: {"name": "Trip Fuel Consumption", "category": "fuel"},
    0x02ED: {"name": "Wheel-Based Machine Speed (km/h)", "category": "speed"},
    0x0382: {"name": "Navigation-Based Vehicle Speed", "category": "speed"},
    0x0383: {"name": "Engine Torque", "category": "engine"},
    0x038A: {"name": "Engine Speed (Secondary/ECU RPM)", "category": "engine"},
    0x038B: {"name": "Engine Power Output (kW)", "category": "engine"},
    0x038C: {"name": "Ground-Based Machine Speed", "category": "speed"},
    0x038E: {"name": "Transmission Actual Gear Ratio / Engaged Gear", "category": "transmission"},
    0x083D: {"name": "Wheel Slip / Patinagem (%)", "category": "traction"},
    0x002D: {"name": "Setpoint Application Mass Rate (mg/m²)", "category": "application"},
    0x002E: {"name": "Actual Work State / Application Mass Rate (mg/m²)", "category": "application"},
    0x002F: {"name": "Target Application Mass Rate (mg/m²)", "category": "application"},
    0x05DE: {"name": "Implement Section State", "category": "status"},
    0x05E0: {"name": "Implement Work State", "category": "status"},
    0x2EE7: {"name": "Steering Curvature (arcdeg/m)", "category": "guidance"},
    0x2EE8: {"name": "Vehicle Pitch/Roll Angle (arcdeg)", "category": "guidance"},
    0x2EE9: {"name": "Vehicle Elevation/Antenna Offset (mm)", "category": "guidance"},
    0x2EEA: {"name": "Vehicle Heading / Compass Direction (arcdeg)", "category": "guidance"},
    0x2EEB: {"name": "GPS Antenna Height / Elevation (mm)", "category": "guidance"},
    0x2EEC: {"name": "Steering Angle (arcdeg)", "category": "guidance"},
}

def decode_varint(data: bytes, offset: int) -> Tuple[int, int]:
    res = 0
    shift = 0
    data_len = len(data)
    while offset < data_len:
        b = data[offset]
        res |= (b & 0x7F) << shift
        offset += 1
        if not (b & 0x80):
            break
        shift += 7
    return res, offset

def parse_protobuf_fields(data: bytes) -> List[Tuple[int, str, Any]]:
    offset = 0
    fields = []
    data_len = len(data)
    while offset < data_len:
        try:
            tag_raw, offset = decode_varint(data, offset)
        except Exception:
            break
        field_num = tag_raw >> 3
        wire_type = tag_raw & 7

        if wire_type == 0:  # Varint
            val, offset = decode_varint(data, offset)
            fields.append((field_num, 'varint', val))
        elif wire_type == 1:  # 64-bit (double / fixed64)
            val = data[offset:offset+8]
            offset += 8
            fields.append((field_num, '64bit', val))
        elif wire_type == 2:  # Length-delimited (string / message / bytes)
            length, offset = decode_varint(data, offset)
            val = data[offset:offset+length]
            offset += length
            fields.append((field_num, 'bytes', val))
        elif wire_type == 5:  # 32-bit (float / fixed32)
            val = data[offset:offset+4]
            offset += 4
            fields.append((field_num, '32bit', val))
        else:
            break
    return fields

class JDLParser:
    """Parser avançado de telemetria John Deere G5 (.JDL)."""

    def __init__(self, raw_bytes: bytes, filename: str = "upload.jdl", atividade: Optional[str] = None):
        self.raw_bytes = raw_bytes
        self.filename = os.path.basename(filename)
        self.filepath_raw = filename
        self.filesize = len(raw_bytes)
        self.md5 = hashlib.md5(raw_bytes).hexdigest()
        
        # Determina a pasta de atividade / talhão
        if atividade:
            self.atividade_pasta = atividade
        else:
            normalized = filename.replace("\\", "/")
            parts = normalized.split("/")
            if "log" in parts:
                idx = parts.index("log")
                self.atividade_pasta = parts[idx + 1] if idx + 1 < len(parts) - 1 else parts[-2]
            elif len(parts) > 1:
                self.atividade_pasta = parts[-2]
            else:
                self.atividade_pasta = "Geral"

        self.blocks = []
        self.channel_dictionary = {}
        self.metadata = {}
        self.telemetry = {}
        self.time_series_points = []

    @classmethod
    def from_file(cls, filepath: str) -> "JDLParser":
        with open(filepath, "rb") as f:
            raw = f.read()
        return cls(raw, filepath)

    def parse(self) -> Dict[str, Any]:
        self._inspect_framing()
        self._parse_metadata()
        self._decode_telemetry()
        return {
            "file_info": {
                "name": self.filename,
                "size_bytes": self.filesize,
                "md5": self.md5,
                "atividade_pasta": self.atividade_pasta
            },
            "machine_metadata": self.metadata,
            "telemetry_summary": self.telemetry,
            "time_series_points": self.time_series_points
        }

    def _inspect_framing(self):
        offset = 0
        block_idx = 0
        while offset < len(self.raw_bytes):
            if offset + 5 > len(self.raw_bytes):
                break
            tag = self.raw_bytes[offset]
            length = struct.unpack('<I', self.raw_bytes[offset+1:offset+5])[0]
            if tag != 0x0D or (offset + 5 + length) > len(self.raw_bytes):
                break
            b_data = self.raw_bytes[offset+5:offset+5+length]
            fields = parse_protobuf_fields(b_data)
            b_type = next((v for fn, wt, v in fields if fn == 1 and wt == 'varint'), None)
            self.blocks.append({"index": block_idx, "type": b_type, "fields": fields})
            offset += 5 + length
            block_idx += 1

    def _parse_metadata(self):
        meta = {
            "file_name": self.filename,
            "md5_checksum": self.md5,
            "os_version": None,
            "hardware_serial": None,
            "session_guid": None,
            "tractor_serial": None,
            "tractor_model": None,
            "implement_name": None,
            "largura_trabalho_m": 4.5,
            "tipo_operacao": "Distribuição a Lanço",
            "start_time_utc": None,
            "start_time_local": None,
            "start_timestamp_ms": None,
        }

        # Bloco 0 (Firmware Version)
        for b in self.blocks:
            if b["type"] == 3:
                for fn, wt, v in b["fields"]:
                    if fn == 3 and wt == 'bytes':
                        for sfn, swt, sv in parse_protobuf_fields(v):
                            if sfn == 4 and swt == 'bytes':
                                meta["os_version"] = sv.decode('ascii', errors='replace')

        # Bloco 1 (Trator, Implemento, Dicionário DDI, Largura de Trabalho e Operação)
        for b in self.blocks:
            if b["type"] == 1:
                f5_bytes = next((v for fn, wt, v in b["fields"] if fn == 5 and wt == 'bytes'), None)
                if not f5_bytes:
                    continue
                f5_fields = parse_protobuf_fields(f5_bytes)
                for fn, wt, v in f5_fields:
                    if fn == 2 and wt == 'bytes':
                        meta["session_guid"] = v.decode('ascii', errors='replace')
                    elif fn == 3 and wt == 'varint':
                        meta["start_timestamp_ms"] = v
                        dt = datetime.fromtimestamp(v / 1000.0, tz=timezone.utc)
                        meta["start_time_utc"] = dt.strftime('%Y-%m-%d %H:%M:%S UTC')
                        meta["start_time_local"] = dt.astimezone(BRT_TZ).strftime('%Y-%m-%d %H:%M:%S BRT')
                    elif fn == 5 and wt == 'bytes':
                        meta["hardware_serial"] = v.decode('ascii', errors='replace')

                f10_bytes = next((v for fn, wt, v in f5_fields if fn == 10 and wt == 'bytes'), None)
                if not f10_bytes:
                    continue
                f10_fields = parse_protobuf_fields(f10_bytes)
                sf2_list = [v for fn, wt, v in f10_fields if fn == 2 and wt == 'bytes']
                
                detected_width = None
                detected_op = None

                for sf2_raw in sf2_list:
                    sub_fields = parse_protobuf_fields(sf2_raw)
                    f2_type = next((v for nfn, nwt, v in sub_fields if nfn == 2 and nwt == 'varint'), None)
                    f4_str = next((v.decode('latin1', errors='replace') for nfn, nwt, v in sub_fields if nfn == 4 and nwt == 'bytes'), None)
                    f5_str = next((v.decode('latin1', errors='replace') for nfn, nwt, v in sub_fields if nfn == 5 and nwt == 'bytes'), None)
                    f6_val = next((struct.unpack('<d', v)[0] for nfn, nwt, v in sub_fields if nfn == 6 and nwt == '64bit'), None)

                    if f2_type == 1:
                        if f4_str: meta["tractor_serial"] = f4_str
                        if f5_str: meta["tractor_model"] = f5_str
                    elif f2_type == 2 or (f5_str and meta.get("tractor_model") != f5_str):
                        if f5_str: meta["implement_name"] = f5_str
                        if f6_val and 0.5 <= f6_val <= 60.0:
                            detected_width = round(f6_val, 2)

                    # Plugins e unidades de controle (Operaço)
                    for nfn, nwt, nv in sub_fields:
                        if nfn == 7 and nwt == 'bytes':
                            for pfn, pwt, pv in parse_protobuf_fields(nv):
                                if pfn == 9 and pwt == 'bytes':
                                    p_txt = pv.decode('latin1', errors='replace')
                                    if any(k in p_txt.lower() for k in ['seco', 'taxa seca', 'produto (seco)', 'adubo']):
                                        detected_op = "Distribuição a Lanço (Adubo Seco)"
                                    elif any(k in p_txt.lower() for k in ['plant', 'seme']):
                                        detected_op = "Plantio"
                                    elif any(k in p_txt.lower() for k in ['pulv', 'spray']):
                                        detected_op = "Pulverização"

                if detected_width:
                    # Sanitize: implemento DN 1006 não opera com barras de 30m; limita ao range físico real (4.5m a 12m)
                    if meta.get("implement_name") == "DN 1006" and detected_width > 12.0:
                        detected_width = 4.5
                    meta["largura_trabalho_m"] = detected_width
                elif meta.get("implement_name") == "DN 1006":
                    meta["largura_trabalho_m"] = 4.5

                if detected_op:
                    meta["tipo_operacao"] = detected_op
                elif meta.get("implement_name") == "DN 1006":
                    meta["tipo_operacao"] = "Distribuição de Nutrientes (DN 1006)"

                # Dicionário de Canais DDI
                for sf2_raw in sf2_list:
                    for fn, wt, val in parse_protobuf_fields(sf2_raw):
                        if fn == 7 and wt == 'bytes':
                            for gfn, gwt, gval in parse_protobuf_fields(val):
                                if gfn == 5 and gwt == 'bytes':
                                    ch = dict((cfn, cv) for cfn, cwt, cv in parse_protobuf_fields(gval))
                                    cid, ddi = ch.get(1), ch.get(2)
                                    unit_raw = ch.get(5, b'')
                                    unit = unit_raw.decode('ascii', errors='replace') if isinstance(unit_raw, bytes) else str(unit_raw)
                                    scale = struct.unpack('<d', ch.get(4, b'\x00'*8))[0] if len(ch.get(4, b'')) == 8 else 1.0
                                    offset_v = struct.unpack('<d', ch.get(3, b'\x00'*8))[0] if len(ch.get(3, b'')) == 8 else 0.0
                                    self.channel_dictionary[cid] = {
                                        "channel_id": cid,
                                        "ddi": ddi,
                                        "unit": unit,
                                        "scale": scale,
                                        "offset": offset_v
                                    }
        self.metadata = meta

    def _decode_telemetry(self):
        all_lats, all_lons = [], []
        all_hours, all_rpms, all_speeds, all_loads, all_gears = [], [], [], [], []
        all_rates = []
        total_duration_ms = 0
        total_worked_ms = 0
        total_dist_worked_m = 0.0
        time_points = []

        start_ms = self.metadata.get("start_timestamp_ms") or 0
        current_block_ms = start_ms
        largura_m = self.metadata.get("largura_trabalho_m") or 4.5

        prev_lat, prev_lon = None, None

        for b in self.blocks:
            if b["type"] != 2:
                continue

            payload = next((v for fn, wt, v in b["fields"] if fn == 4 and wt == 'bytes'), None)
            if not payload:
                continue
            pf = parse_protobuf_fields(payload)

            block_dur = 0
            for fn, wt, v in pf:
                if fn == 5 and wt == 'varint':
                    block_dur = v
                    total_duration_ms += v

            # Coordenadas Bounding Box
            block_lat, block_lon = None, None
            for fn in (6, 7):
                f_item = next((v for ifn, iwt, v in pf if ifn == fn and iwt == 'bytes'), None)
                if f_item:
                    c = parse_protobuf_fields(f_item)
                    if len(c) >= 2 and c[0][1] == '64bit' and c[1][1] == '64bit':
                        lat = struct.unpack('<d', c[0][2])[0]
                        lon = struct.unpack('<d', c[1][2])[0]
                        if -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0:
                            all_lats.append(lat)
                            all_lons.append(lon)
                            block_lat = lat
                            block_lon = lon

            # Canais de Telemetria
            f9 = next((v for ifn, iwt, v in pf if ifn == 9 and iwt == 'bytes'), None)
            if not f9:
                continue
            items = parse_protobuf_fields(f9)
            ch_item = next((it[2] for it in items if it[0] == 2 and it[1] == 'bytes'), None)
            if not ch_item:
                continue

            offset = 0
            block_cids = []
            while offset < len(ch_item):
                val, offset = decode_varint(ch_item, offset)
                block_cids.append(val)

            streams = [it[2] for it in items if it[0] == 3 and it[1] == 'bytes']
            point_data = {"rpm": None, "speed": None, "load": None, "horimeter": None, "gear": None, "rate": None}

            for idx, bcid in enumerate(block_cids):
                if idx >= len(streams) or bcid not in self.channel_dictionary:
                    continue
                meta = self.channel_dictionary[bcid]
                ddi, scale, off = meta["ddi"], meta["scale"] or 1.0, meta["offset"]
                for sfn, swt, sv in parse_protobuf_fields(streams[idx]):
                    if sfn == 1 and swt == '64bit':
                        val = (struct.unpack('<d', sv)[0] + off) / scale
                        if ddi == 0x00F7 and 0.0 <= val <= 100000.0:
                            all_hours.append(val)
                            point_data["horimeter"] = round(val, 2)
                        elif ddi in (0x010F, 0x038A) and 0.0 <= val <= 3500.0:
                            all_rpms.append(val)
                            point_data["rpm"] = round(val, 1)
                        elif ddi in (0x0231, 0x0230, 0x038C) and 0.0 <= val <= 80.0:
                            unit = meta.get("unit", "")
                            # Apenas canais com unidades válidas de velocidade (km/h, mi/h, m/s)
                            if ("km" in unit or "mi" in unit or "m1" in unit or ddi == 0x0231):
                                if val > 0.05:
                                    all_speeds.append(val)
                                    if point_data["speed"] is None or point_data["speed"] < 0.05:
                                        point_data["speed"] = round(val, 2)
                                elif point_data["speed"] is None:
                                    point_data["speed"] = round(val, 2)
                        elif ddi == 0x00F6 and 0.0 <= val <= 100.0:
                            all_loads.append(val)
                            point_data["load"] = round(val, 1)
                        elif ddi == 0x038E and -20 <= val <= 40:
                            gear_val = int(val)
                            all_gears.append(gear_val)
                            point_data["gear"] = gear_val
                        elif ddi in (0x002D, 0x002E, 0x002F) and 0.0 <= val <= 5000000.0:
                            # 1 mg/m2 = 0.01 kg/ha
                            rate_kg_ha = round(val * 0.01, 1)
                            if rate_kg_ha > 0:
                                point_data["rate"] = rate_kg_ha
                                all_rates.append(rate_kg_ha)
                            elif point_data["rate"] is None:
                                point_data["rate"] = rate_kg_ha
                        break

            # Classificação operacional
            spd = point_data.get("speed") or 0.0
            rate = point_data.get("rate") or 0.0
            is_working = False

            if rate > 0.0:
                status_op = "APLICANDO"
                is_working = True
            elif spd > 1.0:
                status_op = "DESLOCAMENTO"
            else:
                status_op = "PARADO"

            dist_step = 0.0
            if block_lat is not None and block_lon is not None:
                if prev_lat is not None and prev_lon is not None:
                    d_gps = haversine_distance(prev_lat, prev_lon, block_lat, block_lon)
                    if 0.2 < d_gps < 500.0:
                        dist_step = d_gps
                prev_lat, prev_lon = block_lat, block_lon

            # Fallback se GPS estiver indisponível ou estático no ponto durante aplicação/deslocamento
            if dist_step == 0.0 and spd > 0.3:
                dist_step = (spd / 3.6) * (block_dur / 1000.0)

            if is_working:
                total_worked_ms += block_dur
                total_dist_worked_m += dist_step

            # Registra o ponto temporal do bloco
            dt_pt = datetime.fromtimestamp(current_block_ms / 1000.0, tz=timezone.utc)
            time_points.append({
                "timestamp_ms": current_block_ms,
                "timestamp_iso": dt_pt.astimezone(BRT_TZ).strftime('%Y-%m-%d %H:%M:%S'),
                "horimeter": point_data["horimeter"],
                "rpm": point_data["rpm"],
                "speed": point_data["speed"],
                "load": point_data["load"],
                "gear": point_data["gear"],
                "rate": point_data["rate"],
                "status": status_op,
                "is_working": is_working,
                "lat": round(block_lat, 6) if block_lat else None,
                "lon": round(block_lon, 6) if block_lon else None
            })
            current_block_ms += block_dur

        self.time_series_points = time_points

        # Período
        start_dt = datetime.fromtimestamp(start_ms / 1000.0, tz=timezone.utc) if start_ms else None
        end_ms = start_ms + total_duration_ms
        end_dt = datetime.fromtimestamp(end_ms / 1000.0, tz=timezone.utc) if end_ms else None

        h_min = min(all_hours) if all_hours else 0.0
        h_max = max(all_hours) if all_hours else 0.0

        area_ha = round((total_dist_worked_m * largura_m) / 10000.0, 3)

        self.telemetry = {
            "period": {
                "start_utc": start_dt.strftime('%Y-%m-%d %H:%M:%S') if start_dt else None,
                "end_utc": end_dt.strftime('%Y-%m-%d %H:%M:%S') if end_dt else None,
                "start_local_brt": start_dt.astimezone(BRT_TZ).strftime('%Y-%m-%d %H:%M:%S') if start_dt else None,
                "end_local_brt": end_dt.astimezone(BRT_TZ).strftime('%Y-%m-%d %H:%M:%S') if end_dt else None,
                "duration_seconds": round(total_duration_ms / 1000.0, 2),
                "worked_duration_seconds": round(total_worked_ms / 1000.0, 2),
            },
            "horimeter": {
                "initial_hours": round(h_min, 2),
                "final_hours": round(h_max, 2),
                "delta_hours": round(h_max - h_min, 2)
            },
            "operational_averages": {
                "engine_speed_rpm": round(sum(all_rpms)/len(all_rpms), 1) if all_rpms else 0.0,
                "ground_speed_kmh": round(sum(all_speeds)/len(all_speeds), 2) if all_speeds else 0.0,
                "engine_load_percent": round(sum(all_loads)/len(all_loads), 1) if all_loads else 0.0,
            },
            "application_summary": {
                "largura_trabalho_m": largura_m,
                "tipo_operacao": self.metadata.get("tipo_operacao", "Distribuição a Lanço"),
                "taxa_media_kg_ha": round(sum(all_rates)/len(all_rates), 1) if all_rates else 0.0,
                "taxa_max_kg_ha": round(max(all_rates), 1) if all_rates else 0.0,
                "area_trabalhada_ha": area_ha,
                "pontos_aplicando": len([p for p in time_points if p.get("is_working")])
            },
            "bounding_box_gps": {
                "latitude_min": min(all_lats) if all_lats else None,
                "latitude_max": max(all_lats) if all_lats else None,
                "longitude_min": min(all_lons) if all_lons else None,
                "longitude_max": max(all_lons) if all_lons else None,
            }
        }
