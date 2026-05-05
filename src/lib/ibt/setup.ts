/**
 * Parse the `CarSetup:` block out of an iRacing sessionInfo YAML dump.
 *
 * iRacing emits the setup as an indentation-based YAML tree, e.g.:
 *
 *   CarSetup:
 *    UpdateCount: 4
 *    Chassis:
 *     Front:
 *      ArbBlades: P3
 *      ToeIn: -1/16"
 *     LeftFront:
 *      CornerWeight: 1840 N
 *      RideHeight: 50.0 mm
 *
 * We do a minimal indentation parser (no anchors, no flow, no quotes) which
 * is good enough for every car iRacing ships.
 */

export interface SetupNode {
  [key: string]: string | SetupNode;
}

export interface ParsedSetup {
  updateCount?: number;
  tree: SetupNode;
  /** Flattened "Chassis.LeftFront.RideHeight" -> "50.0 mm" for diffing. */
  flat: Record<string, string>;
}

export function extractCarSetupYaml(yaml: string): string | null {
  if (!yaml) return null;
  const i = yaml.indexOf("\nCarSetup:");
  if (i < 0) return null;
  // Capture everything from CarSetup: up to the next top-level key (line that
 // starts at column 0 with a non-space character) or EOF.
  const after = yaml.slice(i + 1);
  const lines = after.split("\n");
  const out: string[] = [lines[0]]; // "CarSetup:"
  for (let j = 1; j < lines.length; j++) {
    const ln = lines[j];
    if (ln.length && ln[0] !== " " && ln[0] !== "\t") break;
    out.push(ln);
  }
  return out.join("\n");
}

export function parseCarSetup(yaml: string): ParsedSetup | null {
  const block = extractCarSetupYaml(yaml);
  if (!block) return null;

  const lines = block.split("\n").filter((l) => l.trim().length > 0);
  // Stack of (indent, node) — each level pushes a child object onto its parent.
  const root: SetupNode = {};
  const stack: { indent: number; node: SetupNode }[] = [{ indent: -1, node: root }];
  let updateCount: number | undefined;

  for (const raw of lines) {
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    // Pop until we find a parent with a smaller indent.
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].node;

    if (key === "CarSetup") continue;
    if (key === "UpdateCount") {
      const n = parseInt(value, 10);
      if (!Number.isNaN(n)) updateCount = n;
      continue;
    }

    if (value === "") {
      const child: SetupNode = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = value;
    }
  }

  const flat: Record<string, string> = {};
  const walk = (node: SetupNode, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") flat[path] = v;
      else walk(v, path);
    }
  };
  walk(root, "");

  return { updateCount, tree: root, flat };
}

export interface SetupDiff {
  path: string;
  a: string | null;
  b: string | null;
  /** Numeric delta when both sides parse to numbers in the same unit. */
  numericDelta?: { value: number; unit: string };
}

const NUM_RE = /^(-?\d+(?:\.\d+)?)(?:\s*([a-zA-Z%°"'/]+))?$/;

function asNumber(v: string): { value: number; unit: string } | null {
  // Handle simple fractions like "1/16" or "-3/8"
  const frac = v.match(/^(-?\d+)\/(\d+)\s*([a-zA-Z%°"'/]*)$/);
  if (frac) {
    return { value: parseInt(frac[1], 10) / parseInt(frac[2], 10), unit: frac[3] || "" };
  }
  const m = v.match(NUM_RE);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: m[2] || "" };
}

export function diffSetups(a: ParsedSetup, b: ParsedSetup): SetupDiff[] {
  const out: SetupDiff[] = [];
  const keys = new Set([...Object.keys(a.flat), ...Object.keys(b.flat)]);
  for (const k of [...keys].sort()) {
    const av = a.flat[k] ?? null;
    const bv = b.flat[k] ?? null;
    if (av === bv) continue;
    const diff: SetupDiff = { path: k, a: av, b: bv };
    if (av && bv) {
      const an = asNumber(av);
      const bn = asNumber(bv);
      if (an && bn && an.unit === bn.unit) {
        diff.numericDelta = { value: bn.value - an.value, unit: an.unit };
      }
    }
    out.push(diff);
  }
  return out;
}