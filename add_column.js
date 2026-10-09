const { Pool } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => { 
  const [k, v] = line.split('='); 
  if(k) acc[k.trim()] = v.trim(); 
  return acc; 
}, {}); 
const pool = new Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query('ALTER TABLE voos ADD COLUMN IF NOT EXISTS kml_url TEXT;').then(() => console.log('Column added')).catch(console.error).finally(() => pool.end());
