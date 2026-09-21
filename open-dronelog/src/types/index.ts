/**
 * TypeScript interfaces matching Rust models
 * These are the data shapes exchanged via Tauri IPC
 */

/** A flight tag with its type (auto/manual) */
export interface FlightTag {
  tag: string;
  tagType: 'auto' | 'manual';
}

/** Flight metadata for list display */
export interface Flight {
  id: number;
  fileName: string;
  displayName: string;
  fileHash: string | null;
  droneModel: string | null;
  droneSerial: string | null;
  aircraftName: string | null;
  batterySerial: string | null;
  cycleCount: number | null;
  startTime: string | null;
  durationSecs: number | null;
  totalDistance: number | null;
  maxAltitude: number | null;
  maxSpeed: number | null;
  homeLat?: number | null;
  homeLon?: number | null;
  pointCount: number | null;
  photoCount: number | null;
  videoCount: number | null;
  tags?: FlightTag[];
  notes?: string | null;
  color?: string | null;
  rcSerial?: string | null;
  batteryLife?: number | null;
}

/** Telemetry data formatted for ECharts */
export interface TelemetryData {
  /** Time in seconds from flight start */
  time: number[];
  latitude?: (number | null)[];
  longitude?: (number | null)[];
  altitude?: (number | null)[];
  height: (number | null)[];
  vpsHeight: (number | null)[];
  speed: (number | null)[];
  velocityX?: (number | null)[];
  velocityY?: (number | null)[];
  velocityZ?: (number | null)[];
  battery: (number | null)[];
  batteryVoltage: (number | null)[];
  batteryTemp: (number | null)[];
  /** Individual cell voltages per telemetry point (array of voltages) */
  cellVoltages?: (number[] | null)[];
  satellites: (number | null)[];
  rcSignal: (number | null)[];
  rcUplink?: (number | null)[];
  rcDownlink?: (number | null)[];
  pitch: (number | null)[];
  roll: (number | null)[];
  yaw: (number | null)[];
  gimbalPitch?: (number | null)[];
  gimbalRoll?: (number | null)[];
  gimbalYaw?: (number | null)[];
  rcAileron?: (number | null)[];
  rcElevator?: (number | null)[];
  rcThrottle?: (number | null)[];
  rcRudder?: (number | null)[];
  /** Photo capture indicator (true when taking photo) */
  isPhoto?: (boolean | null)[];
  /** Video recording indicator (true when recording) */
  isVideo?: (boolean | null)[];
  /** Flight mode (e.g., "GPS", "ATTI", "Sport") */
  flightMode?: (string | null)[];
  /** Battery current draw in mA */
  batteryCurrent?: (number | null)[];
  /** Battery design / full charge capacity in mAh */
  batteryFullCapacity?: (number | null)[];
  /** Battery remaining capacity in mAh */
  batteryRemainedCapacity?: (number | null)[];
}

/** App tip/warning/caution message from DJI flight log */
export interface FlightMessage {
  timestampMs: number;
  messageType: 'tip' | 'warn' | 'caution';
  message: string;
}

/** Complete flight data response from backend */
export interface FlightDataResponse {
  flight: Flight;
  telemetry: TelemetryData;
  /** GPS track: [lng, lat, height][] */
  track: [number, number, number][];
  /** App tip/warning messages */
  messages?: FlightMessage[];
}

export interface BatteryUsage {
  batterySerial: string;
  flightCount: number;
  totalDurationSecs: number;
  maxCycleCount: number | null;
}

export interface DroneUsage {
  droneModel: string;
  droneSerial: string | null;
  aircraftName: string | null;
  flightCount: number;
}

export interface FlightDateCount {
  date: string;
  count: number;
}

export interface TopFlight {
  id: number;
  displayName: string;
  durationSecs: number;
  startTime: string | null;
}

export interface TopDistanceFlight {
  id: number;
  displayName: string;
  maxDistanceFromHomeM: number;
  startTime: string | null;
}

export interface BatteryHealthPoint {
  flightId: number;
  batterySerial: string;
  startTime: string | null;
  durationMins: number;
  deltaPercent: number;
  ratePerMin: number;
}

export interface OverviewStats {
  totalFlights: number;
  totalDistanceM: number;
  totalDurationSecs: number;
  totalPoints: number;
  totalPhotos: number;
  totalVideos: number;
  maxAltitudeM: number;
  maxDistanceFromHomeM: number;
  batteriesUsed: BatteryUsage[];
  dronesUsed: DroneUsage[];
  flightsByDate: FlightDateCount[];
  topFlights: TopFlight[];
  topDistanceFlights: TopDistanceFlight[];
  batteryHealthPoints: BatteryHealthPoint[];
}

/** Result from import_log command */
export interface ImportResult {
  success: boolean;
  flightId: number | null;
  message: string;
  pointCount: number;
  fileHash: string | null;
}

/** Flight statistics */
export interface FlightStats {
  durationSecs: number;
  totalDistanceM: number;
  maxAltitudeM: number;
  maxSpeedMs: number;
  avgSpeedMs: number;
  minBattery: number;
  homeLocation: [number, number] | null;
}

/** Chart series configuration */
export interface ChartSeries {
  name: string;
  data: (number | null)[];
  color: string;
  unit: string;
  visible: boolean;
}

/** Map viewport state */
export interface MapViewport {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}
