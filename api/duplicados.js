const { query } = require('./db');
module.exports=async(req,res)=>{
 try{
  const r=await query('SELECT id,nome_arquivo,drone,data_voo FROM voos ORDER BY criado_em DESC LIMIT 100');
  res.json({success:true,voos:r.rows});
 }catch(e){res.status(500).json({success:false,error:e.message})}
};
