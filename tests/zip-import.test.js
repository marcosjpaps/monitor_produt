const {test}=require('node:test');
const assert=require('node:assert/strict');
const zlib=require('node:zlib');
const {directory,member}=require('../frontend/js/zip-import');
function crc(bytes){let c=-1;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^-1)>>>0;}
function zip(name,raw,method=8){
 const n=Buffer.from(name),data=method===8?zlib.deflateRawSync(raw):raw,local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(method,8);local.writeUInt16LE(n.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(method,10);central.writeUInt32LE(crc(raw),16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(n.length,28);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+n.length,12);end.writeUInt32LE(local.length+n.length+data.length,16);
 return new File([local,n,data,central,n,end],'data.zip');
}
test('stored and deflate preserve activity path and exact bytes',async()=>{
 for(const method of [0,8]){const raw=Buffer.from('telemetria real bytes'),file=zip('JD-Data/log/atividade/test.jdl',raw,method);const entries=await directory(file);assert.equal(entries.length,1);const result=await member(file,entries[0]);assert.equal(result.name,'JD-Data/log/atividade/test.jdl');assert.deepEqual(Buffer.from(await result.arrayBuffer()),raw);}
});
test('reject traversal, hidden paths, corrupt directory and CRC',async()=>{
 for(const name of ['../x.jdl','/x.jdl','a/.secret','C:/x.jdl'])await assert.rejects(directory(zip(name,Buffer.from('abc'))),/inseguro/);
 await assert.rejects(directory(new File(['broken'],'a.zip')),/inválido/);
 const file=zip('x.jdl',Buffer.from('abc'));const entries=await directory(file);entries[0].crc=0;await assert.rejects(member(file,entries[0]),/CRC/);
 entries[0].expanded=1;await assert.rejects(member(file,entries[0]),/Tamanho/);
});
