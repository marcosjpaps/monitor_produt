const { query, local, transaction, close } = require('../api/db');

async function migrate(){await transaction(async()=>{
  await query(`CREATE TABLE IF NOT EXISTS talhoes(id TEXT PRIMARY KEY, nome_faz TEXT, talhao TEXT, zona TEXT, variedade TEXT, plantio TEXT, area_total DOUBLE PRECISION, coords ${local?'TEXT':'JSONB'}, bbox ${local?'TEXT':'JSONB'}, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_talhoes_nome_faz ON talhoes(nome_faz)`);
});}
if(require.main===module) migrate().then(close).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={migrate};
