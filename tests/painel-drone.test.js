const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('painel inspirado no Drone possui as três marcas e todos os controles ativos',()=>{
  const html=read('frontend/painel.html');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(ids.length,new Set(ids).size,'ids HTML devem ser únicos');
  for(const id of ['map','periodStart','periodEnd','farmOptions','fieldOptions','machineOptions','dateOptions','tableBody','pageSize','exportCsv','exportKml','btnFields','btnTrash','logout','mobileMap','mobileTable']){
    assert.ok(ids.includes(id),'Controle obrigatório: '+id);
  }
  for(const name of ['johndeere','jacto','massey'])assert.match(html,new RegExp('data-module="'+name+'"'));
  assert.match(html,/\/js\/auth-guard\.js/);
  assert.match(html,/\/js\/painel\.js/);
  assert.match(html,/\/vendor\/leaflet\/leaflet\.js/);
});
test('mapa e filtros: javascript compilável e sem acesso direto a credenciais',()=>{
 const code=read('frontend/js/painel.js');
 assert.doesNotThrow(()=>new Function(code));
 for(const endpoint of ['/api/arquivos','/api/jacto/eventos','/api/massey/operations','/api/dashboard/mapa','/api/talhoes','/api/rastro/lixeira']){
   assert.ok(code.includes(endpoint),'API faltante: '+endpoint);
 }
 assert.ok(!/\bDATABASE_URL\b|\bAPP_ADMIN_PASSWORD\b|postgresql:\/\//.test(code));
 assert.match(code,/escape|xml\s*=/);
 assert.match(code,/document\.createElement\('td'\)/);
});
test('rotas e login levam ao mapa único, inclusive links antigos do portal',()=>{
 const cfg=JSON.parse(read('vercel.json'));
 assert.ok(cfg.routes.some(x=>x.src==='/painel'&&x.dest==='/painel.html'));
 assert.match(read('server.js'),/'\/painel':'frontend\/painel.html'/);
 for(const p of ['frontend/index.html','frontend/portal.html','index.html']){
   const code=read(p);
   assert.ok(!code.includes('machine-card card-'));
   assert.ok(!code.includes("if (!urlParams.has('hub'))"));
   assert.match(code,/window\.location\.replace\(pages\.includes\(next\)/);
   assert.ok(!code.includes('AUTH_CONFIG'));
 }
 const py=read('backend/main.py');
 assert.match(py,/@app\.get\("\/api\/rastro\/lixeira"\)/);
 assert.match(py,/@app\.get\("\/painel"/);
});
test('layout incorpora mapa, tabela, tema claro e celular',()=>{
 const css=read('frontend/css/painel.css');
 for(const cls of ['.map-zone','.data-panel','.kpi-strip','.filter-menu','.mobile-tabs','body.light']){
   assert.ok(css.includes(cls),'Componente: '+cls);
 }
 assert.match(css,/@media\(max-width:700px\)/);
});
