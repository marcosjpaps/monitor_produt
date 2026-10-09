// PostgreSQL configurado, ou SQLite local persistente (Node >= 22.13).
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const context = new AsyncLocalStorage();
const DATABASE_URL = process.env.DATABASE_URL;
let pool, local;
if (process.env.DRONE_DB_MODE === 'pglite') {
  const {PGlite}=require('@electric-sql/pglite');
  const db=new PGlite(process.env.PGLITE_DB_PATH);
  pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}}),end:()=>db.close()};
} else if (DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: DATABASE_URL,
    ssl: process.env.PG_SSL === 'true' ? {rejectUnauthorized:true} : false });
} else {
  const { DatabaseSync } = require('node:sqlite');
  const file = process.env.DRONE_DB_PATH || path.join(__dirname, '../data/drone.sqlite');
  fs.mkdirSync(path.dirname(file), {recursive:true});
  local = new DatabaseSync(file);
  local.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
}
async function query(sql, params = []) {
  if (pool) return (await (context.getStore() || pool).query(sql,params)).rows;
  // Parametrização posicional também suporta placeholders repetidos.
  const values=[];
  sql=sql.replace(/\$(\d+)/g, (_, n)=>{ values.push(params[Number(n)-1]); return '?'; })
    .replace(/::jsonb/g,'').replace(/NOW\(\)/gi,'CURRENT_TIMESTAMP');
  const stmt = local.prepare(sql);
  const rows = stmt.all(...values.map(v=> v === undefined ? null : (typeof v==='object' && v!==null ? JSON.stringify(v) : v)));
  for(const row of rows) for(const key of ['coords','bbox']) {
    if(typeof row[key]==='string') {try {row[key]=JSON.parse(row[key]);}catch {row[key]=[];}}
  }
  return rows;
}
let queue=Promise.resolve();
async function transaction(fn) {
  if (pool) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result=await context.run(client,fn); await client.query('COMMIT'); return result; }
    catch(e) { await client.query('ROLLBACK'); throw e; }
    finally {client.release();}
  }
  const run=queue.then(async()=>{local.exec('BEGIN IMMEDIATE'); try {const result=await fn();local.exec('COMMIT');return result;}catch(e){local.exec('ROLLBACK');throw e;}});
  queue=run.catch(()=>{});return run;
}
async function close(){ if(pool) await pool.end();else local.close(); }
module.exports={query,transaction,close,pool,DATABASE_URL,local};
