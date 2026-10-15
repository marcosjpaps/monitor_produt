/* Cockpit unificado inspirado no VeredasDrone.
   Utiliza apenas dados importados e armazenados nas APIs existentes do Monitor.
   Nenhum indicador é simulado. Cookies de sessão são HttpOnly no servidor. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const number = v => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) ? Number(v) : null;
  const num = (v, digits=1) => number(v) === null ? '—' : Number(v).toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
  const dateKey = v => {
    if (!v) return '';
    const t = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0,10);
    if (/^\d{2}\/\d{2}\/\d{4}/.test(t)) {const [d,m,y]=t.slice(0,10).split('/');return y+'-'+m+'-'+d;}
    if (/^\d{8}$/.test(t)) return t.slice(0,4)+'-'+t.slice(4,6)+'-'+t.slice(6);
    return '';
  };
  const labelDate = d => {
    const k=dateKey(d);
    return k ? k.slice(8,10)+'/'+k.slice(5,7)+'/'+k.slice(0,4) : '—';
  };
  const text = v => (v===null||v===undefined||v==='')?'—':String(v);
  const safe = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const xml = v => String(v??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
  const formatSize = n => number(n)===null?'—':num(n/1048576,2)+' MB';
  const state={
    module:'johndeere',rows:[],visible:[],selected:new Set(),filters:{farm:new Set(),field:new Set(),machine:new Set(),date:new Set()},
    page:1,pageSize:50,map:null,sat:null,street:null,routes:null,boundaries:null,sourceFeatures:[],
    allFarms:[],hasMap:false,requestSerial:0,busy:false,layerMeta:[],currentScope:'map'
  };
  const modules={
    johndeere:{title:'John Deere',url:'/johndeere',color:'#94c11f',unit:'Rastros de telemetria'},
    jacto:{title:'Jacto / AgGPS',url:'/jacto',color:'#fb923c',unit:'Eventos de aplicação'},
    massey:{title:'Massey Ferguson',url:'/massey',color:'#f87171',unit:'Operações importadas'}
  };
  let toastTimer;

  function toast(message,isError=false){
    const node=$('toast');node.textContent=message;node.hidden=false;node.style.borderColor=isError?'var(--danger)':'var(--green)';
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>{node.hidden=true},6500);
  }
  function icon(){if(window.lucide?.createIcons)window.lucide.createIcons();}
  async function request(path,opts={}){
    const resp=await fetch(path,{credentials:'same-origin',cache:'no-store',...opts});
    if(resp.status===401){location.replace('/?login=necessario&next='+encodeURIComponent('/painel'));throw Error('Faça login novamente.');}
    if(!resp.ok){
      const dat=await resp.json().catch(()=>({}));
      throw Error(String(dat.error||dat.detail||'Erro HTTP '+resp.status).slice(0,220));
    }
    return resp.json();
  }
  function initMap(){
    if(typeof window.L==='undefined'){toast('Não foi possível carregar o mapa Leaflet.',true);return;}
    state.map=L.map('map',{zoomControl:false,preferCanvas:true}).setView([-17.8,-46.03],10);
    L.control.zoom({position:'bottomright'}).addTo(state.map);
    state.sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'});
    state.street=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}.png',{maxZoom:19,attribution:'© OpenStreetMap'});
    state.sat.addTo(state.map);
    state.routes=L.featureGroup().addTo(state.map);
    state.boundaries=L.featureGroup().addTo(state.map);
    const coord=e=>$('coordsLabel').textContent=e.latlng.lat.toFixed(5)+'°, '+e.latlng.lng.toFixed(5)+'°';
    state.map.on('mousemove',coord);
    state.map.on('zoomend',()=>$('zoomValue').textContent=String(state.map.getZoom()));
    $('zoomValue').textContent=String(state.map.getZoom());
  }
  function jdRows(raw){
    return (Array.isArray(raw)?raw:[]).map((r,i)=>({
      id:String(r.id||'jd-'+i),date:r.data_inicio||'',farm:r.fazenda||'',field:r.atividade_pasta||'',
      machine:r.modelo_trator||r.maquina_id||'',operation:r.tipo_operacao||'',
      area:number(r.area_trabalhada_ha),speed:number(r.velocidade_media),
      hours:number(r.duracao_segundos)===null?null:Number(r.duracao_segundos)/3600,
      filename:r.nome_arquivo||'',details:r,geo:null
    }));
  }
  function jactoRows(raw){
    return (Array.isArray(raw)?raw:[]).map((r,i)=>({
      id:'ja-'+i,date:r.date||r.date_open||'',farm:r.farm||r.fazenda||'',field:r.field||r.talhao||'',
      machine:r.machine||r.equipment||'Jacto',operation:r.event||'',
      area:number(r.area_ha),speed:number(r.avg_speed_kmh||r.speed),hours:number(r.duration_hours),
      filename:r.event||r.name||'',details:r,geo:null
    }));
  }
  function masseyRows(raw){
    return (Array.isArray(raw)?raw:[]).map((r,i)=>({
      id:String(r.uuid||r.id||'mf-'+i),date:r.operation_date||r.imported_at||'',
      farm:r.farm_name||'',field:r.field_name||'',
      machine:r.vehicle_name==='Não informado'?'':r.vehicle_name||r.device_serial||'',
      operation:r.operation_type||'',
      area:number(r.area_ha),speed:number(r.avg_speed_kmh),hours:number(r.duration_hours),
      filename:r.clean_name||r.raw_name||'',details:r,geo:r.geojson_geometry||null
    }));
  }
  async function load(){
    const nonce=++state.requestSerial;
    const module=state.module;
    const start=$('periodStart').value,end=$('periodEnd').value;
    if(start&&end&&start>end){toast('A data inicial não pode ser maior que a final.',true);return;}
    $('tableBody').replaceChildren();const tr=document.createElement('tr');const td=document.createElement('td');td.className='table-empty';td.colSpan=10;td.textContent='Consultando o banco de dados…';tr.append(td);$('tableBody').append(tr);
    $('dbText').textContent='Consultando…';$('dbDot').className='status-dot';
    $('mapEmpty').hidden=true;
    try{
      const queries={
        johndeere:'/api/arquivos',
        jacto:'/api/jacto/eventos',
        massey:'/api/massey/operations'
      };
      const q=new URLSearchParams();
      // Busca no backend quando suporta datas para evitar downloads enormes.
      if(module!=='massey'){if(start)q.set('data_inicio',start);if(end)q.set('data_fim',end);}
      const url=queries[module]+(q.size?'?'+q:'');
      const [data,farms,farmGroups]=await Promise.all([
        request(url),
        request('/api/talhoes').catch(()=>({farms:[]})),
        module==='johndeere'?request('/api/fazendas').catch(()=>[]):Promise.resolve([])
      ]);
      if(nonce!==state.requestSerial)return;
      state.rows=module==='johndeere'?jdRows(data):module==='jacto'?jactoRows(data):masseyRows(data);
      if(module==='johndeere'&&Array.isArray(farmGroups)){
        const activityFarms=new Map();
        farmGroups.forEach(group=>(group.talhoes||[]).forEach(t=>{
          if(t.atividade)activityFarms.set(t.atividade,group.fazenda||'');
        }));
        state.rows.forEach(row=>{if(!row.farm)row.farm=activityFarms.get(row.field)||'';});
      }
      // IDs para seleção devem ser estáveis dentro da lista; não mostrar registros apagados.
      state.selected=new Set(state.rows.map(r=>r.id));
      state.allFarms=Array.isArray(farms.farms)?farms.farms:[];
      state.filters={farm:new Set(),field:new Set(),machine:new Set(),date:new Set()};
      state.page=1;
      buildFilters();
      await loadGeometries(module,nonce);
      if(nonce!==state.requestSerial)return;
      applyFilters();
      $('dbDot').className='status-dot ok';
      $('dbText').textContent='Banco conectado';
    }catch(e){
      if(nonce!==state.requestSerial)return;
      $('dbDot').className='status-dot error';
      $('dbText').textContent='Falha na consulta';
      state.rows=[];state.sourceFeatures=[];applyFilters();toast(e.message||'Falha ao consultar dados.',true);
    }
  }
  async function loadGeometries(module,nonce){
    state.sourceFeatures=[];
    const addFeatures=raw=>{
      if(Array.isArray(raw)) return raw.filter(f=>f&&f.type==='Feature'&&f.geometry);
      if(raw?.type==='FeatureCollection')return Array.isArray(raw.features)?raw.features.filter(f=>f?.geometry):[];
      if(raw?.type==='Feature'&&raw.geometry)return [raw];
      if(raw?.type&&raw.coordinates)return [{type:'Feature',geometry:raw,properties:{}}];
      return [];
    };
    try{
      if(module==='johndeere'){
        const q=new URLSearchParams();
        if($('periodStart').value)q.set('data_inicio',$('periodStart').value);
        if($('periodEnd').value)q.set('data_fim',$('periodEnd').value);
        const data=await request('/api/dashboard/mapa'+(q.size?'?'+q:''));
        if(nonce!==state.requestSerial)return;
        const byId=new Map(state.rows.map(r=>[r.id,r]));
        for(const x of Array.isArray(data)?data:[]){
          const rec=byId.get(String(x.id));if(!rec)continue;
          const points=(x.points||[]).map(p=>[number(p.longitude),number(p.latitude)])
            .filter(p=>p[0]!==null&&p[1]!==null&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90);
          if(points.length>1){
            const feature={type:'Feature',geometry:{type:'LineString',coordinates:points},properties:{_row:rec.id,farm:rec.farm,field:rec.field}};
            state.sourceFeatures.push(feature);
          }
        }
      }else if(module==='jacto'){
        const cov=await request('/api/jacto/cobertura?max_features=4000');
        if(nonce!==state.requestSerial)return;
        // Cobertura pode existir sem evento de aplicação; é mostrada como dado espacial, não como registro fictício.
        state.sourceFeatures=addFeatures(cov).map(f=>({type:'Feature',geometry:f.geometry,properties:{
          ...(f.properties||{}),_row:state.rows.find(r=>r.farm===f.properties?.farm&&r.field===f.properties?.field)?.id||null
        }}));
      }else{
        state.sourceFeatures=state.rows.flatMap(row=>addFeatures(row.geo).map(f=>({type:'Feature',geometry:f.geometry,properties:{...(f.properties||{}),_row:row.id}})));
      }
    }catch(err){if(nonce===state.requestSerial)toast('Registros carregados, mas o mapa não pôde ser atualizado: '+err.message,true);}
  }
  function keys(type){
    if(type==='date')return [...new Set(state.rows.map(r=>dateKey(r.date)).filter(Boolean))].sort().reverse();
    return [...new Set(state.rows.map(r=>String(r[type]||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  }
  function buildFilters(){
    for(const type of ['farm','field','machine','date']){
      const host=$(type+'Options'),search=$('search'+type[0].toUpperCase()+type.slice(1));
      host.replaceChildren();
      const list=keys(type);
      if(!list.length){const p=document.createElement('p');p.textContent='Sem opções nos arquivos';host.append(p);continue;}
      for(const value of list){
        const lbl=document.createElement('label');lbl.dataset.search=value.toLowerCase();
        const ch=document.createElement('input');ch.type='checkbox';ch.value=value;ch.checked=state.filters[type].has(value);
        ch.addEventListener('change',()=>{if(ch.checked)state.filters[type].add(value);else state.filters[type].delete(value);state.page=1;updateFilters();applyFilters();});
        const span=document.createElement('span');span.textContent=type==='date'?labelDate(value):value;
        lbl.append(ch,span);host.append(lbl);
      }
      search.value='';
    }
    updateFilters();
  }
  function updateFilters(){
    const labels={farm:'Fazendas',field:'Talhões',machine:'Equipamentos',date:'Datas'};
    for(const type of Object.keys(labels)){
      const count=state.filters[type].size;
      $(type+'Summary').textContent=count?labels[type]+' ('+count+') ▾':labels[type]+' ▾';
    }
  }
  function matches(row){
    const f=state.filters;
    for(const type of ['farm','field','machine','date']){
      if(f[type].size&& !f[type].has(type==='date'?dateKey(row.date):String(row[type]||'')))return false;
    }
    const a=$('periodStart').value,b=$('periodEnd').value,k=dateKey(row.date);
    if(a&&(!k||k<a))return false;
    if(b&&(!k||k>b))return false;
    const term=$('textFilter').value.trim().toLocaleLowerCase('pt-BR');
    if(term && ![row.farm,row.field,row.machine,row.operation,row.filename,dateKey(row.date)]
      .some(x=>String(x||'').toLocaleLowerCase('pt-BR').includes(term)))return false;
    return true;
  }
  function applyFilters(){
    state.visible=state.rows.filter(matches);
    const ids=new Set(state.visible.map(r=>r.id));
    // Linhas filtradas permanecem selecionadas conforme seleção do usuário.
    $('totalLabel').textContent='('+state.visible.length+' de '+state.rows.length+' registros)';
    $('pageInfo').textContent=state.visible.length+' registros filtrados';
    $('selectAll').checked=state.visible.length>0&&state.visible.every(r=>state.selected.has(r.id));
    $('headSelect').checked=$('selectAll').checked;
    $('deleteSelected').hidden=state.module!=='johndeere';
    $('deleteSelected').disabled=![...ids].some(id=>state.selected.has(id));
    renderTable();renderMap();renderKpis();
  }
  function renderKpis(){
    const rows=state.visible.filter(r=>state.selected.has(r.id));
    const areas=rows.map(r=>r.area).filter(n=>n!==null);
    const hours=rows.map(r=>r.hours).filter(n=>n!==null);
    const speeds=rows.map(r=>r.speed).filter(n=>n!==null);
    $('kpiTitleCount').textContent=modules[state.module].unit;
    $('kpiCount').textContent=String(rows.length)+' / '+state.visible.length;
    $('kpiCountInfo').textContent='Selecionados / filtrados';
    $('kpiArea').textContent=areas.length?num(areas.reduce((a,b)=>a+b,0),2)+' ha':'—';
    $('kpiHours').textContent=hours.length?num(hours.reduce((a,b)=>a+b,0),1)+' h':'—';
    $('kpiSpeed').textContent=speeds.length?num(speeds.reduce((a,b)=>a+b,0)/speeds.length,1)+' km/h':'—';
    $('kpiMachines').textContent=String(new Set(rows.map(r=>r.machine).filter(Boolean)).size);
    $('kpiFarms').textContent=String(new Set(rows.map(r=>r.farm).filter(Boolean)).size);
    $('kpiGeo').textContent=String(state.layerMeta.length);
  }
  function renderTable(){
    const list=state.visible, pages=Math.max(1,Math.ceil(list.length/state.pageSize));
    state.page=Math.max(1,Math.min(pages,state.page));
    const body=$('tableBody');body.replaceChildren();
    if(!list.length){
      const tr=document.createElement('tr'),td=document.createElement('td');
      td.colSpan=10;td.className='table-empty';td.textContent='Nenhum registro neste filtro. Importe arquivos ou limpe os filtros.';
      tr.append(td);body.append(tr);
    }else{
      for(const item of list.slice((state.page-1)*state.pageSize,state.page*state.pageSize)){
        const tr=document.createElement('tr');tr.className=state.selected.has(item.id)?'selected':'';tr.dataset.rowid=item.id;
        const checkCell=document.createElement('td');const check=document.createElement('input');check.type='checkbox';check.checked=state.selected.has(item.id);check.setAttribute('aria-label','Selecionar '+(item.filename||item.operation||'registro'));
        check.addEventListener('click',e=>e.stopPropagation());
        check.addEventListener('change',()=>{if(check.checked)state.selected.add(item.id);else state.selected.delete(item.id);applyFilters();});
        checkCell.append(check);tr.append(checkCell);
        const vals=[labelDate(item.date),text(item.farm),text(item.field),text(item.machine),text(item.operation),item.area===null?'—':num(item.area,2),item.speed===null?'—':num(item.speed,1),item.hours===null?'—':num(item.hours,2),text(item.filename)];
        vals.forEach((value,i)=>{const td=document.createElement('td');td.textContent=value;if(i===1||i===2)td.style.color='var(--amber)';if(i===5)td.style.color='var(--green)';td.title=value;tr.append(td);});
        tr.addEventListener('click',()=>focusRow(item));
        body.append(tr);
      }
    }
    $('pageNumber').textContent=state.page+' / '+pages;
    $('prevPage').disabled=state.page===1;$('nextPage').disabled=state.page===pages;
  }
  function rowGeometry(row){
    return state.sourceFeatures.filter(f=>f.properties?._row===row.id);
  }
  function focusRow(row){
    const g=rowGeometry(row);
    if(!g.length){toast('Este registro não possui coordenadas geográficas no arquivo.',true);return;}
    try{
      const layer=L.geoJSON({type:'FeatureCollection',features:g});
      if(layer.getLayers().length&&layer.getBounds().isValid()){
        state.map.fitBounds(layer.getBounds().pad(.2),{maxZoom:16});mobileView('map');
      }
    }catch{toast('Não foi possível enquadrar a geometria.',true);}
  }
  function validFeature(f){return !!(f&&f.geometry&&typeof f.geometry.type==='string'&&f.geometry.coordinates);}
  function farmFeature(f){
    let coords=Array.isArray(f.coords)?f.coords:null;
    if(!coords||coords.length<3)return null;
    let ring=coords.map(p=>[number(p[1]),number(p[0])]).filter(p=>p[0]!==null&&p[1]!==null&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90);
    if(ring.length<3)return null;
    if(ring[0][0]!==ring[ring.length-1][0]||ring[0][1]!==ring[ring.length-1][1])ring.push([...ring[0]]);
    return {type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{farm:f.nomeFaz||'',field:f.talhao||'',area_ha:f.areaTotal||null,_boundary:true}};
  }
  function renderMap(){
    if(!state.map||!state.routes||!state.boundaries)return;
    state.routes.clearLayers();state.boundaries.clearLayers();state.layerMeta=[];
    const selected=new Set(state.visible.filter(r=>state.selected.has(r.id)).map(r=>r.id));
    const allowedFarms=new Set(state.visible.filter(r=>state.selected.has(r.id)).map(r=>r.farm).filter(Boolean));
    const features=state.sourceFeatures.filter(f=>{
      if(!validFeature(f))return false;
      const id=f.properties?._row;
      if(id!==null&&id!==undefined)return selected.has(id);
      if(state.module==='jacto'){
        const props=f.properties||{};
        const farm=String(props.farm||'');
        const field=String(props.field||'');
        if(state.filters.farm.size&&!state.filters.farm.has(farm))return false;
        if(state.filters.field.size&&!state.filters.field.has(field))return false;
        if(allowedFarms.size&&!allowedFarms.has(farm))return false;
        return true;
      }
      return false;
    });
    const col=modules[state.module].color;
    if($('toggleOperations').checked){
      for(const f of features){
        try{
          const layer=L.geoJSON(f,{style:()=>({color:col,weight:3,opacity:.92,fillColor:col,fillOpacity:.18}),pointToLayer:(feature,latlng)=>L.circleMarker(latlng,{radius:4,color:col})});
          layer.on('click',e=>{const props=f.properties||{};const tooltip=document.createElement('div');tooltip.textContent=[props.farm,props.field].filter(Boolean).join(' • ')||'Geometria importada';L.popup().setLatLng(e.latlng).setContent(tooltip).openOn(state.map);});
          state.routes.addLayer(layer);state.layerMeta.push({feature:f,layer});
        }catch{ /* Coordenadas incompletas não devem derrubar o mapa */ }
      }
    }
    if($('toggleFarms').checked){
      for(const farm of state.allFarms){
        const f=farmFeature(farm);if(!f)continue;
        try{
          const layer=L.geoJSON(f,{style:{color:'#eab308',weight:2,dashArray:'7 5',fillOpacity:.06}});
          layer.bindTooltip([farm.nomeFaz,farm.talhao].filter(Boolean).join(' • '));
          state.boundaries.addLayer(layer);
          state.layerMeta.push({feature:f,layer});
        }catch{}
      }
    }
    const total=state.layerMeta.length;
    $('visibleCount').textContent=String(total);
    $('mapEmpty').hidden=total>0;
    if(total===0){$('emptyMapTitle').textContent=state.visible.length?'Sem GPS para estes registros':'Nenhum registro no período';$('emptyMapDesc').textContent=state.visible.length?'Os arquivos selecionados não têm geometrias disponíveis no mapa.':'Importe operações agrícolas ou polígonos de talhões para visualizar no mapa.';}
    $('kpiGeo').textContent=String(total);
  }
  function zoomAll(){
    if(!state.map)return;
    const group=L.featureGroup([...(state.routes?.getLayers()||[]),...(state.boundaries?.getLayers()||[])]);
    if(group.getLayers().length&&group.getBounds().isValid())state.map.fitBounds(group.getBounds().pad(.15),{maxZoom:17});
    else toast('Nenhuma geometria importada para enquadrar.',true);
  }
  function selectAll(checked){
    for(const row of state.visible){if(checked)state.selected.add(row.id);else state.selected.delete(row.id);}
    applyFilters();
  }
  function mobileView(view){
    state.currentScope=view;
    document.body.classList.toggle('mobile-map',view==='map');
    document.body.classList.toggle('mobile-data',view==='data');
    $('mobileMap').classList.toggle('active',view==='map');$('mobileTable').classList.toggle('active',view==='data');
    $('mobileMap').setAttribute('aria-pressed',String(view==='map'));
    $('mobileTable').setAttribute('aria-pressed',String(view==='data'));
    if(view==='map')setTimeout(()=>state.map?.invalidateSize(),100);
  }
  function openModal(title,description){
    $('modalTitle').textContent=title;$('modalDescription').textContent=description;
    $('modalContent').replaceChildren();$('modalCover').hidden=false;$('closeModal').focus();
  }
  function closeModal(){$('modalCover').hidden=true;}
  function modalItem(title,description,buttons=[]){
    const li=document.createElement('div');li.className='item';
    const info=document.createElement('span');const strong=document.createElement('strong');strong.textContent=title;
    const small=document.createElement('small');small.textContent=description||'';
    info.append(strong,small);li.append(info);
    for(const {label,action,danger} of buttons){const btn=document.createElement('button');btn.className='btn small'+(danger?' danger':'');btn.textContent=label;btn.onclick=action;li.append(btn);}
    $('modalContent').append(li);return li;
  }
  async function openTrash(){
    openModal('Lixeira e arquivos arquivados','Para John Deere, os rastros enviados à lixeira podem ser restaurados. Para Jacto e Massey, consulte os arquivos arquivados; os dados operacionais não são apagados ao arquivar.');
    try{
      if(state.module==='johndeere'){
        const data=await request('/api/rastro/lixeira?limit=100');
        const rows=Array.isArray(data.items)?data.items:[];
        if(!rows.length)modalItem('Lixeira vazia','Nenhum rastro John Deere excluído.');
        rows.forEach(item=>modalItem(item.nome_arquivo||item.id,[item.atividade_pasta,labelDate(item.data_inicio)].filter(Boolean).join(' • '),[{label:'Restaurar',action:async()=>{
          try{await request('/api/rastro/restaurar?arquivo_id='+encodeURIComponent(item.id),{method:'POST'});toast('Rastro restaurado.');await openTrash();await load();}
          catch(e){toast(e.message,true);}
        }}]));
      }else{
        const data=await request('/api/importacoes?archived=true&module='+state.module+'&limit=100');
        const items=data.items||[];
        if(!items.length)modalItem('Sem arquivos arquivados','Nenhum arquivo encontrado.');
        items.forEach(item=>modalItem(item.filename,text(item.imported_at),[{label:'Restaurar',action:async()=>{
          try{await request('/api/importacoes/'+encodeURIComponent(item.id)+'/restore',{method:'POST'});toast('Arquivo restaurado.');await openTrash();await load();}
          catch(e){toast(e.message,true);}
        }}]));
      }
    }catch(e){modalItem('Não foi possível consultar a lixeira',e.message);}
    icon();
  }
  async function deleteSelected(){
    if(state.module!=='johndeere')return;
    const ids=state.visible.filter(r=>state.selected.has(r.id)).map(r=>r.id);
    if(!ids.length)return;
    if(!confirm('Enviar '+ids.length+' rastro(s) John Deere para a lixeira? Você poderá restaurá-los.'))return;
    $('deleteSelected').disabled=true;
    try{
      const r=await request('/api/rastro/excluir-lote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({arquivo_ids:ids})});
      toast(text(r.deleted_count??ids.length)+' rastro(s) enviados à lixeira.');
      await load();
    }catch(e){toast(e.message,true);}
    finally{$('deleteSelected').disabled=false;}
  }
  function download(name,content,type='text/plain;charset=utf-8'){
    const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }
  function csvEscape(v){
    let val=String(v??'');
    if(/^[\s]*[=+@-]/.test(val))val="'"+val;
    return '"'+val.replace(/"/g,'""')+'"';
  }
  function exportCSV(){
    const rows=state.visible.filter(r=>state.selected.has(r.id));
    if(!rows.length)return toast('Selecione ao menos um registro para exportar.',true);
    const fields=['Data','Fazenda','Talhão','Máquina','Operação','Área (ha)','Velocidade média (km/h)','Horas','Arquivo'];
    const lines=[fields.map(csvEscape).join(';')];
    rows.forEach(r=>lines.push([dateKey(r.date),r.farm,r.field,r.machine,r.operation,r.area??'',r.speed??'',r.hours??'',r.filename].map(csvEscape).join(';')));
    download('monitor_'+state.module+'_'+new Date().toISOString().slice(0,10)+'.csv','\uFEFF'+lines.join('\n'),'text/csv;charset=utf-8');
    toast('Planilha exportada com '+rows.length+' registro(s).');
  }
  function coordXML(coords){return (coords||[]).map(p=>p.slice(0,2).join(',')+',0').join(' ');}
  function featureToKml(f){
    const geom=f.geometry||{},p=f.properties||{},name=xml(p.field||p.farm||'Operação');
    let snippet='';
    const polygon=ring=>'<Polygon><outerBoundaryIs><LinearRing><coordinates>'+coordXML(ring?.[0])+'</coordinates></LinearRing></outerBoundaryIs></Polygon>';
    if(geom.type==='Polygon')snippet=polygon(geom.coordinates);
    if(geom.type==='MultiPolygon')snippet='<MultiGeometry>'+geom.coordinates.map(polygon).join('')+'</MultiGeometry>';
    if(geom.type==='LineString')snippet='<LineString><tessellate>1</tessellate><coordinates>'+coordXML(geom.coordinates)+'</coordinates></LineString>';
    if(geom.type==='MultiLineString')snippet='<MultiGeometry>'+geom.coordinates.map(c=>'<LineString><coordinates>'+coordXML(c)+'</coordinates></LineString>').join('')+'</MultiGeometry>';
    if(geom.type==='Point')snippet='<Point><coordinates>'+coordXML([geom.coordinates])+'</coordinates></Point>';
    if(geom.type==='MultiPoint')snippet='<MultiGeometry>'+geom.coordinates.map(c=>'<Point><coordinates>'+coordXML([c])+'</coordinates></Point>').join('')+'</MultiGeometry>';
    return snippet?'<Placemark><name>'+name+'</name>'+snippet+'</Placemark>':'';
  }
  function exportKML(features,filename){
    const chunks=features.filter(validFeature).map(featureToKml).filter(Boolean);
    if(!chunks.length){toast('Nenhum polígono ou rastro com coordenadas para exportar.',true);return;}
    download(filename,'<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Monitor Agrícola</name>'+chunks.join('')+'</Document></kml>','application/vnd.google-earth.kml+xml;charset=utf-8');
    toast(chunks.length+' geometria(s) exportadas para KML.');
  }
  function exportSelectedKml(){
    const selected=new Set(state.visible.filter(r=>state.selected.has(r.id)).map(r=>r.id));
    // Exportar somente o que está efetivamente visível no mapa.
    const features=state.layerMeta.map(item=>item.feature)
      .filter(f=>f.properties?._boundary || selected.has(f.properties?._row)
        || (state.module==='jacto'&&f.properties?._row===null));

    exportKML(features,'monitor_'+state.module+'_'+new Date().toISOString().slice(0,10)+'.kml');
  }
  function areaFromRing(coords){
    if(coords.length<3)return null;
    // Fórmula esférica em WGS84 aproximado, não substitui área cadastral.
    const rad=Math.PI/180;const radius=6378137;let total=0;
    for(let i=0;i<coords.length;i++){
      const a=coords[i],b=coords[(i+1)%coords.length];
      total+=(b[1]-a[1])*rad*(2+Math.sin(a[0]*rad)+Math.sin(b[0]*rad));
    }
    return Math.abs(total)*radius*radius/2/10000;
  }
  function geoToFarms(collection,filename){
    const feats=collection?.type==='FeatureCollection'?collection.features:[collection];
    const farms=[];
    for(const [idx,f] of (feats||[]).entries()){
      if(!f?.geometry)continue;
      const p=f.properties||{},geom=f.geometry;
      const polys=geom.type==='Polygon'?[geom.coordinates]:geom.type==='MultiPolygon'?geom.coordinates:[];
      for(const [part,poly] of polys.entries()){
        let ring=(poly?.[0]||[]).map(x=>[Number(x[1]),Number(x[0])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1])&&Math.abs(x[0])<=90&&Math.abs(x[1])<=180);
        if(ring.length<4)continue;
        const area=number(p.AREA_TOTAL??p.area_ha??p.area_total)??areaFromRing(ring);
        const fz=p.NOME_FAZ||p.FAZENDA||p.fazenda||p.farm_name||filename;
        const field=p.TALHAO||p.talhao||p.field_name||p.NAME||p.name||String(idx+1);
        farms.push({nomeFaz:String(fz),talhao:String(field)+(polys.length>1?' '+(part+1):''),zona:String(p.ZONA||p.zona||''),variedade:String(p.VARIEDADE||p.variedade||''),areaTotal:Number((area||0).toFixed(3)),coords:ring});
      }
    }
    return farms;
  }
  function parseFarmKml(content,name){
    const dom=new DOMParser().parseFromString(content,'application/xml');
    if(dom.getElementsByTagName('parsererror').length)throw Error('XML KML inválido.');
    const placemarks=[...dom.getElementsByTagName('Placemark')];
    const farms=[];
    for(const [idx,place] of placemarks.entries()){
      const polys=[...place.getElementsByTagName('Polygon')];
      for(const poly of polys){
        const line=poly.getElementsByTagName('coordinates')[0];
        if(!line)continue;
        const points=(line.textContent||'').trim().split(/\s+/).map(v=>v.split(',')).map(v=>[Number(v[1]),Number(v[0])])
          .filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180);
        if(points.length<4)continue;
        const label=place.getElementsByTagName('name')[0]?.textContent||'Talhão '+(idx+1);
        const fz=name.replace(/\.kml$/i,'');
        farms.push({nomeFaz:fz,talhao:label,zona:'',variedade:'',areaTotal:Number((areaFromRing(points)||0).toFixed(3)),coords:points});
      }
    }
    return farms;
  }
  async function parseFarmFiles(fileList){
    const files=Array.from(fileList||[]),farm=[];
    if(files.length>30)throw Error('Envie até 30 componentes por lote.');
    for(const f of files){
      if(f.size>40*1024*1024)throw Error('Arquivo maior que 40 MB: '+f.name);
      const suffix=f.name.toLowerCase().split('.').pop();
      if(['json','geojson'].includes(suffix)){
        farm.push(...geoToFarms(JSON.parse(await f.text()),f.name));
      }else if(suffix==='kml'){
        farm.push(...parseFarmKml(await f.text(),f.name));
      }else if(suffix==='zip'){
        if(!window.shp){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/shp.js';s.onload=resolve;s.onerror=()=>reject(Error('Biblioteca SHP indisponível'));document.head.append(s);});}
        const res=await window.shp(await f.arrayBuffer());
        for(const x of Array.isArray(res)?res:[res])farm.push(...geoToFarms(x,f.name));
      }else if(suffix==='shp'){
        const dbf=files.find(x=>x.name.toLowerCase()===f.name.toLowerCase().replace(/\.shp$/,'.dbf'));
        if(!dbf)throw Error('Inclua .dbf e .prj do Shapefile, ou use um ZIP completo.');
        if(!window.shp){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/shp.js';s.onload=resolve;s.onerror=()=>reject(Error('Biblioteca SHP indisponível'));document.head.append(s);});}
        const prj=files.find(x=>x.name.toLowerCase()===f.name.toLowerCase().replace(/\.shp$/,'.prj'));
        const geom=window.shp.parseShp(await f.arrayBuffer(),prj?await prj.text():null);
        const attrs=window.shp.parseDbf(await dbf.arrayBuffer());
        farm.push(...geoToFarms(window.shp.combine([geom,attrs]),f.name));
      }
    }
    const unique=new Map();
    farm.forEach(x=>unique.set([x.nomeFaz,x.talhao,JSON.stringify(x.coords)].join('|'),x));
    return [...unique.values()];
  }
  async function saveFarms(files){
    try{
      toast('Validando os polígonos…');const farms=await parseFarmFiles(files);
      if(!farms.length){toast('Nenhum polígono válido foi encontrado.',true);return;}
      if(!confirm('Salvar '+farms.length+' talhão(ões) no banco Neon?'))return;
      let count=0;
      for(let i=0;i<farms.length;i+=15){
        const r=await request('/api/talhoes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({farms:farms.slice(i,i+15)})});
        count+=Number(r.savedCount||0);
      }
      toast(count+' talhões salvos no PostgreSQL.');
      closeModal();await load();
    }catch(e){toast('Falha ao salvar talhões: '+e.message,true);}
  }
  async function openFields(){
    openModal('Fazendas e talhões','Importe KML, GeoJSON ou Shapefile ZIP com coordenadas geográficas. Os polígonos são salvos no Neon e podem ser baixados individualmente.');
    const picker=document.createElement('input');picker.type='file';picker.multiple=true;picker.accept='.kml,.json,.geojson,.zip,.shp,.dbf,.prj,.shx';
    picker.setAttribute('aria-label','Selecionar arquivos de talhões');
    picker.addEventListener('change',async()=>{const val=Array.from(picker.files||[]);picker.value='';if(val.length)await saveFarms(val);});
    $('modalContent').append(picker);
    if(!state.allFarms.length)modalItem('Nenhum talhão cadastrado','Importe arquivos KML, ZIP ou GeoJSON para começar.');
    const grouped=new Map();
    state.allFarms.forEach(f=>{const k=f.nomeFaz||'Fazenda não informada';if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(f);});
    for(const [farm,parts] of grouped){
      const features=parts.map(farmFeature).filter(Boolean);
      modalItem(farm,parts.length+' talhão(ões) • '+parts.map(x=>text(x.talhao)).join(', '),[
        {label:'Baixar KML',action:()=>exportKML(features,'talhoes_'+farm.replace(/[^a-z0-9_-]/gi,'_')+'.kml')}
      ]);
    }
    icon();
  }
  async function checkDB(){
    try{
      await request('/api/importacoes?limit=1');
      $('dbDot').className='status-dot ok';$('dbText').textContent='Neon conectado';
      toast('Banco de dados respondeu à consulta.');
    }catch(e){$('dbDot').className='status-dot error';$('dbText').textContent='Conexão indisponível';toast(e.message,true);}
  }
  function changeModule(module){
    if(!modules[module])return;
    state.module=module;state.requestSerial++;
    for(const b of document.querySelectorAll('[data-module]'))b.setAttribute('aria-selected',String(b.dataset.module===module));
    $('textFilter').value='';$('periodStart').value='';$('periodEnd').value='';
    closeModal();load();
    document.querySelectorAll('.filter-menu[open]').forEach(x=>x.open=false);
  }
  async function logout(){
    try{await request('/api/auth/logout',{method:'POST'});location.replace('/?login=necessario');}
    catch(e){toast(e.message,true);}
  }
  function listeners(){
    for(const btn of document.querySelectorAll('[data-module]'))btn.addEventListener('click',()=>changeModule(btn.dataset.module));
    for(const type of ['farm','field','machine','date']){
      $('search'+type[0].toUpperCase()+type.slice(1)).addEventListener('input',e=>{
        const term=e.target.value.toLocaleLowerCase('pt-BR');
        $(type+'Options').querySelectorAll('label').forEach(label=>label.hidden=!label.dataset.search.includes(term));
      });
    }
    document.querySelectorAll('[data-reset]').forEach(btn=>btn.addEventListener('click',()=>{
      const type=btn.dataset.reset;state.filters[type].clear();$(type+'Options').querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=false);
      updateFilters();state.page=1;applyFilters();
    }));
    for(const id of ['periodStart','periodEnd'])$(id).addEventListener('change',()=>{state.page=1;load();});
    $('textFilter').addEventListener('input',()=>{state.page=1;applyFilters();});
    $('clearFilters').addEventListener('click',()=>{
      $('textFilter').value='';$('periodStart').value='';$('periodEnd').value='';load();
    });
    $('refresh').addEventListener('click',load);
    $('dbStatus').addEventListener('click',checkDB);
    $('toggleOperations').addEventListener('change',()=>{renderMap();renderKpis();});
    $('toggleFarms').addEventListener('change',()=>{renderMap();renderKpis();});
    $('baseLayer').addEventListener('change',e=>{
      if(!state.map)return;
      state.map.removeLayer(state.sat);state.map.removeLayer(state.street);
      (e.target.value==='sat'?state.sat:state.street).addTo(state.map);
    });
    $('zoomAll').addEventListener('click',zoomAll);
    $('selectAll').addEventListener('change',e=>selectAll(e.target.checked));
    $('headSelect').addEventListener('change',e=>selectAll(e.target.checked));
    $('deleteSelected').addEventListener('click',deleteSelected);
    $('exportCsv').addEventListener('click',exportCSV);$('mobileCsv').addEventListener('click',exportCSV);
    $('exportKml').addEventListener('click',exportSelectedKml);$('mobileKml').addEventListener('click',exportSelectedKml);
    $('btnFields').addEventListener('click',openFields);$('mobileFields').addEventListener('click',openFields);
    $('btnTrash').addEventListener('click',openTrash);$('mobileTrash').addEventListener('click',openTrash);
    $('closeModal').addEventListener('click',closeModal);
    $('modalCover').addEventListener('click',e=>{if(e.target===$('modalCover'))closeModal();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
    $('pageSize').addEventListener('change',e=>{state.pageSize=Number(e.target.value);state.page=1;renderTable();});
    $('prevPage').addEventListener('click',()=>{state.page--;renderTable();});
    $('nextPage').addEventListener('click',()=>{state.page++;renderTable();});
    $('mobileMap').addEventListener('click',()=>mobileView('map'));
    $('mobileTable').addEventListener('click',()=>mobileView('data'));
    $('panelResize').addEventListener('click',()=>{$('workspace').classList.toggle('map-focused');setTimeout(()=>state.map?.invalidateSize(),220);});
    $('toggleTop').addEventListener('click',()=>{
      const collapsed=$('topSection').classList.toggle('collapsed-top');
      $('topSection').style.maxHeight=collapsed?'0px':'';
      $('topSection').style.overflow=collapsed?'hidden':'';
      $('topSection').style.border=collapsed?'none':'';
      $('topLabel').textContent=collapsed?'Mostrar topo':'Ocultar topo';
      $('topSection').style.flexBasis=collapsed?'0':'';
      setTimeout(()=>state.map?.invalidateSize(),250);
    });
    $('toggleFull').addEventListener('click',()=>{document.body.classList.toggle('fullmap');setTimeout(()=>state.map?.invalidateSize(),130);});
    $('logout').addEventListener('click',logout);
    $('btnTheme').addEventListener('click',()=>{
      const light=document.body.classList.toggle('light');
      localStorage.setItem('monitor_visual_theme',light?'light':'dark');
    });
    $('openActions').addEventListener('click',()=>{
      $('mobileActions').hidden=!$('mobileActions').hidden;
      $('openActions').setAttribute('aria-expanded',String(!$('mobileActions').hidden));
    });
  }
  document.addEventListener('DOMContentLoaded',()=>{
    if(localStorage.getItem('monitor_visual_theme')==='light')document.body.classList.add('light');
    initMap();listeners();icon();load();
  });
})();
