// Shared plan geometry. Footprint is one or more axis-aligned "wings" (rectangles)
// in metres, in a 0..W (x) by 0..L (z) box. Their union gives L/T/U shapes.
// Used by the 3D generator, the SVG blueprints, and the DXF export.

export function wingsOf(spec) {
  const W = Math.max(1, spec.footprint.width), L = Math.max(1, spec.footprint.length);
  const raw = Array.isArray(spec.footprint?.wings) ? spec.footprint.wings
    : Array.isArray(spec.wings) ? spec.wings : [];
  const wings = raw
    .map(w => ({ x: +w.x || 0, z: +w.z || 0, w: +w.width || +w.w || 0, l: +w.length || +w.l || 0 }))
    .filter(w => w.w > 0.2 && w.l > 0.2);
  if (!wings.length) return { W, L, wings: [{ x: 0, z: 0, w: W, l: L }], simple: true };
  // clamp wings into the bounding box
  for (const w of wings) {
    w.x = Math.min(Math.max(w.x, 0), W); w.z = Math.min(Math.max(w.z, 0), L);
    w.w = Math.min(w.w, W - w.x); w.l = Math.min(w.l, L - w.z);
  }
  return { W, L, wings: wings.filter(w => w.w > 0.2 && w.l > 0.2), simple: false };
}

function uniqSorted(arr) { return [...new Set(arr.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b); }

// Perimeter wall runs of the union, each a maximal straight boundary segment with
// the inward normal and (if on a bounding face) a face label.
export function perimeterRuns(wings, W, L) {
  const xs = uniqSorted(wings.flatMap(w => [w.x, w.x + w.w]));
  const zs = uniqSorted(wings.flatMap(w => [w.z, w.z + w.l]));
  const nx = xs.length - 1, nz = zs.length - 1;
  const covered = (i, j) => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    return wings.some(w => cx > w.x && cx < w.x + w.w && cz > w.z && cz < w.z + w.l);
  };
  // Boundary only where the two cells straddling an edge DIFFER; inward points to the covered side.
  const vIn = (i, j) => { const a = covered(i, j), b = covered(i - 1, j); return a === b ? 0 : a ? 1 : -1; };
  const hIn = (i, j) => { const a = covered(i, j), b = covered(i, j - 1); return a === b ? 0 : a ? 1 : -1; };
  const runs = [];
  for (let i = 0; i <= nx; i++) {
    let j = 0;
    while (j < nz) {
      const inward = vIn(i, j);
      if (inward === 0) { j++; continue; }
      let k = j;
      while (k < nz && vIn(i, k) === inward) k++;
      const x = xs[i];
      runs.push({ orient: "v", x0: x, z0: zs[j], x1: x, z1: zs[k], inward: [inward, 0],
        face: x <= 1e-6 && inward > 0 ? "left" : Math.abs(x - W) <= 1e-6 && inward < 0 ? "right" : null,
        length: zs[k] - zs[j] });
      j = k;
    }
  }
  for (let j = 0; j <= nz; j++) {
    let i = 0;
    while (i < nx) {
      const inward = hIn(i, j);
      if (inward === 0) { i++; continue; }
      let k = i;
      while (k < nx && hIn(k, j) === inward) k++;
      const z = zs[j];
      runs.push({ orient: "h", x0: xs[i], z0: z, x1: xs[k], z1: z, inward: [0, inward],
        face: z <= 1e-6 && inward > 0 ? "front" : Math.abs(z - L) <= 1e-6 && inward < 0 ? "back" : null,
        length: xs[k] - xs[i] });
      i = k;
    }
  }
  return runs;
}

// Distribute a wall's openings along a run of the given length (auto when offset<0 / count>1).
export function layoutOpeningsOn(length, list) {
  const out = [];
  for (const o of list) {
    const count = Math.max(1, o.count || 1);
    const auto = count > 1 || !(o.offset >= 0);
    for (let n = 0; n < count; n++) {
      let center = auto ? (length * (n + 1)) / (count + 1) : o.offset;
      center = Math.min(Math.max(center, o.width / 2 + 0.15), length - o.width / 2 - 0.15);
      out.push({ ...o, center });
    }
  }
  return out;
}

// Pick the longest perimeter run for a named bounding face (for placing that wall's openings).
export function longestRunForFace(runs, face) {
  return runs.filter(r => r.face === face).sort((a, b) => b.length - a.length)[0] || null;
}
