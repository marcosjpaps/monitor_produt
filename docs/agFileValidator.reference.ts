/**
 * agFileValidator.ts
 * Módulo de Validação e Identificação de Arquivos de Telemetria e Aplicação Agrícola
 * Marcas suportadas: John Deere, Stara, Case IH, Jacto e Trimble
 *
 * Dependência necessária no projeto:
 * npm install jszip
 */

import JSZip from 'jszip';

export type BrandName =
  | 'JOHN_DEERE'
  | 'STARA'
  | 'CASE_IH'
  | 'JACTO'
  | 'TRIMBLE'
  | 'GENERIC_AG'
  | 'UNKNOWN';

export type FileContainerFormat =
  | 'SHAPEFILE_ZIP'
  | 'ISOXML_ZIP'
  | 'JACTO_CSV'
  | 'PROPRIETARY_RAW'
  | 'KML_VISUAL_ONLY'
  | 'INVALID_FORMAT';

export type OperationFileType =
  | 'AS_APPLIED_COVERAGE' // Arquivo válido: Rastro + Aplicação Realizada
  | 'PRESCRIPTION_RX'     // Erro: Mapa de Prescrição (apenas dose alvo, sem telemetria)
  | 'BOUNDARY_ONLY'       // Erro: Apenas limite/bordadura de talhão
  | 'GUIDANCE_AB_LINE'    // Erro: Apenas linha guia AB / pista
  | 'RAW_PROPRIETARY'     // Erro: Arquivo bruto de monitor (.cn1, .jdl, .fdd, .otm, AgGPS)
  | 'KML_NO_TELEMETRY'    // Erro: Arquivo KML/KMZ (perde atributos de aplicação)
  | 'INCOMPLETE_PACKAGE'  // Erro: Shapefile/ISOXML faltando arquivos obrigatórios
  | 'CORRUPTED_OR_EMPTY'; // Erro: Arquivo vazio, geometria nula ou fora de projeção

export interface MappedColumns {
  appliedRate: string | null;
  targetRate: string | null;
  speed: string | null;
  swathWidth: string | null;
  timestamp: string | null;
  elevation: string | null;
  product: string | null;
}

export interface ValidatedShapefileLayer {
  baseName: string;
  shapeType: string;
  recordCount: number;
  isWgs84Compatible: boolean;
  bbox: [number, number, number, number]; // [xmin, ymin, xmax, ymax]
  rawColumns: string[];
  mappedColumns: MappedColumns;
  layerClassification: OperationFileType;
}

export interface AgValidationResult {
  isValid: boolean;
  detectedBrand: BrandName;
  containerFormat: FileContainerFormat;
  operationType: OperationFileType;
  validLayers: ValidatedShapefileLayer[];
  ignoredLayers: { baseName: string; reason: string }[];
  missingFiles: string[];
  warnings: string[];
  errorMessage: string | null;
}

/**
 * Dicionário de Colunas DBF (respeitando o truncamento de 10 caracteres do padrão dBASE III)
 * e variações conhecidas em Português/Inglês das 5 marcas.
 */
const COLUMN_DICTIONARY = {
  appliedRate: [
    // John Deere
    'APPLIEDRAT', 'VRT_RATE', 'CTRLRATE', 'APPRATE', 'RATE_APPLI',
    // Stara (Topper 4500/5500)
    'TAXA_APLIC', 'DOSE_APLIC', 'TAXAAPLIC', 'DOSEAPLIC', 'TX_APLIC',
    // Case IH (AFS)
    'RATE_APP', 'RATEAPPLI', 'FLOW', 'PRODFLOW', 'LIQ_RATE',
    // Jacto (Otmis / Next)
    'TAXA_APL', 'VOL_APLIC', 'VAZAO', 'DOSE_REAL', 'TAXA_REAL',
    // Trimble (AgGPS / GFX)
    'APPLDRATE', 'ACTRATE', 'ACTUALRATE', 'LOGGEDRATE',
  ],
  targetRate: [
    'TARGETRATE', 'TGTRATE', 'TARGETRAT', 'TARGRATE',
    'TAXA_ALVO', 'DOSE_ALVO', 'TAXAALVO', 'DOSEALVO', 'TX_ALVO',
    'RXRATE', 'PRESCRATE', 'TAXA_PRESC', 'DOSE_PRESC',
  ],
  speed: [
    'SPEED', 'VEHICLSPEE', 'GROUNDSPD', 'PASSSPEED', 'GPSSPEED', 'SPD',
    'VELOCIDADE', 'VELOC', 'VEL', 'VEL_KMH', 'VEL_ATUAL',
  ],
  swathWidth: [
    'SWATHWIDTH', 'SWATH', 'WIDTH', 'IMPLWIDTH', 'IMPLEMENTW', 'LOGGEDSWAT', 'DISTANCE',
    'LARGURA', 'LARG_FAIXA', 'FAIXA', 'LARG_TRAB', 'SECOES', 'LARG_SECAO',
  ],
  timestamp: [
    'TIME', 'ISOTIME', 'TIMESTAMP', 'UTCTIME', 'LOCALTIME', 'DATETIME',
    'DATA_HORA', 'DATAHORA', 'HORA', 'DT_HR', 'DATE',
  ],
  elevation: [
    'ELEVATION', 'ALTITUDE', 'ALT', 'ELEV', 'HEIGHT', 'Z',
  ],
  product: [
    'PRODUCT', 'PROD_NAME', 'TANKMIX', 'PRODUTO', 'INSUMO', 'VARIETY',
  ],
};

/**
 * Assinaturas exclusivas de colunas e arquivos para identificar a marca automaticamente
 */
const BRAND_SIGNATURES: Record<Exclude<BrandName, 'GENERIC_AG' | 'UNKNOWN'>, {
  columns: string[];
  filePatterns: RegExp[];
}> = {
  JOHN_DEERE: {
    columns: ['VEHICLSPEE', 'ISOTIME', 'VRT_RATE', 'SWATHWIDTH', 'TANKMIX'],
    filePatterns: [/deere/i, /metadata\.json$/i, /^rcd/i, /gs3_2630/i, /gen4/i, /\.jdl$/i, /\.fdd$/i],
  },
  STARA: {
    columns: ['TAXA_APLIC', 'TAXA_ALVO', 'VELOCIDADE', 'LARGURA', 'ALT'],
    filePatterns: [/topper/i, /stara/i, /trabalho/i, /bordadura/i, /linha_ab/i],
  },
  CASE_IH: {
    columns: ['APPRATE', 'TGTRATE', 'GROUNDSPD', 'IMPLWIDTH', 'PRODFLOW'],
    filePatterns: [/\.cn1/i, /index\.vy1/i, /afs/i, /case/i],
  },
  JACTO: {
    columns: ['DOSE_APLIC', 'VOL_APLIC', 'LARG_FAIXA', 'VAZAO', 'SECOES'],
    filePatterns: [/otmis/i, /jacto/i, /\.otm$/i, /omni/i],
  },
  TRIMBLE: {
    columns: ['APPLDRATE', 'PASSSPEED', 'LOGGEDSWAT', 'IMPLEMENTW', 'UTCTIME'],
    filePatterns: [/aggps/i, /trimble/i, /\.swath$/i, /\.agdata$/i, /\.ehm$/i, /\.pos$/i],
  },
};

/**
 * Nomes de arquivos que indicam Linha Guia (AB) ou Limite (Boundary) para descarte imediato
 */
const BOUNDARY_FILE_REGEX = /(^|\/|\\)(limite|bordadura|boundary|boundaries|perimetro|border|talhao_lim)/i;
const GUIDANCE_FILE_REGEX = /(^|\/|\\)(linha_ab|linhaab|abline|ab_line|guidance|guia|swathline|pista|rastro_guia)/i;

/**
 * Função Principal: Valida o arquivo enviado no upload antes de enviar para o mapa
 */
export async function validateAgUploadFile(file: File): Promise<AgValidationResult> {
  const fileName = file.name.toLowerCase();
  const warnings: string[] = [];

  // 1. Bloqueio imediato de KML / KMZ (Comum na Jacto Otmis / Google Earth)
  if (fileName.endsWith('.kml') || fileName.endsWith('.kmz')) {
    return {
      isValid: false,
      detectedBrand: 'JACTO',
      containerFormat: 'KML_VISUAL_ONLY',
      operationType: 'KML_NO_TELEMETRY',
      validLayers: [],
      ignoredLayers: [],
      missingFiles: ['.shp', '.shx', '.dbf'],
      warnings: [],
      errorMessage:
        'Arquivos KML/KMZ contêm apenas o desenho visual do rastro e perdem os dados ponto a ponto de Taxa Aplicada, Velocidade e Seção. Exporte o arquivo em formato Shapefile (.zip) no Jacto Next / Otmis Maps.',
    };
  }

  // 2. Bloqueio de extensões proprietárias brutas soltas (.jdl, .fdd, .otm, .vy1, .agdata)
  if (/\.(jdl|fdd|vy1|cn1|otm|agdata|swath|ehm|pos)$/i.test(fileName)) {
    const detected = detectBrandFromFileNames([fileName], []);
    return {
      isValid: false,
      detectedBrand: detected,
      containerFormat: 'PROPRIETARY_RAW',
      operationType: 'RAW_PROPRIETARY',
      validLayers: [],
      ignoredLayers: [],
      missingFiles: [],
      warnings: [],
      errorMessage: getProprietaryErrorMessage(detected, fileName),
    };
  }

  // 3. Bloqueio de arquivo .shp solto (usuário esqueceu de zipar com .dbf e .shx)
  if (fileName.endsWith('.shp') || fileName.endsWith('.dbf') || fileName.endsWith('.shx')) {
    return {
      isValid: false,
      detectedBrand: 'UNKNOWN',
      containerFormat: 'INVALID_FORMAT',
      operationType: 'INCOMPLETE_PACKAGE',
      validLayers: [],
      ignoredLayers: [],
      missingFiles: ['.shp', '.shx', '.dbf (compactados juntos em um único .zip)'],
      warnings: [],
      errorMessage:
        'Você enviou um arquivo isolado do Shapefile. Compacte os arquivos .shp, .shx, .dbf e .prj juntos em um único arquivo .zip antes de importar.',
    };
  }

  // 4. Validação de CSV estruturado (Ex: exportação tabular Jacto Otmis)
  if (fileName.endsWith('.csv')) {
    return await validateCsvFile(file);
  }

  // 5. Validação de pacote .ZIP (Shapefile, ISOXML ou pasta de pen drive zipada)
  if (fileName.endsWith('.zip')) {
    return await validateZipPackage(file, warnings);
  }

  return {
    isValid: false,
    detectedBrand: 'UNKNOWN',
    containerFormat: 'INVALID_FORMAT',
    operationType: 'CORRUPTED_OR_EMPTY',
    validLayers: [],
    ignoredLayers: [],
    missingFiles: [],
    warnings: [],
    errorMessage: `Formato de arquivo não suportado (${file.name}). Envie um pacote .zip contendo Shapefile (.shp, .shx, .dbf) ou ISOXML (TASKDATA.XML).`,
  };
}

/**
 * Inspeciona o interior do pacote .ZIP sem precisar extrair tudo na memória
 */
async function validateZipPackage(file: File, warnings: string[]): Promise<AgValidationResult> {
  let zip: JSZip;
  try {
    const arrayBuffer = await file.arrayBuffer();
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    return {
      isValid: false,
      detectedBrand: 'UNKNOWN',
      containerFormat: 'INVALID_FORMAT',
      operationType: 'CORRUPTED_OR_EMPTY',
      validLayers: [],
      ignoredLayers: [],
      missingFiles: [],
      warnings: [],
      errorMessage: 'O arquivo .zip está corrompido ou não pôde ser lido.',
    };
  }

  const allPaths = Object.keys(zip.files).filter((path) => !zip.files[path].dir && !path.includes('__MACOSX'));

  if (allPaths.length === 0) {
    return {
      isValid: false,
      detectedBrand: 'UNKNOWN',
      containerFormat: 'INVALID_FORMAT',
      operationType: 'CORRUPTED_OR_EMPTY',
      validLayers: [],
      ignoredLayers: [],
      missingFiles: [],
      warnings: [],
      errorMessage: 'O arquivo .zip enviado está vazio.',
    };
  }

  // Verifica se o usuário zipou uma pasta bruta proprietária (.cn1 da Case, RCD/JDL da John Deere, AgGPS da Trimble)
  const hasCaseCn1 = allPaths.some((p) => /\.cn1\//i.test(p) || /index\.vy1$/i.test(p));
  const hasJdRaw = allPaths.some((p) => /\.(jdl|fdd)$/i.test(p));
  const hasTrimbleRaw = allPaths.some((p) => /\.(agdata|ehm|swath)$/i.test(p)) && !allPaths.some((p) => /\.shp$/i.test(p));
  const hasJactoKmlOnly = allPaths.some((p) => /\.kml$/i.test(p)) && !allPaths.some((p) => /\.shp$/i.test(p));

  if (hasCaseCn1 || hasJdRaw || hasTrimbleRaw) {
    const brand: BrandName = hasCaseCn1 ? 'CASE_IH' : hasJdRaw ? 'JOHN_DEERE' : 'TRIMBLE';
    return {
      isValid: false,
      detectedBrand: brand,
      containerFormat: 'PROPRIETARY_RAW',
      operationType: 'RAW_PROPRIETARY',
      validLayers: [],
      ignoredLayers: [],
      missingFiles: [],
      warnings: [],
      errorMessage: getProprietaryErrorMessage(brand, file.name),
    };
  }

  if (hasJactoKmlOnly) {
    return {
      isValid: false,
      detectedBrand: 'JACTO',
      containerFormat: 'KML_VISUAL_ONLY',
      operationType: 'KML_NO_TELEMETRY',
      validLayers: [],
      ignoredLayers: [],
      missingFiles: ['.shp', '.shx', '.dbf'],
      warnings: [],
      errorMessage:
        'O pacote .zip contém apenas arquivos .KML (Google Earth), que não possuem dados de taxa de aplicação ou velocidade. Exporte em formato Shapefile.',
    };
  }

  // Verifica se é um pacote ISOXML (TASKDATA.XML)
  const taskDataPath = allPaths.find((p) => /(^|\/|\\)taskdata\.xml$/i.test(p));
  const shpPaths = allPaths.filter((p) => /\.shp$/i.test(p));

  if (taskDataPath && shpPaths.length === 0) {
    return await validateIsoXmlPackage(zip, taskDataPath, allPaths, warnings);
  }

  // Agrupa arquivos por nome base para validar Shapefiles (.shp, .shx, .dbf, .prj, .json)
  const baseGroups = new Map<string, {
    shp?: string;
    shx?: string;
    dbf?: string;
    prj?: string;
    json?: string;
  }>();

  for (const path of allPaths) {
    const match = path.match(/^(.*)\.(shp|shx|dbf|prj|json)$/i);
    if (!match) continue;
    const baseName = match[1];
    const ext = match[2].toLowerCase();

    // Se for o JSON de metadados da John Deere (ex: NomeArquivo-Deere-Metadata.json)
    if (ext === 'json' && /-deere-metadata$/i.test(baseName)) {
      const cleanBase = baseName.replace(/-deere-metadata$/i, '');
      const group = baseGroups.get(cleanBase) || {};
      group.json = path;
      baseGroups.set(cleanBase, group);
      continue;
    }

    const group = baseGroups.get(baseName) || {};
    if (ext === 'shp') group.shp = path;
    if (ext === 'shx') group.shx = path;
    if (ext === 'dbf') group.dbf = path;
    if (ext === 'prj') group.prj = path;
    if (ext === 'json') group.json = path;
    baseGroups.set(baseName, group);
  }

  const validLayers: ValidatedShapefileLayer[] = [];
  const ignoredLayers: { baseName: string; reason: string }[] = [];
  const missingFiles: string[] = [];
  const allDetectedColumns: string[] = [];

  for (const [baseName, files] of baseGroups.entries()) {
    // Ignora grupos que só tinham um .json avulso
    if (!files.shp && !files.dbf && !files.shx) continue;

    // 1. Filtra pelo nome se for claramente Bordadura ou Linha Guia (comum no Topper da Stara e Trimble)
    if (BOUNDARY_FILE_REGEX.test(baseName)) {
      ignoredLayers.push({
        baseName,
        reason: 'Arquivo identificado como Limite/Bordadura de talhão (sem aplicação).',
      });
      continue;
    }

    if (GUIDANCE_FILE_REGEX.test(baseName)) {
      ignoredLayers.push({
        baseName,
        reason: 'Arquivo identificado como Linha Guia AB / Pista (sem aplicação).',
      });
      continue;
    }

    // 2. Verifica a tríade obrigatória (.shp + .shx + .dbf)
    const missingForLayer: string[] = [];
    if (!files.shp) missingForLayer.push(`${baseName}.shp`);
    if (!files.shx) missingForLayer.push(`${baseName}.shx`);
    if (!files.dbf) missingForLayer.push(`${baseName}.dbf`);

    if (missingForLayer.length > 0) {
      missingFiles.push(...missingForLayer);
      ignoredLayers.push({
        baseName,
        reason: `Shapefile incompleto. Faltando: ${missingForLayer.join(', ')}`,
      });
      continue;
    }

    // 3. Lê o cabeçalho binário do .shp (100 bytes)
    const shpBuffer = await zip.file(files.shp!)!.async('uint8array');
    const shpHeader = parseShpHeader(shpBuffer);

    if (!shpHeader.isValid) {
      ignoredLayers.push({
        baseName,
        reason: shpHeader.errorReason || 'Cabeçalho .shp corrompido ou sem geometrias.',
      });
      continue;
    }

    // 4. Verifica projeção cartográfica (.prj) ou limites da Bounding Box
    let isWgs84 = shpHeader.isWgs84Bbox;
    if (files.prj) {
      const prjText = await zip.file(files.prj)!.async('string');
      if (/UTM|PROJCS/i.test(prjText) && !shpHeader.isWgs84Bbox) {
        isWgs84 = false;
        warnings.push(
          `A camada "${baseName}" está projetada em metros (UTM) e precisará de reprojeção para WGS84 (EPSG:4326) antes de desenhar no mapa.`
        );
      }
    } else {
      warnings.push(`Arquivo ${baseName}.prj ausente. Assumindo projeção WGS84 (Lat/Lon) pelo Bounding Box.`);
    }

    // 5. Lê o cabeçalho binário do .dbf (colunas e quantidade de registros)
    const dbfBuffer = await zip.file(files.dbf!)!.async('uint8array');
    const dbfInfo = parseDbfHeader(dbfBuffer);

    if (dbfInfo.recordCount === 0 || dbfInfo.columns.length === 0) {
      ignoredLayers.push({
        baseName,
        reason: 'Tabela de atributos (.dbf) está vazia (0 pontos gravados).',
      });
      continue;
    }

    allDetectedColumns.push(...dbfInfo.columns);

    // 6. Mapeia as colunas para o padrão do sistema
    const mappedColumns = mapDbfColumns(dbfInfo.columns);
    const layerClassification = classifyShapefileLayer(shpHeader.shapeType, mappedColumns, dbfInfo.columns);

    if (layerClassification === 'AS_APPLIED_COVERAGE') {
      validLayers.push({
        baseName,
        shapeType: shpHeader.shapeType,
        recordCount: dbfInfo.recordCount,
        isWgs84Compatible: isWgs84,
        bbox: shpHeader.bbox,
        rawColumns: dbfInfo.columns,
        mappedColumns,
        layerClassification,
      });
    } else {
      ignoredLayers.push({
        baseName,
        reason: getLayerRejectionReason(layerClassification, dbfInfo.columns),
      });
    }
  }

  const detectedBrand = detectBrandFromFileNames(allPaths, allDetectedColumns);

  // Se encontrou pelo menos 1 camada válida de trabalho/aplicação (mesmo que tenha ignorado limites/guias da Stara)
  if (validLayers.length > 0) {
    return {
      isValid: true,
      detectedBrand,
      containerFormat: 'SHAPEFILE_ZIP',
      operationType: 'AS_APPLIED_COVERAGE',
      validLayers,
      ignoredLayers,
      missingFiles,
      warnings,
      errorMessage: null,
    };
  }

  // Se não sobrou nenhuma camada válida, diagnostica o motivo exato para exibir ao usuário
  if (missingFiles.length > 0) {
    return {
      isValid: false,
      detectedBrand,
      containerFormat: 'SHAPEFILE_ZIP',
      operationType: 'INCOMPLETE_PACKAGE',
      validLayers: [],
      ignoredLayers,
      missingFiles,
      warnings,
      errorMessage: `O pacote Shapefile está incompleto. Arquivos ausentes: ${missingFiles.join(', ')}.`,
    };
  }

  const firstReason =
    ignoredLayers.length > 0
      ? ignoredLayers.map((l) => `${l.baseName}: ${l.reason}`).join(' | ')
      : 'Nenhum arquivo Shapefile (.shp/.dbf) válido foi encontrado dentro do .zip.';

  return {
    isValid: false,
    detectedBrand,
    containerFormat: 'SHAPEFILE_ZIP',
    operationType: determineDominantFailureType(ignoredLayers),
    validLayers: [],
    ignoredLayers,
    missingFiles: [],
    warnings,
    errorMessage: `Arquivo rejeitado na validação: ${firstReason}`,
  };
}

/**
 * Lê os primeiros 100 bytes do arquivo .SHP para validar Magic Bytes (9994),
 * Tipo de Geometria (Point, PolyLine, Polygon) e Bounding Box (WGS84 vs UTM).
 */
function parseShpHeader(buffer: Uint8Array): {
  isValid: boolean;
  shapeType: string;
  bbox: [number, number, number, number];
  isWgs84Bbox: boolean;
  errorReason?: string;
} {
  if (buffer.byteLength < 100) {
    return {
      isValid: false,
      shapeType: 'EMPTY',
      bbox: [0, 0, 0, 0],
      isWgs84Bbox: false,
      errorReason: 'Arquivo .shp possui menos de 100 bytes (vazio).',
    };
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Bytes 0-3 (Big Endian): Código oficial do formato Shapefile = 9994
  const fileCode = view.getInt32(0, false);
  if (fileCode !== 9994) {
    return {
      isValid: false,
      shapeType: 'INVALID',
      bbox: [0, 0, 0, 0],
      isWgs84Bbox: false,
      errorReason: 'Assinatura binária do .shp inválida (File Code != 9994).',
    };
  }

  // Bytes 24-27 (Big Endian): Tamanho total em words de 16 bits (50 words = 100 bytes = sem registros)
  const fileLengthWords = view.getInt32(24, false);
  if (fileLengthWords <= 50) {
    return {
      isValid: false,
      shapeType: 'EMPTY',
      bbox: [0, 0, 0, 0],
      isWgs84Bbox: false,
      errorReason: 'O arquivo .shp não contém nenhuma geometria gravada.',
    };
  }

  // Bytes 32-35 (Little Endian): Tipo de Geometria
  const shapeTypeCode = view.getInt32(32, true);
  const shapeTypeMap: Record<number, string> = {
    0: 'NullShape',
    1: 'Point',
    3: 'PolyLine',
    5: 'Polygon',
    8: 'MultiPoint',
    11: 'PointZ',
    13: 'PolyLineZ',
    15: 'PolygonZ',
    21: 'PointM',
    23: 'PolyLineM',
    25: 'PolygonM',
  };

  const shapeType = shapeTypeMap[shapeTypeCode] || `Unknown(${shapeTypeCode})`;
  if (shapeTypeCode === 0) {
    return {
      isValid: false,
      shapeType,
      bbox: [0, 0, 0, 0],
      isWgs84Bbox: false,
      errorReason: 'Tipo de geometria do .shp é NullShape.',
    };
  }

  // Bounding Box: xmin (36), ymin (44), xmax (52), ymax (60) - Float64 Little Endian
  const xmin = view.getFloat64(36, true);
  const ymin = view.getFloat64(44, true);
  const xmax = view.getFloat64(52, true);
  const ymax = view.getFloat64(60, true);

  // Verifica se as coordenadas estão dentro do intervalo geográfico Global / Brasil (WGS84 / SIRGAS 2000)
  const isWgs84Bbox =
    xmin >= -180 && xmax <= 180 && ymin >= -90 && ymax <= 90 && !(xmin === 0 && xmax === 0);

  return {
    isValid: true,
    shapeType,
    bbox: [xmin, ymin, xmax, ymax],
    isWgs84Bbox,
  };
}

/**
 * Lê o cabeçalho binário do arquivo .DBF (dBASE III/IV) para extrair
 * a contagem de pontos/polígonos e os nomes exatos das colunas (até 10 caracteres).
 */
function parseDbfHeader(buffer: Uint8Array): {
  recordCount: number;
  columns: string[];
} {
  if (buffer.byteLength < 32) {
    return { recordCount: 0, columns: [] };
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);

  const columns: string[] = [];
  let offset = 32;

  // Cada descritor de coluna possui 32 bytes; 0x0D marca o fim dos descritores
  while (offset + 32 <= headerLength && offset + 32 <= buffer.byteLength) {
    if (buffer[offset] === 0x0d) break;

    // Bytes 0 a 10 do descritor contêm o nome da coluna em ASCII (terminado em 0x00)
    const nameBytes = buffer.subarray(offset, offset + 11);
    let rawName = '';
    for (let i = 0; i < nameBytes.length; i++) {
      if (nameBytes[i] === 0) break;
      rawName += String.fromCharCode(nameBytes[i]);
    }

    const cleanName = rawName.trim();
    if (cleanName.length > 0) {
      columns.push(cleanName);
    }

    offset += 32;
  }

  return { recordCount, columns };
}

/**
 * Cruza as colunas encontradas no .DBF com o dicionário das 5 marcas
 */
function mapDbfColumns(rawColumns: string[]): MappedColumns {
  const upperMap = new Map<string, string>();
  for (const col of rawColumns) {
    upperMap.set(col.toUpperCase(), col);
  }

  const findMatch = (candidates: string[]): string | null => {
    for (const candidate of candidates) {
      if (upperMap.has(candidate)) {
        return upperMap.get(candidate)!;
      }
    }
    // Fallback por substring para cobrir variações customizadas de monitores
    for (const [upperCol, originalCol] of upperMap.entries()) {
      if (candidates.some((c) => upperCol.includes(c) || c.includes(upperCol) && upperCol.length >= 4)) {
        return originalCol;
      }
    }
    return null;
  };

  return {
    appliedRate: findMatch(COLUMN_DICTIONARY.appliedRate),
    targetRate: findMatch(COLUMN_DICTIONARY.targetRate),
    speed: findMatch(COLUMN_DICTIONARY.speed),
    swathWidth: findMatch(COLUMN_DICTIONARY.swathWidth),
    timestamp: findMatch(COLUMN_DICTIONARY.timestamp),
    elevation: findMatch(COLUMN_DICTIONARY.elevation),
    product: findMatch(COLUMN_DICTIONARY.product),
  };
}

/**
 * Classifica se a camada Shapefile é Aplicação Realizada, Prescrição (Rx), Linha AB ou Limite
 */
function classifyShapefileLayer(
  shapeType: string,
  mapped: MappedColumns,
  rawColumns: string[]
): OperationFileType {
  const hasAppliedRate = Boolean(mapped.appliedRate);
  const hasTargetRate = Boolean(mapped.targetRate);
  const hasSpeed = Boolean(mapped.speed);
  const hasSwath = Boolean(mapped.swathWidth);
  const hasTimestamp = Boolean(mapped.timestamp);

  // Regra 1: Possui Taxa Aplicada OU (Velocidade + Largura/Timestamp) -> Rastro de Cobertura / Aplicação válido
  if (hasAppliedRate || (hasSpeed && (hasSwath || hasTimestamp))) {
    return 'AS_APPLIED_COVERAGE';
  }

  // Regra 2: Possui APENAS Taxa Alvo (Dose Prescrita) e Polígono, sem Velocidade e sem Hora -> Mapa de Prescrição (Rx)
  if (hasTargetRate && !hasSpeed && !hasTimestamp && !hasAppliedRate) {
    return 'PRESCRIPTION_RX';
  }

  // Regra 3: Geometria de Linha (PolyLine) sem atributos de aplicação -> Linha Guia AB
  if (shapeType.startsWith('PolyLine')) {
    return 'GUIDANCE_AB_LINE';
  }

  // Regra 4: Polígono apenas com Área/Perímetro/ID/Fazenda -> Limite de Talhão (Boundary)
  const upperCols = rawColumns.map((c) => c.toUpperCase());
  const isOnlyBoundaryAttrs = upperCols.every((c) =>
    ['ID', 'OBJECTID', 'FID', 'AREA', 'HA', 'HECTARES', 'PERIMETER', 'FARM', 'FIELD', 'TALHAO', 'FAZENDA', 'CLIENT', 'NAME'].includes(c)
  );
  if (shapeType.startsWith('Polygon') && isOnlyBoundaryAttrs) {
    return 'BOUNDARY_ONLY';
  }

  return 'CORRUPTED_OR_EMPTY';
}

/**
 * Valida pacotes ISOXML (TASKDATA.XML) verificando se existem registros de TimeLog (TLG*.BIN / TLG*.XML)
 */
async function validateIsoXmlPackage(
  zip: JSZip,
  taskDataPath: string,
  allPaths: string[],
  warnings: string[]
): Promise<AgValidationResult> {
  const xmlText = await zip.file(taskDataPath)!.async('string');
  const tlgBins = allPaths.filter((p) => /(^|\/|\\)tlg[0-9a-z_]+\.bin$/i.test(p));

  let detectedBrand: BrandName = 'GENERIC_AG';
  if (/John Deere|GreenStar|GS3|Gen4/i.test(xmlText)) detectedBrand = 'JOHN_DEERE';
  else if (/Stara|Topper/i.test(xmlText)) detectedBrand = 'STARA';
  else if (/CNH|Case|AFS/i.test(xmlText)) detectedBrand = 'CASE_IH';
  else if (/Trimble|AgGPS/i.test(xmlText)) detectedBrand = 'TRIMBLE';
  else if (/Jacto|Otmis/i.test(xmlText)) detectedBrand = 'JACTO';

  // Se o TASKDATA.XML só tiver Limite (<PFD>) ou Linha Guia (<GPN>/<LSG>) e nenhum TimeLog (<TLG>)
  const hasTimeLogTag = /<TLG\b/i.test(xmlText);
  if (!hasTimeLogTag || tlgBins.length === 0) {
    const hasOnlyBoundaryOrGuidance = /<PFD\b|<GPN\b/i.test(xmlText);
    return {
      isValid: false,
      detectedBrand,
      containerFormat: 'ISOXML_ZIP',
      operationType: hasOnlyBoundaryOrGuidance ? 'BOUNDARY_ONLY' : 'INCOMPLETE_PACKAGE',
      validLayers: [],
      ignoredLayers: [],
      missingFiles: tlgBins.length === 0 ? ['TLG*.BIN (Arquivos binários de registro de aplicação)'] : [],
      warnings,
      errorMessage:
        'Este pacote ISOXML (TASKDATA.XML) não possui arquivos de rastro de aplicação (TLG*.BIN). Ele contém apenas cadastros de talhão, prescrição ou linhas guia.',
    };
  }

  return {
    isValid: true,
    detectedBrand,
    containerFormat: 'ISOXML_ZIP',
    operationType: 'AS_APPLIED_COVERAGE',
    validLayers: [
      {
        baseName: 'TASKDATA.XML',
        shapeType: 'ISOXML_TimeLog',
        recordCount: tlgBins.length,
        isWgs84Compatible: true,
        bbox: [0, 0, 0, 0],
        rawColumns: ['ISO_11783_TLG_BINARY'],
        mappedColumns: {
          appliedRate: 'DDI_0001_AppliedRate',
          targetRate: 'DDI_0002_TargetRate',
          speed: 'DDI_0148_Speed',
          swathWidth: 'DDI_0043_WorkingWidth',
          timestamp: 'TimeStart',
          elevation: 'PositionUp',
          product: 'ProductAllocation',
        },
        layerClassification: 'AS_APPLIED_COVERAGE',
      },
    ],
    ignoredLayers: [],
    missingFiles: [],
    warnings,
    errorMessage: null,
  };
}

/**
 * Valida arquivos CSV exportados (Ex: Jacto Otmis / Next) checando se há Lat/Lon + Dose/Velocidade
 */
async function validateCsvFile(file: File): Promise<AgValidationResult> {
  const slice = file.slice(0, 8192);
  const text = await slice.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return {
      isValid: false,
      detectedBrand: 'UNKNOWN',
      containerFormat: 'JACTO_CSV',
      operationType: 'CORRUPTED_OR_EMPTY',
      validLayers: [],
      ignoredLayers: [],
      missingFiles: [],
      warnings: [],
      errorMessage: 'O arquivo CSV está vazio ou não possui registros de operação.',
    };
  }

  const separator = lines[0].includes(';') ? ';' : ',';
  const rawColumns = lines[0].split(separator).map((c) => c.replace(/["']/g, '').trim());
  const upperCols = rawColumns.map((c) => c.toUpperCase());

  const hasLat = upperCols.some((c) => ['LAT', 'LATITUDE', 'Y', 'COORD_Y'].includes(c));
  const hasLon = upperCols.some((c) => ['LON', 'LONG', 'LONGITUDE', 'LNG', 'X', 'COORD_X'].includes(c));
  const mappedColumns = mapDbfColumns(rawColumns);

  if (!hasLat || !hasLon || (!mappedColumns.appliedRate && !mappedColumns.speed)) {
    return {
      isValid: false,
      detectedBrand: 'JACTO',
      containerFormat: 'JACTO_CSV',
      operationType: 'INCOMPLETE_PACKAGE',
      validLayers: [],
      ignoredLayers: [],
      missingFiles: [],
      warnings: [],
      errorMessage:
        'O arquivo CSV não contém as colunas obrigatórias de Coordenadas (Latitude/Longitude) e Aplicação (Taxa Aplicada / Velocidade).',
    };
  }

  return {
    isValid: true,
    detectedBrand: 'JACTO',
    containerFormat: 'JACTO_CSV',
    operationType: 'AS_APPLIED_COVERAGE',
    validLayers: [
      {
        baseName: file.name,
        shapeType: 'Point',
        recordCount: lines.length - 1,
        isWgs84Compatible: true,
        bbox: [0, 0, 0, 0],
        rawColumns,
        mappedColumns,
        layerClassification: 'AS_APPLIED_COVERAGE',
      },
    ],
    ignoredLayers: [],
    missingFiles: [],
    warnings: [],
    errorMessage: null,
  };
}

/**
 * Identifica de qual das 5 marcas o arquivo veio com base em nomes de arquivos e colunas DBF
 */
function detectBrandFromFileNames(filePaths: string[], columns: string[]): BrandName {
  const upperCols = new Set(columns.map((c) => c.toUpperCase()));
  const scores: Record<Exclude<BrandName, 'GENERIC_AG' | 'UNKNOWN'>, number> = {
    JOHN_DEERE: 0,
    STARA: 0,
    CASE_IH: 0,
    JACTO: 0,
    TRIMBLE: 0,
  };

  for (const [brand, sig] of Object.entries(BRAND_SIGNATURES) as [
    Exclude<BrandName, 'GENERIC_AG' | 'UNKNOWN'>,
    typeof BRAND_SIGNATURES['JOHN_DEERE']
  ][]) {
    for (const col of sig.columns) {
      if (upperCols.has(col)) scores[brand] += 3;
    }
    for (const path of filePaths) {
      if (sig.filePatterns.some((regex) => regex.test(path))) {
        scores[brand] += 4;
      }
    }
  }

  let bestBrand: BrandName = 'GENERIC_AG';
  let maxScore = 0;

  for (const [brand, score] of Object.entries(scores) as [BrandName, number][]) {
    if (score > maxScore) {
      maxScore = score;
      bestBrand = brand;
    }
  }

  return maxScore > 0 ? bestBrand : 'GENERIC_AG';
}

function getProprietaryErrorMessage(brand: BrandName, fileName: string): string {
  switch (brand) {
    case 'JOHN_DEERE':
      return `Arquivo bruto de monitor John Deere detectado (${fileName}). Exporte a operação no John Deere Operations Center como "Shapefile (.zip)" ou "ISOXML" antes de importar.`;
    case 'CASE_IH':
      return `Pasta proprietária Case IH (.cn1 / .vy1) detectada. Exporte a operação pelo portal AFS Connect ou monitor em formato "Shapefile (.zip)" ou "ISOXML".`;
    case 'TRIMBLE':
      return `Arquivo nativo Trimble AgGPS detectado (${fileName}). Exporte os dados de cobertura em formato "Shapefile (.zip)" ou "ISOXML".`;
    case 'JACTO':
      return `Arquivo nativo Otmis (${fileName}) detectado. Exporte a operação no Jacto Next / Otmis Maps como "Shapefile (.zip)".`;
    default:
      return `Formato proprietário bruto de monitor não suportado diretamente no navegador (${fileName}). Exporte em Shapefile (.zip) ou ISOXML.`;
  }
}

function getLayerRejectionReason(type: OperationFileType, rawColumns: string[]): string {
  switch (type) {
    case 'PRESCRIPTION_RX':
      return 'Este arquivo é um Mapa de Prescrição (Rx) contendo apenas Dose Alvo planejada, sem dados reais de aplicação ou velocidade.';
    case 'GUIDANCE_AB_LINE':
      return 'Este arquivo contém apenas Linhas Guia (AB) de piloto automático e não possui dados de aplicação.';
    case 'BOUNDARY_ONLY':
      return 'Este arquivo contém apenas o Limite/Bordadura do talhão e não possui rastro de aplicação.';
    default:
      return `Colunas de aplicação/velocidade não encontradas no .dbf (Colunas lidas: ${rawColumns.slice(0, 8).join(', ')}).`;
  }
}

function determineDominantFailureType(ignoredLayers: { baseName: string; reason: string }[]): OperationFileType {
  const reasons = ignoredLayers.map((l) => l.reason).join(' ');
  if (/Prescrição/i.test(reasons)) return 'PRESCRIPTION_RX';
  if (/Linha Guia/i.test(reasons)) return 'GUIDANCE_AB_LINE';
  if (/Limite|Bordadura/i.test(reasons)) return 'BOUNDARY_ONLY';
  return 'CORRUPTED_OR_EMPTY';
}