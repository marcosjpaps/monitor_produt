const crypto = require('crypto');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Parser robusto para arquivos DJI (KML exportados do controle)
function parseDJI(buffer, filename) {
  const text = buffer.toString('utf8');
  
  const flight = {
    id: crypto.createHash('sha1').update(buffer).digest('hex'),
    fileName: filename,
    drone: 'Drone',
    pilot: '',
    dateFormatted: '',
    rawDate: '',
    area: 0,
    sprayL: 0,
    rate: 0,
    timeSec: 0,
    speed: 0,
    height: 0,
    spacing: 0,
    points: 0,
    coords: []
  };

  // Extração KML (DJI Agras)
  if (filename.toLowerCase().endsWith('.kml') || text.includes('<kml')) {
    // Coordenadas
    const lines=[...text.matchAll(/<(?:\w+:)?LineString\b[^>]*>([\s\S]*?)<\/(?:\w+:)?LineString>/g)];
    if(lines.length>1)throw new Error('KML com múltiplas trajetórias: envie um voo por arquivo');
    const coordMatch = (lines[0]?.[1] || text).match(/<(?:\w+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/);
    if (coordMatch) {
      coordMatch[1].trim().split(/\s+/).forEach(pt => {
        const parts = pt.split(',');
        if (parts.length >= 2) {
          const lng = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lng)) flight.coords.push([lat, lng]);
        }
      });
    }

    // Metadados DJI ExtendedData
    const extractData = (name) => {
      const regex = new RegExp(`<Data name="${name}">\\s*<value>([^<]*)<\/value>`);
      const m = text.match(regex);
      return m ? m[1].trim() : '';
    };

    flight.drone = extractData('Aircraft Name') || 'Drone';
    flight.pilot = extractData('Pilot Name') || '';
    
    const timeMs = parseFloat(extractData('Flight Time'));
    if (!isNaN(timeMs)) flight.timeSec = Math.round(timeMs / 100) / 10;
    
    flight.area = parseFloat(extractData('Task Area')) || 0;
    
    const sprayMl = parseFloat(extractData('Spray amount'));
    if (!isNaN(sprayMl)) flight.sprayL = Math.round(sprayMl / 10) / 100;
    
    if (flight.area > 0.001) flight.rate = Math.round((flight.sprayL / flight.area) * 10) / 10;
    
    flight.speed = parseFloat(extractData('Task Flight Speed')) || 0;
    flight.height = parseFloat(extractData('Height')) || 0;
    flight.spacing = parseFloat(extractData('Route Spacing')) || 0;
    
    // Data do arquivo pelo nome (padrão T100_YYYYMMDDHHMMSS)
    const dateMatch = filename.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (dateMatch) {
      flight.rawDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      flight.dateFormatted = `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]} ${dateMatch[4]}:${dateMatch[5]}`;
    }
  } 
  // CSV com cabeçalhos lat/lon ou, sem cabeçalho, ordem explícita lon,lat.
  else if (filename.toLowerCase().endsWith('.csv')) {
    const lines=text.trim().split(/\r?\n/).filter(Boolean);
    const delimiter=(lines[0]||'').includes(';')?';':',';
    const cells=line=>line.split(delimiter).map(v=>v.trim().replace(/^"|"$/g,''));
    const first=cells(lines[0]||'');
    const hasHeader=first.some(v=>/[a-z]/i.test(v));
    const headers=first.map(v=>v.toLowerCase());
    const latIndex=hasHeader?headers.findIndex(v=>['lat','latitude'].includes(v)):1;
    const lonIndex=hasHeader?headers.findIndex(v=>['lon','lng','longitude'].includes(v)):0;
    if(latIndex<0||lonIndex<0)throw new Error('CSV precisa de cabeçalhos latitude/longitude');
    for(const line of lines.slice(hasHeader?1:0)){
      const row=cells(line);const lat=Number(row[latIndex]?.replace(',','.')),lon=Number(row[lonIndex]?.replace(',','.'));
      if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('CSV com coordenada inválida');
      flight.coords.push([lat,lon]);
    }
  } else throw new Error('Formato não suportado: envie KML, CSV ou JSON de voos processados');

  flight.points = flight.coords.length;
  return flight;
}

module.exports = { parseDJI };
