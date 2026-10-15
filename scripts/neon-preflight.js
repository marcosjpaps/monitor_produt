/**
 * Vercel build gate: somente leitura no PostgreSQL configurado.
 * Não imprime endereço do servidor, usuário, senha ou dados dos clientes.
 */
const { Client } = require('pg');
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_AUSENTE');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 12000,
    query_timeout: 10000,
    statement_timeout: 10000,
    application_name: 'monitor_prodp_preflight'
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const ping = await client.query('SELECT 1 AS conectado');
    if (Number(ping.rows[0]?.conectado) !== 1) throw new Error('PING_INESPERADO');
    const schema = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
    );
    const names = new Set(schema.rows.map(row => row.table_name));
    const monitorTables = ['maquinas','arquivos_processados','telemetria_registros','resumo_operacional','talhoes','agricultural_operations','farm_fields','monitor_imports','monitor_import_chunks'];
    console.log('NEON_PREFLIGHT_OK');
    console.log('TABELAS_PUBLIC_TOTAL=' + names.size);
    console.log('TABELAS_MONITOR_EXISTENTES=' + monitorTables.filter(n => names.has(n)).join(','));
    console.log('TABELAS_MONITOR_A_CRIAR=' + monitorTables.filter(n => !names.has(n)).join(','));
    await client.query('ROLLBACK');
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch(e => {
  // Código resumido, sem valores sensíveis como connectionString ou stack.
  console.error('NEON_PREFLIGHT_FAIL=' + String(e.code || e.name || 'UNKNOWN').replace(/[^A-Z0-9_]/gi, '').slice(0,40));
  process.exitCode = 1;
});
