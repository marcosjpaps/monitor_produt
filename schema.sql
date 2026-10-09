-- =============================================================
-- AgroTelemetry Monitor - Schema PostgreSQL
-- Execute este script via psql ou gerenciador PostgreSQL:
-- psql "$DATABASE_URL" -f schema.sql
-- =============================================================

-- Extensão para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================
-- 0. TABELAS CENTRAIS DE TELEMETRIA DE DRONES (VeredasDrone)
-- =============================================================

-- Talhões cadastrados e importados (SIG / Shapefile / KML / CSV)
CREATE TABLE IF NOT EXISTS talhoes (
    id              TEXT PRIMARY KEY,
    nome_faz        TEXT,
    talhao          TEXT,
    zona            TEXT,
    variedade       TEXT,
    plantio         TEXT,
    area_total      DOUBLE PRECISION,
    coords          JSONB,
    bbox            JSONB,
    criado_em       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_talhoes_fazenda ON talhoes(nome_faz);
CREATE INDEX IF NOT EXISTS idx_talhoes_talhao  ON talhoes(talhao);

-- Missões / Voos de Drones (DJI Agras / KML / Telemetria)
CREATE TABLE IF NOT EXISTS voos (
    id              TEXT PRIMARY KEY,
    nome_arquivo    TEXT,
    drone           TEXT,
    piloto          TEXT,
    data_voo        TEXT,
    raw_date        TEXT,
    area_ha         DOUBLE PRECISION,
    calda_l         DOUBLE PRECISION,
    taxa_l_ha       DOUBLE PRECISION,
    tempo_voo_s     DOUBLE PRECISION,
    tempo_voo_fmt   TEXT,
    vel_media_kmh   DOUBLE PRECISION,
    altura_media_m  DOUBLE PRECISION,
    faixa_media_m   DOUBLE PRECISION,
    num_pontos      INTEGER,
    farm            TEXT,
    talhao          TEXT,
    coords          JSONB,
    criado_em       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voos_data   ON voos(data_voo);
CREATE INDEX IF NOT EXISTS idx_voos_farm   ON voos(farm);
CREATE INDEX IF NOT EXISTS idx_voos_drone  ON voos(drone);
CREATE INDEX IF NOT EXISTS idx_voos_piloto ON voos(piloto);

-- Voos excluídos (para sincronização entre múltiplos clientes)
CREATE TABLE IF NOT EXISTS voos_deletados (
    id              TEXT PRIMARY KEY,
    deletado_em     TIMESTAMPTZ DEFAULT NOW()
);

-- Lixeira de voos excluídos (com histórico completo para restauração)
CREATE TABLE IF NOT EXISTS voos_lixeira (
    id              VARCHAR PRIMARY KEY,
    nome_arquivo    VARCHAR,
    drone           VARCHAR,
    piloto          VARCHAR,
    data_voo        VARCHAR,
    raw_date        TEXT,
    area_ha         NUMERIC,
    calda_l         NUMERIC,
    taxa_l_ha       NUMERIC,
    tempo_voo_s     NUMERIC,
    tempo_voo_fmt   VARCHAR,
    vel_media_kmh   NUMERIC,
    altura_media_m  NUMERIC,
    faixa_media_m   NUMERIC,
    num_pontos      INTEGER,
    farm            VARCHAR,
    talhao          VARCHAR,
    coords          JSONB,
    criado_em       TIMESTAMPTZ,
    deletado_em     TIMESTAMPTZ DEFAULT NOW()
);

-- Relacionamento N:N (Um voo pode cruzar múltiplos talhões)
CREATE TABLE IF NOT EXISTS voo_talhoes (
    id               BIGSERIAL PRIMARY KEY,
    voo_id           TEXT NOT NULL,
    talhao_id        TEXT NOT NULL,
    nome_faz         TEXT,
    talhao           TEXT,
    coverage_percent NUMERIC(5, 2) DEFAULT 0,
    match_status     TEXT DEFAULT 'matched',
    criado_em        TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_voo_talhao UNIQUE (voo_id, talhao_id)
);

CREATE INDEX IF NOT EXISTS idx_voo_talhoes_voo    ON voo_talhoes(voo_id);
CREATE INDEX IF NOT EXISTS idx_voo_talhoes_talhao ON voo_talhoes(talhao_id);

-- =============================================================
-- 1. MÁQUINAS / EQUIPAMENTOS
-- =============================================================
CREATE TABLE IF NOT EXISTS machines (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    serial_number   TEXT UNIQUE NOT NULL,
    model           TEXT NOT NULL,
    custom_name     TEXT,
    manufacturer    TEXT DEFAULT 'Unknown',
    implement       TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- 2. SESSÕES / FICHEIROS DE TELEMETRIA
-- =============================================================
CREATE TABLE IF NOT EXISTS telemetry_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    machine_id      UUID REFERENCES machines(id) ON DELETE SET NULL,
    file_name       TEXT NOT NULL,
    file_md5        TEXT UNIQUE NOT NULL,
    file_size_bytes BIGINT,
    source_type     TEXT CHECK (source_type IN ('JDL', 'AGF', 'KML', 'SHP', 'TMX', 'RNX')) NOT NULL,
    farm_name       TEXT,
    field_name      TEXT,
    activity        TEXT,
    operation_type  TEXT,
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    duration_min    NUMERIC(10,2),
    area_ha         NUMERIC(10,4),
    distance_km     NUMERIC(10,3),
    fuel_l          NUMERIC(10,2),
    avg_speed_kmh   NUMERIC(8,2),
    avg_rpm         NUMERIC(8,2),
    avg_engine_load NUMERIC(5,2),
    raw_meta        JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_machine ON telemetry_sessions(machine_id);
CREATE INDEX IF NOT EXISTS idx_sessions_farm    ON telemetry_sessions(farm_name);
CREATE INDEX IF NOT EXISTS idx_sessions_date    ON telemetry_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_type    ON telemetry_sessions(source_type);

-- =============================================================
-- 3. PONTOS GPS / SÉRIES TEMPORAIS
-- =============================================================
CREATE TABLE IF NOT EXISTS gps_points (
    id          BIGSERIAL PRIMARY KEY,
    session_id  UUID REFERENCES telemetry_sessions(id) ON DELETE CASCADE,
    ts          TIMESTAMPTZ NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    alt_m       NUMERIC(8,2),
    speed_kmh   NUMERIC(7,2),
    rpm         NUMERIC(7,1),
    engine_load NUMERIC(5,2),
    fuel_l_h    NUMERIC(7,3),
    heading_deg NUMERIC(5,1)
);

CREATE INDEX IF NOT EXISTS idx_gps_session ON gps_points(session_id);
CREATE INDEX IF NOT EXISTS idx_gps_ts      ON gps_points(ts);

-- =============================================================
-- 4. TALHÕES / FARM FIELDS (SIG)
-- =============================================================
CREATE TABLE IF NOT EXISTS farm_fields (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farm_name       TEXT NOT NULL,
    zone            TEXT,
    field_number    TEXT,
    field_desc      TEXT,
    variety         TEXT,
    planting_year   INTEGER,
    area_ha         NUMERIC(12,4),
    center_lon      DOUBLE PRECISION,
    center_lat      DOUBLE PRECISION,
    bbox_json       JSONB,
    boundary_geojson JSONB,
    source          TEXT DEFAULT 'SIG',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fields_farm  ON farm_fields(farm_name);
CREATE INDEX IF NOT EXISTS idx_fields_field ON farm_fields(field_number);

-- =============================================================
-- 5. OPERAÇÕES AGRÍCOLAS (Massey / Trimble TMX)
-- =============================================================
CREATE TABLE IF NOT EXISTS agricultural_operations (
    id                  TEXT PRIMARY KEY,  -- UUID do Trimble
    raw_name            TEXT,
    clean_name          TEXT,
    operation_type      TEXT,
    client_name         TEXT,
    farm_name           TEXT,
    field_name          TEXT,
    detected_fields     JSONB,
    device_product      TEXT,
    device_serial       TEXT,
    vehicle_name        TEXT,
    implement_name      TEXT,
    controller_name     TEXT,
    crypto_key_version  TEXT,
    crypto_iv           TEXT,
    payload_files       JSONB,
    source_archive_path TEXT,
    manifest_xml_raw    TEXT,
    file_size_bytes     BIGINT,
    area_ha             TEXT,
    applied_rate        TEXT,
    total_applied       TEXT,
    swath_width_m       TEXT,
    geojson_geometry    JSONB,
    points_count        INTEGER,
    operation_date      TEXT,
    imported_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_farm   ON agricultural_operations(farm_name);
CREATE INDEX IF NOT EXISTS idx_ops_type   ON agricultural_operations(operation_type);
CREATE INDEX IF NOT EXISTS idx_ops_serial ON agricultural_operations(device_serial);

-- =============================================================
-- 6. EVENTOS DE COBERTURA AgGPS (Jacto / Trimble)
-- =============================================================
CREATE TABLE IF NOT EXISTS aggps_events (
    id              BIGSERIAL PRIMARY KEY,
    session_label   TEXT,
    farm_name       TEXT,
    field_name      TEXT,
    operator        TEXT,
    implement       TEXT,
    swath_width_m   NUMERIC(8,2),
    area_ha         NUMERIC(10,4),
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    duration_min    NUMERIC(10,2),
    product         TEXT,
    rate_kg_ha      NUMERIC(10,2),
    total_kg        NUMERIC(12,2),
    source_path     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- 7. LOGS DE AUDITORIA
-- =============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    action      TEXT NOT NULL,
    entity      TEXT,
    entity_id   TEXT,
    details     JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS importacoes (id SERIAL PRIMARY KEY, arquivo TEXT, registros INTEGER DEFAULT 0, status TEXT, criado_em TIMESTAMP DEFAULT NOW());

ALTER TABLE voos ADD COLUMN IF NOT EXISTS kml_url TEXT;
ALTER TABLE voos_lixeira ADD COLUMN IF NOT EXISTS kml_url TEXT;
