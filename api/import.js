// Importação web de logs e telemetria
// Aceita JSON já processado e uploads multipart de logs/CSV.
const { query } = require('./db');
const crypto = require('crypto');
const { parseDJI } = require('./djiParser');

function parseMultipart(body, contentType){
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if(!match) return null;
  const boundary = '--' + (match[1] || match[2]).trim();
  const text = body.toString('latin1');
  const parts = text.split(boundary);
  for(const part of parts){
    const idx = part.indexOf('\r\n\r\n');
    if(idx < 0) continue;
    const head = part.slice(0, idx);
    const data = part.slice(idx+4).replace(/\r\n$/, '');
    const name = (head.match(/name="([^"]+)"/)||[])[1];
    const filename = (head.match(/filename="([^"]+)"/)||[])[1];
    if(filename) return {filename:Buffer.from(filename,'latin1').toString('utf8'), buffer: Buffer.from(data,'latin1')};
  }
  return null;
}

async function saveFlight(f){
  f = require('./telemetryValidator').validateFlight(f);
  if (!f.coords.length) throw new Error('Arquivo sem coordenadas válidas');
  const existing = await query('SELECT id FROM voos WHERE id=$1',[f.id]);
  if(existing.length) return {duplicate:true,id:f.id};
  let outcome;
  const response={status(code){this.code=code;return this;},json(value){outcome=value;},setHeader(){}};
  await require('./voos')({method:'POST',query:{},body:{flights:[f]}},response);
  if(response.code>=400 || outcome?.error)throw new Error(outcome.error);
  return outcome;
}

module.exports = async (req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');
 if(req.method==='OPTIONS') return res.status(200).end();
 if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
 try{
  if(req.headers['content-type']?.includes('application/json')){
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if (body.conteudo) {
      let flight = parseDJI(Buffer.from(body.conteudo, 'utf8'), body.arquivo || body.nome || 'arquivo.kml');
      const { validateFlight } = require('./telemetryValidator');
      flight = validateFlight(flight);
      const resSave = await saveFlight(flight);
      if (resSave && resSave.duplicate) {
        return res.json({success:true, imported:0, duplicate:true, id:flight.id});
      }
      return res.json({success:true, imported:1, id:flight.id, points:flight.points});
    }
    if(!Array.isArray(body.flights)||!body.flights.length)return res.status(400).json({error:'Envie flights ou o conteúdo de um KML/CSV'});
    let imported=0,duplicates=0;
    for(const f of (body.flights||[])){const r=await saveFlight(f);if(r.duplicate)duplicates++;else imported++;}
    return res.json({success:true,imported,duplicates});
  }
  const file=parseMultipart(req.body, req.headers['content-type']||'');
  if(!file) return res.status(400).json({success:false,error:'Arquivo não encontrado'});

  let flight = parseDJI(file.buffer, file.filename);
  
  // Otimização: aplica Douglas-Peucker e garante limites de pontos
  const { validateFlight } = require('./telemetryValidator');
  flight = validateFlight(flight);

  const saved=await saveFlight(flight);
  return res.json({success:true, duplicate:!!saved.duplicate, imported:saved.duplicate?0:1, id:flight.id, points:flight.points});
 }catch(e){
  console.error(e);
  res.status(400).json({success:false,error:e.message});
 }
};
