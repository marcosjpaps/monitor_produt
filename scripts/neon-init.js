/**
 * Migração inicial conservadora do Monitor Agrícola na Neon.
 * Somente CREATE TABLE/INDEX IF NOT EXISTS e ADD COLUMN IF NOT EXISTS.
 * Nunca executa DROP/DELETE/TRUNCATE, nem copia credenciais para o Git.
 */
const { Client } = require('pg');
const JD_FILES = [
  'atividade_pasta TEXT',
  'largura_trabalho_m DOUBLE PRECISION DEFAULT 4.5',
  "tipo_operacao TEXT DEFAULT 'Distribuição a Lanço'",
  'taxa_media_kg_ha DOUBLE PRECISION DEFAULT 0',
  'area_trabalhada_ha DOUBLE PRECISION DEFAULT 0',
  'is_deleted INTEGER DEFAULT 0',
  'modelo_trator TEXT',
  'operador TEXT',
];
const JD_RECORDS = [
  'taxa_aplicacao DOUBLE PRECISION DEFAULT 0',
  "status_operacao TEXT DEFAULT 'DESLOCAMENTO'",
];
const OP_COLUMNS = [
  'raw_name','clean_name','operation_type','client_name','farm_name',
  'field_name','detected_fields','device_product','device_serial','vehicle_name',
  'implement_name','controller_name','crypto_key_version','crypto_iv',
  'payload_files','source_archive_path','manifest_xml_raw','file_size_bytes',
  'area_ha','applied_rate','total_applied','swath_width_m','geojson_geometry',
  'points_count','operation_date','imported_at'
];
const FIELD_COLUMNS = [
  'farm_name','zone','field_number','field_desc','variety','planting_year',
  'area_ha','center_lon','center_lat','bbox_json','boundary_geojson','source'
];
async function main(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL_AUSENTE');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 12000,
    query_timeout: 20000,
    application_name: 'monitor_produt_migracao'
  });
  let begun=false;
  try{
    await client.connect();
    await client.query('BEGIN');
    begun=true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    // Não executar em um banco já usado por outro sistema sem revisão.
    const current=await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
    );
    const existing=new Set(current.rows.map(x=>x.table_name));
    const expected=new Set(['maquinas','arquivos_processados','telemetria_registros',
      'resumo_operacional','talhoes','agricultural_operations','farm_fields',
      'monitor_imports','monitor_import_chunks']);
    const unrelated=[...existing].filter(x=>!expected.has(x));
    if(unrelated.length) throw new Error('BANCO_COMPARTILHADO_REVISAO_NECESSARIA');

    await client.query(`CREATE TABLE IF NOT EXISTS maquinas (
      id TEXT PRIMARY KEY, numero_serie TEXT UNIQUE NOT NULL, modelo TEXT NOT NULL,
      nome_customizado TEXT, implemento_padrao TEXT, fabricante TEXT DEFAULT 'John Deere',
      horimetro_atual DOUBLE PRECISION DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await client.query(`CREATE TABLE IF NOT EXISTS arquivos_processados (
      id TEXT PRIMARY KEY, maquina_id TEXT NOT NULL REFERENCES maquinas(id),
      nome_arquivo TEXT NOT NULL, hash_md5 TEXT UNIQUE NOT NULL,
      tamanho_bytes INTEGER NOT NULL, versao_so TEXT, hardware_serial TEXT,
      implemento TEXT, atividade_pasta TEXT, data_inicio TEXT NOT NULL, data_fim TEXT NOT NULL,
      duracao_segundos DOUBLE PRECISION NOT NULL, horimetro_inicial DOUBLE PRECISION NOT NULL,
      horimetro_final DOUBLE PRECISION NOT NULL,
      lat_min DOUBLE PRECISION, lat_max DOUBLE PRECISION,
      lon_min DOUBLE PRECISION, lon_max DOUBLE PRECISION,
      imported_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    for(const c of JD_FILES) await client.query(
      `ALTER TABLE arquivos_processados ADD COLUMN IF NOT EXISTS ${c}`);
    await client.query(`CREATE TABLE IF NOT EXISTS telemetria_registros (
      id SERIAL PRIMARY KEY,
      arquivo_id TEXT NOT NULL REFERENCES arquivos_processados(id),
      maquina_id TEXT NOT NULL REFERENCES maquinas(id),
      timestamp_iso TEXT NOT NULL, timestamp_ms BIGINT NOT NULL,
      horimetro DOUBLE PRECISION, rpm DOUBLE PRECISION, velocidade DOUBLE PRECISION,
      marcha INTEGER, carga DOUBLE PRECISION, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
      taxa_aplicacao DOUBLE PRECISION DEFAULT 0,
      status_operacao TEXT DEFAULT 'DESLOCAMENTO')`);
    for(const c of JD_RECORDS) await client.query(
      `ALTER TABLE telemetria_registros ADD COLUMN IF NOT EXISTS ${c}`);
    await client.query(`CREATE TABLE IF NOT EXISTS resumo_operacional (
      id TEXT PRIMARY KEY, arquivo_id TEXT UNIQUE NOT NULL REFERENCES arquivos_processados(id),
      maquina_id TEXT NOT NULL REFERENCES maquinas(id),
      tempo_ligado_s DOUBLE PRECISION NOT NULL,
      tempo_deslocamento_s DOUBLE PRECISION NOT NULL,
      tempo_parado_s DOUBLE PRECISION NOT NULL,
      rpm_medio DOUBLE PRECISION, velocidade_media DOUBLE PRECISION,
      velocidade_max DOUBLE PRECISION, carga_media DOUBLE PRECISION)`);
    await client.query(`CREATE TABLE IF NOT EXISTS talhoes (
      id TEXT PRIMARY KEY, nome_faz TEXT, talhao TEXT, zona TEXT, variedade TEXT, plantio TEXT,
      area_total DOUBLE PRECISION, coords JSONB, bbox JSONB,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await client.query(`CREATE TABLE IF NOT EXISTS agricultural_operations (
      id TEXT PRIMARY KEY,
      ${OP_COLUMNS.map(c=>c+' TEXT').join(',')})`);
    await client.query(`CREATE TABLE IF NOT EXISTS farm_fields (
      id TEXT PRIMARY KEY,
      ${FIELD_COLUMNS.map(c=>c+' '+(['area_ha','center_lon','center_lat'].includes(c)?'DOUBLE PRECISION':'TEXT')).join(',')})`);
    for(const c of OP_COLUMNS) await client.query(
      `ALTER TABLE agricultural_operations ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    for(const c of FIELD_COLUMNS) await client.query(
      `ALTER TABLE farm_fields ADD COLUMN IF NOT EXISTS ${c} ${['area_ha','center_lon','center_lat'].includes(c)?'DOUBLE PRECISION':'TEXT'}`);
    await client.query(`CREATE TABLE IF NOT EXISTS monitor_imports (
      id TEXT PRIMARY KEY,module TEXT NOT NULL,filename TEXT NOT NULL,
      sha256 TEXT NOT NULL,bytes_size BIGINT NOT NULL,
      records_count INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'imported',
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,archived_at TEXT,file_data BYTEA,
      UNIQUE(module,sha256))`);
    await client.query(`CREATE TABLE IF NOT EXISTS monitor_import_chunks (
      upload_id TEXT NOT NULL,part_index INTEGER NOT NULL,total_parts INTEGER NOT NULL,
      module TEXT NOT NULL,filename TEXT NOT NULL,file_data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(upload_id,part_index))`);
    const indexes=[
      'CREATE INDEX IF NOT EXISTS idx_arq_md5 ON arquivos_processados(hash_md5)',
      'CREATE INDEX IF NOT EXISTS idx_arq_ativ ON arquivos_processados(atividade_pasta)',
      'CREATE INDEX IF NOT EXISTS idx_arq_maq ON arquivos_processados(maquina_id)',
      'CREATE INDEX IF NOT EXISTS idx_arq_deleted ON arquivos_processados(is_deleted)',
      'CREATE INDEX IF NOT EXISTS idx_arq_modelo ON arquivos_processados(modelo_trator)',
      'CREATE INDEX IF NOT EXISTS idx_arq_impl ON arquivos_processados(implemento)',
      'CREATE INDEX IF NOT EXISTS idx_arq_larg ON arquivos_processados(largura_trabalho_m)',
      'CREATE INDEX IF NOT EXISTS idx_telemetria_time ON telemetria_registros(timestamp_ms)',
      'CREATE INDEX IF NOT EXISTS idx_telemetria_maq ON telemetria_registros(maquina_id)',
      'CREATE INDEX IF NOT EXISTS idx_telemetria_arq ON telemetria_registros(arquivo_id)',
      'CREATE INDEX IF NOT EXISTS idx_talhoes_nome_faz ON talhoes(nome_faz)',
      'CREATE INDEX IF NOT EXISTS monitor_imports_date_idx ON monitor_imports(imported_at)'
    ];
    for(const sql of indexes) await client.query(sql);
    await client.query('COMMIT');
    begun=false;
    const verified=await client.query(
      "SELECT count(*)::integer AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name=ANY($1)",
      [[...expected]]
    );
    console.log('NEON_SCHEMA_INITIALIZED_OK');
    console.log('TABELAS_MONITOR_VERIFICADAS=' + verified.rows[0].n);
  }catch(e){
    if(begun) await client.query('ROLLBACK').catch(()=>{});
    console.error('NEON_SCHEMA_ERROR=' + String(e.code || e.message || 'UNKNOWN').replace(/[^A-Z0-9_]/gi,'').slice(0,60));
    process.exitCode=1;
  }finally{await client.end().catch(()=>{});}
}
main();
