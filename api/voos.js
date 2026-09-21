// api/voos.js - Gerenciamento e Sincronização de Voos no Neon
const { query } = require('./db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. GET: Retorna voos salvos ou lista de exclusões
    if (req.method === 'GET') {
      const type = req.query.type;

      // Retorna apenas a lista de IDs de voos deletados (sincronização rápida)
      if (type === 'deletados') {
        const delRows = await query('SELECT id FROM voos_deletados ORDER BY deletado_em DESC;');
        return res.status(200).json({
          success: true,
          deletedIds: delRows.map(r => r.id)
        });
      }

      // Retorna voos gravados no banco + lista de deletados
      const flightsRows = await query(`
        SELECT 
          id, 
          nome_arquivo as "fileName", 
          drone, 
          piloto as pilot, 
          data_voo as "dateFormatted", 
          raw_date as "rawDate", 
          area_ha as area, 
          calda_l as "sprayL", 
          taxa_l_ha as rate, 
          tempo_voo_s as "timeSec", 
          tempo_voo_fmt as time, 
          vel_media_kmh as speed, 
          altura_media_m as height, 
          faixa_media_m as spacing, 
          num_pontos as points, 
          farm, 
          talhao, 
          coords 
        FROM voos 
        ORDER BY raw_date DESC, criado_em DESC 
        LIMIT 500;
      `);

      const delRows = await query('SELECT id FROM voos_deletados;');

      return res.status(200).json({
        success: true,
        flights: flightsRows,
        deletedIds: delRows.map(r => r.id)
      });
    }

    // 2. POST: Salvar voos novos ou restaurar deletados
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const action = req.query.action || (body && body.action);

      // Restaurar voos excluídos
      if (action === 'restaurar') {
        const ids = body.ids || (body.id ? [body.id] : []);
        for (const id of ids) {
          await query('DELETE FROM voos_deletados WHERE id = $1;', [id]);
        }
        return res.status(200).json({ success: true, restored: ids.length });
      }

      // Salvar lote de voos
      const items = Array.isArray(body) ? body : (body.flights || [body]);
      let savedCount = 0;

      for (const item of items) {
        if (!item || !item.id) continue;

        // Se estava na lista de deletados, remove
        await query('DELETE FROM voos_deletados WHERE id = $1;', [item.id]);

        const coordsJson = JSON.stringify(item.coords || []);
        await query(`
          INSERT INTO voos (
            id, nome_arquivo, drone, piloto, data_voo, raw_date,
            area_ha, calda_l, taxa_l_ha, tempo_voo_s, tempo_voo_fmt,
            vel_media_kmh, altura_media_m, faixa_media_m, num_pontos,
            farm, talhao, coords
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, $15,
            $16, $17, $18::jsonb
          )
          ON CONFLICT (id) DO UPDATE SET
            nome_arquivo = EXCLUDED.nome_arquivo,
            drone = EXCLUDED.drone,
            piloto = EXCLUDED.piloto,
            data_voo = EXCLUDED.data_voo,
            raw_date = EXCLUDED.raw_date,
            area_ha = EXCLUDED.area_ha,
            calda_l = EXCLUDED.calda_l,
            taxa_l_ha = EXCLUDED.taxa_l_ha,
            tempo_voo_s = EXCLUDED.tempo_voo_s,
            tempo_voo_fmt = EXCLUDED.tempo_voo_fmt,
            vel_media_kmh = EXCLUDED.vel_media_kmh,
            altura_media_m = EXCLUDED.altura_media_m,
            faixa_media_m = EXCLUDED.faixa_media_m,
            num_pontos = EXCLUDED.num_pontos,
            farm = EXCLUDED.farm,
            talhao = EXCLUDED.talhao,
            coords = EXCLUDED.coords;
        `, [
          item.id,
          item.fileName || item.nome_arquivo || '',
          item.drone || '',
          item.pilot || item.piloto || '',
          item.dateFormatted || item.data_voo || '',
          item.rawDate || item.raw_date || '',
          parseFloat(item.area) || 0,
          parseFloat(item.sprayL) || 0,
          parseFloat(item.rate) || 0,
          parseFloat(item.timeSec) || 0,
          item.time || item.tempo_voo_fmt || '',
          parseFloat(item.speed) || 0,
          parseFloat(item.height) || 0,
          parseFloat(item.spacing) || 0,
          parseInt(item.points) || 0,
          item.farm || '',
          item.talhao || '',
          coordsJson
        ]);
        savedCount++;
      }

      return res.status(200).json({ success: true, savedCount });
    }

    // 3. DELETE: Excluir voos (salva no banco em voos_deletados para sincronizar entre todos os computadores)
    if (req.method === 'DELETE') {
      let ids = [];
      if (req.query.id) {
        ids = [req.query.id];
      } else if (req.body) {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        ids = body.ids || (body.id ? [body.id] : []);
      }

      if (ids.length === 0) {
        return res.status(400).json({ error: "Nenhum ID informado para exclusão" });
      }

      for (const id of ids) {
        // Marca como deletado permanentemente na nuvem
        await query(`
          INSERT INTO voos_deletados (id) VALUES ($1)
          ON CONFLICT (id) DO NOTHING;
        `, [id]);

        // Remove da tabela de voos se estiver lá
        await query('DELETE FROM voos WHERE id = $1;', [id]);
      }

      return res.status(200).json({ success: true, deletedCount: ids.length });
    }

    return res.status(405).json({ error: 'Método não permitido' });
  } catch (error) {
    console.error('Erro na API de Voos:', error);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
};
