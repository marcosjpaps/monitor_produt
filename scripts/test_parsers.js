const {spawnSync}=require('child_process');const path=require('path');
process.exitCode=spawnSync(process.execPath,['--test',path.join(__dirname,'../tests/parsers.test.js')],{stdio:'inherit'}).status;
