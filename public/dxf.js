// Generates a real DXF (AutoCAD R12 / AC1009) floor plan in metres, from the spec.
// Opens in AutoCAD, LibreCAD, FreeCAD, Fusion 360, QCAD, etc. Layers: WALLS, OPENINGS,
// GRID, DIMENSIONS, TEXT. Model coords: X = width (m), Y = length (m).
import { wingsOf, perimeterRuns, layoutOpeningsOn } from "/geometry.js";

const g = (code, val) => code + "\n" + val + "\n";

function line(layer, x1, y1, x2, y2) {
  return g(0, "LINE") + g(8, layer) + g(10, x1) + g(20, y1) + g(30, 0) + g(11, x2) + g(21, y2) + g(31, 0);
}
function polyClosed(layer, pts) {
  // R12-compatible POLYLINE / VERTEX / SEQEND (70=1 → closed)
  let s = g(0, "POLYLINE") + g(8, layer) + g(66, 1) + g(70, 1);
  for (const [x, y] of pts) s += g(0, "VERTEX") + g(8, layer) + g(10, x) + g(20, y) + g(30, 0);
  return s + g(0, "SEQEND") + g(8, layer);
}
function circle(layer, cx, cy, r) {
  return g(0, "CIRCLE") + g(8, layer) + g(10, cx) + g(20, cy) + g(30, 0) + g(40, r);
}
function arc(layer, cx, cy, r, a0, a1) {
  return g(0, "ARC") + g(8, layer) + g(10, cx) + g(20, cy) + g(30, 0) + g(40, r) + g(50, a0) + g(51, a1);
}
function text(layer, x, y, h, str) {
  return g(0, "TEXT") + g(8, layer) + g(10, x) + g(20, y) + g(30, 0) + g(40, h) + g(1, String(str).replace(/\n/g, " "));
}

const LAYERS = [["WALLS", 7], ["OPENINGS", 3], ["GRID", 1], ["DIMENSIONS", 5], ["TEXT", 4]];

function header() {
  let s = g(0, "SECTION") + g(2, "HEADER") + g(9, "$ACADVER") + g(1, "AC1009") + g(9, "$INSUNITS") + g(70, 6) + g(0, "ENDSEC");
  s += g(0, "SECTION") + g(2, "TABLES") + g(0, "TABLE") + g(2, "LAYER") + g(70, LAYERS.length);
  for (const [name, color] of LAYERS)
    s += g(0, "LAYER") + g(2, name) + g(70, 0) + g(62, color) + g(6, "CONTINUOUS");
  s += g(0, "ENDTAB") + g(0, "ENDSEC");
  return s;
}

export function toDXF(spec) {
  const { W, L, wings } = wingsOf(spec);
  const t = Math.min(Math.max(spec.walls?.thickness || 0.15, 0.05), 0.5);
  const openWalls = new Set(spec.walls?.openWalls || []);
  const runs = perimeterRuns(wings, W, L);
  let e = "";

  // walls — double-line (rectangle per run offset inward by t). Open sides: dashed centre line.
  for (const r of runs) {
    const [ix, iz] = r.inward;
    if (openWalls.has(r.face)) { e += line("OPENINGS", r.x0, r.z0, r.x1, r.z1); continue; }
    const p0 = [r.x0, r.z0], p1 = [r.x1, r.z1];
    const p2 = [r.x1 + ix * t, r.z1 + iz * t], p3 = [r.x0 + ix * t, r.z0 + iz * t];
    e += polyClosed("WALLS", [p0, p1, p2, p3]);
  }

  // openings — jambs + door swing, placed along the matching face run
  const byFace = { front: [], back: [], left: [], right: [] };
  for (const o of (spec.openings || [])) if ((o.storey || 1) === 1 && byFace[o.wall]) byFace[o.wall].push(o);
  for (const face of Object.keys(byFace)) {
    if (!byFace[face].length || openWalls.has(face)) continue;
    const run = runs.filter(r => r.face === face).sort((a, b) => b.length - a.length)[0];
    if (!run) continue;
    const along = run.orient === "h" ? "x" : "z";
    const base = run.orient === "h" ? run.x0 : run.z0;
    const fixed = run.orient === "h" ? run.z0 : run.x0;
    const [ix, iz] = run.inward;
    for (const o of layoutOpeningsOn(run.length, byFace[face])) {
      const a = base + o.center - o.width / 2, b = base + o.center + o.width / 2;
      if (run.orient === "h") {          // wall runs along X, thickness along Z
        e += line("OPENINGS", a, fixed, a, fixed + iz * t);          // jamb
        e += line("OPENINGS", b, fixed, b, fixed + iz * t);          // jamb
        if (o.type === "door") {
          e += line("OPENINGS", a, fixed, a, fixed + iz * o.width);  // door leaf
          const s0 = iz > 0 ? 0 : 180, s1 = iz > 0 ? 90 : 270;
          e += arc("OPENINGS", a, fixed, o.width, s0, s1);
        } else { e += line("OPENINGS", a, fixed + iz * t / 2, b, fixed + iz * t / 2); }
      } else {                           // wall runs along Z, thickness along X
        e += line("OPENINGS", fixed, a, fixed + ix * t, a);
        e += line("OPENINGS", fixed, b, fixed + ix * t, b);
        if (o.type === "door") {
          e += line("OPENINGS", fixed, a, fixed + ix * o.width, a);
          const s0 = ix > 0 ? 270 : 90, s1 = ix > 0 ? 360 : 180;
          e += arc("OPENINGS", fixed, a, o.width, s0, s1);
        } else { e += line("OPENINGS", fixed + ix * t / 2, a, fixed + ix * t / 2, b); }
      }
    }
  }

  // structural column grid (main frames along the length on x=0 and x=W)
  const bay = Math.min(Math.max(spec.structure?.baySpacing || 3, 1.5), Math.max(2, L));
  const n = Math.max(2, Math.round(L / bay) + 1);
  for (let i = 0; i < n; i++) {
    const z = (L * i) / (n - 1);
    for (const x of [0, W]) { e += circle("GRID", x, z, 0.18); e += text("GRID", x - 0.6, z - 0.09, 0.25, i + 1); }
  }

  // overall dimensions
  const dy = -1.2, dx = -1.2;
  e += line("DIMENSIONS", 0, dy, W, dy) + line("DIMENSIONS", 0, dy + 0.15, 0, dy - 0.15) + line("DIMENSIONS", W, dy + 0.15, W, dy - 0.15);
  e += text("DIMENSIONS", W / 2 - 0.5, dy + 0.2, 0.35, W.toFixed(2) + " m");
  e += line("DIMENSIONS", dx, 0, dx, L) + line("DIMENSIONS", dx + 0.15, 0, dx - 0.15, 0) + line("DIMENSIONS", dx + 0.15, L, dx - 0.15, L);
  e += text("DIMENSIONS", dx - 0.4, L / 2, 0.35, L.toFixed(2) + " m");

  // title
  e += text("TEXT", 0, L + 0.7, 0.5, (spec.name || "Redgum") + " — FLOOR PLAN");
  e += text("TEXT", 0, L + 0.2, 0.28, (spec.buildingType || "") + "  |  " + (spec.structure?.system || "") + "  |  metres");

  const entities = g(0, "SECTION") + g(2, "ENTITIES") + e + g(0, "ENDSEC");
  return header() + entities + g(0, "EOF");
}
