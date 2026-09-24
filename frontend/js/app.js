/**
 * Trimble TMX-2050 - Precision Agriculture GIS & Operations Management Hub
 * Interface Dark Navy GIS compatível com drone-ivory-ten.vercel.app
 * Visualização de Satélite, Faixas Reais de Aplicação (Swaths), Rastros de Passadas e Linha AB
 */

// =========================================================================
// CONFIGURAÇÃO DO MAPA LEAFLET E CAMADAS DE SATÉLITE
// =========================================================================

const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
  maxZoom: 22, attribution: '&copy; Google Hybrid'
});
const googleSat = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
  maxZoom: 22, attribution: '&copy; Google Satellite'
});
const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, attribution: '&copy; Esri World Imagery'
});
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap'
});

const map = L.map('map', {
  center: [-17.69, -45.79], // Coordenadas reais da Usina G5 / Fazendas em Minas Gerais
  zoom: 13,
  layers: [googleHybrid],
  preferCanvas: true
});

L.control.layers({
  "🛰️ Satélite Híbrido (Google)": googleHybrid,
  "🛰️ Satélite Puro (Google)": googleSat,
  "🛰️ Satélite (Esri World)": esriSat,
  "🗺️ Mapa de Ruas (OSM)": osm
}, null, { position: 'topright' }).addTo(map);

// Escala Gráfica Métrica
L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(map);

// Telemetria e Coordenadas no HUD
map.on('mousemove', (e) => {
  const el = document.getElementById('hudCoords');
  if (el) {
    el.innerHTML = `<i data-lucide="crosshair" style="width:11px; height:11px;"></i> ${e.latlng.lat.toFixed(5)}°, ${e.latlng.lng.toFixed(5)}°`;
    if (window.lucide) lucide.createIcons();
  }
});

map.on('zoomend', () => {
  const el = document.getElementById('hudZoom');
  if (el) el.innerText = map.getZoom();
});

// =========================================================================
// CORES POR TIPO DE OPERAÇÃO AGRÍCOLA
// =========================================================================
const OP_COLORS = {
  'Calagem': '#f59e0b',       // Dourado / Âmbar
  'Gessagem': '#06b6d4',      // Ciano / Aqua
  'Plantio': '#10b981',       // Verde Esmeralda
  'Pulverização': '#38bdf8',  // Azul Céu Elétrico
  'Adubação': '#a855f7',      // Roxo
  'Colheita': '#fb923c',      // Laranja
  'Preparo de Solo': '#eab308',
  'DEFAULT': '#38bdf8'
};

function getOpColor(type) {
  if (!type) return OP_COLORS['DEFAULT'];
  for (const [k, v] of Object.entries(OP_COLORS)) {
    if (type.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return OP_COLORS['DEFAULT'];
}

function getTypeClass(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('gess')) return 'type-gessagem';
  if (t.includes('calc') || t.includes('cal')) return 'type-calagem';
  if (t.includes('plant') || t.includes('seme')) return 'type-plantio';
  if (t.includes('pulv')) return 'type-pulverizacao';
  if (t.includes('adub') || t.includes('npk')) return 'type-adubacao';
  if (t.includes('colh')) return 'type-colheita';
  return 'type-calagem';
}

function matchesTypeFilter(op, term) {
  if (!term) return true;
  const normalize = (str) => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const normTerm = normalize(term);
  const normType = normalize(op.operation_type);
  const normName = normalize(op.clean_name);
  const normRaw = normalize(op.raw_name);

  // 1. Contido diretamente no tipo ou no nome da operação
  if (normType.includes(normTerm)) return true;
  if (normName.includes(normTerm) || normRaw.includes(normTerm)) return true;

  // 2. Equivalências de Calcário / Calagem
  if (normTerm.includes('calc') || normTerm === 'cal' || normTerm.includes('calagem')) {
    if (normType.includes('calagem') || normName.includes('calc') || normName.includes('cal')) return true;
  }

  // 3. Equivalências de Gesso / Gessagem
  if (normTerm.includes('gess')) {
    if (normType.includes('gessagem') || normName.includes('gess')) return true;
  }

  // 4. Plantio / Semeadura
  if (normTerm.includes('plant') || normTerm.includes('seme')) {
    if (normType.includes('plant') || normType.includes('seme') || normName.includes('plant') || normName.includes('seme')) return true;
  }

  // 5. Pulverização / Defensivo
  if (normTerm.includes('pulv') || normTerm.includes('defens') || normTerm.includes('quim')) {
    if (normType.includes('pulv')) return true;
  }

  // 6. Adubação / NPK
  if (normTerm.includes('adub') || normTerm.includes('npk') || normTerm.includes('fert')) {
    if (normType.includes('adub')) return true;
  }

  return false;
}

// =========================================================================
// ESTADO GLOBAL DA APLICAÇÃO
// =========================================================================
let operations = [];
let filteredOperations = [];
let selectedIds = new Set();
let mapLayers = {}; // Armazena grupos de camadas por UUID
let showFields = true;
let showSwath = true;
let showTracks = true;
let showABLine = true;
let selectedDates = new Set();
let allDatesList = [];
let currentDetailOp = null;

// Configuração e Estado das Colunas da Tabela
const COLUMN_CONFIG = [
  { key: 'delete', label: 'Excluir', default: true },
  { key: 'date', label: 'Data', default: true },
  { key: 'farm', label: 'Fazenda', default: true },
  { key: 'field', label: 'Talhões', default: true },
  { key: 'op', label: 'Operação / Tarefa', default: true },
  { key: 'type', label: 'Tipo / Insumo', default: true },
  { key: 'vehicle', label: 'Máquina / Trator', default: true },
  { key: 'controller', label: 'Piloto / NAV-900', default: true },
  { key: 'implement', label: 'Implemento & Faixa', default: true },
  { key: 'area', label: 'Área (ha)', default: true },
  { key: 'rate', label: 'Taxa Aplicada', default: true },
  { key: 'total', label: 'Insumo Total', default: true },
  { key: 'monitor', label: 'Monitor Trimble', default: true },
  { key: 'uuid', label: 'UUID Trimble', default: false },
  { key: 'actions', label: 'Ações (Mapa / Detalhes)', default: true }
];

let visibleColumns = {};
let columnFilterValues = {};
let showFilterRow = false;

// =========================================================================
// INICIALIZAÇÃO
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  setupDragAndDrop();
  setupFileInputs();
  setupActionButtons();
  initColumnChooser();
  loadData();
});

async function loadData() {
  try {
    const res = await fetch('/api/operations');
    if (!res.ok) throw new Error('Falha ao obter operações');
    operations = await res.json();
    filteredOperations = [...operations];
    selectedIds = new Set(operations.map(op => op.uuid));

    const badgeOps = document.getElementById('badgeOpsCount');
    if (badgeOps) badgeOps.innerText = operations.length;

    populateFilters();
    renderMap();
    renderTable();
    applyColumnVisibilityClasses();
    updateFilterRowDisplay();
    updateStats();
    zoomToAll();

    // Carrega talhões cadastrais do SIG (857 talhões)
    loadFarmFields();
    loadCadastralFieldsGeoJSON();
  } catch (err) {
    showToast('Erro ao carregar operações: ' + err.message, 'error');
  }
}

// =========================================================================
// POPULAR FILTROS E DATAS
// =========================================================================
function populateFilters() {
  const monitorSet = new Set();
  const farmSet = new Set();
  const fieldSet = new Set();
  const typeCounts = {};
  const dateCounts = {};

  operations.forEach(op => {
    if (op.device_serial) monitorSet.add(op.device_serial);
    if (op.farm_name) farmSet.add(op.farm_name);
    if (op.detected_fields && op.detected_fields.length > 0) {
      op.detected_fields.forEach(f => fieldSet.add(f));
    } else if (op.field_name) {
      fieldSet.add(op.field_name);
    }
    const t = op.operation_type || 'Geral';
    typeCounts[t] = (typeCounts[t] || 0) + 1;

    const d = op.operation_date || (op.imported_at ? op.imported_at.split('T')[0] : '2026-09-23');
    dateCounts[d] = (dateCounts[d] || 0) + 1;
  });

  // Select de Monitores
  const selMonitor = document.getElementById('selMonitor');
  if (selMonitor) {
    const curVal = selMonitor.value;
    selMonitor.innerHTML = '<option value="">Todos os Monitores</option>';
    Array.from(monitorSet).sort().forEach(s => {
      selMonitor.innerHTML += `<option value="${s}" ${s === curVal ? 'selected' : ''}>TMX-2050 (S/N: ${s})</option>`;
    });
  }

  // Select de Tipos / Insumos Dinâmico
  const selOpType = document.getElementById('selOpType');
  if (selOpType) {
    const curVal = selOpType.value;
    selOpType.innerHTML = '<option value="">Todos os Insumos / Tipos</option>';
    Object.keys(typeCounts).sort().forEach(t => {
      let label = t;
      if (t === 'Calagem') label = `Calagem / Calcário (${typeCounts[t]})`;
      else if (t === 'Gessagem') label = `Gessagem / Gesso (${typeCounts[t]})`;
      else if (t === 'Plantio') label = `Plantio / Semeadura (${typeCounts[t]})`;
      else if (t === 'Pulverização') label = `Pulverização (${typeCounts[t]})`;
      else if (t === 'Adubação') label = `Adubação / NPK (${typeCounts[t]})`;
      else label = `${t} (${typeCounts[t]})`;

      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = label;
      if (t === curVal) opt.selected = true;
      selOpType.appendChild(opt);
    });
  }

  // Select de Fazendas
  const selFarm = document.getElementById('selFarm');
  if (selFarm) {
    const curVal = selFarm.value;
    selFarm.innerHTML = '<option value="">Todas as Fazendas</option>';
    Array.from(farmSet).sort().forEach(f => {
      selFarm.innerHTML += `<option value="${f}" ${f === curVal ? 'selected' : ''}>${f}</option>`;
    });
  }

  // Select de Talhões
  const selTalhao = document.getElementById('selTalhao');
  if (selTalhao) {
    const curVal = selTalhao.value;
    selTalhao.innerHTML = '<option value="">Todos os Talhões</option>';
    Array.from(fieldSet).sort().forEach(f => {
      selTalhao.innerHTML += `<option value="${f}" ${f === curVal ? 'selected' : ''}>${f}</option>`;
    });
  }

  // Multi-Datas
  allDatesList = Object.keys(dateCounts).sort().reverse().map(d => {
    const parts = d.split('-');
    return {
      rawDate: d,
      displayDate: parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d,
      count: dateCounts[d]
    };
  });

  const listContainer = document.getElementById('dateCheckboxList');
  if (listContainer) {
    listContainer.innerHTML = allDatesList.map(item => `
      <label style="display:flex; align-items:center; gap:8px; padding:4px 6px; border-radius:4px; cursor:pointer; user-select:none;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
        <input type="checkbox" value="${item.rawDate}" ${selectedDates.has(item.rawDate) ? 'checked' : ''} onchange="onDateCheckboxChanged('${item.rawDate}', this.checked)">
        <span>${item.displayDate}</span>
        <span style="margin-left:auto; color:var(--text-muted); font-size:0.7rem;">(${item.count})</span>
      </label>
    `).join('');
  }
}

function toggleDateDropdown(e) {
  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }
  const pop = document.getElementById('datePopover');
  if (!pop) return;

  // Fecha colChooser se estiver aberto
  const colPop = document.getElementById('colChooserPopover');
  if (colPop) colPop.style.display = 'none';

  const isHidden = (pop.style.display === 'none' || pop.style.display === '' || window.getComputedStyle(pop).display === 'none');
  pop.style.display = isHidden ? 'flex' : 'none';
}

document.addEventListener('click', (e) => {
  const pop = document.getElementById('datePopover');
  const btn = document.getElementById('btnDateFilter');
  if (pop && pop.style.display === 'flex') {
    if (!pop.contains(e.target) && e.target !== btn && (!btn || !btn.contains(e.target))) {
      pop.style.display = 'none';
    }
  }
});

function onDateCheckboxChanged(dateStr, isChecked) {
  if (isChecked) {
    selectedDates.add(dateStr);
  } else {
    selectedDates.delete(dateStr);
  }
  updateDateLabel();
  applyFilters();
}

function selectAllDates(all) {
  selectedDates.clear();
  if (all) {
    allDatesList.forEach(item => selectedDates.add(item.rawDate));
  }
  populateFilters();
  updateDateLabel();
  applyFilters();
}

function updateDateLabel() {
  const lbl = document.getElementById('lblDateFilter');
  if (!lbl) return;
  if (selectedDates.size === 0 || selectedDates.size === allDatesList.length) {
    lbl.textContent = 'Todas as Datas';
  } else if (selectedDates.size === 1) {
    const d = Array.from(selectedDates)[0].split('-');
    lbl.textContent = `${d[2]}/${d[1]}/${d[0]}`;
  } else {
    lbl.textContent = `${selectedDates.size} Datas Selecionadas`;
  }
}

function filterDateCheckboxList() {
  const q = document.getElementById('txtSearchDates').value.toLowerCase();
  const items = document.querySelectorAll('#dateCheckboxList label');
  items.forEach(el => {
    el.style.display = el.innerText.toLowerCase().includes(q) ? 'flex' : 'none';
  });
}

// =========================================================================
// FILTRAGEM DINÂMICA
// =========================================================================
function applyFilters() {
  const monitor = document.getElementById('selMonitor').value;
  const opType = document.getElementById('selOpType').value;
  const farm = document.getElementById('selFarm').value;
  const talhao = document.getElementById('selTalhao').value;
  const q = document.getElementById('txtSearch').value.toLowerCase().trim();

  filteredOperations = operations.filter(op => {
    // 1. Filtros superiores
    if (monitor && op.device_serial !== monitor) return false;
    if (opType && !matchesTypeFilter(op, opType)) return false;
    if (farm && op.farm_name !== farm) return false;
    if (talhao) {
      const match = (op.detected_fields && op.detected_fields.includes(talhao)) || (op.field_name === talhao);
      if (!match) return false;
    }

    if (selectedDates.size > 0 && selectedDates.size < allDatesList.length) {
      const d = op.operation_date || (op.imported_at ? op.imported_at.split('T')[0] : '');
      if (!selectedDates.has(d)) return false;
    }

    if (q) {
      const targetStr = `${op.clean_name} ${op.raw_name} ${op.operation_type} ${op.uuid} ${op.farm_name} ${op.field_name} ${op.vehicle_name} ${op.implement_name}`.toLowerCase();
      if (!targetStr.includes(q)) return false;
    }

    // 2. Filtros individuais por coluna
    for (const [colKey, rawVal] of Object.entries(columnFilterValues)) {
      if (!rawVal) continue;
      const v = rawVal.toLowerCase().trim();

      if (colKey === 'date') {
        const d = op.operation_date || (op.imported_at ? op.imported_at.split('T')[0] : '');
        const p = d.split('-');
        const dateFormatted = p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
        if (!d.toLowerCase().includes(v) && !dateFormatted.toLowerCase().includes(v)) return false;
      } else if (colKey === 'farm') {
        if (!op.farm_name || !op.farm_name.toLowerCase().includes(v)) return false;
      } else if (colKey === 'field') {
        const fStr = ((op.detected_fields || []).join(' ') + ' ' + (op.field_name || '')).toLowerCase();
        if (!fStr.includes(v)) return false;
      } else if (colKey === 'op') {
        const oStr = ((op.clean_name || '') + ' ' + (op.raw_name || '')).toLowerCase();
        if (!oStr.includes(v)) return false;
      } else if (colKey === 'type') {
        if (!matchesTypeFilter(op, v)) return false;
      } else if (colKey === 'vehicle') {
        if (!op.vehicle_name || !op.vehicle_name.toLowerCase().includes(v)) return false;
      } else if (colKey === 'controller') {
        if (!op.controller_name || !op.controller_name.toLowerCase().includes(v)) return false;
      } else if (colKey === 'implement') {
        if (!op.implement_name || !op.implement_name.toLowerCase().includes(v)) return false;
      } else if (colKey === 'area') {
        if (!String(op.area_ha || '').toLowerCase().includes(v)) return false;
      } else if (colKey === 'rate') {
        if (!String(op.applied_rate || '').toLowerCase().includes(v)) return false;
      } else if (colKey === 'total') {
        if (!String(op.total_applied || '').toLowerCase().includes(v)) return false;
      } else if (colKey === 'monitor') {
        if (!String(op.device_serial || '').toLowerCase().includes(v)) return false;
      } else if (colKey === 'uuid') {
        if (!op.uuid || !op.uuid.toLowerCase().includes(v)) return false;
      }
    }

    return true;
  });

  renderMap();
  renderTable();
  updateStats();
}

// =========================================================================
// GERENCIADOR DE COLUNAS VISÍVEIS E FILTROS INDIVIDUAIS
// =========================================================================
function initColumnChooser() {
  const savedCols = localStorage.getItem('massei_visible_cols');
  if (savedCols) {
    try {
      visibleColumns = JSON.parse(savedCols);
    } catch (e) {
      visibleColumns = {};
    }
  }
  COLUMN_CONFIG.forEach(col => {
    if (visibleColumns[col.key] === undefined) {
      visibleColumns[col.key] = col.default;
    }
  });

  const savedFilterRow = localStorage.getItem('massei_show_filter_row');
  if (savedFilterRow !== null) {
    showFilterRow = savedFilterRow === 'true';
  }

  const chkFilterRow = document.getElementById('chkShowFilterRow');
  if (chkFilterRow) chkFilterRow.checked = showFilterRow;

  // Garante listeners explícitos no botão e no popover
  const btnColChooser = document.getElementById('btnColChooser');
  if (btnColChooser) {
    btnColChooser.onclick = function(e) {
      toggleColChooser(e);
    };
  }

  const colPop = document.getElementById('colChooserPopover');
  if (colPop) {
    colPop.onclick = function(e) {
      e.stopPropagation();
    };
  }

  renderColCheckboxList();
  applyColumnVisibilityClasses();
  updateFilterRowDisplay();
}

function renderColCheckboxList() {
  const list = document.getElementById('colCheckboxList');
  if (!list) return;
  list.innerHTML = COLUMN_CONFIG.map(col => `
    <label class="col-checkbox-label">
      <input type="checkbox" value="${col.key}" ${visibleColumns[col.key] !== false ? 'checked' : ''} onchange="toggleColumnVisibility('${col.key}', this.checked)">
      <span>${col.label}</span>
    </label>
  `).join('');
}

function toggleColChooser(e) {
  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }
  const pop = document.getElementById('colChooserPopover');
  if (!pop) {
    console.error('Elemento #colChooserPopover não encontrado!');
    return;
  }

  // Fecha o datePopover se estiver aberto para não sobrepor
  const datePop = document.getElementById('datePopover');
  if (datePop) datePop.style.display = 'none';

  const isHidden = (pop.style.display === 'none' || pop.style.display === '' || window.getComputedStyle(pop).display === 'none');
  if (isHidden) {
    renderColCheckboxList();
    pop.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  } else {
    pop.style.display = 'none';
  }
}

document.addEventListener('click', (e) => {
  const pop = document.getElementById('colChooserPopover');
  const btn = document.getElementById('btnColChooser');
  if (pop && pop.style.display === 'flex') {
    if (!pop.contains(e.target) && e.target !== btn && (!btn || !btn.contains(e.target))) {
      pop.style.display = 'none';
    }
  }
});

function toggleColumnVisibility(colKey, isVisible) {
  visibleColumns[colKey] = isVisible;
  localStorage.setItem('massei_visible_cols', JSON.stringify(visibleColumns));
  applyColumnVisibilityClasses();
}

function setAllColumnsVisibility(allVisible) {
  COLUMN_CONFIG.forEach(col => {
    visibleColumns[col.key] = allVisible;
  });
  localStorage.setItem('massei_visible_cols', JSON.stringify(visibleColumns));
  renderColCheckboxList();
  applyColumnVisibilityClasses();
}

function resetColumnsVisibility() {
  COLUMN_CONFIG.forEach(col => {
    visibleColumns[col.key] = col.default;
  });
  localStorage.setItem('massei_visible_cols', JSON.stringify(visibleColumns));
  renderColCheckboxList();
  applyColumnVisibilityClasses();
}

function applyColumnVisibilityClasses() {
  const table = document.getElementById('operationsTable');
  if (!table) return;
  COLUMN_CONFIG.forEach(col => {
    const cls = `hide-col-${col.key}`;
    if (visibleColumns[col.key] === false) {
      table.classList.add(cls);
    } else {
      table.classList.remove(cls);
    }
  });
}

function toggleFilterRow(checked) {
  showFilterRow = checked;
  localStorage.setItem('massei_show_filter_row', String(checked));
  updateFilterRowDisplay();
}

function updateFilterRowDisplay() {
  const fRow = document.getElementById('filterRow');
  if (fRow) {
    if (showFilterRow) {
      fRow.classList.add('active');
    } else {
      fRow.classList.remove('active');
    }
  }
}

function onColumnFilterChange(colKey, val) {
  columnFilterValues[colKey] = val.trim();
  applyFilters();
}

function clearAllFilters() {
  columnFilterValues = {};
  document.querySelectorAll('.col-filter-input').forEach(inp => inp.value = '');

  const selM = document.getElementById('selMonitor');
  if (selM) selM.value = '';
  const selO = document.getElementById('selOpType');
  if (selO) selO.value = '';
  const selF = document.getElementById('selFarm');
  if (selF) selF.value = '';
  const selT = document.getElementById('selTalhao');
  if (selT) selT.value = '';
  const txtS = document.getElementById('txtSearch');
  if (txtS) txtS.value = '';
  selectAllDates(true);
}

// Vincula funções ao escopo global window para garantir chamadas HTML onclick
window.toggleColChooser = toggleColChooser;
window.setAllColumnsVisibility = setAllColumnsVisibility;
window.resetColumnsVisibility = resetColumnsVisibility;
window.toggleColumnVisibility = toggleColumnVisibility;
window.toggleFilterRow = toggleFilterRow;
window.onColumnFilterChange = onColumnFilterChange;
window.clearAllFilters = clearAllFilters;

// =========================================================================
// RENDERIZAÇÃO NO MAPA LEAFLET COM FAIXAS PINTADAS (SWATHS) E LINHAS AB
// =========================================================================
function renderMap() {
  // Remove camadas antigas
  Object.values(mapLayers).forEach(layerGroup => {
    map.removeLayer(layerGroup);
  });
  mapLayers = {};

  filteredOperations.forEach(op => {
    if (!selectedIds.has(op.uuid)) return;

    const baseColor = getOpColor(op.operation_type);
    const layerGroup = L.featureGroup();

    if (op.geojson_geometry && op.geojson_geometry.features) {
      op.geojson_geometry.features.forEach(feature => {
        const pType = feature.properties ? feature.properties.type : '';

        // 1. LIMITES DO TALHÃO (Perímetro com traço delimitador)
        if (pType === 'boundary' || (feature.geometry.type === 'Polygon' && !pType)) {
          if (!showFields) return;
          const latlngs = feature.geometry.coordinates[0].map(pt => [pt[1], pt[0]]);
          const polygon = L.polygon(latlngs, {
            color: '#38bdf8',
            weight: 2,
            dashArray: '5, 5',
            fillColor: baseColor,
            fillOpacity: 0.10
          });

          const fieldsListStr = (op.detected_fields && op.detected_fields.length > 0)
            ? op.detected_fields.join(', ')
            : op.field_name;

          polygon.bindTooltip(`
            <div style="font-family:'Plus Jakarta Sans',sans-serif; font-size:12px; min-width:190px;">
              <strong style="color:#38bdf8; font-size:13px;">${escapeHtml(op.clean_name)}</strong><br>
              <span style="color:#f59e0b;">Fazenda: <b>${escapeHtml(op.farm_name)}</b></span><br>
              <span>Talhões: <b>${escapeHtml(fieldsListStr)}</b></span><br>
              <span>Área: <b>${escapeHtml(op.area_ha)} ha</b> | Taxa: <b>${escapeHtml(op.applied_rate)}</b></span><br>
              <span style="font-size:10px; color:#94a3b8;">Monitor Trimble TMX: ${escapeHtml(op.device_serial || '6251225841')}</span>
            </div>
          `, { sticky: true, opacity: 0.95 });

          polygon.on('click', () => {
            highlightTableRow(op.uuid);
            openDetailModal(op.uuid);
          });

          layerGroup.addLayer(polygon);
        }

        // 2. FAIXAS REAIS DE APLICAÇÃO PINTADAS (SWATH COVERAGE)
        else if (pType === 'swath_coverage') {
          if (!showSwath) return;
          const latlngs = feature.geometry.coordinates[0].map(pt => [pt[1], pt[0]]);
          const passNum = feature.properties.pass_number || 1;
          const swathW = feature.properties.swath_width_m || op.swath_width_m || 12.0;

          // Alternância sutil de tom para diferenciar passadas contíguas perfeitamente
          const fillOp = (passNum % 2 === 0) ? 0.65 : 0.52;

          const swathPoly = L.polygon(latlngs, {
            color: 'rgba(255, 255, 255, 0.35)',
            weight: 1,
            fillColor: baseColor,
            fillOpacity: fillOp
          });

          swathPoly.bindTooltip(`
            <div style="font-family:'Plus Jakarta Sans',sans-serif; font-size:12px; min-width:220px; padding:2px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <span style="font-weight:700; color:#38bdf8; font-size:13px;">🚜 Passada #${passNum} (${swathW}m)</span>
                <span style="background:rgba(56,189,248,0.2); color:#38bdf8; font-size:10px; font-weight:700; padding:1px 5px; border-radius:3px;">APLICAÇÃO</span>
              </div>
              <div style="font-weight:600; color:#fff; margin-bottom:4px;">${escapeHtml(op.clean_name)}</div>
              <div style="font-size:11px; color:#cbd5e1; display:grid; grid-template-columns:auto 1fr; gap:2px 8px;">
                <span>Trator:</span><b style="color:#fff;">${escapeHtml(op.vehicle_name || 'Massey Ferguson 7318')}</b>
                <span>Piloto:</span><b style="color:#ec4899;">${escapeHtml(op.controller_name || 'Trimble NAV-900')}</b>
                <span>Implemento:</span><b style="color:#a855f7;">${escapeHtml(op.implement_name || 'Espalhadeira 12m')}</b>
                <span>Taxa:</span><b style="color:#10b981;">${escapeHtml(op.applied_rate || '1.500 kg/ha')}</b>
                <span>Fazenda:</span><b style="color:#f59e0b;">${escapeHtml(op.farm_name)}</b>
              </div>
            </div>
          `, { sticky: true, opacity: 0.95 });

          swathPoly.on('mouseover', function () {
            this.setStyle({ weight: 2, color: '#ffffff', fillOpacity: 0.85 });
          });
          swathPoly.on('mouseout', function () {
            this.setStyle({ weight: 1, color: 'rgba(255, 255, 255, 0.35)', fillOpacity: fillOp });
          });

          swathPoly.on('click', () => {
            highlightTableRow(op.uuid);
            openDetailModal(op.uuid);
          });

          layerGroup.addLayer(swathPoly);
        }

        // 3. RASTROS DE PASSADAS E TRAJETÓRIA DO TRATOR
        else if (pType === 'tracks' || feature.geometry.type === 'MultiLineString') {
          if (!showTracks) return;
          feature.geometry.coordinates.forEach(lineCoords => {
            const lineLatlngs = lineCoords.map(pt => [pt[1], pt[0]]);
            const line = L.polyline(lineLatlngs, {
              color: '#ffffff',
              weight: 2,
              opacity: 0.9,
              dashArray: '6, 6'
            });
            line.bindTooltip(`Rastro do Trator: ${escapeHtml(op.vehicle_name || 'Massey Ferguson 7318')}`, { sticky: true });
            layerGroup.addLayer(line);
          });
        }

        // 4. LINHA-GUIA AB (NAV-900 AUTOPILOT)
        else if (pType === 'ab_guidance' || (feature.geometry.type === 'LineString' && !pType)) {
          if (!showABLine) return;
          const lineLatlngs = feature.geometry.coordinates.map(pt => [pt[1], pt[0]]);
          const abLine = L.polyline(lineLatlngs, {
            color: '#ec4899',
            weight: 3.5,
            opacity: 1,
            dashArray: '8, 8'
          });

          abLine.bindTooltip(`
            <div style="font-family:'Plus Jakarta Sans',sans-serif; font-size:11px;">
              <strong style="color:#ec4899;">Linha-Guia Mestre AB (Piloto Automático)</strong><br>
              <span>Controlador: <b>${escapeHtml(op.controller_name || 'Trimble NAV-900')}</b></span><br>
              <span>Largura de Passada: <b>${op.swath_width_m || 12.0}m</b></span>
            </div>
          `, { sticky: true });
          layerGroup.addLayer(abLine);

          // Marcadores dos Pontos A e B
          if (lineLatlngs.length >= 2) {
            const ptA = lineLatlngs[0];
            const ptB = lineLatlngs[lineLatlngs.length - 1];

            const iconA = L.divIcon({
              className: 'custom-ab-icon',
              html: '<div class="marker-ab-badge marker-ab-a">A</div>',
              iconSize: [20, 20],
              iconAnchor: [10, 10]
            });
            const iconB = L.divIcon({
              className: 'custom-ab-icon',
              html: '<div class="marker-ab-badge marker-ab-b">B</div>',
              iconSize: [20, 20],
              iconAnchor: [10, 10]
            });

            const markerA = L.marker(ptA, { icon: iconA }).bindTooltip('Ponto de Início A (Piloto Trimble NAV-900)', { sticky: true });
            const markerB = L.marker(ptB, { icon: iconB }).bindTooltip('Ponto Final B (Piloto Trimble NAV-900)', { sticky: true });
            layerGroup.addLayer(markerA);
            layerGroup.addLayer(markerB);
          }
        }
      });
    }

    layerGroup.addTo(map);
    mapLayers[op.uuid] = layerGroup;
  });

  const hudVisible = document.getElementById('hudVisibleOps');
  if (hudVisible) hudVisible.innerText = Object.keys(mapLayers).length;
}

function zoomToAll() {
  const allLayers = Object.values(mapLayers);
  if (allLayers.length === 0) return;

  const group = L.featureGroup(allLayers);
  try {
    map.fitBounds(group.getBounds().pad(0.12));
  } catch (e) {}
}

function zoomToOperation(uuid) {
  const layer = mapLayers[uuid];
  if (layer && layer.getBounds) {
    try {
      map.fitBounds(layer.getBounds().pad(0.2));
      highlightTableRow(uuid);
    } catch (e) {}
  }
}

function toggleFieldsVisibility() {
  const chk = document.getElementById('chkShowFields');
  showFields = chk ? chk.checked : true;
  renderMap();
}

function toggleSwathVisibility() {
  const chk = document.getElementById('chkSwath');
  showSwath = chk ? chk.checked : true;
  renderMap();
}

function toggleTracksVisibility() {
  const chk = document.getElementById('chkTracks');
  showTracks = chk ? chk.checked : true;
  renderMap();
}

function toggleABLineVisibility() {
  const chk = document.getElementById('chkABLine');
  showABLine = chk ? chk.checked : true;
  renderMap();
}

function toggleSelectAll(checked) {
  if (checked) {
    filteredOperations.forEach(op => selectedIds.add(op.uuid));
  } else {
    selectedIds.clear();
  }
  const hChk = document.getElementById('headerChkAll');
  if (hChk) hChk.checked = checked;
  renderMap();
  renderTable();
  updateStats();
}

function toggleOpSelection(uuid, checked) {
  if (checked) {
    selectedIds.add(uuid);
  } else {
    selectedIds.delete(uuid);
  }
  const hChk = document.getElementById('headerChkAll');
  if (hChk) {
    hChk.checked = (selectedIds.size === filteredOperations.length && filteredOperations.length > 0);
  }
  renderMap();
  updateStats();
}

// =========================================================================
// RENDERIZAÇÃO DA TABELA DE ATRIBUTOS
// =========================================================================
function renderTable() {
  const tbody = document.getElementById('attrTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const lblCount = document.getElementById('lblCount');
  if (lblCount) {
    lblCount.innerText = `(${filteredOperations.length} operações)`;
  }

  filteredOperations.forEach(op => {
    const isSelected = selectedIds.has(op.uuid);
    const tr = document.createElement('tr');
    tr.id = `row-${op.uuid}`;
    if (isSelected) tr.classList.add('active');

    const fieldsStr = (op.detected_fields && op.detected_fields.length > 0)
      ? op.detected_fields.join(', ')
      : (op.field_name || 'Geral');

    const d = op.operation_date || (op.imported_at ? op.imported_at.split('T')[0] : '-');
    const p = d.split('-');
    const dateFormatted = p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;

    tr.innerHTML = `
      <td data-col="select" style="text-align: center;" onclick="event.stopPropagation()">
        <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleOpSelection('${op.uuid}', this.checked)">
      </td>
      <td data-col="delete" style="text-align: center;" onclick="event.stopPropagation()">
        <button class="btn btn-outline" style="padding:2px 5px; color:#ef4444; border-color:rgba(239,68,68,0.4);" onclick="deleteOperation('${op.uuid}')" title="Excluir operação">
          <i data-lucide="trash" style="width:12px; height:12px;"></i>
        </button>
      </td>
      <td data-col="date">${dateFormatted}</td>
      <td data-col="farm"><span class="tag-farm">${escapeHtml(op.farm_name)}</span></td>
      <td data-col="field"><span class="tag-field">${escapeHtml(fieldsStr)}</span></td>
      <td data-col="op">
        <div style="font-weight:700; color:#fff;">${escapeHtml(op.clean_name)}</div>
        ${op.clean_name !== op.raw_name ? `<div style="font-size:0.68rem; color:var(--text-dim);">Original: "${escapeHtml(op.raw_name)}"</div>` : ''}
      </td>
      <td data-col="type"><span class="tag-type ${getTypeClass(op.operation_type)}">${escapeHtml(op.operation_type)}</span></td>
      <td data-col="vehicle"><span style="color:#38bdf8; font-weight:600;"><i data-lucide="tractor" style="width:12px; height:12px; vertical-align:middle;"></i> ${escapeHtml(op.vehicle_name || 'Massey Ferguson 7318')}</span></td>
      <td data-col="controller"><span style="color:#ec4899; font-weight:600;"><i data-lucide="navigation" style="width:12px; height:12px; vertical-align:middle;"></i> ${escapeHtml(op.controller_name || 'Trimble NAV-900')}</span></td>
      <td data-col="implement"><span style="color:#a855f7;"><i data-lucide="split" style="width:12px; height:12px; vertical-align:middle;"></i> ${escapeHtml(op.implement_name || 'Espalhadeira')} (${op.swath_width_m || '12.0'}m)</span></td>
      <td data-col="area" style="font-weight:600; color:#10b981;">${escapeHtml(op.area_ha)} ha</td>
      <td data-col="rate" style="color:#f59e0b; font-weight:600;">${escapeHtml(op.applied_rate)}</td>
      <td data-col="total" style="color:#38bdf8;">${escapeHtml(op.total_applied)}</td>
      <td data-col="monitor"><span style="font-family:var(--font-mono); font-size:0.75rem; color:#94a3b8;">${escapeHtml(op.device_serial || '6251225841')}</span></td>
      <td data-col="uuid" style="font-family:var(--font-mono); font-size:0.7rem; color:var(--text-dim);">${op.uuid.substring(0, 13)}...</td>
      <td data-col="actions">
        <div style="display:flex; gap:6px;">
          <button class="btn btn-outline" style="padding:2px 8px; font-size:0.7rem;" onclick="zoomToOperation('${op.uuid}')" title="Aproximar no mapa">
            <i data-lucide="crosshair" style="width:12px; height:12px;"></i>
          </button>
          <button class="btn btn-primary" style="padding:2px 8px; font-size:0.7rem;" onclick="openDetailModal('${op.uuid}')" title="Ver detalhes completos e telemetria">
            <i data-lucide="eye" style="width:12px; height:12px;"></i>
          </button>
        </div>
      </td>
    `;

    tr.addEventListener('click', () => {
      highlightTableRow(op.uuid);
      zoomToOperation(op.uuid);
    });

    tbody.appendChild(tr);
  });

  if (window.lucide) lucide.createIcons();
}

function highlightTableRow(uuid) {
  document.querySelectorAll('.attr-table tbody tr').forEach(r => r.classList.remove('active'));
  const tr = document.getElementById(`row-${uuid}`);
  if (tr) {
    tr.classList.add('active');
    tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// =========================================================================
// ATUALIZAÇÃO DOS KPIS
// =========================================================================
function updateStats() {
  const selectedOps = filteredOperations.filter(op => selectedIds.has(op.uuid));

  let totalArea = 0;
  let totalAppliedNum = 0;
  let totalPoints = 0;
  const fieldSet = new Set();
  const monitorSet = new Set();

  selectedOps.forEach(op => {
    const a = parseFloat(op.area_ha || 0);
    if (!isNaN(a)) totalArea += a;
    totalPoints += (op.points_count || 0);
    if (op.detected_fields) op.detected_fields.forEach(f => fieldSet.add(f));
    if (op.device_serial) monitorSet.add(op.device_serial);
  });

  const kOps = document.getElementById('kpiOperations');
  if (kOps) kOps.innerText = `${selectedOps.length} / ${operations.length}`;

  const kArea = document.getElementById('kpiArea');
  if (kArea) kArea.innerText = `${totalArea.toFixed(2)} ha`;

  const kApplied = document.getElementById('kpiTotalApplied');
  if (kApplied) kApplied.innerText = `${(totalArea * 1500).toLocaleString('pt-BR')} kg`;

  const kRate = document.getElementById('kpiRate');
  if (kRate) kRate.innerText = selectedOps.length ? selectedOps[0].applied_rate : '-';

  const kSpacing = document.getElementById('kpiSpacing');
  if (kSpacing) kSpacing.innerText = selectedOps.length ? `${selectedOps[0].swath_width_m} m` : '-';

  const kFields = document.getElementById('kpiFields');
  if (kFields) kFields.innerText = fieldSet.size;

  const kMonitors = document.getElementById('kpiMonitors');
  if (kMonitors) kMonitors.innerText = monitorSet.size;

  const kPoints = document.getElementById('kpiPoints');
  if (kPoints) kPoints.innerText = totalPoints.toLocaleString('pt-BR');
}

// =========================================================================
// PAINEL SUPERIOR E INFERIOR (COLLAPSIBLE / FULLSCREEN)
// =========================================================================
function toggleTopPanel() {
  const topSec = document.getElementById('topSection');
  const btnText = document.getElementById('lblToggleTop');
  const icon = document.getElementById('iconToggleTop');
  const isCollapsed = topSec.classList.toggle('collapsed');
  document.body.classList.toggle('top-collapsed', isCollapsed);

  if (isCollapsed) {
    if (btnText) btnText.innerText = 'Mostrar Topo';
    if (icon) icon.setAttribute('data-lucide', 'chevrons-down');
  } else {
    if (btnText) btnText.innerText = 'Ocultar Topo';
    if (icon) icon.setAttribute('data-lucide', 'chevrons-up');
  }
  if (window.lucide) lucide.createIcons();
  setTimeout(() => map.invalidateSize(), 320);
}

function togglePanelSize() {
  const panel = document.getElementById('attrPanel');
  const icon = document.getElementById('btnToggleIcon');
  const isCollapsed = panel.classList.toggle('collapsed');
  if (icon) {
    icon.setAttribute('data-lucide', isCollapsed ? 'chevron-down' : 'chevron-up');
  }
  if (window.lucide) lucide.createIcons();
  setTimeout(() => map.invalidateSize(), 300);
}

function toggleFullscreenMap() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

// =========================================================================
// UPLOAD MULTI-FORMATO (PASTA, ZIP, AGF, KML, SHAPEFILE)
// =========================================================================
async function uploadFilesToServer(fileList, label = 'Arquivos') {
  if (!fileList || fileList.length === 0) return;
  showToast(`Enviando ${fileList.length} arquivo(s) (${label})...`);

  const formData = new FormData();
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    const relPath = f.webkitRelativePath || f.name;
    formData.append('files', f, relPath);
  }

  try {
    const res = await fetch('/api/upload-multi', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Falha no processamento');
    showToast(data.message || 'Dados importados e mapeados com sucesso!');
    await loadData();
  } catch (err) {
    showToast('Erro no upload: ' + err.message, 'error');
  }
}

function setupDragAndDrop() {
  const dropZone = document.getElementById('dropZone');
  if (!dropZone) return;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropZone.classList.add('active');
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('active');
  });

  dropZone.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) {
      dropZone.classList.remove('active');
    }
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('active');
    if (e.dataTransfer.files.length > 0) {
      uploadFilesToServer(e.dataTransfer.files, 'Arquivos arrastados');
    }
  });
}

function setupFileInputs() {
  const fileInput = document.getElementById('fileInput');
  const folderInput = document.getElementById('folderInput');
  const shpFileInput = document.getElementById('shpFileInput');

  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      await uploadFilesToServer(e.target.files, 'Pacote de Arquivos');
      fileInput.value = '';
    });
  }

  if (folderInput) {
    folderInput.addEventListener('change', async (e) => {
      await uploadFilesToServer(e.target.files, 'Pasta Completa');
      folderInput.value = '';
    });
  }

  if (shpFileInput) {
    shpFileInput.addEventListener('change', async (e) => {
      await uploadFilesToServer(e.target.files, 'Shapefiles / KML');
      shpFileInput.value = '';
    });
  }
}

// =========================================================================
// AÇÕES DO CABEÇALHO
// =========================================================================
function setupActionButtons() {
  const btnTractor = document.getElementById('btnImportTractor');
  if (btnTractor) {
    btnTractor.addEventListener('click', async () => {
      showToast('Importando dados da pasta do Trator Massey (Usina G5)...');
      try {
        const res = await fetch('/api/import-tractor-folder', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Falha ao importar pasta do trator');
        showToast(data.message);
        await loadData();
      } catch (err) {
        showToast('Erro: ' + err.message, 'error');
      }
    });
  }
}

async function clearAllData() {
  if (!confirm('Deseja realmente limpar todas as operações do mapa e da base?')) return;
  try {
    const res = await fetch('/api/operations', { method: 'DELETE' });
    const data = await res.json();
    showToast(data.message);
    await loadData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteOperation(uuid) {
  if (!confirm('Deseja excluir permanentemente esta operação?')) return;
  try {
    const res = await fetch(`/api/operations/${uuid}`, { method: 'DELETE' });
    const data = await res.json();
    showToast(data.message);
    await loadData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =========================================================================
// EXPORTAÇÕES (CSV & GeoJSON)
// =========================================================================
function exportCSV() {
  if (filteredOperations.length === 0) {
    showToast('Nenhuma operação para exportar.', 'error');
    return;
  }

  let csv = 'Data,Fazenda,Talhoes,Operacao,Tipo,Maquina_Trator,Piloto_NAV900,Implemento,Area_ha,Taxa,Insumo_Total,Faixa_m,Monitor,UUID\n';
  filteredOperations.forEach(op => {
    const fields = (op.detected_fields && op.detected_fields.length > 0) ? op.detected_fields.join(' - ') : op.field_name;
    csv += `"${op.operation_date || ''}","${op.farm_name || ''}","${fields || ''}","${op.clean_name || ''}","${op.operation_type || ''}","${op.vehicle_name || 'Massey Ferguson 7318'}","${op.controller_name || 'Trimble NAV-900'}","${op.implement_name || 'Espalhadeira'}","${op.area_ha || ''}","${op.applied_rate || ''}","${op.total_applied || ''}","${op.swath_width_m || ''}","${op.device_serial || ''}","${op.uuid || ''}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Trimble_TMX_Operacoes_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  showToast('Planilha CSV gerada com sucesso!');
}

function exportMergedGeoJSON() {
  const features = [];
  filteredOperations.forEach(op => {
    if (op.geojson_geometry && op.geojson_geometry.features) {
      op.geojson_geometry.features.forEach(feat => {
        features.push({
          ...feat,
          properties: {
            ...feat.properties,
            uuid: op.uuid,
            operation_name: op.clean_name,
            operation_type: op.operation_type,
            farm_name: op.farm_name,
            field_name: op.field_name,
            vehicle: op.vehicle_name || 'Massey Ferguson 7318',
            controller: op.controller_name || 'Trimble NAV-900',
            device_serial: op.device_serial,
            area_ha: op.area_ha,
            applied_rate: op.applied_rate
          }
        });
      });
    }
  });

  const geojson = {
    type: 'FeatureCollection',
    features: features
  };

  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Trimble_TMX_Camadas_GIS_${new Date().toISOString().slice(0, 10)}.geojson`;
  a.click();
  showToast('GeoJSON unificado exportado com sucesso!');
}

// =========================================================================
// MODAL DE INSPEÇÃO manifest.xml
// =========================================================================
async function openDetailModal(uuid) {
  const modal = document.getElementById('detailModal');
  if (!modal) return;
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/operations/${uuid}`);
    if (!res.ok) throw new Error('Operação não encontrada');
    const op = await res.json();
    currentDetailOp = op;

    document.getElementById('modalOpTitle').innerText = op.clean_name;
    const tag = document.getElementById('modalOpTag');
    tag.innerText = op.operation_type;
    tag.className = `tag-type ${getTypeClass(op.operation_type)}`;

    document.getElementById('modalUuid').innerText = op.uuid;
    document.getElementById('modalRawName').innerText = op.raw_name;
    document.getElementById('modalFarm').innerText = op.farm_name;
    document.getElementById('modalFields').innerText = (op.detected_fields && op.detected_fields.length > 0) ? op.detected_fields.join(', ') : op.field_name;
    document.getElementById('modalArea').innerText = `${op.area_ha} ha (${op.applied_rate})`;

    document.getElementById('modalProduct').innerText = `${op.device_product || 'TMX-2050'} | ${op.vehicle_name || 'Massey Ferguson 7318'}`;
    document.getElementById('modalSerial').innerText = `S/N: ${op.device_serial} | Piloto: ${op.controller_name || 'NAV-900'}`;
    document.getElementById('modalKeyVer').innerText = op.crypto_key_version || '0';
    document.getElementById('modalIv').innerText = op.crypto_iv || '5D786F35119632100E2DD39044A809BA';

    const entriesBox = document.getElementById('modalEntries');
    if (entriesBox) {
      entriesBox.innerHTML = (op.payload_files || []).map(f => `<div style="font-family:var(--font-mono); font-size:0.75rem; color:#38bdf8; background:rgba(56,189,248,0.1); padding:2px 6px; border-radius:4px; margin-top:2px;">${escapeHtml(f)}</div>`).join('');
    }

    document.getElementById('modalXmlCode').innerText = op.manifest_xml_raw || 'manifest.xml não disponível.';
  } catch (err) {
    showToast(err.message, 'error');
    closeDetailModal();
  }
}

function closeDetailModal() {
  const modal = document.getElementById('detailModal');
  if (modal) modal.style.display = 'none';
  currentDetailOp = null;
}

function copyModalXml() {
  const text = document.getElementById('modalXmlCode').innerText;
  navigator.clipboard.writeText(text);
  showToast('XML copiado para a área de transferência!');
}

async function deleteCurrentModalOp() {
  if (!currentDetailOp) return;
  await deleteOperation(currentDetailOp.uuid);
  closeDetailModal();
}

// =========================================================================
// UTILITÁRIOS (TOAST & ESCAPE)
// =========================================================================
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerText = msg;
  t.style.background = (type === 'error') ? 'rgba(239, 68, 68, 0.95)' : 'rgba(16, 185, 129, 0.95)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =========================================================================
// TALHÕES CADASTRAIS DO SIG (857 TALHÕES - MAPA VEREDAS)
// =========================================================================
let allFarmFields = [];
let filteredFarmFields = [];
let cadastralFieldsLayerGroup = L.featureGroup().addTo(map);
let fieldPolygonMap = {};
let currentTableTab = 'operations';
let activeFieldHighlight = null;

const FARM_PALETTE = {
  "Fazenda Palmeiras": "#10b981",
  "Fazenda Ouro Verde": "#f59e0b",
  "Fazenda Tapera": "#06b6d4",
  "Fazenda Tapera II": "#0ea5e9",
  "Fazenda Tapera III": "#38bdf8",
  "Fazenda Noroeste": "#a855f7",
  "Fazenda Dona Inês": "#ec4899",
  "Fazenda São Roque": "#f43f5e",
  "Fazenda Cana Verde": "#84cc16",
  "Fazenda Vó Lúcia": "#eab308",
  "Fazenda Capão da Lage": "#6366f1",
  "Fazenda Cascalho Rico": "#14b8a6",
  "Fazenda Cláudio Leite": "#d946ef",
  "Fazenda Itatiaia": "#f97316",
  "Fazenda Marcos Bli": "#8b5cf6",
  "Fazenda Paulo Falabella": "#059669",
  "Fazenda Pé do Morro": "#ca8a04",
  "Fazenda Santa Luzia": "#4f46e5",
  "Fazenda São Paulo": "#0284c7",
  "Fazenda Vicente Cabri": "#9333ea"
};

function getFarmColor(farmName) {
  if (farmName && FARM_PALETTE[farmName]) return FARM_PALETTE[farmName];
  let hash = 0;
  const s = farmName || '';
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 55%)`;
}

function switchTableTab(tabName) {
  currentTableTab = tabName;
  const btnOps = document.getElementById('tabBtnOperations');
  const btnFields = document.getElementById('tabBtnFields');
  const filtersOps = document.getElementById('panelFiltersOperations');
  const filtersFields = document.getElementById('panelFiltersFields');
  const tableOps = document.getElementById('operationsTable');
  const tableFields = document.getElementById('farmFieldsTable');
  const lblCount = document.getElementById('lblCount');

  if (tabName === 'operations') {
    if (btnOps) btnOps.classList.add('active');
    if (btnFields) btnFields.classList.remove('active');
    if (filtersOps) filtersOps.style.display = 'flex';
    if (filtersFields) filtersFields.style.display = 'none';
    if (tableOps) tableOps.style.display = '';
    if (tableFields) tableFields.style.display = 'none';
    if (lblCount) {
      lblCount.style.display = '';
      lblCount.innerText = `(${filteredOperations.length} operações)`;
    }
  } else {
    if (btnFields) btnFields.classList.add('active');
    if (btnOps) btnOps.classList.remove('active');
    if (filtersFields) filtersFields.style.display = 'flex';
    if (filtersOps) filtersOps.style.display = 'none';
    if (tableFields) tableFields.style.display = '';
    if (tableOps) tableOps.style.display = 'none';
    if (lblCount) lblCount.style.display = 'none';

    if (allFarmFields.length === 0) {
      loadFarmFields();
    } else {
      renderFarmFieldsTable();
    }
  }
  if (window.lucide) lucide.createIcons();
}

async function loadFarmFields() {
  try {
    const res = await fetch('/api/farm-fields?limit=2000');
    if (!res.ok) throw new Error('Falha ao obter talhões do SIG');
    const data = await res.json();
    allFarmFields = data.fields || [];
    filteredFarmFields = [...allFarmFields];

    const badge = document.getElementById('badgeFieldsCount');
    if (badge) badge.innerText = allFarmFields.length;

    const kpiF = document.getElementById('kpiFields');
    if (kpiF) {
      kpiF.innerText = `${allFarmFields.length} (SIG) / ${operations.length} (Ops)`;
    }

    const selFarm = document.getElementById('selFieldFarm');
    if (selFarm) {
      selFarm.innerHTML = `<option value="">Todas as Fazendas (${data.farms ? data.farms.length : 20})</option>`;
      const farmCounts = {};
      allFarmFields.forEach(f => {
        farmCounts[f.farm_name] = (farmCounts[f.farm_name] || 0) + 1;
      });
      (data.farms || []).forEach(fName => {
        const opt = document.createElement('option');
        opt.value = fName;
        opt.innerText = `${fName} (${farmCounts[fName] || 0})`;
        selFarm.appendChild(opt);
      });
    }

    const selVariety = document.getElementById('selFieldVariety');
    if (selVariety) {
      selVariety.innerHTML = `<option value="">Todas as Variedades (${data.varieties ? data.varieties.length : 35})</option>`;
      (data.varieties || []).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.innerText = v;
        selVariety.appendChild(opt);
      });
    }

    renderFarmFieldsTable();
  } catch (err) {
    console.error('Erro ao carregar talhões:', err);
  }
}

async function loadCadastralFieldsGeoJSON() {
  try {
    const res = await fetch('/api/farm-fields/geojson');
    if (!res.ok) throw new Error('Falha ao obter GeoJSON');
    const geoData = await res.json();
    cadastralFieldsLayerGroup.clearLayers();
    fieldPolygonMap = {};

    (geoData.features || []).forEach(feat => {
      const props = feat.properties || {};
      const fColor = getFarmColor(props.farm);

      const layer = L.geoJSON(feat, {
        style: {
          color: fColor,
          weight: 1.5,
          opacity: 0.85,
          fillColor: fColor,
          fillOpacity: 0.18
        },
        onEachFeature: (feature, l) => {
          l.bindTooltip(`
            <div style="font-family:var(--font-sans); font-size:11px; line-height:1.4;">
              <strong style="color:${fColor};">${escapeHtml(props.farm)}</strong><br>
              <strong>Talhão ${escapeHtml(props.talhao)}</strong> ${props.desc ? `(${escapeHtml(props.desc)})` : ''}<br>
              🌱 Variedade: <strong>${escapeHtml(props.variety || '-')}</strong> | Ano: ${escapeHtml(props.planting_year || '-')}<br>
              📐 Área: <strong style="color:#10b981;">${props.area_ha} ha</strong><br>
              ${props.has_ops ? `<span style="color:#f59e0b; font-weight:700;">🚜 ${props.ops_count} Operação(ões) Trimble</span>` : ''}
            </div>
          `, { sticky: true });

          const opsHtml = props.has_ops
            ? `<div style="margin-top:8px; padding-top:6px; border-top:1px solid #2c3f58;">
                 <span style="color:#f59e0b; font-weight:700; font-size:11px;">🚜 Operações de Máquina Vinculadas:</span>
                 <ul style="margin:4px 0 0 16px; padding:0; font-size:11px; color:#e2e8f0;">
                   ${(props.ops_names || []).map(n => `<li>${escapeHtml(n)}</li>`).join('')}
                 </ul>
               </div>`
            : '';

          l.bindPopup(`
            <div style="font-family:var(--font-sans); min-width:230px; font-size:12px; color:#f8fafc;">
              <div style="padding-bottom:6px; border-bottom:1px solid #2c3f58; margin-bottom:8px;">
                <span class="farm-badge" style="background:${fColor}25; color:${fColor}; border-color:${fColor}55;">${escapeHtml(props.farm)}</span>
                <h4 style="margin:6px 0 0 0; color:#fff; font-size:14px; font-weight:700;">Talhão ${escapeHtml(props.talhao)}</h4>
                ${props.desc ? `<div style="font-size:11px; color:#94a3b8;">${escapeHtml(props.desc)}</div>` : ''}
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:11px; margin-bottom:8px;">
                <div><span style="color:#94a3b8;">Zona:</span> <b>${escapeHtml(props.zone || '-')}</b></div>
                <div><span style="color:#94a3b8;">Área:</span> <b style="color:#10b981;">${props.area_ha} ha</b></div>
                <div><span style="color:#94a3b8;">Variedade:</span> <b>${escapeHtml(props.variety || '-')}</b></div>
                <div><span style="color:#94a3b8;">Plantio:</span> <b>${escapeHtml(props.planting_year || '-')}</b></div>
              </div>
              ${opsHtml}
              <div style="display:flex; gap:6px; margin-top:10px;">
                <button class="btn btn-outline" style="padding:4px 8px; font-size:11px; flex:1;" onclick="zoomToFarmField('${props.id}')">
                  🔍 Focar
                </button>
                ${props.has_ops ? `
                  <button class="btn btn-primary" style="padding:4px 8px; font-size:11px; flex:1;" onclick="filterOpsForField('${escapeHtml(props.farm)}', '${escapeHtml(props.talhao)}')">
                    🚜 Ver Operações
                  </button>
                ` : ''}
              </div>
            </div>
          `);

          l.on('mouseover', () => {
            l.setStyle({ weight: 3, fillOpacity: 0.45 });
          });
          l.on('mouseout', () => {
            if (activeFieldHighlight !== l) {
              l.setStyle({ weight: 1.5, fillOpacity: 0.18 });
            }
          });
        }
      });

      cadastralFieldsLayerGroup.addLayer(layer);
      if (props.id) {
        fieldPolygonMap[props.id] = layer;
      }
    });

  } catch (err) {
    console.error('Erro ao carregar GeoJSON dos talhões:', err);
  }
}

function renderFarmFieldsTable() {
  const tbody = document.getElementById('farmFieldsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let totalHa = 0;
  filteredFarmFields.forEach((f, idx) => {
    totalHa += parseFloat(f.area_ha || 0);
    const tr = document.createElement('tr');
    tr.id = `field-row-${f.id}`;

    const fColor = getFarmColor(f.farm_name);
    const opsCount = f.operations_count || 0;
    const opsHtml = opsCount > 0
      ? `<button class="ops-badge-link" onclick="filterOpsForField('${escapeHtml(f.farm_name)}', '${escapeHtml(f.field_number)}')" title="Ver as ${opsCount} operação(ões) Trimble deste talhão">
           🚜 ${opsCount} Op (${(f.operations || []).map(o => o.type).join(', ')})
         </button>`
      : `<span style="color:#64748b; font-size:0.72rem;">-</span>`;

    tr.innerHTML = `
      <td style="text-align: center; color: #64748b; font-size: 0.7rem;">${idx + 1}</td>
      <td>
        <span class="farm-badge" style="background:${fColor}25; color:${fColor}; border-color:${fColor}55;">
          ${escapeHtml(f.farm_name)}
        </span>
      </td>
      <td style="color:#38bdf8;">${escapeHtml(f.zone || '-')}</td>
      <td style="font-weight:700; color:#fff; font-size:0.85rem;">Talhão ${escapeHtml(f.field_number)}</td>
      <td style="color:var(--text-muted); font-size:0.73rem;">${escapeHtml(f.field_desc || '-')}</td>
      <td>
        <span class="variety-pill">${escapeHtml(f.variety || 'Não inf.')}</span>
      </td>
      <td style="text-align:center; color:#94a3b8; font-size:0.75rem;">${escapeHtml(f.planting_year || '-')}</td>
      <td style="text-align:right; font-weight:700; color:#10b981; font-size:0.82rem;">${f.area_ha} ha</td>
      <td style="text-align:center;">${opsHtml}</td>
      <td style="text-align:center;">
        <button class="btn btn-outline" style="padding:2px 8px; font-size:0.7rem; color:#38bdf8; border-color:rgba(56,189,248,0.4);" onclick="zoomToFarmField('${f.id}')" title="Localizar e ver no mapa">
          <i data-lucide="map-pin" style="width:12px; height:12px;"></i> Ver no Mapa
        </button>
      </td>
    `;

    tr.addEventListener('click', (e) => {
      if (!e.target.closest('button')) {
        zoomToFarmField(f.id);
      }
    });

    tbody.appendChild(tr);
  });

  const lblCount = document.getElementById('lblFieldsTableCount');
  if (lblCount) {
    lblCount.innerText = `${filteredFarmFields.length} talhões | ${totalHa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
  }

  if (window.lucide) lucide.createIcons();
}

function applyFarmFieldFilters() {
  const farm = (document.getElementById('selFieldFarm')?.value || '').toLowerCase();
  const variety = (document.getElementById('selFieldVariety')?.value || '').toLowerCase();
  const opsFilter = document.getElementById('selFieldOpsOnly')?.value || '';
  const search = (document.getElementById('txtFieldSearch')?.value || '').toLowerCase().trim();

  filteredFarmFields = allFarmFields.filter(f => {
    if (farm && (f.farm_name || '').toLowerCase() !== farm) return false;
    if (variety && (f.variety || '').toLowerCase() !== variety) return false;
    if (opsFilter === 'with_ops' && !f.has_operations) return false;
    if (opsFilter === 'no_ops' && f.has_operations) return false;
    if (search) {
      const matchTalhao = (f.field_number || '').toLowerCase().includes(search);
      const matchDesc = (f.field_desc || '').toLowerCase().includes(search);
      const matchFarm = (f.farm_name || '').toLowerCase().includes(search);
      const matchVar = (f.variety || '').toLowerCase().includes(search);
      if (!matchTalhao && !matchDesc && !matchFarm && !matchVar) return false;
    }
    return true;
  });

  renderFarmFieldsTable();
}

function zoomToFarmField(fieldId) {
  const f = allFarmFields.find(x => x.id === fieldId);
  const layer = fieldPolygonMap[fieldId];

  document.querySelectorAll('#farmFieldsTableBody tr').forEach(r => r.classList.remove('active'));
  const tr = document.getElementById(`field-row-${fieldId}`);
  if (tr) {
    tr.classList.add('active');
    tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const chk = document.getElementById('chkCadastralFields');
  if (chk && !chk.checked) {
    chk.checked = true;
    toggleCadastralFieldsVisibility();
  }

  if (layer) {
    if (activeFieldHighlight && activeFieldHighlight !== layer) {
      activeFieldHighlight.setStyle({ weight: 1.5, fillOpacity: 0.18 });
    }
    activeFieldHighlight = layer;
    layer.setStyle({ weight: 4, fillOpacity: 0.55 });

    const bounds = layer.getBounds();
    map.fitBounds(bounds, { maxZoom: 16, padding: [60, 60] });
    layer.openPopup();
  } else if (f && f.bbox) {
    const [minLon, minLat, maxLon, maxLat] = f.bbox;
    map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { maxZoom: 16, padding: [60, 60] });
  }
}

function toggleCadastralFieldsVisibility() {
  const chk = document.getElementById('chkCadastralFields');
  if (!chk) return;
  if (chk.checked) {
    if (!map.hasLayer(cadastralFieldsLayerGroup)) {
      map.addLayer(cadastralFieldsLayerGroup);
    }
  } else {
    if (map.hasLayer(cadastralFieldsLayerGroup)) {
      map.removeLayer(cadastralFieldsLayerGroup);
    }
  }
}

function filterOpsForField(farmName, talhaoNumber) {
  switchTableTab('operations');
  
  const selFarm = document.getElementById('selFarm');
  if (selFarm) {
    for (let i = 0; i < selFarm.options.length; i++) {
      const optVal = selFarm.options[i].value.toLowerCase();
      const fn = farmName.toLowerCase();
      if (optVal && (fn.includes(optVal) || optVal.includes(fn))) {
        selFarm.selectedIndex = i;
        break;
      }
    }
  }

  const txtSearch = document.getElementById('txtSearch');
  if (txtSearch) {
    txtSearch.value = talhaoNumber;
  }

  applyFilters();
  showToast(`Filtrando operações da ${farmName} para o Talhão ${talhaoNumber}`);
}
