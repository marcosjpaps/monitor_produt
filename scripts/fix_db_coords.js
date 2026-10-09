// Recalcula vínculos, preservando os pontos originais e sem adivinhar sua ordem.
const {query,transaction,close}=require('../api/db');
async function run(){await require('./migrate').migrate();await transaction(async()=>{const flights=await query('SELECT id FROM voos');await require('../api/voos').linkFlights(flights.map(f=>f.id));console.log(`${flights.length} trajetórias verificadas; coordenadas preservadas.`);});await close();}
run().catch(e=>{console.error(e);process.exitCode=1;});
