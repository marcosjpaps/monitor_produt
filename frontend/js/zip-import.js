/* Read ZIP members individually: never send a multi-GB archive to a function. */
(function(root){
  'use strict';
  const MAX_MEMBER=50*1024*1024, MAX_EXPANDED=3*1024*1024*1024;
  const view=b=>new DataView(b);
  async function directory(file){
    const start=Math.max(0,file.size-65557), tail=view(await file.slice(start).arrayBuffer());
    let end=-1;
    for(let i=tail.byteLength-22;i>=0;i--)if(tail.getUint32(i,true)===0x06054b50 && i+22+tail.getUint16(i+20,true)===tail.byteLength){end=i;break;}
    if(end<0)throw Error('ZIP inválido: diretório não encontrado.');
    const count=tail.getUint16(end+10,true), size=tail.getUint32(end+12,true), offset=tail.getUint32(end+16,true);
    if(tail.getUint16(end+4,true)||tail.getUint16(end+6,true)||count===65535||offset===0xffffffff||count>20000||size>16*1024*1024||offset+size>start+end)throw Error('ZIP dividido, ZIP64 ou diretório acima do limite.');
    const bytes=await file.slice(offset,offset+size).arrayBuffer(), d=view(bytes), entries=[];
    let pos=0,total=0;
    for(let i=0;i<count;i++){
      if(pos+46>d.byteLength||d.getUint32(pos,true)!==0x02014b50)throw Error('Diretório ZIP truncado.');
      const flags=d.getUint16(pos+8,true), method=d.getUint16(pos+10,true), compressed=d.getUint32(pos+20,true), expanded=d.getUint32(pos+24,true), n=d.getUint16(pos+28,true), extra=d.getUint16(pos+30,true), comment=d.getUint16(pos+32,true), at=d.getUint32(pos+42,true);
      if(pos+46+n+extra+comment>d.byteLength)throw Error('Diretório ZIP truncado.');
      const name=new TextDecoder().decode(bytes.slice(pos+46,pos+46+n)).replace(/\\/g,'/');
      if(name.startsWith('/')||name.includes(':')||name.replace(/\/$/,'').split('/').some(p=>!p||p.startsWith('.')))throw Error('Caminho inseguro no ZIP.');
      if(flags&1)throw Error('ZIP protegido por senha não é aceito.');
      if(![0,8].includes(method)||expanded>MAX_MEMBER||at+30+compressed>offset)throw Error('Membro ZIP incompatível ou acima de 50 MB.');
      total+=expanded;if(total>MAX_EXPANDED)throw Error('ZIP excede 3 GB descompactados.');
      if(!name.endsWith('/'))entries.push({name,flags,method,compressed,expanded,at,crc:d.getUint32(pos+16,true)});
      pos+=46+n+extra+comment;
    }
    return entries;
  }
  function crc32(bytes){let crc=-1;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^-1)>>>0;}
  async function member(file,e){
    const h=view(await file.slice(e.at,e.at+30).arrayBuffer());
    if(h.byteLength!==30||h.getUint32(0,true)!==0x04034b50)throw Error('Cabeçalho ZIP inválido.');
    const begin=e.at+30+h.getUint16(26,true)+h.getUint16(28,true);
    let stream=file.slice(begin,begin+e.compressed).stream();
    if(e.method===8)stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));
    const reader=stream.getReader(), chunks=[];let size=0;
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>e.expanded||size>MAX_MEMBER){await reader.cancel();throw Error('Tamanho descompactado inválido.');}chunks.push(value);}
    const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());
    if(size!==e.expanded||crc32(bytes)!==e.crc)throw Error('ZIP corrompido: tamanho ou CRC inválido.');
    return new File([bytes],e.name,{type:'application/octet-stream'});
  }
  root.AgriculturalZip={directory,member};
  if(typeof module!=='undefined')module.exports=root.AgriculturalZip;
})(globalThis);
