/**
 * Curated catalog of canonical iRacing telemetry channels, modeled on the
 * channel list shipped with the McLaren ATLAS iRacing plugin workbook.
 *
 * Used by the ChannelBrowser to (a) pin the most useful channels to the top
 * in an "Essentials" group, (b) regroup raw channels into ATLAS-style
 * categories that are friendlier than our regex inferGroup, and (c) show a
 * short description tooltip explaining each channel.
 */

export type CatalogEntry = {
  /** Exact iRacing channel name (case-sensitive). */
  name: string;
  /** ATLAS-style group label. */
  group: string;
  /** One-line human description. */
  desc: string;
  /** Whether to surface in the "Essentials" pinned section. */
  essential?: boolean;
};

export const CHANNEL_CATALOG: CatalogEntry[] = [
  // Driver inputs
  { name: "Throttle", group: "Driver Inputs", desc: "Throttle pedal 0–1", essential: true },
  { name: "Brake", group: "Driver Inputs", desc: "Brake pedal 0–1", essential: true },
  { name: "Clutch", group: "Driver Inputs", desc: "Clutch pedal 0–1 (1 = engaged)" },
  { name: "SteeringWheelAngle", group: "Driver Inputs", desc: "Steering angle, radians (+ left)", essential: true },
  { name: "HandbrakeRaw", group: "Driver Inputs", desc: "Raw handbrake input 0–1" },
  { name: "BrakeABSactive", group: "Driver Inputs", desc: "ABS active flag" },
  // Vehicle
  { name: "Speed", group: "Vehicle", desc: "Ground speed (m/s)", essential: true },
  { name: "RPM", group: "Vehicle", desc: "Engine RPM", essential: true },
  { name: "Gear", group: "Vehicle", desc: "Current gear", essential: true },
  { name: "VelocityX", group: "Vehicle", desc: "Body-frame longitudinal velocity (m/s)" },
  { name: "VelocityY", group: "Vehicle", desc: "Body-frame lateral velocity (m/s)" },
  { name: "YawRate", group: "Vehicle", desc: "Yaw rate (rad/s)" },
  { name: "LatAccel", group: "Vehicle", desc: "Lateral g (corner load)", essential: true },
  { name: "LongAccel", group: "Vehicle", desc: "Longitudinal g (brake/accel)", essential: true },
  { name: "VertAccel", group: "Vehicle", desc: "Vertical g (bumps/curbs)" },
  { name: "Roll", group: "Vehicle", desc: "Body roll angle (rad)" },
  { name: "Pitch", group: "Vehicle", desc: "Body pitch angle (rad)" },
  { name: "Yaw", group: "Vehicle", desc: "Yaw heading (rad)" },
  // Session / lap
  { name: "Lap", group: "Session", desc: "Current lap number", essential: true },
  { name: "LapDistPct", group: "Session", desc: "Lap progress 0–1", essential: true },
  { name: "LapDist", group: "Session", desc: "Lap distance (m)" },
  { name: "LapCurrentLapTime", group: "Session", desc: "Elapsed time on current lap (s)" },
  { name: "LapLastLapTime", group: "Session", desc: "Previous completed lap time (s)" },
  { name: "LapBestLapTime", group: "Session", desc: "Session best lap time (s)" },
  { name: "SessionTime", group: "Session", desc: "Session clock (s)" },
  { name: "PlayerCarMyIncidentCount", group: "Session", desc: "Driver's incident count" },
  { name: "OnPitRoad", group: "Session", desc: "On pit road flag" },
  // Engine / fuel
  { name: "FuelLevel", group: "Engine", desc: "Fuel remaining (L)", essential: true },
  { name: "FuelUsePerHour", group: "Engine", desc: "Instantaneous fuel use (kg/hr)" },
  { name: "FuelPress", group: "Engine", desc: "Fuel rail pressure (bar)" },
  { name: "OilTemp", group: "Engine", desc: "Engine oil temp (°C)" },
  { name: "OilPress", group: "Engine", desc: "Engine oil pressure (bar)" },
  { name: "WaterTemp", group: "Engine", desc: "Coolant temp (°C)" },
  { name: "WaterLevel", group: "Engine", desc: "Coolant level (L)" },
  { name: "ManifoldPress", group: "Engine", desc: "Intake manifold pressure (bar)" },
  // Tyres
  { name: "LFtempCM", group: "Tyres", desc: "LF carcass middle temp (°C)" },
  { name: "RFtempCM", group: "Tyres", desc: "RF carcass middle temp (°C)" },
  { name: "LRtempCM", group: "Tyres", desc: "LR carcass middle temp (°C)" },
  { name: "RRtempCM", group: "Tyres", desc: "RR carcass middle temp (°C)" },
  { name: "LFpressure", group: "Tyres", desc: "LF cold pressure (kPa)" },
  { name: "RFpressure", group: "Tyres", desc: "RF cold pressure (kPa)" },
  { name: "LRpressure", group: "Tyres", desc: "LR cold pressure (kPa)" },
  { name: "RRpressure", group: "Tyres", desc: "RR cold pressure (kPa)" },
  { name: "LFwearM", group: "Tyres", desc: "LF tread wear middle %" },
  { name: "RFwearM", group: "Tyres", desc: "RF tread wear middle %" },
  // Brakes
  { name: "BrakeRaw", group: "Brakes", desc: "Raw brake input 0–1" },
  { name: "dcBrakeBias", group: "Brakes", desc: "Brake bias % front" },
  { name: "LFbrakeLinePress", group: "Brakes", desc: "LF brake line pressure (bar)" },
  { name: "RFbrakeLinePress", group: "Brakes", desc: "RF brake line pressure (bar)" },
  { name: "LRbrakeLinePress", group: "Brakes", desc: "LR brake line pressure (bar)" },
  { name: "RRbrakeLinePress", group: "Brakes", desc: "RR brake line pressure (bar)" },
  // Suspension
  { name: "LFshockDefl", group: "Suspension", desc: "LF damper deflection (m)" },
  { name: "RFshockDefl", group: "Suspension", desc: "RF damper deflection (m)" },
  { name: "LRshockDefl", group: "Suspension", desc: "LR damper deflection (m)" },
  { name: "RRshockDefl", group: "Suspension", desc: "RR damper deflection (m)" },
  { name: "LFshockVel", group: "Suspension", desc: "LF damper velocity (m/s)" },
  { name: "RFshockVel", group: "Suspension", desc: "RF damper velocity (m/s)" },
  { name: "LRshockVel", group: "Suspension", desc: "LR damper velocity (m/s)" },
  { name: "RRshockVel", group: "Suspension", desc: "RR damper velocity (m/s)" },
  { name: "LFrideHeight", group: "Suspension", desc: "LF ride height (m)" },
  { name: "RFrideHeight", group: "Suspension", desc: "RF ride height (m)" },
  // Environment
  { name: "TrackTempCrew", group: "Environment", desc: "Track surface temp (°C)" },
  { name: "AirTemp", group: "Environment", desc: "Ambient air temp (°C)" },
  { name: "AirPressure", group: "Environment", desc: "Ambient air pressure (Hg)" },
  { name: "RelativeHumidity", group: "Environment", desc: "Relative humidity (0–1)" },
  { name: "WindVel", group: "Environment", desc: "Wind speed (m/s)" },
  { name: "WindDir", group: "Environment", desc: "Wind direction (rad)" },
  { name: "Skies", group: "Environment", desc: "Sky cover (0=clear, 3=overcast)" },
];

const BY_NAME = new Map<string, CatalogEntry>(CHANNEL_CATALOG.map((c) => [c.name, c]));

/** Look up curated metadata for a channel name (or null). */
export function catalogEntry(name: string): CatalogEntry | null {
  return BY_NAME.get(name) ?? null;
}

/** Names of essential channels in catalog order. */
export const ESSENTIAL_CHANNELS: string[] = CHANNEL_CATALOG.filter((c) => c.essential).map((c) => c.name);