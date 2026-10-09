const { parseDJI } = require('./djiParser');

module.exports = async function(req,res){
  try{
    const b=req.body||{};
    if(!b.conteudo) return res.status(400).json({error:'arquivo vazio'});
    const buf=Buffer.from(b.conteudo,'utf8');
    const flight=parseDJI(buf,b.nome||'arquivo.kml');
    if(!flight.coords.length)return res.status(400).json({error:'Arquivo sem coordenadas válidas'});
    res.json({success:true,total:1,voos:[{arquivo:flight.fileName,drone:flight.drone,pontos:flight.points,area:flight.area,data:flight.dateFormatted}]});
  }catch(e){res.status(500).json({error:e.message})}
}
