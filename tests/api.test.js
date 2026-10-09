const {test}=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const [index,mode] of ['sqlite','pglite'].entries())test('API integrada com banco '+mode,async(t)=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'drone-test-'));const port=3201+index;
 let child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,DATABASE_URL:'',DRONE_DB_MODE:mode,DRONE_DB_PATH:path.join(temp,'drone.db'),PGLITE_DB_PATH:path.join(temp,'pg'),PORT:String(port),START_PYTHON:'false'}});
 let logs='';child.stderr.on('data',c=>logs+=c);child.stdout.on('data',c=>logs+=c);
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}fs.rmSync(temp,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port;
 for(let i=0;i<200;i++){try{if((await fetch(base)).ok)break;}catch{}if(child.exitCode!==null)throw new Error(logs);await new Promise(r=>setTimeout(r,50));}
 async function api(url,method='GET',body){const r=await fetch(base+url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 for(const url of ['/.env','/server.js','/api/db.js','/backend/main.py','/data/drone.sqlite','/package.json','/static/../server.js','/absent'])assert.equal((await fetch(base+url)).status,404,url);
 const pages=['/','/johndeere','/jacto','/massey','/drone'];const contents=[];for(const url of pages){const r=await fetch(base+url);assert.equal(r.status,200);contents.push(await r.text());}assert.equal(new Set(contents).size,5);
 assert.equal((await api('/api/unknown')).status,503);
 assert.equal((await fetch(base+'/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
 assert.equal((await api('/api/talhoes','POST',{farms:[{id:'bad',coords:[[1,1],[1,1],[1,1]]}]})).status,400);
 assert.equal((await api('/api/talhoes')).data.count,0);
 const field={id:'triangle',nomeFaz:'Teste',talhao:'01',coords:[[0,0],[0,1],[1,0],[0,0]],areaTotal:1};assert.equal((await api('/api/talhoes','POST',{farms:[field]})).data.savedCount,1);
 assert.equal((await api('/api/voos','POST',{flights:[{id:'invalid',coords:[['abc',1]]}]})).status,400);
 const outside={id:'outside',coords:[[.8,.8],[.9,.9]]};assert.equal((await api('/api/voos','POST',{flights:[outside]})).data.savedCount,1);
 let flights=(await api('/api/voos')).data.flights;assert.equal(flights[0].matchedTalhoes.length,0);
 const crossing={id:'crossing',coords:[[.2,-.1],[.2,.9]]};await api('/api/voos','POST',{flights:[crossing]});flights=(await api('/api/voos')).data.flights;assert.equal(flights.find(f=>f.id==='crossing').matchedTalhoes.length,1);assert.equal(flights.find(f=>f.id==='crossing').matchedTalhoes[0].coveragePercent,null);
 assert.equal((await api('/api/import','POST',{flights:[{id:'rollback',coords:[[0,0],[0,.1]]},{id:'corrupt',coords:[]}]})).status,400);
 assert.equal((await api('/api/voos')).data.flights.some(f=>f.id==='rollback'),false,'Importação atômica');
 const kml='<?xml version="1.0"?><kml><Placemark><LineString><coordinates>-46,-35,0 -46.01,-35.01,0</coordinates></LineString></Placemark></kml>';
 const form=new FormData();form.append('file',new Blob([kml]),'ação.kml');let r=await fetch(base+'/api/import',{method:'POST',body:form});assert.equal(r.status,200,await r.clone().text());let imported=await r.json();assert.equal(imported.imported,1);
 r=await fetch(base+'/api/import',{method:'POST',body:form});assert.equal((await r.json()).imported,0);
 flights=(await api('/api/voos')).data.flights;assert.deepEqual(flights.find(f=>f.id===imported.id).coords[0],[-35,-46]);
 assert.equal((await api('/api/voos','DELETE',{ids:['crossing','absent']})).data.deletedCount,1);
 assert.equal((await api('/api/voos?type=lixeira')).data.flights.length,1);
 assert.equal((await api('/api/voos?action=restaurar','POST',{ids:['crossing','absent']})).data.restored,1);
 assert.equal((await api('/api/voos?type=lixeira')).data.flights.length,0);
 assert.equal((await api('/api/voos')).data.flights.find(f=>f.id==='crossing').matchedTalhoes.length,1);
 await api('/api/voos','DELETE',{ids:['crossing']});assert.equal((await api('/api/voos?action=excluir_permanente','DELETE',{ids:['crossing']})).data.deletedCount,1);
 const history=(await api('/api/importacoes','POST',{arquivo:'teste.kml',registros:1})).data;assert.ok(history.id);assert.equal((await api('/api/importacoes','DELETE')).status,400);await api('/api/importacoes?id='+history.id,'DELETE');assert.equal((await api('/api/importacoes')).data.length,0);
 await api('/api/talhoes?id=triangle','DELETE');assert.equal((await api('/api/talhoes')).data.count,0);
 // Reinício: os dados persistem realmente no arquivo do banco.
 assert.equal((await api('/api/voos')).data.flights.length,2);
 child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));
 child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,DATABASE_URL:'',DRONE_DB_MODE:mode,DRONE_DB_PATH:path.join(temp,'drone.db'),PGLITE_DB_PATH:path.join(temp,'pg'),PORT:String(port),START_PYTHON:'false'}});
 child.stderr.on('data',c=>logs+=c);child.stdout.on('data',c=>logs+=c);
 for(let i=0;i<200;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 assert.equal((await api('/api/voos')).data.flights.length,2,'Persistência depois de reiniciar');
});
