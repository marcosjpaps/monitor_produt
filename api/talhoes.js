// api/talhoes.js - Gerenciamento e Sincronização de Talhões/Fazendas no Neon
const { query } = require('./db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. GET: Retorna todos os talhões cadastrados no Neon
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
      let savedCount = 0;

      for (const f of farms) {
        if (!f) continue;
        const id = f.id || `farm_${f.nomeFaz || 'sem_fazenda'}_${f.talhao || 'sem_talhao'}_${Date.now()}`;
        const coordsJson = JSON.stringify(f.coords || []);
        const bboxJson = JSON.stringify(f.bbox || null);

        await query(`
          INSERT INTO talhoes (
            id, nome_faz, talhao, zona, variedade, plantio, area_total, coords, bbox
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb
          )
          ON CONFLICT (id) DO UPDATE SET
            nome_faz = EXCLUDED.nome_faz,
            talhao = EXCLUDED.talhao,
            zona = EXCLUDED.zona,
            variedade = EXCLUDED.variedade,
            plantio = EXCLUDED.plantio,
            area_total = EXCLUDED.area_total,
            coords = EXCLUDED.coords,
            bbox = EXCLUDED.bbox;
        `, [
          id,
          f.nomeFaz || '',
          f.talhao || '',
          f.zona || '',
          f.variedade || '',
          f.plantio || '',
          parseFloat(f.areaTotal) || 0,
          coordsJson,
          bboxJson
        ]);
        savedCount++;
      }

      return res.status(200).json({ success: true, savedCount });
    }

    // 3. DELETE: Excluir talhões específicos ou limpar tudo
    if (req.method === 'DELETE') {
      const action = req.query.action;
      if (action === 'clear_all') {
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

      await query('DELETE FROM talhoes WHERE id = $1;', [id]);
      return res.status(200).json({ success: true, deletedId: id });
    }

    return res.status(405).json({ error: 'Método não permitido' });
  } catch (error) {
    console.error('Erro na API de Talhões:', error);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
};
