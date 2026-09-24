#!/usr/bin/env python3
"""
Custom KML flight parser for Open DroneLog.
Converts DJI Agras / KML flight plans and logs into Open-DroneLog compliant CSV format.
"""

import sys
import os
import re
import csv
import json
import math
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate the great-circle distance between two points in meters."""
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def parse_kml_to_dronelog(input_path: str, output_path: str):
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    # Remove namespace prefixes if any to simplify querying
    with open(input_path, "r", encoding="utf-8", errors="replace") as f:
        xml_content = f.read()

    # Strip default namespace for easier XML element finding
    xml_content = re.sub(r'\sxmlns="[^"]+"', '', xml_content, count=1)
    root = ET.fromstring(xml_content)

    # Locate placemark
    placemark = root.find(".//Placemark")
    if placemark is None:
        raise ValueError(f"No Placemark found in KML: {input_path}")

    # Extract ExtendedData
    data_dict = {}
    for data_elem in placemark.findall(".//ExtendedData/Data"):
        name = data_elem.attrib.get("name", "").strip()
        val_elem = data_elem.find("value")
        val = val_elem.text.strip() if (val_elem is not None and val_elem.text) else ""
        data_dict[name] = val

    aircraft_name = data_dict.get("Aircraft Name", "Drone")
    fc_id = data_dict.get("Flight Controller ID", "Unknown")
    pilot_name = data_dict.get("Pilot Name", "")
    flight_time_ms = float(data_dict.get("Flight Time", 0.0) or 0.0)
    flight_time_sec = flight_time_ms / 1000.0 if flight_time_ms > 0 else 0.0
    mode = data_dict.get("Mode Selection", "Auto")
    height = float(data_dict.get("Height", 0.0) or 0.0)
    route_spacing = float(data_dict.get("Route Spacing", 0.0) or 0.0)
    task_speed = float(data_dict.get("Task Flight Speed", 0.0) or 0.0)
    task_area = float(data_dict.get("Task Area", 0.0) or 0.0)
    spray_amount = float(data_dict.get("Spray amount", 0.0) or 0.0)
    spray_liters = spray_amount / 1000.0

    # Extract timestamp from filename
    filename = os.path.basename(input_path)
    date_match = re.search(r"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})", filename)
    if date_match:
        y, m, d, h, mi, s = date_match.groups()
        start_time_iso = f"{y}-{m}-{d}T{h}:{mi}:{s}Z"
    else:
        start_time_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Coordinates
    coord_elem = placemark.find(".//LineString/coordinates")
    if coord_elem is None or not coord_elem.text:
        raise ValueError(f"No coordinates found in KML: {input_path}")

    raw_tokens = coord_elem.text.strip().split()
    points = []
    for token in raw_tokens:
        token = token.strip()
        if not token:
            continue
        parts = token.split(",")
        if len(parts) >= 2:
            lon = float(parts[0])
            lat = float(parts[1])
            alt = float(parts[2]) if len(parts) >= 3 else 0.0
            if alt == 0.0 and height > 0.0:
                alt = height
            points.append((lat, lon, alt))

    if not points:
        raise ValueError(f"No valid coordinate points found in {input_path}")

    # Distances
    home_lat, home_lon, _ = points[0]
    cum_dists = [0.0] * len(points)
    dist_to_home = [0.0] * len(points)

    for i in range(1, len(points)):
        p1 = points[i - 1]
        p2 = points[i]
        step = haversine_distance(p1[0], p1[1], p2[0], p2[1])
        cum_dists[i] = cum_dists[i - 1] + step
        dist_to_home[i] = haversine_distance(home_lat, home_lon, p2[0], p2[1])

    total_dist = cum_dists[-1]

    # Timestamps
    if flight_time_sec <= 0:
        if task_speed > 0 and total_dist > 0:
            flight_time_sec = total_dist / task_speed
        else:
            flight_time_sec = max(1.0, float(len(points) - 1))

    times = [0.0] * len(points)
    for i in range(len(points)):
        if len(points) == 1:
            times[i] = 0.0
        elif total_dist > 0:
            times[i] = (cum_dists[i] / total_dist) * flight_time_sec
        else:
            times[i] = (i / float(len(points) - 1)) * flight_time_sec

    # Notes & Tags
    notes_parts = []
    if pilot_name and pilot_name != "Unknown":
        notes_parts.append(f"Piloto: {pilot_name}")
    if task_area > 0:
        notes_parts.append(f"Area: {task_area:.2f} ha")
    if spray_liters > 0:
        notes_parts.append(f"Calda: {spray_liters:.2f} L")
    if route_spacing > 0:
        notes_parts.append(f"Faixa: {route_spacing:.2f} m")
    if task_speed > 0:
        notes_parts.append(f"Velocidade: {task_speed:.1f} m/s")
    notes_str = " | ".join(notes_parts)

    tags = [
        {"tag": "KML", "tag_type": "auto"},
        {"tag": aircraft_name, "tag_type": "auto"},
    ]
    if pilot_name and pilot_name != "Unknown":
        tags.append({"tag": pilot_name, "tag_type": "manual"})
    if spray_liters > 0:
        tags.append({"tag": "Pulverizacao", "tag_type": "auto"})

    meta_obj = {
        "drone_model": aircraft_name,
        "aircraft_name": aircraft_name,
        "drone_serial": fc_id,
        "start_time": start_time_iso,
        "home_lat": home_lat,
        "home_lon": home_lon,
        "notes": notes_str,
        "tags": tags,
    }
    meta_json = json.dumps(meta_obj)

    # Output directory
    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    # Write CSV
    with open(output_path, "w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(["time_s", "lat", "lng", "alt_m", "distance_to_home_m", "speed_ms", "flight_mode", "Metadata"])

        for i, (lat, lon, alt) in enumerate(points):
            t_str = f"{times[i]:.2f}"
            lat_str = f"{lat:.8f}"
            lon_str = f"{lon:.8f}"
            alt_str = f"{alt:.2f}"
            dist_str = f"{dist_to_home[i]:.2f}"

            if i > 0:
                dt = times[i] - times[i - 1]
                ds = cum_dists[i] - cum_dists[i - 1]
                spd = ds / dt if dt > 0.001 else task_speed
            else:
                spd = task_speed if task_speed > 0 else 0.0
            spd_str = f"{spd:.2f}"

            meta_cell = meta_json if i == 0 else ""
            writer.writerow([t_str, lat_str, lon_str, alt_str, dist_str, spd_str, mode, meta_cell])

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: parse_kml.py <input.kml> <output.csv>", file=sys.stderr)
        sys.exit(1)

    in_file = sys.argv[1]
    out_file = sys.argv[2]
    try:
        parse_kml_to_dronelog(in_file, out_file)
        sys.exit(0)
    except Exception as exc:
        print(f"Error parsing KML: {exc}", file=sys.stderr)
        sys.exit(1)
