/**
 * neon_sync.js - Sincronização em Nuvem com Neon PostgreSQL para o AgroDrone
 * Permite persistência global de Voos, Exclusões e Talhões entre múltiplos usuários e dispositivos.
 */

const NEON_CONFIG = {
  directEndpoint: "https://ep-green-mode-act23gk5.sa-east-1.aws.neon.tech/sql",
  connString: "postgresql://neondb_owner:npg_bAg5oQPTR3vB@ep-green-mode-act23gk5-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require"
};

const NeonSync = {
  isSyncing: false,
  useApi: window.location.protocol.startsWith('http'),

  // Executa uma query SQL direta no Neon (usada em modo estático/file ou fallback)
  async queryDirect(sql, params = []) {
    try {
      const resp = await fetch(NEON_CONFIG.directEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Neon-Connection-String': NEON_CONFIG.connString
        },
        body: JSON.stringify({ query: sql, params })
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(t);
      }
      const data = await resp.json();
      return data.rows || [];
    } catch (err) {
      console.warn("Falha no Neon direct query:", err);
      throw err;
    }
  },

  // Atualiza o indicador visual na barra superior
  updateBadge(status, text) {
    const badge = document.getElementById('neonSyncBadge');
    const dot = document.getElementById('neonSyncDot');
    const label = document.getElementById('neonSyncText');
    if (!badge || !dot || !label) return;

    if (status === 'syncing') {
      dot.style.background = '#f59e0b'; // amarelo
      badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      badge.style.color = '#f59e0b';
      label.innerText = text || 'Sincronizando...';
    } else if (status === 'synced') {
      dot.style.background = '#10b981'; // verde
      badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      badge.style.color = '#10b981';
      label.innerText = text || 'Nuvem Neon';
    } else if (status === 'error') {
      dot.style.background = '#ef4444'; // vermelho
      badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      badge.style.color = '#ef4444';
      label.innerText = text || 'Offline';
    }
  },

  // Busca lista de IDs de voos deletados no banco
  async fetchDeletedIds() {
    if (this.useApi) {
      try {
        const r = await fetch('/api/voos?type=deletados');
        if (r.ok) {
          const data = await r.json();
          return data.deletedIds || [];
        }
      } catch (e) {
        console.warn("API /api/voos inacessível, usando conexão direta:", e);
      }
    }
    const rows = await this.queryDirect("SELECT id FROM voos_deletados ORDER BY deletado_em DESC;");
    return rows.map(r => r.id);
  },

  // Envia lista de IDs para exclusão permanente na nuvem
  async saveDeletedIds(ids) {
    if (!ids || ids.length === 0) return;
    this.updateBadge('syncing', 'Salvando exclusão...');

    try {
      if (this.useApi) {
        try {
          const r = await fetch('/api/voos', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
          });
          if (r.ok) {
            this.updateBadge('synced', 'Nuvem Neon');
            return;
          }
        } catch (e) {
          console.warn("Tentando gravação direta de exclusão:", e);
        }
      }

      // Gravação direta no Neon
      for (const id of ids) {
        await this.queryDirect(
          "INSERT INTO voos_deletados (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;",
          [id]
        );
        await this.queryDirect("DELETE FROM voos WHERE id = $1;", [id]);
      }
      this.updateBadge('synced', 'Nuvem Neon');
    } catch (err) {
      console.error("Erro ao salvar exclusões no Neon:", err);
      this.updateBadge('error', 'Erro Sync');
    }
  },

  // Restaura voos na nuvem
  async restoreDeletedIds(ids) {
    if (!ids || ids.length === 0) return;
    this.updateBadge('syncing', 'Restaurando...');
    try {
      if (this.useApi) {
        try {
          const r = await fetch('/api/voos?action=restaurar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
          });
          if (r.ok) {
            this.updateBadge('synced', 'Nuvem Neon');
            return;
          }
        } catch (e) {}
      }

      for (const id of ids) {
        await this.queryDirect("DELETE FROM voos_deletados WHERE id = $1;", [id]);
      }
      this.updateBadge('synced', 'Nuvem Neon');
    } catch (err) {
      console.error("Erro ao restaurar voos no Neon:", err);
      this.updateBadge('error', 'Erro Sync');
    }
  },

  // Busca todos os talhões salvos no banco
  async fetchFarms() {
    if (this.useApi) {
      try {
        const r = await fetch('/api/talhoes');
        if (r.ok) {
          const data = await r.json();
          return data.farms || [];
        }
      } catch (e) {}
    }

    const rows = await this.queryDirect(`
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
    return rows;
  },

  // Salva lote de talhões importados (Shapefile / KML) na nuvem
  async saveFarms(farmsList) {
    if (!farmsList || farmsList.length === 0) return;
    this.updateBadge('syncing', 'Salvando talhões...');

    try {
      if (this.useApi) {
        try {
          const r = await fetch('/api/talhoes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ farms: farmsList })
          });
          if (r.ok) {
            this.updateBadge('synced', 'Nuvem Neon');
            return;
          }
        } catch (e) {}
      }

      // Gravação direta lote por lote no Neon
      for (const f of farmsList) {
        const id = f.id || `farm_${f.nomeFaz || 'sem_faz'}_${f.talhao || 'sem_talhao'}`;
        await this.queryDirect(`
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
          JSON.stringify(f.coords || []),
          JSON.stringify(f.bbox || null)
        ]);
      }
      this.updateBadge('synced', 'Nuvem Neon');
    } catch (err) {
      console.error("Erro ao salvar talhões no Neon:", err);
      this.updateBadge('error', 'Erro Sync');
    }
  },

  // Remove um talhão no banco
  async deleteFarm(id) {
    if (!id) return;
    try {
      if (this.useApi) {
        fetch(`/api/talhoes?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
      }
      this.queryDirect("DELETE FROM talhoes WHERE id = $1;", [id]).catch(() => {});
    } catch (e) {}
  },

  // Remove todos os talhões no banco
  async clearAllFarms() {
    try {
      if (this.useApi) {
        fetch('/api/talhoes?action=clear_all', { method: 'DELETE' }).catch(() => {});
      }
      this.queryDirect("DELETE FROM talhoes;").catch(() => {});
    } catch (e) {}
  },

  // Salva novos voos importados no banco Neon
  async saveFlights(flightsList) {
    if (!flightsList || flightsList.length === 0) return;
    this.updateBadge('syncing', 'Salvando voos...');

    try {
      if (this.useApi) {
        try {
          const r = await fetch('/api/voos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flights: flightsList })
          });
          if (r.ok) {
            this.updateBadge('synced', 'Nuvem Neon');
            return;
          }
        } catch (e) {}
      }

      // Direto no Neon para cada voo
      for (const item of flightsList) {
        await this.queryDirect("DELETE FROM voos_deletados WHERE id = $1;", [item.id]);
        await this.queryDirect(`
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
          JSON.stringify(item.coords || [])
        ]);
      }
      this.updateBadge('synced', 'Nuvem Neon');
    } catch (err) {
      console.error("Erro ao salvar voos no Neon:", err);
      this.updateBadge('error', 'Erro Sync');
    }
  },

  // Sincronização global completa: sincroniza exclusões, talhões e voos
  async syncAll(showFeedback = false) {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.updateBadge('syncing', 'Sincronizando...');

    try {
      // 1. Sincroniza exclusões de voos
      const cloudDeleted = await this.fetchDeletedIds();
      let changed = false;

      // Se havia exclusões locais antigas, envia para a nuvem
      const localDeleted = Array.from(deletedIds);
      const toUpload = localDeleted.filter(id => !cloudDeleted.includes(id));
      if (toUpload.length > 0) {
        this.saveDeletedIds(toUpload); // assíncrono em background
      }

      // Adiciona as exclusões da nuvem localmente
      cloudDeleted.forEach(id => {
        if (!deletedIds.has(id)) {
          deletedIds.add(id);
          changed = true;
        }
      });

      if (changed) {
        localStorage.setItem('agrodrone_deleted_ids', JSON.stringify(Array.from(deletedIds)));
        flights = flights.filter(f => !deletedIds.has(f.id));
        applyFilters();
      }

      // 2. Sincroniza talhões/fazendas
      const cloudFarms = await this.fetchFarms();
      if (cloudFarms && cloudFarms.length > 0) {
        let farmChanged = false;
        cloudFarms.forEach(cf => {
          const idx = savedFarms.findIndex(sf => (sf.id && sf.id === cf.id) || (sf.nomeFaz === cf.nomeFaz && sf.talhao === cf.talhao));
          if (idx >= 0) {
            savedFarms[idx] = cf;
          } else {
            savedFarms.push(cf);
            farmChanged = true;
          }
        });

        localStorage.setItem('agrodrone_saved_farms', JSON.stringify(savedFarms));
        linkFlightsToFarms();
        populateFarmFilterOptions();
        renderFarmsOnMap();
        renderTable();
        updateFarmUI();
      } else if (savedFarms.length > 0) {
        // Se a nuvem estava vazia mas a máquina local tem talhões, sobe para o banco
        this.saveFarms(savedFarms);
      }

      this.updateBadge('synced', 'Nuvem Neon');
      if (showFeedback && typeof showToast === 'function') {
        showToast("Nuvem Neon sincronizada com sucesso!");
      }
    } catch (err) {
      console.warn("Falha na sincronização com Neon:", err);
      this.updateBadge('error', 'Offline');
      if (showFeedback && typeof showToast === 'function') {
        showToast("Não foi possível conectar ao Neon. Operando no modo local.");
      }
    } finally {
      this.isSyncing = false;
    }
  }
};

window.NeonSync = NeonSync;
