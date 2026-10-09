const { query } = require('./db');
module.exports = async (req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');
 try{
  if(req.method==='GET'){
   const rows=await query('SELECT * FROM importacoes ORDER BY criado_em DESC LIMIT 100');
   return res.json(rows);
  }
  if(req.method==='DELETE'){
   const id=req.query.id;
   if(!id) return res.status(400).json({error:'ID não informado'});
   await query('DELETE FROM importacoes WHERE id=$1',[id]);
   return res.json({success:true});
  }
  if(req.method==='POST'){
   const b=typeof req.body==='string'?JSON.parse(req.body):req.body;
   const rows=await query(`INSERT INTO importacoes(arquivo,registros,status) VALUES($1,$2,$3) RETURNING *`,[b.arquivo||'',b.registros||0,b.status||'Concluído']);
   return res.json(rows[0]);
  }
  res.status(405).json({error:'Method not allowed'});
 }catch(e){res.status(500).json({error:e.message})}
};
