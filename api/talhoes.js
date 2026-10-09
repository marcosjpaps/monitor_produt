// api/talhoes.js - Gerenciamento e Sincronização de Talhões/Fazendas no PostgreSQL
const { query } = require('./db');
const { geometryHash, normalizeCoords, validatePolygon } = require('./sigUtils');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS' || req.method === 'HEAD') {
    return res.status(200).end();
  }

  try {
    // 1. GET: Retorna todos os talhões cadastrados no banco de dados
    if (req.method === 'GET') {
      const rows = await query(`
        SELECT 
          id, 
          nome_faz as "nomeFaz", 
          talhao, 
          zona, 
          variedade, 
          plantio, 
          area_total as "areaTotal", 
          coords, 
          bbox 
        FROM talhoes 
        ORDER BY nome_faz, talhao;
      `);

      return res.status(200).json({
        success: true,
        count: rows.length,
        farms: rows
      });
    }

    // 2. POST: Salvar ou atualizar lote de talhões importados (Shapefile / KML)
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const farms = Array.isArray(body) ? body : (body.farms || [body]);
      if (!Array.isArray(farms) || farms.some(f => !f || !Array.isArray(f.coords) || f.coords.some(p => !require('./telemetryValidator').extractLatLng(p)) || !validatePolygon(f.coords))) return res.status(400).json({error:'Talhão inválido. Use um polígono com coordenadas [latitude, longitude].'});
      const validFarms = [...new Map(farms.map(f => [f.id || geometryHash(f.coords,f.areaTotal,f.nomeFaz,f.talhao),f])).values()];
      if (validFarms.length === 0) return res.status(200).json({ success: true, savedCount: 0 });

      const valuesList = [];
      const params = [];
      let paramIdx = 1;

      for (const f of validFarms) {
        const coords = normalizeCoords(f.coords || []);
        if (!validatePolygon(coords)) {
          continue;
        }
        const geometry_hash = geometryHash(coords, f.areaTotal, f.nomeFaz, f.talhao);
        const id = f.id || `field_${geometry_hash.slice(0, 24)}`;
        const coordsJson = JSON.stringify(coords);
        const bboxJson = JSON.stringify(f.bbox || null);

        valuesList.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}::jsonb, $${paramIdx++}::jsonb)`);
        
        params.push(
          id,
          f.nomeFaz || '',
          f.talhao || '',
          f.zona || '',
          f.variedade || '',
          f.plantio || '',
          parseFloat(f.areaTotal) || 0,
          coordsJson,
          bboxJson
        );
      }

      if (!valuesList.length) return res.status(400).json({error:"Nenhum polígono válido"});
      const sql = `
        INSERT INTO talhoes (
          id, nome_faz, talhao, zona, variedade, plantio, area_total, coords, bbox
        ) VALUES ${valuesList.join(', ')}
        ON CONFLICT (id) DO UPDATE SET
          nome_faz = EXCLUDED.nome_faz,
          talhao = EXCLUDED.talhao,
          zona = EXCLUDED.zona,
          variedade = EXCLUDED.variedade,
          plantio = EXCLUDED.plantio,
          area_total = EXCLUDED.area_total,
          coords = EXCLUDED.coords,
          bbox = EXCLUDED.bbox;
      `;

      await query(sql, params);
      await require('./voos').linkFlights((await query('SELECT id FROM voos')).map(r=>r.id));
      return res.status(200).json({ success: true, savedCount: valuesList.length });
    }

    // 3. DELETE: Excluir talhões específicos ou limpar tudo
    if (req.method === 'DELETE') {
      const action = req.query.action;
      if (action === 'clear_all') {
        await query('DELETE FROM voo_talhoes');
        await query('DELETE FROM talhoes;');
        return res.status(200).json({ success: true, message: 'Todos os talhões foram removidos do banco.' });
      }

      let id = req.query.id;
      if (!id && req.body) {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        id = body.id;
      }

      if (!id) {
        return res.status(400).json({ error: "ID do talhão não informado para exclusão" });
      }

      await query('DELETE FROM voo_talhoes WHERE talhao_id=$1',[id]);
      await query('DELETE FROM talhoes WHERE id = $1;', [id]);
      return res.status(200).json({ success: true, deletedId: id });
    }

    return res.status(405).json({ error: 'Método não permitido' });
  } catch (error) {
    console.error('Erro na API de Talhões:', error);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
};
