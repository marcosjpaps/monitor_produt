#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Database Management Layer for Telemetry Dashboard (SQLite)
Otimizado para séries temporais agrícolas, filtragem por Talhão/Atividade e importação de pastas JD-Data.
"""

import sqlite3
import os
import uuid
import re
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta

BRT_TZ = timezone(timedelta(hours=-3))
DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "telemetria.db")

def get_connection(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA cache_size = -64000;")  # 64MB cache
    return conn

def init_db(db_path: str = DEFAULT_DB_PATH):
    """Cria e atualiza o esquema do banco de dados."""
    with get_connection(db_path) as conn:
        cursor = conn.cursor()

        # 1. Máquinas
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS maquinas (
            id TEXT PRIMARY KEY,
            numero_serie TEXT UNIQUE NOT NULL,
            modelo TEXT NOT NULL,
            nome_customizado TEXT,
            implemento_padrao TEXT,
            fabricante TEXT DEFAULT 'John Deere',
            horimetro_atual REAL DEFAULT 0.0,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
        """)

        # 2. Arquivos Processados
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS arquivos_processados (
            id TEXT PRIMARY KEY,
            maquina_id TEXT NOT NULL,
            nome_arquivo TEXT NOT NULL,
            hash_md5 TEXT UNIQUE NOT NULL,
            tamanho_bytes INTEGER NOT NULL,
            versao_so TEXT,
            hardware_serial TEXT,
            implemento TEXT,
            atividade_pasta TEXT,
            data_inicio TEXT NOT NULL,
            data_fim TEXT NOT NULL,
            duracao_segundos REAL NOT NULL,
            horimetro_inicial REAL NOT NULL,
            horimetro_final REAL NOT NULL,
            lat_min REAL,
            lat_max REAL,
            lon_min REAL,
            lon_max REAL,
            imported_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (maquina_id) REFERENCES maquinas(id)
        );
        """)

        # Migração segura para novas colunas em arquivos_processados
        cols_arquivos = [
            ("atividade_pasta", "TEXT"),
            ("largura_trabalho_m", "REAL DEFAULT 4.5"),
            ("tipo_operacao", "TEXT DEFAULT 'Distribuição a Lanço'"),
            ("taxa_media_kg_ha", "REAL DEFAULT 0.0"),
            ("area_trabalhada_ha", "REAL DEFAULT 0.0"),
            ("is_deleted", "INTEGER DEFAULT 0"),
            ("modelo_trator", "TEXT"),
            ("operador", "TEXT")
        ]
        for col, ctype in cols_arquivos:
            try:
                cursor.execute(f"ALTER TABLE arquivos_processados ADD COLUMN {col} {ctype};")
            except Exception:
                pass

        # Backfill e consistência
        try:
            cursor.execute("UPDATE arquivos_processados SET is_deleted = 0 WHERE is_deleted IS NULL;")
            cursor.execute("""
                UPDATE arquivos_processados
                SET modelo_trator = (SELECT modelo FROM maquinas WHERE maquinas.id = arquivos_processados.maquina_id)
                WHERE modelo_trator IS NULL;
            """)
        except Exception:
            pass

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_arq_md5 ON arquivos_processados(hash_md5);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_arq_ativ ON arquivos_processados(atividade_pasta);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_arq_maq ON arquivos_processados(maquina_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_arq_deleted ON arquivos_processados(is_deleted);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_arq_modelo ON arquivos_processados(modelo_trator);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_arq_impl ON arquivos_processados(implemento);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_arq_larg ON arquivos_processados(largura_trabalho_m);")

        # 3. Registros de Telemetria
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS telemetria_registros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            arquivo_id TEXT NOT NULL,
            maquina_id TEXT NOT NULL,
            timestamp_iso TEXT NOT NULL,
            timestamp_ms INTEGER NOT NULL,
            horimetro REAL,
            rpm REAL,
            velocidade REAL,
            marcha INTEGER,
            carga REAL,
            latitude REAL,
            longitude REAL,
            taxa_aplicacao REAL DEFAULT 0.0,
            status_operacao TEXT DEFAULT 'DESLOCAMENTO',
            FOREIGN KEY (arquivo_id) REFERENCES arquivos_processados(id),
            FOREIGN KEY (maquina_id) REFERENCES maquinas(id)
        );
        """)

        # Migração segura para novas colunas em telemetria_registros
        cols_telemetria = [
            ("taxa_aplicacao", "REAL DEFAULT 0.0"),
            ("status_operacao", "TEXT DEFAULT 'DESLOCAMENTO'")
        ]
        for col, ctype in cols_telemetria:
            try:
                cursor.execute(f"ALTER TABLE telemetria_registros ADD COLUMN {col} {ctype};")
            except Exception:
                pass

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_telemetria_time ON telemetria_registros(timestamp_ms);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_telemetria_maq ON telemetria_registros(maquina_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_telemetria_arq ON telemetria_registros(arquivo_id);")

        # 4. Resumo Operacional por Arquivo
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS resumo_operacional (
            id TEXT PRIMARY KEY,
            arquivo_id TEXT UNIQUE NOT NULL,
            maquina_id TEXT NOT NULL,
            tempo_ligado_s REAL NOT NULL,
            tempo_deslocamento_s REAL NOT NULL,
            tempo_parado_s REAL NOT NULL,
            rpm_medio REAL,
            velocidade_media REAL,
            velocidade_max REAL,
            carga_media REAL,
            FOREIGN KEY (arquivo_id) REFERENCES arquivos_processados(id),
            FOREIGN KEY (maquina_id) REFERENCES maquinas(id)
        );
        """)
        conn.commit()

def is_file_processed(md5_hash: str, db_path: str = DEFAULT_DB_PATH) -> bool:
    with get_connection(db_path) as conn:
        row = conn.execute("SELECT 1 FROM arquivos_processados WHERE hash_md5 = ? LIMIT 1;", (md5_hash,)).fetchone()
        return row is not None

def get_processed_md5_set(db_path: str = DEFAULT_DB_PATH) -> set:
    with get_connection(db_path) as conn:
        rows = conn.execute("SELECT hash_md5 FROM arquivos_processados;").fetchall()
        return set(r[0] for r in rows)

def save_parsed_session(session_data: Dict[str, Any], db_path: str = DEFAULT_DB_PATH, conn_external: Optional[sqlite3.Connection] = None) -> str:
    """Insere uma sessão de telemetria no banco de dados com largura de trabalho e operação."""
    meta = session_data["machine_metadata"]
    telemetry = session_data["telemetry_summary"]
    finfo = session_data["file_info"]

    serial = meta.get("tractor_serial") or "DESCONHECIDO"
    model = meta.get("tractor_model") or "John Deere"
    implement = meta.get("implement_name") or meta.get("default_implement") or finfo.get("implement") or "Nenhum"
    atividade = finfo.get("atividade_pasta") or session_data.get("atividade") or "Geral"
    h_init = telemetry["horimeter"]["initial_hours"]
    h_final = telemetry["horimeter"]["final_hours"]

    app_meta = telemetry.get("application_summary") or telemetry.get("operation") or {}
    largura = app_meta.get("largura_trabalho_m", meta.get("largura_trabalho_m", 4.5))
    tipo_op = app_meta.get("tipo_operacao", meta.get("tipo_operacao", "Distribuição a Lanço (Adubo Seco)"))
    taxa_med = app_meta.get("taxa_media_kg_ha", 0.0)
    area_ha = app_meta.get("area_trabalhada_ha", 0.0)

    def _do_insert(conn):
        cursor = conn.cursor()

        # 1. Upsert da Máquina
        cursor.execute("SELECT id, horimetro_atual FROM maquinas WHERE numero_serie = ?;", (serial,))
        m_row = cursor.fetchone()
        if m_row:
            maquina_id = m_row["id"]
            novo_horimetro = max(m_row["horimetro_atual"] or 0.0, h_final or 0.0)
            cursor.execute("""
                UPDATE maquinas
                SET horimetro_atual = ?, modelo = ?, implemento_padrao = ?, updated_at = datetime('now', 'localtime')
                WHERE id = ?;
            """, (novo_horimetro, model, implement, maquina_id))
        else:
            maquina_id = str(uuid.uuid4())
            cursor.execute("""
                INSERT INTO maquinas (id, numero_serie, modelo, nome_customizado, implemento_padrao, horimetro_atual)
                VALUES (?, ?, ?, ?, ?, ?);
            """, (maquina_id, serial, model, f"Trator {model}", implement, h_final))

        # 2. Arquivo Processado
        arquivo_id = str(uuid.uuid4())
        bbox = telemetry.get("bounding_box_gps", {})
        cursor.execute("""
            INSERT INTO arquivos_processados (
                id, maquina_id, nome_arquivo, hash_md5, tamanho_bytes, versao_so,
                hardware_serial, implemento, atividade_pasta, data_inicio, data_fim, duracao_segundos,
                horimetro_inicial, horimetro_final, lat_min, lat_max, lon_min, lon_max,
                largura_trabalho_m, tipo_operacao, taxa_media_kg_ha, area_trabalhada_ha,
                is_deleted, modelo_trator, operador
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?);
        """, (
            arquivo_id, maquina_id, finfo["name"], finfo["md5"], finfo["size_bytes"],
            meta.get("os_version") or finfo.get("os_version"), meta.get("hardware_serial") or finfo.get("hardware_serial"), implement, atividade,
            telemetry["period"]["start_local_brt"] or datetime.now(BRT_TZ).isoformat(),
            telemetry["period"]["end_local_brt"] or datetime.now(BRT_TZ).isoformat(),
            telemetry["period"]["duration_seconds"] or 0.0,
            h_init, h_final,
            bbox.get("latitude_min"), bbox.get("latitude_max"),
            bbox.get("longitude_min"), bbox.get("longitude_max"),
            largura, tipo_op, taxa_med, area_ha,
            model, meta.get("operador")
        ))

        # 3. Registros de Telemetria
        records = session_data.get("time_series_points", [])
        if records:
            batch = [
                (
                    arquivo_id, maquina_id, r["timestamp_iso"], r["timestamp_ms"],
                    r.get("horimeter"), r.get("rpm"), r.get("speed"),
                    r.get("gear"), r.get("load"), r.get("lat"), r.get("lon"),
                    r.get("rate") or 0.0,
                    r.get("status") or ("APLICANDO" if (r.get("rate") or 0.0) > 0 else "DESLOCAMENTO")
                )
                for r in records
            ]
            cursor.executemany("""
                INSERT INTO telemetria_registros (
                    arquivo_id, maquina_id, timestamp_iso, timestamp_ms,
                    horimetro, rpm, velocidade, marcha, carga, latitude, longitude,
                    taxa_aplicacao, status_operacao
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, batch)

        # 4. Resumo Operacional
        ops = telemetry.get("operational_averages", {})
        dur = telemetry["period"].get("duration_seconds") or 0.0
        spd = ops.get("ground_speed_kmh") or 0.0
        t_desloc = dur if spd > 1.0 else 0.0
        t_parado = dur - t_desloc

        cursor.execute("""
            INSERT INTO resumo_operacional (
                id, arquivo_id, maquina_id, tempo_ligado_s, tempo_deslocamento_s,
                tempo_parado_s, rpm_medio, velocidade_media, velocidade_max, carga_media
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            str(uuid.uuid4()), arquivo_id, maquina_id, dur, t_desloc, t_parado,
            ops.get("engine_speed_rpm"), spd, spd * 1.15, ops.get("engine_load_percent")
        ))
        return arquivo_id

    if conn_external:
        return _do_insert(conn_external)
    else:
        with get_connection(db_path) as conn:
            aid = _do_insert(conn)
            conn.commit()
            return aid

def extract_fazenda(nome: Optional[str]) -> str:
    """Extrai e padroniza o nome da Fazenda a partir da pasta de atividade."""
    if not nome:
        return 'Geral / Outros'
    n = re.sub(r'^2026_?(Usina )?(G5_?)?', '', nome, flags=re.IGNORECASE).strip('_ ')
    if not n:
        return 'Geral / Outros'
    parts = re.split(r'[_.]\s*(?=\d|T\s*\d|Ao|ao)', n)
    f = parts[0].strip('_ ')
    if not f or re.match(r'^\d', f):
        return 'Geral / Outros'
    f_upper = f.upper()
    if 'PE DO MORRO' in f_upper: return 'Pé do Morro'
    if 'MACUS' in f_upper: return 'Macus Bliujus'
    if 'NOROESTE' in f_upper: return 'Noroeste'
    if 'TAPERA' in f_upper: return 'Usina Tapera'
    if 'CAUDIO' in f_upper or 'LEITEIRO' in f_upper: return 'Caudio Leiteiro'
    if 'SAO ROQUE' in f_upper or 'SÃO ROQUE' in f_upper: return 'São Roque'
    if 'DR PAULO' in f_upper: return 'DR Paulo'
    if 'DONA' in f_upper or 'INES' in f_upper or 'LNES' in f_upper: return 'Dona Inês'
    if 'PASTO' in f_upper: return 'Pasto 20'
    return f.title()

def get_atividades_por_fazenda(fazenda: str, db_path: str = DEFAULT_DB_PATH) -> List[str]:
    with get_connection(db_path) as conn:
        rows = conn.execute("SELECT DISTINCT atividade_pasta FROM arquivos_processados WHERE atividade_pasta IS NOT NULL;").fetchall()
        matching = []
        for r in rows:
            atv = r["atividade_pasta"]
            if extract_fazenda(atv) == fazenda:
                matching.append(atv)
        return matching

def _build_filter_sql(
    table_prefix: str = "a.",
    maquina_id: Optional[str] = None,
    atividade: Optional[str] = None,
    fazenda: Optional[str] = None,
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    operacao: Optional[str] = None,
    trator: Optional[str] = None,
    implemento: Optional[str] = None,
    faixa_real: Optional[Any] = None,
    operador: Optional[str] = None,
    db_path: str = DEFAULT_DB_PATH
):
    where = [f"{table_prefix}horimetro_inicial > 0"] if table_prefix == "a." else []
    params = []

    # Ignora registros excluídos/aparados
    if table_prefix == "a.":
        where.append(f"({table_prefix}is_deleted IS NULL OR {table_prefix}is_deleted = 0)")

    if maquina_id:
        where.append(f"{table_prefix}maquina_id = ?")
        params.append(maquina_id)

    if atividade and atividade != "all":
        where.append(f"{table_prefix}atividade_pasta = ?")
        params.append(atividade)
    elif fazenda and fazenda != "all":
        atvs = get_atividades_por_fazenda(fazenda, db_path)
        if atvs:
            placeholders = ",".join(["?"] * len(atvs))
            where.append(f"{table_prefix}atividade_pasta IN ({placeholders})")
            params.extend(atvs)
        else:
            where.append("1 = 0")

    if data_inicio:
        where.append(f"SUBSTR({table_prefix}data_inicio, 1, 10) >= ?")
        params.append(data_inicio)

    if data_fim:
        where.append(f"SUBSTR({table_prefix}data_inicio, 1, 10) <= ?")
        params.append(data_fim)

    if operacao and operacao != "all":
        where.append(f"{table_prefix}tipo_operacao = ?")
        params.append(operacao)

    if trator and trator != "all":
        where.append(f"({table_prefix}modelo_trator = ? OR {table_prefix}maquina_id IN (SELECT id FROM maquinas WHERE modelo = ?))")
        params.extend([trator, trator])

    if implemento and implemento != "all":
        where.append(f"{table_prefix}implemento = ?")
        params.append(implemento)

    if faixa_real is not None and str(faixa_real) != "all" and str(faixa_real).strip() != "":
        try:
            f_val = float(faixa_real)
            where.append(f"ABS({table_prefix}largura_trabalho_m - ?) < 0.08")
            params.append(f_val)
        except Exception:
            pass

    if operador and operador != "all":
        where.append(f"{table_prefix}operador = ?")
        params.append(operador)

    where_sql = " AND ".join(where) if where else "1=1"
    return where_sql, params

def get_dashboard_kpis(
    db_path: str = DEFAULT_DB_PATH, 
    maquina_id: Optional[str] = None, 
    atividade: Optional[str] = None,
    fazenda: Optional[str] = None,
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    operacao: Optional[str] = None,
    trator: Optional[str] = None,
    implemento: Optional[str] = None,
    faixa_real: Optional[Any] = None,
    operador: Optional[str] = None
) -> Dict[str, Any]:
    with get_connection(db_path) as conn:
        m_query = "SELECT * FROM maquinas"
        m_params = []
        if maquina_id:
            m_query += " WHERE id = ?"
            m_params.append(maquina_id)
        elif trator and trator != "all":
            m_query += " WHERE modelo = ?"
            m_params.append(trator)
        m_query += " ORDER BY horimetro_atual DESC LIMIT 1;"
        m_row = conn.execute(m_query, m_params).fetchone()

        if not m_row:
            # Fallback para primeira máquina se filtro específico
            m_row = conn.execute("SELECT * FROM maquinas ORDER BY horimetro_atual DESC LIMIT 1;").fetchone()
            if not m_row:
                return {"has_data": False}

        where_sql, params = _build_filter_sql(
            table_prefix="a.",
            maquina_id=maquina_id,
            atividade=atividade,
            fazenda=fazenda,
            data_inicio=data_inicio,
            data_fim=data_fim,
            operacao=operacao,
            trator=trator,
            implemento=implemento,
            faixa_real=faixa_real,
            operador=operador,
            db_path=db_path
        )

        # Estatísticas de horímetro
        h_stats = conn.execute(f"""
            SELECT 
                MIN(a.horimetro_inicial) as min_h, 
                MAX(a.horimetro_final) as max_h,
                COUNT(*) as total_arquivos,
                SUM(a.duracao_segundos) as total_segundos
            FROM arquivos_processados a
            WHERE {where_sql};
        """, params).fetchone()

        # Médias operacionais e de aplicação
        ops_sql = f"""
            SELECT 
                AVG(r.rpm_medio) as avg_rpm,
                AVG(r.velocidade_media) as avg_speed,
                MAX(r.velocidade_max) as max_speed,
                AVG(r.carga_media) as avg_load,
                SUM(r.tempo_deslocamento_s) as sum_desloc,
                SUM(r.tempo_parado_s) as sum_parado,
                SUM(r.tempo_ligado_s) as sum_ligado,
                SUM(a.area_trabalhada_ha) as sum_area_ha,
                AVG(CASE WHEN a.taxa_media_kg_ha > 0 THEN a.taxa_media_kg_ha END) as avg_taxa,
                MAX(a.tipo_operacao) as main_operacao
            FROM resumo_operacional r
            JOIN arquivos_processados a ON a.id = r.arquivo_id
            WHERE {where_sql};
        """
        ops = conn.execute(ops_sql, params).fetchone()

        # Largura de trabalho predominante (Moda por frequência e área)
        larg_row = conn.execute(f"""
            SELECT a.largura_trabalho_m
            FROM arquivos_processados a
            WHERE {where_sql} AND a.largura_trabalho_m > 0
            GROUP BY a.largura_trabalho_m
            ORDER BY COUNT(*) DESC, SUM(a.area_trabalhada_ha) DESC
            LIMIT 1;
        """, params).fetchone()
        largura_predominante = larg_row["largura_trabalho_m"] if (larg_row and larg_row["largura_trabalho_m"]) else 4.5

        min_h = h_stats["min_h"] or 0.0
        max_h = h_stats["max_h"] or 0.0
        delta_h = max(0.0, round(max_h - min_h, 2))

        # Cálculos de Telemetria e Consumo SAE J1939 (TractorHacking / ASABE D497.7)
        avg_spd = (ops["avg_speed"] if ops else 0.0) or 0.0
        avg_ld = (ops["avg_load"] if ops else 0.0) or 0.0
        sum_desloc_s = (ops["sum_desloc"] if ops else 0.0) or 0.0
        sum_parado_s = (ops["sum_parado"] if ops else 0.0) or 0.0
        sum_ligado_s = sum_desloc_s + sum_parado_s

        cap_campo = round((avg_spd * largura_predominante) / 10.0, 2) if (avg_spd > 0 and largura_predominante > 0) else 0.0
        if avg_ld > 0:
            consumo_lh = round(6.5 + (avg_ld / 100.0) * 35.0, 1)
        else:
            consumo_lh = 22.0 if avg_spd > 0 else 6.5
        consumo_lha = round(consumo_lh / max(cap_campo, 0.1), 2) if cap_campo > 0 else 0.0
        eficiencia_op = round((sum_desloc_s / max(sum_ligado_s, 1.0)) * 100.0, 1) if sum_ligado_s > 0 else 0.0

        return {
            "has_data": True,
            "machine": {
                "id": m_row["id"],
                "serial": m_row["numero_serie"],
                "model": m_row["modelo"],
                "custom_name": m_row["nome_customizado"],
                "implement": m_row["implemento_padrao"],
                "current_horimeter": m_row["horimetro_atual"]
            },
            "horimeter": {
                "initial_hours": round(min_h, 2),
                "final_hours": round(max_h, 2),
                "worked_hours": delta_h
            },
            "operation": {
                "tipo_operacao": (ops["main_operacao"] if ops else None) or "Distribuição a Lanço (Adubo Seco)",
                "largura_trabalho_m": round(largura_predominante, 2),
                "total_area_ha": round((ops["sum_area_ha"] if ops else 0.0) or 0.0, 2),
                "avg_rate_kg_ha": round((ops["avg_taxa"] if ops else 0.0) or 0.0, 1),
                "capacidade_campo_hah": cap_campo,
                "consumo_estimado_lh": consumo_lh,
                "consumo_estimado_lha": consumo_lha,
                "eficiencia_operacional_pct": eficiencia_op
            },
            "summary": {
                "total_files": h_stats["total_arquivos"] or 0,
                "total_duration_hours": round((h_stats["total_segundos"] or 0.0) / 3600.0, 2),
                "avg_rpm": round((ops["avg_rpm"] if ops else 0.0) or 0.0, 1),
                "avg_speed_kmh": round((ops["avg_speed"] if ops else 0.0) or 0.0, 2),
                "max_speed_kmh": round((ops["max_speed"] if ops else 0.0) or 0.0, 2),
                "avg_load_pct": round((ops["avg_load"] if ops else 0.0) or 0.0, 1),
                "time_moving_hours": round(((ops["sum_desloc"] if ops else 0.0) or 0.0) / 3600.0, 2),
                "time_idle_hours": round(((ops["sum_parado"] if ops else 0.0) or 0.0) / 3600.0, 2)
            }
        }

def get_all_sessions(
    db_path: str = DEFAULT_DB_PATH, 
    maquina_id: Optional[str] = None, 
    atividade: Optional[str] = None,
    fazenda: Optional[str] = None,
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    operacao: Optional[str] = None,
    trator: Optional[str] = None,
    implemento: Optional[str] = None,
    faixa_real: Optional[Any] = None,
    operador: Optional[str] = None
) -> List[Dict[str, Any]]:
    with get_connection(db_path) as conn:
        where_sql, params = _build_filter_sql(
            table_prefix="a.",
            maquina_id=maquina_id,
            atividade=atividade,
            fazenda=fazenda,
            data_inicio=data_inicio,
            data_fim=data_fim,
            operacao=operacao,
            trator=trator,
            implemento=implemento,
            faixa_real=faixa_real,
            operador=operador,
            db_path=db_path
        )
        query = f"""
            SELECT a.*, COALESCE(NULLIF(a.modelo_trator, ''), m.modelo, 'John Deere') as modelo_trator,
                   r.rpm_medio, r.velocidade_media, r.carga_media
            FROM arquivos_processados a
            LEFT JOIN resumo_operacional r ON r.arquivo_id = a.id
            LEFT JOIN maquinas m ON m.id = a.maquina_id
            WHERE {where_sql}
            ORDER BY a.data_inicio DESC LIMIT 25000;
        """
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

def get_atividades(db_path: str = DEFAULT_DB_PATH) -> List[Dict[str, Any]]:
    """Retorna lista de todas as atividades/pastas importadas com totais."""
    with get_connection(db_path) as conn:
        rows = conn.execute("""
            SELECT 
                COALESCE(atividade_pasta, 'Geral') as atividade,
                COUNT(*) as total_arquivos,
                SUM(area_trabalhada_ha) as total_area_ha,
                MIN(data_inicio) as data_inicio,
                MAX(data_fim) as data_fim,
                MIN(horimetro_inicial) as min_horimetro,
                MAX(horimetro_final) as max_horimetro
            FROM arquivos_processados
            WHERE (is_deleted IS NULL OR is_deleted = 0)
            GROUP BY atividade_pasta
            ORDER BY total_arquivos DESC;
        """).fetchall()
        return [dict(r) for r in rows]

def get_fazendas_e_atividades(db_path: str = DEFAULT_DB_PATH) -> List[Dict[str, Any]]:
    """Retorna lista de Fazendas com seus respectivos talhões e métricas consolidadas."""
    with get_connection(db_path) as conn:
        rows = conn.execute("""
            SELECT 
                COALESCE(atividade_pasta, 'Geral') as atividade,
                COUNT(*) as total_arquivos,
                SUM(area_trabalhada_ha) as total_area_ha,
                MIN(data_inicio) as data_inicio,
                MAX(data_fim) as data_fim
            FROM arquivos_processados
            WHERE (is_deleted IS NULL OR is_deleted = 0)
            GROUP BY atividade_pasta
            ORDER BY total_arquivos DESC;
        """).fetchall()

        fazendas_map = {}
        for r in rows:
            atv = r["atividade"]
            fz = extract_fazenda(atv if atv != 'Geral' else None)
            if fz not in fazendas_map:
                fazendas_map[fz] = {
                    "fazenda": fz,
                    "total_arquivos": 0,
                    "total_area_ha": 0.0,
                    "talhoes": []
                }
            fazendas_map[fz]["total_arquivos"] += r["total_arquivos"]
            fazendas_map[fz]["total_area_ha"] += (r["total_area_ha"] or 0.0)
            fazendas_map[fz]["talhoes"].append({
                "atividade": atv,
                "total_arquivos": r["total_arquivos"],
                "total_area_ha": round(r["total_area_ha"] or 0.0, 2),
                "data_inicio": r["data_inicio"],
                "data_fim": r["data_fim"]
            })

        result = []
        for fz, data in sorted(fazendas_map.items(), key=lambda x: x[1]["total_area_ha"], reverse=True):
            data["total_area_ha"] = round(data["total_area_ha"], 2)
            data["area_ha"] = data["total_area_ha"]
            data["total_talhoes"] = len(data["talhoes"])
            data["talhoes"].sort(key=lambda t: t["total_area_ha"], reverse=True)
            result.append(data)
        return result

def get_operacoes(db_path: str = DEFAULT_DB_PATH) -> List[Dict[str, Any]]:
    """Retorna tipos distintos de operação registrados."""
    with get_connection(db_path) as conn:
        rows = conn.execute("""
            SELECT tipo_operacao, tipo_operacao as operacao, COUNT(*) as total_arquivos, 
                   SUM(area_trabalhada_ha) as total_area_ha, SUM(area_trabalhada_ha) as area_ha
            FROM arquivos_processados
            WHERE tipo_operacao IS NOT NULL AND (is_deleted IS NULL OR is_deleted = 0)
            GROUP BY tipo_operacao
            ORDER BY total_arquivos DESC;
        """).fetchall()
        return [dict(r) for r in rows]

def get_filtros_equipamento(db_path: str = DEFAULT_DB_PATH) -> Dict[str, Any]:
    """Retorna listas únicas de tratores, implementos e faixas reais disponíveis."""
    with get_connection(db_path) as conn:
        # Tratores
        tratores_rows = conn.execute("""
            SELECT DISTINCT COALESCE(NULLIF(a.modelo_trator, ''), m.modelo, 'John Deere') as modelo
            FROM arquivos_processados a
            LEFT JOIN maquinas m ON m.id = a.maquina_id
            WHERE (a.is_deleted IS NULL OR a.is_deleted = 0)
            ORDER BY modelo ASC;
        """).fetchall()
        tratores = [r["modelo"] for r in tratores_rows if r["modelo"]]

        # Implementos
        impl_rows = conn.execute("""
            SELECT DISTINCT implemento
            FROM arquivos_processados
            WHERE implemento IS NOT NULL AND implemento != '' AND implemento != 'Nenhum'
              AND (is_deleted IS NULL OR is_deleted = 0)
            ORDER BY implemento ASC;
        """).fetchall()
        implementos = [r["implemento"] for r in impl_rows]

        # Faixas de trabalho em metros
        faixa_rows = conn.execute("""
            SELECT DISTINCT largura_trabalho_m
            FROM arquivos_processados
            WHERE largura_trabalho_m > 0
              AND (is_deleted IS NULL OR is_deleted = 0)
            ORDER BY largura_trabalho_m ASC;
        """).fetchall()
        faixas = [round(r["largura_trabalho_m"], 2) for r in faixa_rows]

        return {
            "tratores": tratores,
            "implementos": implementos,
            "faixas": faixas
        }

def get_segmentacao_filtros(
    db_path: str = DEFAULT_DB_PATH,
    fazenda: Optional[str] = None,
    atividade: Optional[str] = None,
    operacao: Optional[str] = None,
    trator: Optional[str] = None,
    implemento: Optional[str] = None,
    faixa_real: Optional[Any] = None,
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Retorna opções válidas e contagens para segmentação de dados cruzada (Power BI slicers).
    Para cada dimensão D, calcula os valores válidos aplicando todos os filtros ativos EXCETO D.
    """
    with get_connection(db_path) as conn:
        # 1. Tratores (todos os filtros exceto trator)
        w_trator, p_trator = _build_filter_sql(
            table_prefix="a.",
            atividade=atividade,
            fazenda=fazenda,
            data_inicio=data_inicio,
            data_fim=data_fim,
            operacao=operacao,
            trator=None,
            implemento=implemento,
            faixa_real=faixa_real,
            db_path=db_path
        )
        sql_tratores = f"""
            SELECT COALESCE(NULLIF(a.modelo_trator, ''), m.modelo, 'John Deere') as modelo,
                   COUNT(*) as count
            FROM arquivos_processados a
            LEFT JOIN maquinas m ON m.id = a.maquina_id
            WHERE {w_trator}
            GROUP BY modelo
            HAVING modelo IS NOT NULL AND modelo != ''
            ORDER BY count DESC, modelo ASC;
        """
        tratores = [{"nome": r["modelo"], "count": r["count"]} for r in conn.execute(sql_tratores, p_trator).fetchall()]

        # 2. Implementos (todos os filtros exceto implemento)
        w_impl, p_impl = _build_filter_sql(
            table_prefix="a.",
            atividade=atividade,
            fazenda=fazenda,
            data_inicio=data_inicio,
            data_fim=data_fim,
            operacao=operacao,
            trator=trator,
            implemento=None,
            faixa_real=faixa_real,
            db_path=db_path
        )
        sql_impl = f"""
            SELECT a.implemento as nome, COUNT(*) as count
            FROM arquivos_processados a
            WHERE {w_impl} AND a.implemento IS NOT NULL AND a.implemento != '' AND a.implemento != 'Nenhum'
            GROUP BY a.implemento
            ORDER BY count DESC, a.implemento ASC;
        """
        implementos = [{"nome": r["nome"], "count": r["count"]} for r in conn.execute(sql_impl, p_impl).fetchall()]

        # 3. Faixas reais (todos os filtros exceto faixa_real)
        w_faixa, p_faixa = _build_filter_sql(
            table_prefix="a.",
            atividade=atividade,
            fazenda=fazenda,
            data_inicio=data_inicio,
            data_fim=data_fim,
            operacao=operacao,
            trator=trator,
            implemento=implemento,
            faixa_real=None,
            db_path=db_path
        )
        sql_faixa = f"""
            SELECT ROUND(a.largura_trabalho_m, 2) as largura, COUNT(*) as count
            FROM arquivos_processados a
            WHERE {w_faixa} AND a.largura_trabalho_m > 0
            GROUP BY largura
            ORDER BY largura ASC;
        """
        faixas = [{"largura": r["largura"], "count": r["count"]} for r in conn.execute(sql_faixa, p_faixa).fetchall()]

        # 4. Operações (todos os filtros exceto operacao)
        w_op, p_op = _build_filter_sql(
            table_prefix="a.",
            atividade=atividade,
            fazenda=fazenda,
            data_inicio=data_inicio,
            data_fim=data_fim,
            operacao=None,
            trator=trator,
            implemento=implemento,
            faixa_real=faixa_real,
            db_path=db_path
        )
        sql_op = f"""
            SELECT a.tipo_operacao as nome, COUNT(*) as count
            FROM arquivos_processados a
            WHERE {w_op} AND a.tipo_operacao IS NOT NULL AND a.tipo_operacao != ''
            GROUP BY a.tipo_operacao
            ORDER BY count DESC, a.tipo_operacao ASC;
        """
        operacoes = [{"nome": r["nome"], "count": r["count"]} for r in conn.execute(sql_op, p_op).fetchall()]

        # 5. Fazendas e Talhões (todos os filtros exceto fazenda e atividade)
        w_faz, p_faz = _build_filter_sql(
            table_prefix="a.",
            atividade=None,
            fazenda=None,
            data_inicio=data_inicio,
            data_fim=data_fim,
            operacao=operacao,
            trator=trator,
            implemento=implemento,
            faixa_real=faixa_real,
            db_path=db_path
        )
        sql_faz_atvs = f"""
            SELECT a.atividade_pasta, COUNT(*) as count, SUM(a.area_trabalhada_ha) as area_ha
            FROM arquivos_processados a
            WHERE {w_faz} AND a.atividade_pasta IS NOT NULL
            GROUP BY a.atividade_pasta
            ORDER BY a.atividade_pasta ASC;
        """
        raw_atvs = conn.execute(sql_faz_atvs, p_faz).fetchall()

        fazendas_dict = {}
        for r in raw_atvs:
            atv = r["atividade_pasta"]
            fz = extract_fazenda(atv if atv != 'Geral' else None)
            if fz not in fazendas_dict:
                fazendas_dict[fz] = {"nome": fz, "count": 0, "area_ha": 0.0, "talhoes": []}
            fazendas_dict[fz]["count"] += r["count"]
            fazendas_dict[fz]["area_ha"] += (r["area_ha"] or 0.0)
            fazendas_dict[fz]["talhoes"].append({"nome": atv, "count": r["count"]})

        fazendas = sorted(list(fazendas_dict.values()), key=lambda x: x["count"], reverse=True)

        # Talhões válidos (se uma fazenda estiver selecionada, limita aos talhões daquela fazenda; senão, todos)
        talhoes = []
        if fazenda and fazenda != 'all':
            talhoes_target = fazendas_dict.get(fazenda, {}).get("talhoes", [])
            talhoes = sorted(talhoes_target, key=lambda x: x["nome"])
        else:
            all_t = {}
            for fz_info in fazendas_dict.values():
                for t in fz_info["talhoes"]:
                    all_t[t["nome"]] = t["count"]
            talhoes = [{"nome": k, "count": v} for k, v in sorted(all_t.items())]

        # 6. Período Min/Max Datas (com todos os filtros ativos)
        w_all, p_all = _build_filter_sql(
            table_prefix="a.",
            atividade=atividade,
            fazenda=fazenda,
            data_inicio=data_inicio,
            data_fim=data_fim,
            operacao=operacao,
            trator=trator,
            implemento=implemento,
            faixa_real=faixa_real,
            db_path=db_path
        )
        sql_dates = f"""
            SELECT MIN(SUBSTR(a.data_inicio, 1, 10)) as min_data,
                   MAX(SUBSTR(a.data_inicio, 1, 10)) as max_data,
                   COUNT(*) as total_arquivos
            FROM arquivos_processados a
            WHERE {w_all};
        """
        date_row = conn.execute(sql_dates, p_all).fetchone()
        periodo = {
            "min_data": date_row["min_data"] if date_row and date_row["min_data"] else None,
            "max_data": date_row["max_data"] if date_row and date_row["max_data"] else None,
            "total_arquivos": date_row["total_arquivos"] if date_row else 0
        }

        return {
            "tratores": tratores,
            "implementos": implementos,
            "faixas": faixas,
            "operacoes": operacoes,
            "fazendas": fazendas,
            "talhoes": talhoes,
            "periodo": periodo
        }

def delete_session(arquivo_id: str, db_path: str = DEFAULT_DB_PATH) -> bool:
    """Marca uma sessão/rastro como excluída (soft-delete imediato)."""
    with get_connection(db_path) as conn:
        res = conn.execute("UPDATE arquivos_processados SET is_deleted = 1 WHERE id = ?;", (arquivo_id,))
        conn.commit()
        return res.rowcount > 0

def restore_session(arquivo_id: str, db_path: str = DEFAULT_DB_PATH) -> bool:
    """Restaura uma sessão/rastro excluída."""
    with get_connection(db_path) as conn:
        res = conn.execute("UPDATE arquivos_processados SET is_deleted = 0 WHERE id = ?;", (arquivo_id,))
        conn.commit()
        return res.rowcount > 0

def delete_sessions_batch(arquivo_ids: List[str], db_path: str = DEFAULT_DB_PATH) -> int:
    """Marca múltiplas sessões/rastros como excluídos de uma vez."""
    if not arquivo_ids:
        return 0
    with get_connection(db_path) as conn:
        placeholders = ",".join(["?"] * len(arquivo_ids))
        res = conn.execute(f"UPDATE arquivos_processados SET is_deleted = 1 WHERE id IN ({placeholders});", arquivo_ids)
        conn.commit()
        return res.rowcount

def restore_sessions_batch(arquivo_ids: List[str], db_path: str = DEFAULT_DB_PATH) -> int:
    """Restaura múltiplas sessões/rastros previamente excluídos."""
    if not arquivo_ids:
        return 0
    with get_connection(db_path) as conn:
        placeholders = ",".join(["?"] * len(arquivo_ids))
        res = conn.execute(f"UPDATE arquivos_processados SET is_deleted = 0 WHERE id IN ({placeholders});", arquivo_ids)
        conn.commit()
        return res.rowcount

def get_timeseries_data(
    arquivo_id: Optional[str] = None, 
    maquina_id: Optional[str] = None, 
    atividade: Optional[str] = None, 
    fazenda: Optional[str] = None,
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    operacao: Optional[str] = None,
    trator: Optional[str] = None,
    implemento: Optional[str] = None,
    faixa_real: Optional[Any] = None,
    operador: Optional[str] = None,
    limit: int = 2500, 
    db_path: str = DEFAULT_DB_PATH
) -> List[Dict[str, Any]]:
    with get_connection(db_path) as conn:
        where_sql, params = _build_filter_sql(
            table_prefix="a.",
            maquina_id=maquina_id,
            atividade=atividade,
            fazenda=fazenda,
            data_inicio=data_inicio,
            data_fim=data_fim,
            operacao=operacao,
            trator=trator,
            implemento=implemento,
            faixa_real=faixa_real,
            operador=operador,
            db_path=db_path
        )
        if arquivo_id:
            where_sql += " AND t.arquivo_id = ?"
            params.append(arquivo_id)

        query = f"""
            SELECT t.timestamp_iso, t.horimetro, t.rpm, t.velocidade, t.carga, t.latitude, t.longitude, t.taxa_aplicacao, t.status_operacao
            FROM telemetria_registros t
            JOIN arquivos_processados a ON a.id = t.arquivo_id
            WHERE {where_sql}
            ORDER BY t.timestamp_ms ASC LIMIT ?;
        """
        params.append(limit)
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

def get_map_routes(
    arquivo_id: Optional[str] = None, 
    maquina_id: Optional[str] = None, 
    atividade: Optional[str] = None, 
    fazenda: Optional[str] = None,
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    operacao: Optional[str] = None,
    trator: Optional[str] = None,
    implemento: Optional[str] = None,
    faixa_real: Optional[Any] = None,
    operador: Optional[str] = None,
    db_path: str = DEFAULT_DB_PATH
) -> List[Dict[str, Any]]:
    with get_connection(db_path) as conn:
        where_sql, params = _build_filter_sql(
            table_prefix="a.",
            maquina_id=maquina_id,
            atividade=atividade,
            fazenda=fazenda,
            data_inicio=data_inicio,
            data_fim=data_fim,
            operacao=operacao,
            trator=trator,
            implemento=implemento,
            faixa_real=faixa_real,
            operador=operador,
            db_path=db_path
        )
        if arquivo_id:
            where_sql += " AND a.id = ?"
            params.append(arquivo_id)

        query = f"""
            SELECT a.id, a.nome_arquivo, a.atividade_pasta, a.data_inicio, a.horimetro_inicial, a.horimetro_final,
                   a.lat_min, a.lat_max, a.lon_min, a.lon_max,
                   a.largura_trabalho_m, a.tipo_operacao, a.implemento,
                   COALESCE(NULLIF(a.modelo_trator, ''), m.modelo, 'John Deere') as modelo_trator,
                   a.taxa_media_kg_ha, a.area_trabalhada_ha,
                   r.velocidade_media, r.rpm_medio
            FROM arquivos_processados a
            LEFT JOIN resumo_operacional r ON r.arquivo_id = a.id
            LEFT JOIN maquinas m ON m.id = a.maquina_id
            WHERE a.lat_min IS NOT NULL AND {where_sql}
            ORDER BY a.data_inicio DESC LIMIT 25000;
        """

        files_rows = conn.execute(query, params).fetchall()
        if not files_rows:
            return []

        file_ids = [f["id"] for f in files_rows]
        file_map = {f["id"]: dict(f) for f in files_rows}
        for f in file_map.values():
            f["points"] = []

        # Carrega pontos em lote de alta performance (chunks de 500 para compatibilidade SQLite)
        chunk_size = 500
        for i in range(0, len(file_ids), chunk_size):
            chunk = file_ids[i:i + chunk_size]
            placeholders = ",".join(["?"] * len(chunk))
            pts_sql = f"""
                SELECT arquivo_id, latitude, longitude, velocidade, rpm, horimetro, timestamp_iso, taxa_aplicacao, status_operacao
                FROM telemetria_registros
                WHERE arquivo_id IN ({placeholders}) AND latitude IS NOT NULL AND longitude IS NOT NULL
                ORDER BY timestamp_ms ASC;
            """
            for pt in conn.execute(pts_sql, chunk).fetchall():
                aid = pt["arquivo_id"]
                file_map[aid]["points"].append({
                    "latitude": pt["latitude"],
                    "longitude": pt["longitude"],
                    "velocidade": pt["velocidade"],
                    "rpm": pt["rpm"],
                    "horimetro": pt["horimetro"],
                    "timestamp_iso": pt["timestamp_iso"],
                    "taxa_aplicacao": pt["taxa_aplicacao"],
                    "status_operacao": pt["status_operacao"]
                })

        return list(file_map.values())
