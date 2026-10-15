/** Teste de INSERT/SELECT/ROLLBACK. A transação não deixa dados de teste no Neon. */
const {Client} = require('pg');
const {randomUUID,randomBytes,createHash} = require('node:crypto');
async function main(){
 if(!process.env.DATABASE_URL) throw Error('DATABASE_URL_AUSENTE');
 const client=new Client({connectionString:process.env.DATABASE_URL,
   connectionTimeoutMillis:12000,query_timeout:12000,
   application_name:'monitor_produt_write_rollback_test'});
 let tx=false;
 const uid=randomUUID(),digest=createHash('sha256').update(randomBytes(32)).digest('hex');
 try{
  await client.connect();
  await client.query('BEGIN');
  tx=true;
  await client.query(
   "INSERT INTO monitor_imports(id,module,filename,sha256,bytes_size,records_count,status) VALUES ($1,'massey','teste_temporario.kml',$2,1,0,'imported')",
   [uid,digest]);
  const inside=await client.query("SELECT count(*)::int AS n FROM monitor_imports WHERE id=$1",[uid]);
  if(inside.rows[0]?.n!==1) throw Error('ESCRITA_NAO_CONFIRMADA');
  await client.query('ROLLBACK');tx=false;
  const after=await client.query("SELECT count(*)::int AS n FROM monitor_imports WHERE id=$1",[uid]);
  if(after.rows[0]?.n!==0) throw Error('ROLLBACK_NAO_CONFIRMADO');
  console.log('NEON_WRITE_READ_ROLLBACK_OK');
  console.log('REGISTROS_TESTE_PERSISTIDOS=0');
 }catch(e){
  console.error('NEON_WRITE_TEST_FAIL='+String(e.code||e.name||'UNKNOWN').replace(/[^A-Z0-9_]/gi,'').slice(0,40));
  process.exitCode=1;
 }finally{
  if(tx)await client.query('ROLLBACK').catch(()=>{});
  await client.end().catch(()=>{});
 }
}
main();
