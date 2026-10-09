const http=require('http'),fs=require('fs'),path=require('path');
const {spawn}=require('child_process');
const base=__dirname;
if(fs.existsSync(path.join(base,'.env')) && process.loadEnvFile)process.loadEnvFile(path.join(base,'.env'));
const {transaction}=require('./api/db');
const routes=Object.fromEntries(['voos','talhoes','import','importacoes','preview'].map(n=>['/api/'+n,require('./api/'+n)]));
const pages={'/':'frontend/portal.html','/johndeere':'frontend/index.html','/dashboard':'frontend/index.html','/jdl':'frontend/index.html','/jacto':'frontend/jacto.html','/massey':'frontend/massey.html','/massei':'frontend/massey.html','/drone':'frontend/drone.html','/studio':'frontend/studio.html','/isoxml':'frontend/studio.html','/index.html':'frontend/portal.html','/Mapa_Aplicacao_Drones.html':'frontend/drone.html','/admin/importacao.html':'admin/importacao.html'};
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
const backendPort=Number(process.env.PYTHON_PORT||8000);
function json(res,code,data){if(res.writableEnded)return;res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
 try {
  const parsed=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(parsed.pathname);
  if(routes[pathname]){
   let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>50*1024*1024){json(res,413,{error:'Arquivo excede 50 MB'});return;}chunks.push(chunk);}
   const raw=Buffer.concat(chunks);let body={};
   if(raw.length){if((req.headers['content-type']||'').includes('multipart/form-data'))body=raw;else{try{body=JSON.parse(raw.toString('utf8'));}catch{return json(res,400,{error:'JSON inválido'});}}}
   let code=200,output,headers={};const response={status(n){code=n;return this;},setHeader(k,v){headers[k]=v;return this;},json(v){output=v;},end(){output=undefined;}};
   const invoke=async()=>{await routes[pathname]({method:req.method,url:req.url,query:Object.fromEntries(parsed.searchParams),body,headers:req.headers},response);if(code>=400){const e=new Error('API error');e.result={code,output};throw e;}};
   await transaction(invoke);
   for(const [k,v] of Object.entries(headers))res.setHeader(k,v);
   if(output===undefined){res.writeHead(code);return res.end();}return json(res,code,output);
  }
  if(pathname.startsWith('/api/')){
   if(/\.[a-z0-9]+$/i.test(pathname))return json(res,404,{error:'Não encontrado'});
   const upstream=http.request({hostname:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${backendPort}`}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
   upstream.setTimeout(120000,()=>upstream.destroy(new Error('Tempo limite do processamento')));
   upstream.on('error',()=>json(res,503,{error:'Serviço de telemetria indisponível. Verifique o terminal.'}));req.pipe(upstream);return;
  }
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Método não permitido'});
  let relative=pages[pathname];
  if(!relative){
   // Somente recursos públicos conhecidos; nunca servir a raiz do projeto.
   if(pathname==='/shp.js'||pathname==='/dados_voos.js')relative='frontend'+pathname;
   else if(/^\/(css|js)\/[a-zA-Z0-9_/-]+\.(css|js)$/.test(pathname))relative='frontend'+pathname;
   else if(pathname.startsWith('/static/'))relative='frontend/'+pathname.slice(8);
  }
  if(!relative)return json(res,404,{error:'Página não encontrada'});
  const parts=relative.split('/');if(parts.some(p=>p==='..'||p.startsWith('.')))return json(res,404,{error:'Não encontrado'});
  const file=path.resolve(base,relative),ext=path.extname(file);
  if(!mime[ext]||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Não encontrado'});
  if(!fs.realpathSync(file).startsWith(fs.realpathSync(base)+path.sep))return json(res,404,{error:'Não encontrado'});
  res.writeHead(200,{'Content-Type':mime[ext]});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
 }catch(e){if(e.result)return json(res,e.result.code,e.result.output);console.error(e);json(res,500,{error:'Falha ao processar a solicitação. Consulte o terminal.'});}
});
async function start(){
 await require('./scripts/migrate').migrate();
 let child;
 if(process.env.START_PYTHON!=='false'){
  const python=process.env.PYTHON_EXECUTABLE||(process.platform==='win32'?'python':'python3');
  child=spawn(python,['-m','uvicorn','backend.main:app','--host','127.0.0.1','--port',String(backendPort)],{cwd:base,stdio:'inherit',env:process.env});
  child.on('error',e=>{console.error('Python não iniciou:',e.message);process.exit(1);});
  child.on('exit',code=>{if(code!==null && code!==0){console.error('Backend Python encerrou. Instale backend/requirements.txt.');process.exit(1);}});
  let ready=false;for(let i=0;i<120;i++){try{const r=await fetch(`http://127.0.0.1:${backendPort}/api/health`);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  if(!ready){child.kill();throw new Error('Backend não iniciou em 30 segundos');}
 }
 const stop=()=>{server.close();if(child)child.kill();require('./api/db').close().finally(()=>process.exit(0));};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Monitor Agrícola: http://127.0.0.1:'+(process.env.PORT||3000)));
}
if(require.main===module)start().catch(e=>{console.error(e);process.exit(1);});
module.exports={server,start};
