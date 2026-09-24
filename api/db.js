// api/db.js - Conexão Segura com Neon PostgreSQL via HTTP Serverless
const NEON_CONN = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_bAg5oQPTR3vB@ep-green-mode-act23gk5-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require";

function getEndpointUrl(connStr) {
  try {
    const url = new URL(connStr);
    const host = url.hostname.replace('-pooler', '');
    return `https://${host}/sql`;
  } catch (e) {
    return 'https://ep-green-mode-act23gk5.sa-east-1.aws.neon.tech/sql';
  }
}

async function query(sql, params = []) {
  const endpoint = getEndpointUrl(NEON_CONN);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': NEON_CONN
    },
    body: JSON.stringify({
      query: sql,
      params: params
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Neon SQL error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.rows || [];
}

module.exports = { query, NEON_CONN };
