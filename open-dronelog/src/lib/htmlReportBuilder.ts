/**
 * HTML Report Builder
 *
 * Generates a self-contained, printable HTML flight report.
 * Flights are grouped by day with subtotals and a grand total.
 * Layout uses grouped cards per flight for A4 print readability.
 */

import type { Flight, FlightDataResponse, TelemetryData } from '@/types';
import type { WeatherData } from '@/lib/weather';
import {
  type UnitSystem,
  type UnitPreferences,
  type SpeedUnit,
  ensureAmPmUpperCase,
  formatDateDisplay,
  formatDateHeader as utilFormatDateHeader,
  isImperialSpeedUnit,
  speedMultiplierFromMs,
  speedUnitLabel,
} from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface HtmlReportFieldConfig {
  // General Info
  flightDateTime: boolean;
  flightName: boolean;
  duration: boolean;
  takeoffTime: boolean;
  landingTime: boolean;
  takeoffCoordinates: boolean;
  notes: boolean;

  // Equipment
  aircraftName: boolean;
  droneModel: boolean;
  droneSerial: boolean;
  batterySerial: boolean;

  // Flight Stats
  totalDistance: boolean;
  maxAltitude: boolean;
  maxSpeed: boolean;
  maxDistanceFromHome: boolean;

  // Battery
  takeoffBattery: boolean;
  landingBattery: boolean;
  batteryVoltage: boolean;
  batteryTemp: boolean;

  // Weather
  temperature: boolean;
  windSpeed: boolean;
  windGusts: boolean;
  humidity: boolean;
  cloudCover: boolean;
  precipitation: boolean;
  pressure: boolean;
  weatherCondition: boolean;

  // Media
  photoCount: boolean;
  videoCount: boolean;

  // Tags
  manualTags: boolean;
  autoTags: boolean;
}

export const DEFAULT_FIELD_CONFIG: HtmlReportFieldConfig = {
  flightDateTime: true,
  flightName: true,
  duration: true,
  takeoffTime: true,
  landingTime: true,
  takeoffCoordinates: true,
  notes: true,
  aircraftName: true,
  droneModel: true,
  droneSerial: true,
  batterySerial: true,
  totalDistance: true,
  maxAltitude: true,
  maxSpeed: true,
  maxDistanceFromHome: true,
  takeoffBattery: true,
  landingBattery: true,
  batteryVoltage: true,
  batteryTemp: true,
  temperature: true,
  windSpeed: true,
  windGusts: true,
  humidity: true,
  cloudCover: true,
  precipitation: true,
  pressure: true,
  weatherCondition: true,
  photoCount: true,
  videoCount: true,
  manualTags: true,
  autoTags: true,
};

export interface FieldGroup {
  name: string;
  fields: { key: keyof HtmlReportFieldConfig; label: string }[];
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    name: 'General Info',
    fields: [
      { key: 'flightDateTime', label: 'Flight Date/Time' },
      { key: 'flightName', label: 'Flight Name' },
      { key: 'duration', label: 'Duration' },
      { key: 'takeoffTime', label: 'Takeoff Time' },
      { key: 'landingTime', label: 'Landing Time' },
      { key: 'takeoffCoordinates', label: 'Takeoff Coordinates' },
      { key: 'notes', label: 'Notes' },
    ],
  },
  {
    name: 'Equipment',
    fields: [
      { key: 'aircraftName', label: 'Aircraft Name' },
      { key: 'droneModel', label: 'Drone Model' },
      { key: 'droneSerial', label: 'Drone Serial' },
      { key: 'batterySerial', label: 'Battery Serial' },
    ],
  },
  {
    name: 'Flight Stats',
    fields: [
      { key: 'totalDistance', label: 'Total Distance' },
      { key: 'maxAltitude', label: 'Max Altitude' },
      { key: 'maxSpeed', label: 'Max Speed' },
      { key: 'maxDistanceFromHome', label: 'Max Distance from Home' },
    ],
  },
  {
    name: 'Battery',
    fields: [
      { key: 'takeoffBattery', label: 'Takeoff Battery %' },
      { key: 'landingBattery', label: 'Landing Battery %' },
      { key: 'batteryVoltage', label: 'Battery Voltage' },
      { key: 'batteryTemp', label: 'Battery Temp' },
    ],
  },
  {
    name: 'Weather',
    fields: [
      { key: 'weatherCondition', label: 'Weather Condition' },
      { key: 'temperature', label: 'Temperature' },
      { key: 'windSpeed', label: 'Wind Speed' },
      { key: 'windGusts', label: 'Wind Gusts' },
      { key: 'humidity', label: 'Humidity' },
      { key: 'cloudCover', label: 'Cloud Cover' },
      { key: 'precipitation', label: 'Precipitation' },
      { key: 'pressure', label: 'Pressure' },
    ],
  },
  {
    name: 'Media',
    fields: [
      { key: 'photoCount', label: 'Photos' },
      { key: 'videoCount', label: 'Videos' },
    ],
  },
  {
    name: 'Tags',
    fields: [
      { key: 'manualTags', label: 'Manual Tags' },
      { key: 'autoTags', label: 'Auto Tags' },
    ],
  },
];

// ============================================================================
// Field config persistence
// ============================================================================

const STORAGE_KEY = 'htmlReportFieldConfig';

export function loadFieldConfig(): HtmlReportFieldConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_FIELD_CONFIG, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_FIELD_CONFIG };
}

export function saveFieldConfig(config: HtmlReportFieldConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

// ============================================================================
// Helpers
// ============================================================================

function esc(str: string | number | null | undefined): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined || seconds === 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

function fmtDistance(meters: number | null, unitSystem: UnitSystem, locale?: string): string {
  if (meters === null || meters === undefined || meters === 0) return '—';
  const fmt = (n: number, d: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  if (unitSystem === 'imperial') {
    const miles = meters / 1609.344;
    return `${fmt(miles, 2)} mi`;
  }
  if (meters >= 1000) return `${fmt(meters / 1000, 2)} km`;
  return `${fmt(meters, 0)} m`;
}

function fmtSpeed(ms: number | null, speedUnit: SpeedUnit, locale?: string): string {
  if (ms === null || ms === undefined || ms === 0) return '—';
  const fmt = (n: number, d: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  return `${fmt(ms * speedMultiplierFromMs(speedUnit), 1)} ${speedUnitLabel(speedUnit)}`;
}

function fmtAltitude(meters: number | null, unitSystem: UnitSystem, locale?: string): string {
  if (meters === null || meters === undefined || meters === 0) return '—';
  const fmt = (n: number, d: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  if (unitSystem === 'imperial') return `${fmt(meters * 3.28084, 1)} ft`;
  return `${fmt(meters, 1)} m`;
}

/** Format to "DD MMM YYYY, hh:mm:ss AM/PM TZ" */
function fmtDateTimeFull(isoString: string | null, dateFormat?: string, lang?: string, hour12?: boolean): string {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    const datePart = dateFormat
      ? formatDateDisplay(date, dateFormat, lang)
      : date.toLocaleDateString(lang, { day: '2-digit', month: 'short', year: 'numeric' });
    const timePart = date.toLocaleTimeString(lang || 'en', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: hour12 !== undefined ? hour12 : true,
      timeZoneName: 'short',
    });
    return ensureAmPmUpperCase(`${datePart}, ${timePart}`);
  } catch {
    return isoString;
  }
}

/** Format time only: "hh:mm:ss AM/PM TZ" */
function fmtTimeFull(isoString: string | null, lang?: string, hour12?: boolean): string {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    return ensureAmPmUpperCase(date.toLocaleTimeString(lang || 'en', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: hour12 !== undefined ? hour12 : true,
      timeZoneName: 'short',
    }));
  } catch {
    return isoString;
  }
}

/** Format date for day header: "Monday, 10 Mar 2025" */
function fmtDateHeader(isoString: string | null, dateFormat?: string, lang?: string): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return dateFormat
      ? utilFormatDateHeader(date, dateFormat, lang)
      : date.toLocaleDateString(lang, { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return isoString;
  }
}

function fmtDateShort(isoString: string | null): string {
  if (!isoString) return '';
  return new Date(isoString).toISOString().split('T')[0];
}

/** Get current timestamp formatted */
function fmtNow(dateFormat?: string, lang?: string, hour12?: boolean): string {
  const now = new Date();
  const datePart = dateFormat
    ? formatDateDisplay(now, dateFormat, lang)
    : now.toLocaleDateString(lang, { day: '2-digit', month: 'short', year: 'numeric' });
  const timePart = now.toLocaleTimeString(lang || 'en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: hour12 !== undefined ? hour12 : true,
    timeZoneName: 'short',
  });
  return ensureAmPmUpperCase(`${datePart}, ${timePart}`);
}

function calculateLandingTime(takeoffTime: string | null, durationSecs: number | null, lang?: string, hour12?: boolean): string {
  if (!takeoffTime || !durationSecs) return '—';
  const landing = new Date(new Date(takeoffTime).getTime() + durationSecs * 1000);
  return ensureAmPmUpperCase(landing.toLocaleTimeString(lang || 'en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: hour12 !== undefined ? hour12 : true,
    timeZoneName: 'short',
  }));
}

function calculateMaxDistanceFromHome(telemetry: TelemetryData): number | null {
  const lats = telemetry.latitude ?? [];
  const lngs = telemetry.longitude ?? [];
  let homeLat: number | null = null;
  let homeLng: number | null = null;
  for (let i = 0; i < lats.length; i++) {
    if (typeof lats[i] === 'number' && typeof lngs[i] === 'number') {
      homeLat = lats[i]!;
      homeLng = lngs[i]!;
      break;
    }
  }
  if (homeLat === null || homeLng === null) return null;
  let maxDistance = 0;
  const toRad = (v: number) => (v * Math.PI) / 180;
  for (let i = 0; i < lats.length; i++) {
    const lat = lats[i];
    const lng = lngs[i];
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const dLat = toRad(lat - homeLat);
    const dLon = toRad(lng - homeLng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(homeLat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = 6371000 * c;
    if (distance > maxDistance) maxDistance = distance;
  }
  return maxDistance;
}

function fmtWindSpeed(kmh: number, speedUnit: SpeedUnit, locale?: string): string {
  const fmt = (n: number, d: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  const speedMs = kmh / 3.6;
  return `${fmt(speedMs * speedMultiplierFromMs(speedUnit), 1)} ${speedUnitLabel(speedUnit)}`;
}

function fmtTemp(c: number, unitSystem: UnitSystem, locale?: string): string {
  const fmt = (n: number, d: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  if (unitSystem === 'imperial') return `${fmt(c * 9 / 5 + 32, 1)} °F`;
  return `${fmt(c, 1)} °C`;
}

function fmtPrecip(mm: number, speedUnit: SpeedUnit, locale?: string): string {
  const fmt = (n: number, d: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  if (isImperialSpeedUnit(speedUnit)) return `${fmt(mm * 0.03937, 2)} in`;
  return `${fmt(mm, 1)} mm`;
}

function fmtPressure(hPa: number, speedUnit: SpeedUnit, locale?: string): string {
  const fmt = (n: number, d: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  if (isImperialSpeedUnit(speedUnit)) return `${fmt(hPa * 0.02953, 2)} inHg`;
  return `${hPa} hPa`;
}

// ============================================================================
// HTML builder
// ============================================================================

export interface FlightReportData {
  flight: Flight;
  data: FlightDataResponse;
  weather?: WeatherData | null;
  getDroneDisplayName?: (serial: string, fallback: string) => string;
  getBatteryDisplayName?: (serial: string) => string;
  getDisplaySerial?: (serial: string) => string;
}

export interface ReportOptions {
  documentTitle: string;
  pilotName: string;
  fieldConfig: HtmlReportFieldConfig;
  unitPrefs: UnitPreferences;
  locale?: string;
  dateLocale?: string;
  appLanguage?: string;
  timeFormat?: '12h' | '24h';
  t?: (key: string, options?: any) => string;
}

interface ComponentGroup {
  group: string;
  items: { label: string; value: string }[];
}

interface FlightColumn {
  isStacked: boolean;
  groups: ComponentGroup[];
}

/** Build data columns for a flight, supporting stacked sections for Tags/Media */
function buildFlightColumns(
  fd: FlightReportData,
  fc: HtmlReportFieldConfig,
  unitPrefs: UnitPreferences,
  locale?: string,
  dateLocale?: string,
  lang?: string,
  hour12?: boolean,
  t?: (key: string, options?: any) => string,
): FlightColumn[] {
  const columns: FlightColumn[] = [];
  const tr = (key: string, fallback: string) => t ? t(key) : fallback;

  // 1. General Info Column
  const generalItems: { label: string; value: string }[] = [];
  if (fc.flightName) generalItems.push({ label: tr('report.flightName', 'Flight Name'), value: esc(fd.flight.displayName || fd.flight.fileName) });
  if (fc.flightDateTime) generalItems.push({ label: tr('report.dateTime', 'Date/Time'), value: esc(fmtDateTimeFull(fd.flight.startTime, dateLocale, lang, hour12)) });
  if (fc.takeoffTime) generalItems.push({ label: tr('report.takeoff', 'Takeoff'), value: esc(fmtTimeFull(fd.flight.startTime, lang, hour12)) });
  if (fc.landingTime) generalItems.push({ label: tr('report.landing', 'Landing'), value: esc(calculateLandingTime(fd.flight.startTime, fd.flight.durationSecs, lang, hour12)) });
  if (fc.duration) generalItems.push({ label: tr('report.duration', 'Duration'), value: esc(fmtDuration(fd.flight.durationSecs)) });
  if (fc.takeoffCoordinates) {
    const lat = fd.flight.homeLat ?? fd.data.telemetry.latitude?.[0];
    const lon = fd.flight.homeLon ?? fd.data.telemetry.longitude?.[0];
    generalItems.push({ label: tr('report.takeoffLocation', 'Takeoff Location'), value: lat != null && lon != null ? `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}` : '—' });
  }
  if (fc.notes && fd.flight.notes) generalItems.push({ label: tr('report.notes', 'Notes'), value: esc(fd.flight.notes) });
  if (generalItems.length > 0) columns.push({ isStacked: false, groups: [{ group: tr('report.generalInfo', 'General Info'), items: generalItems }] });

  // 2. Equipment Column
  const equipItems: { label: string; value: string }[] = [];
  if (fc.aircraftName) {
    const fallback = fd.flight.aircraftName || fd.flight.droneModel || '';
    const name = fd.flight.droneSerial && fd.getDroneDisplayName
      ? fd.getDroneDisplayName(fd.flight.droneSerial, fallback) : fallback;
    equipItems.push({ label: tr('report.aircraft', 'Aircraft'), value: esc(name || '—') });
  }
  if (fc.droneModel) equipItems.push({ label: tr('report.droneModel', 'Drone Model'), value: esc(fd.flight.droneModel || '—') });
  if (fc.droneSerial) {
    const serial = fd.flight.droneSerial;
    const displaySerial = serial ? (fd.getDisplaySerial ? fd.getDisplaySerial(serial) : serial) : '—';
    equipItems.push({ label: tr('report.droneSN', 'Drone SN'), value: esc(displaySerial) });
  }
  if (fc.batterySerial) {
    const serial = fd.flight.batterySerial;
    const displaySerial = serial ? (fd.getDisplaySerial ? fd.getDisplaySerial(serial) : serial) : '—';
    let batterySerialValue = displaySerial;
    if (serial && fd.getBatteryDisplayName) {
      const customName = fd.getBatteryDisplayName(serial)?.trim();
      // Append only an actual custom label, not the serial/masked fallback.
      if (customName && customName !== serial && customName !== displaySerial) {
        batterySerialValue = `${displaySerial} (${customName})`;
      }
    }
    equipItems.push({ label: tr('report.batterySN', 'Battery SN'), value: esc(batterySerialValue) });
  }
  if (equipItems.length > 0) columns.push({ isStacked: false, groups: [{ group: tr('report.equipment', 'Equipment'), items: equipItems }] });

  // 3. Performance Column (Flight Stats + Battery merged)
  const perfItems: { label: string; value: string }[] = [];
  if (fc.totalDistance) perfItems.push({ label: tr('report.distance', 'Distance'), value: esc(fmtDistance(fd.flight.totalDistance, unitPrefs.distance, locale)) });
  if (fc.maxAltitude) perfItems.push({ label: tr('report.maxAlt', 'Max Alt.'), value: esc(fmtAltitude(fd.flight.maxAltitude, unitPrefs.altitude, locale)) });
  if (fc.maxSpeed) perfItems.push({ label: tr('report.maxSpeed', 'Max Speed'), value: esc(fmtSpeed(fd.flight.maxSpeed, unitPrefs.speed, locale)) });
  if (fc.maxDistanceFromHome) {
    const d = calculateMaxDistanceFromHome(fd.data.telemetry);
    perfItems.push({ label: tr('report.maxDistHome', 'Max Dist. Home'), value: esc(fmtDistance(d, unitPrefs.distance, locale)) });
  }
  if (fc.takeoffBattery) {
    const b = fd.data.telemetry.battery;
    const v = fd.data.telemetry.batteryVoltage;
    // Use the highest valid battery percentage for takeoff; many logs begin with 0 placeholders.
    const indexedBattery = (b ?? [])
      .map((pct, idx) => ({ pct, idx }))
      .filter((sample): sample is { pct: number; idx: number } => typeof sample.pct === 'number' && Number.isFinite(sample.pct));

    const nonZeroBattery = indexedBattery.filter((sample) => sample.pct > 0);

    let takeoffSample: { pct: number; idx: number } | null = null;
    for (const sample of nonZeroBattery) {
      if (!takeoffSample || sample.pct > takeoffSample.pct) {
        takeoffSample = sample;
      }
    }

    const firstBat = takeoffSample?.pct ?? null;
    // Find voltage at the same index as selected takeoff battery sample.
    let firstVolt: number | null = null;
    if (fc.batteryVoltage && v && takeoffSample && takeoffSample.idx < v.length) {
      const sampleVolt = v[takeoffSample.idx];
      if (typeof sampleVolt === 'number' && Number.isFinite(sampleVolt)) {
        firstVolt = sampleVolt;
      }
    }
    let takeoffValue = '—';
    if (firstBat != null) {
      takeoffValue = firstVolt != null && firstVolt > 0
        ? `${firstBat}% (${firstVolt.toFixed(2)} V)`
        : `${firstBat}%`;
    }
    perfItems.push({ label: tr('report.takeoffBat', 'Takeoff Bat.'), value: takeoffValue });
  }
  if (fc.landingBattery) {
    const b = fd.data.telemetry.battery;
    const v = fd.data.telemetry.batteryVoltage;
    let lastBat: number | null = null;
    let lastBatIdx = -1;
    if (b) for (let i = b.length - 1; i >= 0; i--) { if (b[i] !== null) { lastBat = b[i]; lastBatIdx = i; break; } }
    // Find voltage at same index as last valid battery
    let lastVolt: number | null = null;
    if (fc.batteryVoltage && lastBatIdx >= 0 && v && lastBatIdx < v.length) {
      lastVolt = v[lastBatIdx];
    }
    let landingValue = '—';
    if (lastBat != null && lastBat !== 0) {
      landingValue = lastVolt != null && lastVolt > 0
        ? `${lastBat}% (${lastVolt.toFixed(2)} V)`
        : `${lastBat}%`;
    }
    perfItems.push({ label: tr('report.landingBat', 'Landing Bat.'), value: landingValue });
  }
  if (fc.batteryTemp) {
    const t = fd.data.telemetry.batteryTemp;
    const validTemps = (t ?? []).filter((val): val is number => typeof val === 'number' && Number.isFinite(val) && Math.abs(val) >= 1e-6);
    if (validTemps.length > 0) {
      const first = validTemps[0];
      const last = validTemps[validTemps.length - 1];
      const formatTemp = (value: number): string => {
        if (unitPrefs.temperature === 'imperial') return `${(value * 9 / 5 + 32).toFixed(1)}°F`;
        return `${value.toFixed(1)}°C`;
      };
      perfItems.push({
        label: tr('report.batTemp', 'Bat. Temp'),
        value: `${formatTemp(first)} — ${formatTemp(last)}`,
      });
    } else {
      perfItems.push({ label: tr('report.batTemp', 'Bat. Temp'), value: '—' });
    }
  }
  if (perfItems.length > 0) columns.push({ isStacked: false, groups: [{ group: tr('report.performance', 'Performance'), items: perfItems }] });

  // 4. Weather Column
  const wxItems: { label: string; value: string }[] = [];
  if (fc.weatherCondition) wxItems.push({ label: tr('report.condition', 'Condition'), value: esc(fd.weather?.conditionLabel ?? '—') });
  if (fc.temperature) wxItems.push({ label: tr('report.temperature', 'Temperature'), value: fd.weather ? esc(fmtTemp(fd.weather.temperature, unitPrefs.temperature, locale)) : '—' });
  if (fc.windSpeed) wxItems.push({ label: tr('report.wind', 'Wind'), value: fd.weather ? esc(fmtWindSpeed(fd.weather.windSpeed, unitPrefs.speed, locale)) : '—' });
  if (fc.windGusts) wxItems.push({ label: tr('report.gusts', 'Gusts'), value: fd.weather ? esc(fmtWindSpeed(fd.weather.windGusts, unitPrefs.speed, locale)) : '—' });
  if (fc.humidity) wxItems.push({ label: tr('report.humidity', 'Humidity'), value: fd.weather && fd.weather.humidity != null ? `${fd.weather.humidity}%` : '—' });
  if (fc.cloudCover) wxItems.push({ label: tr('report.clouds', 'Clouds'), value: fd.weather && fd.weather.cloudCover != null ? `${fd.weather.cloudCover}%` : '—' });
  if (fc.precipitation) wxItems.push({ label: tr('report.precipitation', 'Precipitation'), value: fd.weather ? esc(fmtPrecip(fd.weather.precipitation, unitPrefs.speed, locale)) : '—' });
  if (fc.pressure) wxItems.push({ label: tr('report.pressure', 'Pressure'), value: fd.weather ? esc(fmtPressure(fd.weather.pressure, unitPrefs.speed, locale)) : '—' });
  if (wxItems.length > 0 && wxItems.some((i) => i.value !== '—')) columns.push({ isStacked: false, groups: [{ group: tr('report.weatherGroup', 'Weather'), items: wxItems }] });

  // 5. Stacked Column (Tags over Media)
  const stackedGroups: ComponentGroup[] = [];

  // ... 5a. Tags (Top Half)
  const tagItems: { label: string; value: string }[] = [];
  if (fc.manualTags || fc.autoTags) {
    const flightTags = fd.flight.tags || [];
    let includedTags = flightTags;

    // Filter tags based on selected checkboxes
    if (fc.manualTags && !fc.autoTags) {
      includedTags = flightTags.filter(t => t.tagType === 'manual');
    } else if (!fc.manualTags && fc.autoTags) {
      includedTags = flightTags.filter(t => t.tagType === 'auto');
    }

    if (includedTags.length > 0) {
      // Build a comma separated string for the tags list
      const tagString = includedTags.map(t => t.tag).join(', ');
      tagItems.push({ label: tr('report.includedTags', 'Included Tags'), value: esc(tagString) });
    } else if (flightTags.length === 0) {
      tagItems.push({ label: tr('report.includedTags', 'Included Tags'), value: tr('report.noTags', 'None') });
    } else {
      tagItems.push({ label: tr('report.includedTags', 'Included Tags'), value: tr('report.noMatchingTags', 'None matching selection') });
    }

    if (tagItems.length > 0) stackedGroups.push({ group: tr('report.tagsGroup', 'Tags'), items: tagItems });
  }

  // ... 5b. Media (Bottom Half)
  const mediaItems: { label: string; value: string }[] = [];
  if (fc.photoCount) mediaItems.push({ label: tr('report.photos', 'Photos'), value: fd.flight.photoCount != null && fd.flight.photoCount > 0 ? String(fd.flight.photoCount) : '—' });
  if (fc.videoCount) mediaItems.push({ label: tr('report.videos', 'Videos'), value: fd.flight.videoCount != null && fd.flight.videoCount > 0 ? String(fd.flight.videoCount) : '—' });
  if (mediaItems.length > 0) stackedGroups.push({ group: tr('report.mediaGroup', 'Media'), items: mediaItems });

  if (stackedGroups.length > 0) {
    // If it contains more than one group (Tags AND Media), it is stacked
    columns.push({ isStacked: stackedGroups.length > 1, groups: stackedGroups });
  }

  return columns;
}

// Calendar SVG icon (inline, no emoji)
const CALENDAR_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

export function buildHtmlReport(
  flightsData: FlightReportData[],
  options: ReportOptions,
): string {
  const {
    documentTitle,
    pilotName,
    fieldConfig: fc,
    unitPrefs,
    locale,
    dateLocale,
    appLanguage,
    timeFormat,
    t,
  } = options;
  const lang = appLanguage || locale;
  const hour12 = timeFormat === '24h' ? false : true;
  const tr = (key: string, fallback: string) => t ? t(key) : fallback;

  // Group flights by day
  type DayGroup = { date: string; dateLabel: string; flights: FlightReportData[] };
  const dayMap = new Map<string, DayGroup>();
  for (const fd of flightsData) {
    const dateKey = fmtDateShort(fd.flight.startTime) || 'Unknown';
    const dateLabel = fmtDateHeader(fd.flight.startTime, dateLocale, lang) || 'Unknown Date';
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, { date: dateKey, dateLabel, flights: [] });
    dayMap.get(dateKey)!.flights.push(fd);
  }
  const days = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const totalFlights = flightsData.length;
  const totalDuration = flightsData.reduce((sum, fd) => sum + (fd.flight.durationSecs || 0), 0);
  const totalDistanceM = flightsData.reduce((sum, fd) => sum + (fd.flight.totalDistance || 0), 0);
  const now = fmtNow(dateLocale, lang, hour12);

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(documentTitle)}</title>
<style>
  :root {
    --primary: #0ea5e9;
    --primary-light: #e0f2fe;
    --bg: #ffffff;
    --text: #1e293b;
    --text-secondary: #64748b;
    --border: #e2e8f0;
    --header-bg: #f8fafc;
    --row-alt: #f1f5f9;
    --day-header-bg: #0f172a;
    --day-header-text: #ffffff;
    --subtotal-bg: #e0f2fe;
    --grand-total-bg: #0ea5e9;
    --grand-total-text: #ffffff;
    --card-bg: #ffffff;
    --card-border: #e2e8f0;
    --group-label-bg: #f1f5f9;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 11px;
    color: var(--text);
    background: var(--bg);
    line-height: 1.5;
  }
  .report-container {
    max-width: 210mm; /* A4 width */
    margin: 0 auto;
    padding: 20px 24px;
  }

  /* Header */
  .report-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 3px solid var(--primary);
  }
  .report-header h1 {
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 2px;
  }
  .report-header .subtitle {
    font-size: 11px;
    color: var(--text-secondary);
    font-weight: 400;
    font-style: italic;
  }
  .report-header .meta {
    text-align: right;
    font-size: 10px;
    color: var(--text-secondary);
    line-height: 1.8;
  }
  .report-header .meta strong { color: var(--text); }

  /* Summary cards */
  .summary-row {
    display: flex;
    gap: 10px;
    margin-bottom: 16px;
  }
  .summary-card {
    flex: 1;
    background: var(--header-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 14px;
    text-align: center;
  }
  .summary-card .value {
    font-size: 18px;
    font-weight: 700;
    color: var(--primary);
  }
  .summary-card .label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  /* Day header */
  .day-header {
    background: var(--day-header-bg);
    color: var(--day-header-text);
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    margin-top: 14px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Flight card */
  .flight-card {
    border: 1px solid var(--card-border);
    border-radius: 5px;
    margin-bottom: 6px;
    overflow: hidden;
    background: var(--card-bg);
    page-break-inside: avoid;
  }
  .flight-card-header {
    background: var(--primary);
    color: white;
    padding: 3px 10px;
    font-size: 10px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .flight-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.25);
    border-radius: 3px;
    width: 20px;
    height: 18px;
    font-size: 9px;
    font-weight: 700;
  }

  /* Grouped fields inside flight card — single compact row */
  .flight-groups {
    display: flex;
    flex-wrap: nowrap;
    gap: 0;
    overflow: hidden;
  }
  .field-group {
    flex: 1 1 0;
    min-width: 0;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }
  .field-group:last-child { border-right: none; }
  .field-group.stacked {
    /* Stacked groups still share the column width but have internal dividers */
  }
  .field-group-internal {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
  }
  .field-group-divider {
    height: 1px;
    background-color: var(--border);
    width: 100%;
  }
  .field-group-label {
    background: var(--group-label-bg);
    padding: 2px 8px;
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .field-group-items {
    display: flex;
    flex-wrap: wrap;
    padding: 2px 4px;
    gap: 0;
    flex: 1;
  }
  .field-item {
    padding: 1px 4px;
    min-width: 90px;
    flex: 1 1 auto;
  }
  .field-item .fl { font-size: 7px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.03em; line-height: 1.3; }
  .field-item .fv { font-size: 9px; font-weight: 600; color: var(--text); line-height: 1.3; }

  /* Subtotal */
  .subtotal {
    background: var(--subtotal-bg);
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    margin-bottom: 4px;
    color: var(--text);
  }

  /* Grand total */
  .grand-total {
    background: var(--grand-total-bg);
    color: var(--grand-total-text);
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    margin-top: 12px;
  }

  /* Footer */
  .report-footer {
    margin-top: 20px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--text-secondary);
    font-size: 10px;
  }
  .report-footer a {
    color: var(--primary);
    text-decoration: none;
    font-weight: 600;
  }
  .report-footer a:hover { text-decoration: underline; }
  .report-footer .branding {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .report-footer .branding svg { width: 16px; height: 16px; }

  /* Print styles */
  @media print {
    body { font-size: 9px; }
    .report-container { padding: 0; max-width: 100%; }
    .summary-card .value { font-size: 15px; }
    .day-header { page-break-after: avoid; }
    .flight-card { page-break-inside: avoid; }
    @page { size: A4; margin: 10mm; }
  }
</style>
</head>
<body>
<div class="report-container">

  <!-- Header -->
  <div class="report-header">
    <div>
      <h1>${esc(documentTitle)}</h1>
      <div class="subtitle">${esc(tr('report.comprehensiveSummary', 'Comprehensive drone flights summary'))}</div>
    </div>
    <div class="meta">
      <div><strong>${esc(tr('report.pilot', 'Pilot:'))}</strong> ${esc(pilotName)}</div>
      <div><strong>${esc(tr('report.reportedFlights', 'Reported Flights:'))}</strong> ${totalFlights}</div>
      <div><strong>${esc(tr('report.totalAirTime', 'Total Air Time:'))}</strong> ${esc(fmtDuration(totalDuration))}</div>
      <div><strong>${esc(tr('overview.totalDistance', 'Total Distance:'))}</strong> ${esc(fmtDistance(totalDistanceM, unitPrefs.distance, locale))}</div>
      <div><strong>${esc(tr('report.generated', 'Generated:'))}</strong> ${esc(now)}</div>
    </div>
  </div>

  <!-- Summary cards -->
  <div class="summary-row">
    <div class="summary-card">
      <div class="value">${totalFlights}</div>
      <div class="label">${esc(tr('overview.totalFlights', 'Total Flights'))}</div>
    </div>
    <div class="summary-card">
      <div class="value">${esc(fmtDuration(totalDuration))}</div>
      <div class="label">${esc(tr('report.totalAirTime', 'Total Air Time:').replace(':', ''))}</div>
    </div>
    <div class="summary-card">
      <div class="value">${esc(fmtDistance(totalDistanceM, unitPrefs.distance, locale))}</div>
      <div class="label">${esc(tr('overview.totalDistance', 'Total Distance'))}</div>
    </div>
    <div class="summary-card">
      <div class="value">${days.length}</div>
      <div class="label">${esc(tr('report.flightDays', 'Flight Days'))}</div>
    </div>
  </div>

`;

  let globalFlightIndex = 0;

  for (const day of days) {
    // Day header
    const flightCountLabel = day.flights.length === 1
      ? tr('report.flightCount_one', '1 flight').replace('{{count}}', '1')
      : tr('report.flightCount_other', '{{count}} flights').replace('{{count}}', String(day.flights.length));
    html += `  <div class="day-header">${CALENDAR_SVG} ${esc(day.dateLabel)} — ${esc(flightCountLabel)}</div>\n`;

    for (const fd of day.flights) {
      globalFlightIndex++;
      const flightColumns = buildFlightColumns(fd, fc, unitPrefs, locale, dateLocale, lang, hour12, t);
      const headerLabel = fd.flight.displayName || fd.flight.fileName || `Flight ${globalFlightIndex}`;

      html += `  <div class="flight-card">
    <div class="flight-card-header">
      <span class="flight-num">${globalFlightIndex}</span>
      ${esc(headerLabel)}
    </div>
    <div class="flight-groups">\n`;

      for (const col of flightColumns) {
        // A column wraps completely around either a single group, or stacked groups
        html += `      <div class="field-group ${col.isStacked ? 'stacked' : ''}">\n`;

        for (let i = 0; i < col.groups.length; i++) {
          const grp = col.groups[i];
          // If this is a stacked internal group (and not the first one), add a divider
          if (col.isStacked && i > 0) {
            html += `        <div class="field-group-divider"></div>\n`;
          }

          html += `        <div class="field-group-internal">
          <div class="field-group-label">${esc(grp.group)}</div>
          <div class="field-group-items">\n`;

          for (const item of grp.items) {
            html += `            <div class="field-item"><div class="fl">${item.label}</div><div class="fv">${item.value}</div></div>\n`;
          }
          html += `          </div>
        </div>\n`;
        }

        html += `      </div>\n`;
      }

      html += `    </div>
  </div>\n`;
    }

    // Day subtotal
    const dayDuration = day.flights.reduce((s, fd) => s + (fd.flight.durationSecs || 0), 0);
    const dayDistance = day.flights.reduce((s, fd) => s + (fd.flight.totalDistance || 0), 0);
    const dayFlightCountLabel = day.flights.length === 1
      ? tr('report.flightCount_one', '1 flight').replace('{{count}}', '1')
      : tr('report.flightCount_other', '{{count}} flights').replace('{{count}}', String(day.flights.length));

    html += `  <div class="subtotal">${esc(tr('report.subtotal', 'Subtotal:'))} ${esc(dayFlightCountLabel)} · ${esc(fmtDuration(dayDuration))} · ${esc(fmtDistance(dayDistance, unitPrefs.distance, locale))}</div>\n`;
  }

  // Grand total
  const totalFlightCountLabel = totalFlights === 1
    ? tr('report.flightCount_one', '1 flight').replace('{{count}}', '1')
    : tr('report.flightCount_other', '{{count}} flights').replace('{{count}}', String(totalFlights));

  html += `  <div class="grand-total">${esc(tr('report.grandTotal', 'Grand Total:'))} ${esc(totalFlightCountLabel)} · ${esc(fmtDuration(totalDuration))} · ${esc(fmtDistance(totalDistanceM, unitPrefs.distance, locale))}</div>\n`;

  // Footer
  html += `
  <div class="report-footer">
    <div>${esc(tr('report.generated', 'Generated:').replace(':', ' on'))} ${esc(now)}</div>
    <div class="branding">
      <svg viewBox="0 0 1024 1024" style="width:18px;height:18px"><defs><style>.r{fill:#ba3935}.p{fill:#8e45ab}</style></defs><path class="r" d="M99.63,382.45h1c10.41-.19,19.67-.28,28.33-.28,10,0,19.25.12,28.14.37l1.61,0c17.87,0,28.1-9.63,30.39-28.62,9.73-80.81,65.78-142.85,146.27-161.88,43.9-10.38,47.45-14.93,47.49-60.93v-8.51c0-5.44,0-10.88,0-16.31-.15-12.07-.43-34.53-24.41-34.53A69.26,69.26,0,0,0,345,73.38c-6.09,1.21-12.24,2.34-18.4,3.48-24.78,4.55-50.41,9.27-73.81,19.62C144.53,144.35,83.7,230.06,72,351.24c-1,9.84,1.09,17.6,6.07,23.08S90.2,382.45,99.63,382.45Z"/><path class="r" d="M382.8,893.51c-.05-46.24-3.59-50.81-47.3-61.07-81.79-19.2-135.24-78.89-146.65-163.76-2.44-18.17-12.37-27.38-29.52-27.38l-1.45,0c-10.71.29-20.34.44-29.45.44-9.5,0-18.27-.15-26.82-.47-.71,0-1.4,0-2.06,0-9.34,0-16.24,2.51-21.11,7.67-6.78,7.19-7,17-6.65,23.8C79.9,812.67,186.22,928.94,324.58,949.19c13,1.9,22.39,3.28,29.78,3.28h0c5.68,0,13.93-.72,20.09-6.89,8.43-8.44,8.41-21.11,8.36-46.38Z"/><path class="r" d="M667.67,189.05c93,12.06,154.05,73.05,167.59,167.34,2.48,17.28,12.29,26,29.17,26h.77c9.53-.13,19.06-.24,28.6-.24,10.21,0,19.34.12,27.9.37l1.72,0c9.86,0,17.12-2.67,22.19-8.17,5.29-5.74,7.42-14,6.51-25.1-5.61-68.57-32.39-131-77.44-180.53C829.38,119,769.94,87,702.78,76.34l-9.31-1.5c-12-2-20.59-3.36-27.26-3.36-5,0-12.16.64-17.73,6.25-7.5,7.55-7.42,18.79-7.28,39.19q0,4.9,0,10.72v3.8l.07,11.4h.12c.07,5.65.1,11.06-.21,16.43C640.23,176.63,649.12,186.65,667.67,189.05Z"/><path class="r" d="M925,641.45h-.75c-10,.15-19.94.26-29.91.26-10.31,0-19.62-.11-28.45-.36h-1.43c-17.15,0-27,9.29-29.31,27.62-10.44,83.17-65.25,144.29-146.61,163.49-43.73,10.32-47.27,14.87-47.29,60.95V899l0,4.29c-.21,24.21-.31,35.26,7.34,43,5.53,5.58,12.75,6.22,17.69,6.22,5.38,0,11.7-.84,20.46-2,3.17-.42,6.66-.89,10.48-1.36,66.32-8.2,129.26-41.61,177.23-94.09s75.51-117.88,77.72-184.36c.32-9.64-1.92-16.8-6.86-21.9C940.56,643.92,933.74,641.45,925,641.45Z"/><path class="p" d="M673.71,776,695,767.7c42-20.74,69-47.54,85.56-96.59,6.2-18.38-3.13-29.92-21.16-36.09-56.87-19.44-90.77-65.55-90.67-123.35.1-57.27,34.36-103.15,91.65-122.72,17.38-5.94,23.64-16.76,20.3-35.1A137.31,137.31,0,0,0,677,244.82,59.18,59.18,0,0,0,663.27,243c-19,0-26.34,14.64-30.19,25.65-18,51.52-63.09,85.61-114.86,86.85-1.25,0-2.48.05-3.72.05-58.71,0-104.82-32.77-123.33-87.64-3.61-10.71-10.56-24.93-29.18-24.93a56,56,0,0,0-13.61,2c-54.66,13.65-89.56,48.36-103.73,103.16-5.72,22.13,1.44,35.25,23.21,42.55,66.06,22.13,101.91,89.26,83.38,156.15-11.95,43.13-41.2,72.93-86.94,88.54-7.56,2.58-25.26,8.62-21.62,32.41,8.21,53.67,50.91,99.63,103.84,111.78a61.18,61.18,0,0,0,13.77,1.81c19.61,0,26.87-14.35,31-26.86,17-51.44,62.92-85,116.92-85.48h1.37c57.95,0,104.4,33,124.26,88.24.12.33.26.68.43,1.07C640.83,773.3,658,780.71,673.71,776ZM512,573.32a61.21,61.21,0,1,1,61.21-61.21A61.2,61.2,0,0,1,512,573.32Z"/></svg>
      ${esc(tr('report.generatedWith', 'Generated with'))} <a href="https://opendronelog.com" target="_blank" rel="noopener noreferrer">Open Drone Log</a> (opendronelog.com)
    </div>
  </div>

</div>
</body>
</html>`;

  return html;
}
