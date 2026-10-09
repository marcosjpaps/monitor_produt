const { query, local, transaction, close } = require('../api/db');
const flightColumns = `id TEXT PRIMARY KEY, nome_arquivo TEXT, drone TEXT, piloto TEXT,
 data_voo TEXT, raw_date TEXT, kml_url TEXT, area_ha DOUBLE PRECISION, calda_l DOUBLE PRECISION,
 taxa_l_ha DOUBLE PRECISION, tempo_voo_s DOUBLE PRECISION, tempo_voo_fmt TEXT,
 vel_media_kmh DOUBLE PRECISION, altura_media_m DOUBLE PRECISION, faixa_media_m DOUBLE PRECISION,
 num_pontos INTEGER, farm TEXT, talhao TEXT, coords ${local?'TEXT':'JSONB'}, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP`;
async function migrate(){await transaction(async()=>{
 await query(`CREATE TABLE IF NOT EXISTS voos (${flightColumns})`);
 await query(`CREATE TABLE IF NOT EXISTS voos_lixeira (${flightColumns}, deletado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
 await query(`CREATE TABLE IF NOT EXISTS voos_deletados(id TEXT PRIMARY KEY, deletado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
 await query(`CREATE TABLE IF NOT EXISTS talhoes(id TEXT PRIMARY KEY, nome_faz TEXT, talhao TEXT, zona TEXT, variedade TEXT, plantio TEXT, area_total DOUBLE PRECISION, coords ${local?'TEXT':'JSONB'}, bbox ${local?'TEXT':'JSONB'}, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
 await query(`CREATE TABLE IF NOT EXISTS voo_talhoes(voo_id TEXT NOT NULL, talhao_id TEXT NOT NULL, nome_faz TEXT, talhao TEXT, coverage_percent DOUBLE PRECISION, match_status TEXT, UNIQUE(voo_id,talhao_id))`);
 await query(`CREATE TABLE IF NOT EXISTS importacoes(id ${local?'INTEGER PRIMARY KEY AUTOINCREMENT':'SERIAL PRIMARY KEY'}, arquivo TEXT, registros INTEGER DEFAULT 0, status TEXT, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
 for(const table of ['voos','voos_lixeira']) {
  if(local){const columns=await query(`PRAGMA table_info(${table})`);if(!columns.some(c=>c.name==='kml_url'))await query(`ALTER TABLE ${table} ADD COLUMN kml_url TEXT`);}
  else await query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS kml_url TEXT`);
 }
 for(const [table,column] of [['voos','data_voo'],['talhoes','nome_faz'],['voo_talhoes','voo_id']]) await query(`CREATE INDEX IF NOT EXISTS idx_${table}_${column} ON ${table}(${column})`);
});}
if(require.main===module) migrate().then(close).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={migrate};
