export type ThemeTokenKey =
  | "background"
  | "foreground"
  | "panel"
  | "panel-2"
  | "rail"
  | "border"
  | "border-strong"
  | "primary"
  | "primary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "destructive"
  | "ch-speed"
  | "ch-throttle"
  | "ch-brake"
  | "ch-rpm"
  | "ch-gear"
  | "ch-steer"
  | "ch-glat"
  | "ch-glong"
  | "grid-major"
  | "grid-minor";

export type ThemeMap = Partial<Record<ThemeTokenKey, string>>;

// Bump when token keys are renamed/removed/added in a breaking way.
// Add a migrator below for each new version.
export const THEME_SCHEMA_VERSION = 2;
export const THEME_SCHEMA_ID = "apextrace.theme";

export interface ThemeFile {
  $schema: string; // "apextrace.theme/v{N}"
  version: number;
  name?: string;
  description?: string | null;
  theme: Required<ThemeMap>;
}

/**
 * Per-version migrations applied in order. Each takes the prior shape and
 * returns the next. Keys are the SOURCE version (i.e. migrations[1] turns
 * v1 into v2).
 */
const MIGRATIONS: Record<number, (input: any) => any> = {
  // v1 → v2: original release. v1 had no `version` field and identical token
  // keys to v2, so this is a structural pass-through. Future renames go here.
  1: (input) => {
    const tokens = (input?.theme ?? input) as Record<string, unknown>;
    return {
      ...(typeof input === "object" && input !== null && "theme" in input ? input : {}),
      theme: tokens,
      version: 2,
    };
  },
};

export interface MigrationResult {
  file: { name?: string; description?: string | null; theme: Record<string, unknown> };
  fromVersion: number;
  toVersion: number;
  steps: number[]; // versions migrated through
}

/**
 * Detect a theme file's schema version and migrate it forward to the current
 * version. Returns the migrated payload + which versions were applied so the
 * UI can tell the user what happened. Throws on totally unrecognizable input.
 */
export function migrateThemeFile(raw: unknown): MigrationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Theme file must be a JSON object.");
  }
  const obj = raw as Record<string, any>;

  // Detect version: explicit `version`, or parse from `$schema` like
  // "apextrace.theme/v2", or fall back to v1 (the original unversioned shape).
  let from: number;
  if (typeof obj.version === "number" && Number.isFinite(obj.version)) {
    from = obj.version;
  } else if (typeof obj.$schema === "string") {
    const m = obj.$schema.match(/\/v(\d+)\b/);
    from = m ? Number(m[1]) : 1;
  } else {
    from = 1;
  }

  if (from > THEME_SCHEMA_VERSION) {
    throw new Error(
      `Theme uses schema v${from}, but this app only understands up to v${THEME_SCHEMA_VERSION}. Update the app to import it.`,
    );
  }

  let cur: any = obj;
  const steps: number[] = [];
  for (let v = from; v < THEME_SCHEMA_VERSION; v++) {
    const fn = MIGRATIONS[v];
    if (!fn) throw new Error(`Missing migration from v${v} to v${v + 1}.`);
    cur = fn(cur);
    steps.push(v + 1);
  }

  // Normalize: ensure `theme` map exists at the top level.
  const theme =
    cur && typeof cur === "object" && cur.theme && typeof cur.theme === "object"
      ? cur.theme
      : cur;

  return {
    file: {
      name: typeof cur?.name === "string" ? cur.name : undefined,
      description:
        typeof cur?.description === "string" || cur?.description === null
          ? cur.description
          : undefined,
      theme,
    },
    fromVersion: from,
    toVersion: THEME_SCHEMA_VERSION,
    steps,
  };
}

export function buildThemeFile(input: {
  name: string;
  description?: string | null;
  theme: Required<ThemeMap>;
}): ThemeFile {
  return {
    $schema: `${THEME_SCHEMA_ID}/v${THEME_SCHEMA_VERSION}`,
    version: THEME_SCHEMA_VERSION,
    name: input.name,
    description: input.description ?? null,
    theme: input.theme,
  };
}

export interface ThemeGroup {
  label: string;
  tokens: { key: ThemeTokenKey; label: string }[];
}

export const THEME_GROUPS: ThemeGroup[] = [
  {
    label: "Surfaces",
    tokens: [
      { key: "background", label: "Background" },
      { key: "panel", label: "Panel" },
      { key: "panel-2", label: "Panel 2" },
      { key: "rail", label: "Rail" },
      { key: "muted", label: "Muted" },
      { key: "accent", label: "Accent" },
    ],
  },
  {
    label: "Text & borders",
    tokens: [
      { key: "foreground", label: "Foreground" },
      { key: "muted-foreground", label: "Muted text" },
      { key: "border", label: "Border" },
      { key: "border-strong", label: "Border strong" },
      { key: "grid-major", label: "Grid major" },
      { key: "grid-minor", label: "Grid minor" },
    ],
  },
  {
    label: "Brand",
    tokens: [
      { key: "primary", label: "Primary" },
      { key: "primary-foreground", label: "Primary text" },
      { key: "destructive", label: "Destructive" },
    ],
  },
  {
    label: "Channel traces",
    tokens: [
      { key: "ch-speed", label: "Speed" },
      { key: "ch-throttle", label: "Throttle" },
      { key: "ch-brake", label: "Brake" },
      { key: "ch-rpm", label: "RPM" },
      { key: "ch-gear", label: "Gear" },
      { key: "ch-steer", label: "Steering" },
      { key: "ch-glat", label: "Lat G" },
      { key: "ch-glong", label: "Long G" },
    ],
  },
];

// Hex defaults derived from the dark MoTeC palette in styles.css.
export const DARK_THEME: Required<ThemeMap> = {
  background: "#1a1d21",
  foreground: "#e6e7ea",
  panel: "#22262b",
  "panel-2": "#272b30",
  rail: "#15181c",
  border: "#2f343a",
  "border-strong": "#3c424a",
  primary: "#22d3ee",
  "primary-foreground": "#0c1014",
  muted: "#272b30",
  "muted-foreground": "#8b929b",
  accent: "#343a42",
  destructive: "#e5484d",
  "ch-speed": "#22d3ee",
  "ch-throttle": "#22c55e",
  "ch-brake": "#ef4444",
  "ch-rpm": "#facc15",
  "ch-gear": "#e6e7ea",
  "ch-steer": "#d946ef",
  "ch-glat": "#fb923c",
  "ch-glong": "#60a5fa",
  "grid-major": "#3a4048",
  "grid-minor": "#272b30",
};

export const LIGHT_THEME: Required<ThemeMap> = {
  background: "#f7f7f8",
  foreground: "#0f1115",
  panel: "#ffffff",
  "panel-2": "#f1f2f4",
  rail: "#eaecef",
  border: "#d8dbe0",
  "border-strong": "#b9bec6",
  primary: "#0891b2",
  "primary-foreground": "#ffffff",
  muted: "#eef0f2",
  "muted-foreground": "#5b6370",
  accent: "#e2e5ea",
  destructive: "#dc2626",
  "ch-speed": "#0891b2",
  "ch-throttle": "#16a34a",
  "ch-brake": "#dc2626",
  "ch-rpm": "#ca8a04",
  "ch-gear": "#0f1115",
  "ch-steer": "#a21caf",
  "ch-glat": "#ea580c",
  "ch-glong": "#2563eb",
  "grid-major": "#cfd3d9",
  "grid-minor": "#e6e8ec",
};

export const HIGH_CONTRAST_THEME: Required<ThemeMap> = {
  ...DARK_THEME,
  background: "#000000",
  panel: "#0a0a0a",
  "panel-2": "#101010",
  rail: "#000000",
  foreground: "#ffffff",
  border: "#5a5a5a",
  "border-strong": "#8a8a8a",
  primary: "#00f0ff",
  "muted-foreground": "#bdbdbd",
};

export const SOLAR_THEME: Required<ThemeMap> = {
  ...DARK_THEME,
  background: "#1a1410",
  panel: "#221a14",
  "panel-2": "#2a2018",
  rail: "#120e0a",
  foreground: "#f5e8d6",
  primary: "#f59e0b",
  "primary-foreground": "#1a1208",
  border: "#3a2c20",
  "muted-foreground": "#b8a890",
  "ch-speed": "#fbbf24",
  "ch-steer": "#f472b6",
};

export const PRESETS: { id: string; label: string; theme: Required<ThemeMap> }[] = [
  { id: "dark", label: "MoTeC Dark", theme: DARK_THEME },
  { id: "light", label: "Daylight", theme: LIGHT_THEME },
  { id: "hc", label: "High Contrast", theme: HIGH_CONTRAST_THEME },
  { id: "solar", label: "Solar", theme: SOLAR_THEME },
];

export function applyTheme(theme: ThemeMap) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const merged = { ...DARK_THEME, ...theme };
  for (const [k, v] of Object.entries(merged)) {
    root.style.setProperty(`--${k}`, v);
  }
}

export function clearAppliedTheme() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const k of Object.keys(DARK_THEME)) {
    root.style.removeProperty(`--${k}`);
  }
}

const LS_KEY = "apextrace.theme.v1";

export function loadLocalTheme(): ThemeMap | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as ThemeMap) : null;
  } catch {
    return null;
  }
}

export function saveLocalTheme(theme: ThemeMap | null) {
  if (typeof localStorage === "undefined") return;
  if (!theme) localStorage.removeItem(LS_KEY);
  else localStorage.setItem(LS_KEY, JSON.stringify(theme));
}