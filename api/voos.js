const {query} = require('./db');
const {validateFlight,extractLatLng} = require('./telemetryValidator');
const {matchFlightToFields}=require('./flightFieldMatcher');
const columns=['id','nome_arquivo','drone','piloto','data_voo','raw_date','kml_url','area_ha','calda_l','taxa_l_ha','tempo_voo_s','tempo_voo_fmt','vel_media_kmh','altura_media_m','faixa_media_m','num_pontos','farm','talhao','coords'];
const numeric=v=>Number.isFinite(Number(v))?Number(v):0;
function convert(r){return {id:r.id,fileName:r.nome_arquivo,drone:r.drone,pilot:r.piloto,dateFormatted:r.data_voo,rawDate:r.raw_date,kmlUrl:r.kml_url,area:r.area_ha,sprayL:r.calda_l,rate:r.taxa_l_ha,timeSec:r.tempo_voo_s,time:r.tempo_voo_fmt,speed:r.vel_media_kmh,height:r.altura_media_m,spacing:r.faixa_media_m,points:r.num_pontos,farm:r.farm,talhao:r.talhao,coords:r.coords||[]};}
async function linkFlights(ids){const fields=await query('SELECT * FROM talhoes');for(const id of ids){await query('DELETE FROM voo_talhoes WHERE voo_id=$1',[id]);const rows=await query('SELECT coords FROM voos WHERE id=$1',[id]);if(!rows.length)continue;for(const m of matchFlightToFields(rows[0].coords,fields))await query('INSERT INTO voo_talhoes(voo_id,talhao_id,nome_faz,talhao,coverage_percent,match_status) VALUES($1,$2,$3,$4,$5,$6)',[id,m.talhaoId,m.nomeFaz,m.talhao,null,m.matchStatus]);}}
module.exports=async(req,res)=>{
 const body=req.body||{};
 if(['OPTIONS','HEAD'].includes(req.method))return res.status(200).end();
 if(req.method==='GET'){
  const deleted=await query('SELECT id FROM voos_deletados ORDER BY deletado_em DESC');
  if(req.query.type==='deletados')return res.json({success:true,deletedIds:deleted.map(r=>r.id)});
  const trash=req.query.type==='lixeira';const rawLimit=Number(req.query.limit);
  const limit=Number.isInteger(rawLimit)&&rawLimit>0?Math.min(rawLimit,100000):null;
  const rows=await query(`SELECT * FROM ${trash?'voos_lixeira':'voos'} ORDER BY ${trash?'deletado_em':'criado_em'} DESC${limit?' LIMIT $1':''}`,limit?[limit]:[]);
  const links=await query('SELECT * FROM voo_talhoes');
  return res.json({success:true,flights:rows.map(r=>({...convert(r),matchedTalhoes:links.filter(m=>m.voo_id===r.id).map(m=>({talhaoId:m.talhao_id,nomeFaz:m.nome_faz,talhao:m.talhao,coveragePercent:m.coverage_percent,matchStatus:m.match_status}))})),deletedIds:deleted.map(r=>r.id)});
 }
 const action=req.query.action||body.action;
 const ids=req.query.id?[req.query.id]:(body.ids||(body.id?[body.id]:[]));
 if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!id))return res.status(400).json({error:'IDs inválidos'});
 if(req.method==='POST' && action==='restaurar'){
  let restored=0;for(const id of ids){const rows=await query('SELECT * FROM voos_lixeira WHERE id=$1',[id]);if(!rows.length)continue;const r=rows[0];await query(`INSERT INTO voos(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO NOTHING`,columns.map(c=>c==='coords'?JSON.stringify(r[c]):r[c]));await query('DELETE FROM voos_lixeira WHERE id=$1',[id]);await query('DELETE FROM voos_deletados WHERE id=$1',[id]);restored++;}await linkFlights(ids);return res.json({success:true,restored});
 }
 if(req.method==='POST'){
  const input=Array.isArray(body)?body:(body.flights||[body]);
  if(!Array.isArray(input)||!input.length || input.some(f=>!f||typeof f.id!=='string'||!f.id||!Array.isArray(f.coords)||!f.coords.length||f.coords.some(p=>!extractLatLng(p))))return res.status(400).json({error:'Cada voo precisa de ID e coordenadas válidas [latitude, longitude].'});
  const flights=[...new Map(input.map(f=>[f.id,validateFlight(f)])).values()];
  for(const f of flights){const values=[f.id,f.fileName||f.nome_arquivo||'',f.drone||'',f.pilot||f.piloto||'',f.dateFormatted||f.data_voo||'',f.rawDate||f.raw_date||'',f.kmlUrl||f.kml_url||'',...['area','sprayL','rate','timeSec'].map(k=>numeric(f[k])),f.time||'',...['speed','height','spacing','points'].map(k=>numeric(f[k])),f.farm||'',f.talhao||'',JSON.stringify(f.coords)];await query(`INSERT INTO voos(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map(c=>c+'=excluded.'+c).join(',')}`,values);await query('DELETE FROM voos_deletados WHERE id=$1',[f.id]);await query('DELETE FROM voos_lixeira WHERE id=$1',[f.id]);}
  await linkFlights(flights.map(f=>f.id));return res.json({success:true,savedCount:flights.length,savedIds:flights.map(f=>f.id),requestedCount:input.length,missingIds:[]});
 }
 if(req.method==='DELETE'){
  if(!ids.length)return res.status(400).json({error:'Nenhum ID informado'});let count=0;
  for(const id of ids){if(action==='excluir_permanente'){const rows=await query('DELETE FROM voos_lixeira WHERE id=$1 RETURNING id',[id]);count+=rows.length;continue;}const rows=await query('SELECT * FROM voos WHERE id=$1',[id]);if(!rows.length)continue;const r=rows[0];await query(`INSERT INTO voos_lixeira(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO UPDATE SET deletado_em=CURRENT_TIMESTAMP`,columns.map(c=>c==='coords'?JSON.stringify(r[c]):r[c]));await query('INSERT INTO voos_deletados(id) VALUES($1) ON CONFLICT(id) DO NOTHING',[id]);await query('DELETE FROM voo_talhoes WHERE voo_id=$1',[id]);await query('DELETE FROM voos WHERE id=$1',[id]);count++;}
  return res.json({success:true,deletedCount:count});
 }
 return res.status(405).json({error:'Método não permitido'});
};
module.exports.linkFlights=linkFlights;
