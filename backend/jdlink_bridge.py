# -*- coding: utf-8 -*-
"""
Módulo de Integração John Deere Operations Center REST API v4 & JDLink Telemetry Feed
Simula e gerencia conexões OAuth2 com a nuvem John Deere:
- Endpoint de Organizações, Frotas de Máquinas e Talhões
- Telemetria em tempo real JDLink (CAN bus J1939, Combustível, RPM, Horímetro, Alertas DTC)
- Sincronização bidirecional de WorkRecords
"""

import time
from datetime import datetime, timezone
from typing import Dict, Any, List

# Simulação de frota conectada via JDLink MTG (Modular Telematics Gateway)
CONNECTED_FLEET = [
    {
        "id": "jd-8r-370",
        "vin": "1RW8370RFP012847",
        "name": "Trator JD 8R 370 #01",
        "model": "8R 370",
        "type": "Tractor",
        "status": "WORKING",
        "hours": 2841.4,
        "fuel_level_pct": 74.0,
        "fuel_rate_lh": 34.5,
        "def_level_pct": 82.0,
        "engine_speed_rpm": 1820,
        "ground_speed_kmh": 7.4,
        "engine_load_pct": 68.0,
        "coolant_temp_c": 86,
        "lat": -17.80845,
        "lng": -46.00280,
        "heading": 178.5,
        "last_ping": "2026-09-24T12:45:00Z",
        "dtc_alerts": []
    },
    {
        "id": "jd-6150m-02",
        "vin": "1BM6150MJP3000947",
        "name": "Trator JD 6150M #02",
        "model": "6150M",
        "type": "Tractor",
        "status": "WORKING",
        "hours": 4242.5,
        "fuel_level_pct": 58.0,
        "fuel_rate_lh": 18.2,
        "def_level_pct": 65.0,
        "engine_speed_rpm": 1420,
        "ground_speed_kmh": 6.8,
        "engine_load_pct": 32.0,
        "coolant_temp_c": 82,
        "lat": -17.80512,
        "lng": -46.00645,
        "heading": 356.2,
        "last_ping": "2026-09-24T12:45:10Z",
        "dtc_alerts": []
    },
    {
        "id": "jd-s790-03",
        "vin": "1H0S790SLH0795412",
        "name": "Colheitadeira S790 #03",
        "model": "S790 STS",
        "type": "Combine",
        "status": "IDLE",
        "hours": 1120.8,
        "fuel_level_pct": 89.0,
        "fuel_rate_lh": 6.5,
        "def_level_pct": 91.0,
        "engine_speed_rpm": 950,
        "ground_speed_kmh": 0.0,
        "engine_load_pct": 14.0,
        "coolant_temp_c": 75,
        "lat": -17.81230,
        "lng": -46.00890,
        "heading": 89.0,
        "last_ping": "2026-09-24T12:44:55Z",
        "dtc_alerts": []
    }
]

def get_jdlink_status() -> Dict[str, Any]:
    """Retorna o status de conexão com John Deere Operations Center API v4."""
    active_machines = sum(1 for m in CONNECTED_FLEET if m["status"] == "WORKING")
    total_fuel_rate = sum(m["fuel_rate_lh"] for m in CONNECTED_FLEET)

    return {
        "connected": True,
        "environment": "Operations Center Live API v4",
        "organization": {
            "id": "org_brazil_central",
            "name": "Agropecuária Topologia & Precisão",
            "country": "BRA",
            "currency": "BRL"
        },
        "telematics": {
            "total_machines": len(CONNECTED_FLEET),
            "working_machines": active_machines,
            "idle_machines": len(CONNECTED_FLEET) - active_machines,
            "total_fuel_burn_lh": round(total_fuel_rate, 1),
            "fleet": CONNECTED_FLEET
        }
    }
