/* Preflight GIS para upload: validação no navegador (o backend também deve validar). */
(function(){
  'use strict';
  const W={johndeere:'john_deere',jacto:'jacto',massey:'trimble',stara:'stara',caseih:'case_ih',trimble:'trimble'};
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const actual=['APPLIEDRATE','APPLIEDRAT','APPLDRATE','APPRATE','TAXA_APLIC','TAXA_APL','DOSEAPLIC','TXAPLIC','ACTRATE','RATEACT'];
  const target=['TARGETRATE','CONTROLRATE','CONTROLRAT','VRT_RATE','VRT_Rate','TAXAALVO'];
  const speed=['VEHICLSPEED','VEHICLSPE','SPEED','VELOCIDADE','GPS_SPEED','VELOCID'];
  const flow=['FLOWRATE','VAZAO','FLOW','ACTFLOW','VAZ_LMIN'];
  const get=(cols,aliases)=>cols.find(x=>aliases.some(a=>norm(a)===norm(x)));
  const read=(bytes,i,little=true)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(i,little);
  const err=(code,message)=>({code,message});
  async function unzip(file){
    const b=new Uint8Array(await file.arrayBuffer()),v=new DataView(b.buffer);
    let end=-1;
    for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--){if(v.getUint32(i,true)===0x06054b50){end=i;break;}}
    if(end<0)throw Error('ZIP inválido ou truncado.');
    const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true);
    if(count>300||start>=b.length)throw Error('ZIP com arquivos demais.');
    const entries=new Map();let p=start,total=0;
    for(let n=0;n<count;n++){
      if(p+46>b.length||v.getUint32(p,true)!==0x02014b50)throw Error('Diretório ZIP corrompido.');
      const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),size=v.getUint32(p+24,true),packed=v.getUint32(p+20,true);
      const fn=v.getUint16(p+28,true),ex=v.getUint16(p+30,true),co=v.getUint16(p+32,true),off=v.getUint32(p+42,true);
      const filename=new TextDecoder().decode(b.slice(p+46,p+46+fn)).toLowerCase();p+=46+fn+ex+co;
      if(/(^|\/)\.\.(\/|$)/.test(filename)||filename.includes('\\')||filename.startsWith('/')||(flags&1))throw Error('ZIP com caminho inseguro ou criptografado.');
      total+=size;
      if(total>160*1024*1024||size>50*1024*1024||packed>50*1024*1024||(packed&&size/packed>200))throw Error('ZIP acima dos limites de segurança.');
      if(method!==0&&method!==8)throw Error('Compactação ZIP não suportada.');
      if(!/\.(shp|shx|dbf|prj|json|xml|bin)$/.test(filename))continue;
      if(off+30>b.length||v.getUint32(off,true)!==0x04034b50)throw Error('ZIP com item inválido.');
      const at=off+30+v.getUint16(off+26,true)+v.getUint16(off+28,true);
      if(at+packed>b.length)throw Error('ZIP truncado.');
      const bytes=b.slice(at,at+packed);
      let uncompressed=bytes;
      if(method===8){
        try{uncompressed=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());}
        catch{throw Error('Não foi possível abrir ZIP compactado neste navegador.');}
      }
      if(uncompressed.length!==size)throw Error('ZIP danificado: tamanho divergente.');
      entries.set(filename,uncompressed);
    }
    return entries;
  }
  function fields(raw){
    const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
    if(raw.length<65)throw Error('DBF incompleto.');
    const rows=v.getUint32(4,true),header=v.getUint16(8,true),rec=v.getUint16(10,true);
    if(rows<1||rows>5000000||header<65||rec<2||header+rows*rec>raw.length)throw Error('Contagem de registros DBF inconsistente.');
    const result=[];let at=1;
    for(let p=32;p<header;p+=32){
      if(raw[p]===13)break;
      if(p+32>raw.length)throw Error('Coluna DBF incompleta.');
      const name=new TextDecoder('windows-1252').decode(raw.slice(p,p+11)).replace(/\0.*$/,'').trim();
      const len=raw[p+16];if(!name||!len||at+len>rec)throw Error('DBF com coluna inválida.');
      result.push({name,start:at,length:len});at+=len;
    }
    if(!result.length)throw Error('DBF sem colunas.');
    return {result,rows,header,rec,raw};
  }
  function hasPositive(db,name){
    const col=db.result.find(c=>c.name===name);if(!col)return false;
    const decoder=new TextDecoder('windows-1252');
    for(let i=0;i<Math.min(db.rows,1000);i++){
      const at=db.header+i*db.rec;
      if(db.raw[at]===42)continue;
      const val=Number(decoder.decode(db.raw.slice(at+col.start,at+col.start+col.length)).trim().replace(',','.'));
      if(Number.isFinite(val)&&val>0)return true;
    }
    return false;
  }
  function inspectShp(data){
    if(data.length<100||read(data,0,false)!==9994||read(data,28)!==1000)throw Error('Assinatura do SHP inválida.');
    const type=read(data,32),types={1:'Point',3:'PolyLine',5:'Polygon',8:'MultiPoint',11:'PointZ',13:'PolyLineZ',15:'PolygonZ',18:'MultiPointZ'};
    if(!types[type])throw Error('Geometria SHP não suportada.');
    const v=new DataView(data.buffer,data.byteOffset,data.byteLength);
    const bb=[36,44,52,60].map(p=>v.getFloat64(p,true));
    if(bb[0]<-180||bb[2]>180||bb[1]<-90||bb[3]>90||bb[0]>bb[2]||bb[1]>bb[3])throw Error('Coordenadas SHP fora dos limites WGS84.');
    return types[type];
  }
  function projected(prj){
    const w=prj.toUpperCase();
    return /PROJCS\s*\[|PROJCRS\s*\[|PROJECTEDCRS\s*\[/.test(w);
  }
  function isWGS(prj){return !projected(prj)&&/WGS[_ ]?84|GCS_WGS_1984|EPSG.?4326/i.test(prj)&&/GEOGCS|GEOGCRS|GEOGRAPHICCRS/i.test(prj);}
  function detect(name,fields,chosen){
    const s=(name+' '+fields.join(' ')).toUpperCase();
    if(/JOHN.?DEERE|GREENSTAR|GS3_2630|GEN4|SWATHWIDTH|APPLIEDRAT/.test(s))return 'john_deere';
    if(/STARA|TOPPER|TAXA_APLIC/.test(s))return 'stara';
    if(/CASE.?IH|CASE.?AFS|AFS.?CONNECT|PRO700|CN1/.test(s))return 'case_ih';
    if(/JACTO|OTMIS|OMNI/.test(s))return 'jacto';
    if(/TRIMBLE|AGGPS|COVERAGE\.SHP|APPLDRATE/.test(s))return 'trimble';
    return W[chosen]||'desconhecida';
  }
  async function validarUploadAgricola(file,chosen){
    const out={estado:'rejeitado',marca:'desconhecida',formato:'desconhecido',camadasAceitas:[],camadasDescartadas:[],mapeamento:{},colunas:[],erros:[],avisos:[],geometria:null};
    const fail=(code,msg)=>out.erros.push(err(code,msg));
    try{
      if(!file.size||file.size>50*1024*1024){fail('TAMANHO','Arquivo vazio ou maior que 50 MB.');return out;}
      const ext=file.name.split('.').pop().toLowerCase();
      out.marca=detect(file.name,[],chosen);
      if(ext==='kml'){out.formato='kml';fail('KML_SEM_TAXA','KML não comprova dose real por ponto. Use um ZIP Shapefile completo de aplicação.');return out;}
      if(['jdl','fdd','cn1','vy1','otm','agdata','swath','pos','ehm','agf'].includes(ext)){fail('BINARIO','É necessário um conversor certificado antes de aceitar arquivos brutos '+ext+'.');return out;}
      if(ext==='csv'){out.formato='csv';fail('CSV_PARSER','Pré-validação CSV disponível apenas na especificação técnica. Aguarda parser estruturado no servidor.');return out;}
      if(ext!=='zip'){fail('ZIP_REQUERIDO','Envie ZIP Shapefile com SHP/SHX/DBF/PRJ ou ISOXML completo.');return out;}
      const entries=await unzip(file);out.formato='shape';
      const shapes=[...entries.keys()].filter(x=>x.endsWith('.shp'));
      if(!shapes.length){
        if([...entries.keys()].some(x=>x.endsWith('taskdata.xml'))){
          out.formato='isoxml';const master=[...entries].find(([key])=>key.endsWith('taskdata.xml'));
          const text=new TextDecoder().decode(master[1]);
          if(!/<ISO11783_TaskData\b/i.test(text)||!/<TSK\b/i.test(text))fail('ISO_INVALIDO','TASKDATA.XML não possui uma estrutura ISOXML válida.');
          else if(!/<TLG\b|<TIM\b/i.test(text))fail('ISO_RX','Sem TIM/TLG de aplicação; prescrição isolada.');
          else{out.estado='revisao';out.avisos.push(err('ISO_LOG','O parser ISOXML deve decodificar os registros DLV/PTN e as escalas DVP antes do banco.'));}
        }else fail('SEM_SHAPE','ZIP sem shapefile e sem TASKDATA.XML.');
        return out;
      }
      for(const shName of shapes){
        const basename=shName.slice(0,-4),layer=shName.split('/').pop();
        if(/ABLINE|SWATH|GUIDANCE|LINHA.?AB|BORDAD|BOUNDAR|LIMIT|PRESCRI|RX|ZONE/.test(shName.toUpperCase())){out.camadasDescartadas.push(shName);continue;}
        const missing=['shx','dbf','prj'].filter(s=>!entries.has(basename+'.'+s));
        if(missing.length){fail('SHAPE_INCOMPLETO',layer+' sem '+missing.join(', '));continue;}
        try{
          const type=inspectShp(entries.get(shName)),shx=entries.get(basename+'.shx');
          if(shx.length<100||read(shx,0,false)!==9994||read(shx,32)!==read(entries.get(shName),32))throw Error('SHX incompatível com SHP.');
          const prj=new TextDecoder().decode(entries.get(basename+'.prj'));
          if(!isWGS(prj))throw Error('PRJ não contém WGS84 geográfico (EPSG:4326).');
          const db=fields(entries.get(basename+'.dbf'));if((shx.length-100)/8!==db.rows)throw Error('Número de registros SHX/DBF diferente.');
          const cols=db.result.map(c=>c.name);out.colunas.push(...cols);
          out.marca=detect(file.name+' '+shName,cols,chosen);
          const rate=get(cols,actual),velocity=get(cols,speed),fl=get(cols,flow),trg=get(cols,target);
          if(!rate){fail('SEM_TAXA_REAL',layer+' tem apenas prescrição ou não possui coluna de taxa aplicada.');continue;}
          if(!hasPositive(db,rate)){fail('TAXA_ZERADA',layer+' sem taxa aplicada positiva nos registros de amostra.');continue;}
          if(['stara','case_ih','jacto','trimble'].includes(out.marca)&&!velocity){fail('SEM_VELOCIDADE',layer+' sem velocidade exigida para '+out.marca);continue;}
          if(out.marca==='case_ih'&&!fl){fail('SEM_VAZAO',layer+' sem vazão/fluxo.');continue;}
          if(out.marca==='john_deere'){
            const jsons=[...entries].filter(([key])=>key.endsWith('.json'));
            let units=false;for(const [key,bytes] of jsons){const value=new TextDecoder().decode(bytes);try{JSON.parse(value);units=units||/units|unidade|unitofmeasure/i.test(value);}catch{}}
            if(!units){fail('DEERE_UNIDADES','John Deere requer JSON válido com unidades.');continue;}
          }
          out.mapeamento={aplicada:rate,alvo:trg,velocidade:velocity,vazao:fl};
          out.geometria={tipo:type,epsg:4326,registros:db.rows};
          out.camadasAceitas.push(shName);
        }catch(e){fail('SHAPE_INVALIDO',layer+': '+e.message);}
      }
      if(out.camadasAceitas.length&&out.erros.length===0){out.estado='aprovado';}
      else if(out.camadasAceitas.length){out.estado='revisao';}
      else if(out.camadasDescartadas.length&&!out.erros.length)fail('APENAS_GUIAS','ZIP contém apenas linha guia, limite ou prescrição; não contém aplicação comprovada.');
      else if(!out.erros.length)fail('SEM_DADOS','Nenhuma camada de aplicação foi validada.');
      return out;
    }catch(e){fail('ARQUIVO_CORROMPIDO',e.message||'Falha ao abrir ZIP.');return out;}
  }
  window.validarUploadAgricola=validarUploadAgricola;
})();
