// Generates blueprint-style SVG sheets (floor plan + elevations) from a building spec.
const NS = "http://www.w3.org/2000/svg";
const INK = "#1b2a44", INK2 = "#4a5b78", RED = "#c0304c", PAPER = "#f7f5ef", GRIDC = "#c7d0dd";

function esc(s) { return String(s == null ? "" : s).replace(/[<&>]/g, c => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;" }[c])); }
function fmt(m) { return (Math.round(m * 100) / 100).toString(); }

// A drawing frame: SVG string builder with border + title block.
function sheet({ title, spec, bodyW, bodyH, scaleLabel }, drawFn) {
  const W = 1180, PAD = 26, TB = 96;
  const areaX = PAD, areaY = PAD, areaW = W - PAD * 2;
  const areaH = bodyH;
  const H = areaY + areaH + 16 + TB + PAD;
  const inner = drawFn({ ox: areaX, oy: areaY, w: areaW, h: areaH });
  const tbY = areaY + areaH + 16;
  const date = new Date().toISOString().slice(0, 10);
  return `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" class="sheet" width="${W}" height="${H}" font-family="IBM Plex Mono, monospace">
  <rect x="0" y="0" width="${W}" height="${H}" fill="${PAPER}"/>
  <rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="${INK}" stroke-width="2"/>
  <rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="${INK}" stroke-width="0.6"/>
  ${inner}
  <g>
    <rect x="${PAD}" y="${tbY}" width="${areaW}" height="${TB}" fill="none" stroke="${INK}" stroke-width="1.4"/>
    <line x1="${PAD + 470}" y1="${tbY}" x2="${PAD + 470}" y2="${tbY + TB}" stroke="${INK}" stroke-width="1"/>
    <line x1="${PAD + 800}" y1="${tbY}" x2="${PAD + 800}" y2="${tbY + TB}" stroke="${INK}" stroke-width="1"/>
    <text x="${PAD + 16}" y="${tbY + 34}" fill="${RED}" font-size="26" font-weight="700" font-family="Syne, sans-serif">STRUCTURA</text>
    <text x="${PAD + 16}" y="${tbY + 60}" fill="${INK}" font-size="15" font-weight="700">${esc(spec.name || "Untitled structure")}</text>
    <text x="${PAD + 16}" y="${tbY + 80}" fill="${INK2}" font-size="11">${esc(spec.buildingType || "")} · ${esc(spec.structure?.system || "")}</text>
    <text x="${PAD + 486}" y="${tbY + 26}" fill="${INK2}" font-size="10">DRAWING</text>
    <text x="${PAD + 486}" y="${tbY + 48}" fill="${INK}" font-size="15" font-weight="700">${esc(title)}</text>
    <text x="${PAD + 486}" y="${tbY + 74}" fill="${INK2}" font-size="10">UNITS: METRES  ·  ${esc(scaleLabel || "NTS")}</text>
    <text x="${PAD + 816}" y="${tbY + 26}" fill="${INK2}" font-size="10">FOOTPRINT</text>
    <text x="${PAD + 816}" y="${tbY + 48}" fill="${INK}" font-size="15" font-weight="700">${fmt(spec.footprint.width)} × ${fmt(spec.footprint.length)} m</text>
    <text x="${PAD + 816}" y="${tbY + 70}" fill="${INK2}" font-size="10">STOREYS ${spec.storeys}  ·  ${date}</text>
    <text x="${PAD + 816}" y="${tbY + 86}" fill="${INK2}" font-size="9">A Radical Party Project — NOT FOR CONSTRUCTION</text>
  </g>
</svg>`;
}

function hDim(x1, x2, y, label, flip) {
  const tick = 5, ty = flip ? y + 16 : y - 6;
  return `<g stroke="${RED}" stroke-width="0.9" fill="${RED}" font-size="12">
    <line x1="${x1}" y1="${y - tick}" x2="${x1}" y2="${y + tick}"/>
    <line x1="${x2}" y1="${y - tick}" x2="${x2}" y2="${y + tick}"/>
    <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>
    <text x="${(x1 + x2) / 2}" y="${ty}" text-anchor="middle" stroke="none">${esc(label)}</text>
  </g>`;
}
function vDim(y1, y2, x, label, left) {
  const tick = 5, tx = left ? x - 8 : x + 8, anchor = left ? "end" : "start";
  return `<g stroke="${RED}" stroke-width="0.9" fill="${RED}" font-size="12">
    <line x1="${x - tick}" y1="${y1}" x2="${x + tick}" y2="${y1}"/>
    <line x1="${x - tick}" y1="${y2}" x2="${x + tick}" y2="${y2}"/>
    <line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>
    <text x="${tx}" y="${(y1 + y2) / 2 + 4}" text-anchor="${anchor}" stroke="none" transform="rotate(-90 ${tx} ${(y1 + y2) / 2})">${esc(label)}</text>
  </g>`;
}

function expandOpenings(L, list) {
  const out = [];
  for (const o of list) {
    const count = Math.max(1, o.count || 1);
    const auto = count > 1 || !(o.offset >= 0);
    for (let i = 0; i < count; i++) {
      let center = auto ? (L * (i + 1)) / (count + 1) : o.offset;
      center = Math.min(Math.max(center, o.width / 2 + 0.15), L - o.width / 2 - 0.15);
      out.push({ ...o, center });
    }
  }
  return out;
}

export function floorPlanSVG(spec) {
  const W = spec.footprint.width, L = spec.footprint.length;
  const t = Math.min(Math.max(spec.walls?.thickness || 0.15, 0.05), 0.5);
  return sheet({ title: "FLOOR PLAN — LEVEL 1", spec, bodyH: 560, scaleLabel: "SCALE TO FIT" }, ({ ox, oy, w, h }) => {
    const margin = 90;
    const s = Math.min((w - margin * 2) / W, (h - margin * 2) / L);
    const gx = ox + (w - W * s) / 2, gy = oy + (h - L * s) / 2;
    const X = (mx) => gx + mx * s;         // model x (0..W) -> paper
    const Y = (mz) => gy + mz * s;         // model z (0..L) -> paper (down)
    const ts = t * s;
    const openWalls = new Set(spec.walls?.openWalls || []);
    let g = "";
    // walls drawn per-side so open sides can be omitted (carports/pavilions)
    const sideRect = { front: [X(0), Y(0), W * s, ts], back: [X(0), Y(L) - ts, W * s, ts],
      left: [X(0), Y(0), ts, L * s], right: [X(W) - ts, Y(0), ts, L * s] };
    for (const wall of ["front", "back", "left", "right"]) {
      const [rx, ry, rw, rh] = sideRect[wall];
      if (openWalls.has(wall)) {
        g += `<line x1="${rx}" y1="${ry}" x2="${rw > rh ? rx + rw : rx}" y2="${rw > rh ? ry : ry + rh}" stroke="${INK2}" stroke-width="1" stroke-dasharray="6 4"/>`;
      } else {
        g += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${INK}"/>`;
      }
    }
    // openings — punch white gaps + symbols
    const ground = (spec.openings || []).filter(o => (o.storey || 1) === 1);
    const draw = (wall, arr) => {
      for (const o of expandOpenings(wall === "front" || wall === "back" ? W : L, arr)) {
        let x1, y1, x2, y2, horiz;
        if (wall === "front") { horiz = true; x1 = X(o.center - o.width / 2); x2 = X(o.center + o.width / 2); y1 = Y(0); y2 = Y(0) + ts; }
        else if (wall === "back") { horiz = true; x1 = X(o.center - o.width / 2); x2 = X(o.center + o.width / 2); y1 = Y(L) - ts; y2 = Y(L); }
        else if (wall === "left") { horiz = false; y1 = Y(o.center - o.width / 2); y2 = Y(o.center + o.width / 2); x1 = X(0); x2 = X(0) + ts; }
        else { horiz = false; y1 = Y(o.center - o.width / 2); y2 = Y(o.center + o.width / 2); x1 = X(W) - ts; x2 = X(W); }
        g += `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" fill="${PAPER}"/>`;
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        if (o.type === "window") {
          g += horiz
            ? `<line x1="${Math.min(x1, x2)}" y1="${cy}" x2="${Math.max(x1, x2)}" y2="${cy}" stroke="${INK}" stroke-width="1.4"/>`
            : `<line x1="${cx}" y1="${Math.min(y1, y2)}" x2="${cx}" y2="${Math.max(y1, y2)}" stroke="${INK}" stroke-width="1.4"/>`;
        } else if (o.type === "door") {
          const wpx = o.width * s;
          if (wall === "front") g += `<line x1="${X(o.center - o.width / 2)}" y1="${Y(0)}" x2="${X(o.center - o.width / 2)}" y2="${Y(0) + wpx}" stroke="${INK}" stroke-width="1.4"/><path d="M ${X(o.center - o.width / 2)} ${Y(0) + wpx} A ${wpx} ${wpx} 0 0 1 ${X(o.center + o.width / 2)} ${Y(0)}" fill="none" stroke="${INK2}" stroke-width="0.8"/>`;
          else if (wall === "back") g += `<line x1="${X(o.center - o.width / 2)}" y1="${Y(L)}" x2="${X(o.center - o.width / 2)}" y2="${Y(L) - wpx}" stroke="${INK}" stroke-width="1.4"/><path d="M ${X(o.center - o.width / 2)} ${Y(L) - wpx} A ${wpx} ${wpx} 0 0 0 ${X(o.center + o.width / 2)} ${Y(L)}" fill="none" stroke="${INK2}" stroke-width="0.8"/>`;
          else if (wall === "left") g += `<line x1="${X(0)}" y1="${Y(o.center - o.width / 2)}" x2="${X(0) + wpx}" y2="${Y(o.center - o.width / 2)}" stroke="${INK}" stroke-width="1.4"/><path d="M ${X(0) + wpx} ${Y(o.center - o.width / 2)} A ${wpx} ${wpx} 0 0 0 ${X(0)} ${Y(o.center + o.width / 2)}" fill="none" stroke="${INK2}" stroke-width="0.8"/>`;
          else g += `<line x1="${X(W)}" y1="${Y(o.center - o.width / 2)}" x2="${X(W) - wpx}" y2="${Y(o.center - o.width / 2)}" stroke="${INK}" stroke-width="1.4"/><path d="M ${X(W) - wpx} ${Y(o.center - o.width / 2)} A ${wpx} ${wpx} 0 0 1 ${X(W)} ${Y(o.center + o.width / 2)}" fill="none" stroke="${INK2}" stroke-width="0.8"/>`;
        } else { // roller / garage / opening
          g += `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" fill="none" stroke="${INK2}" stroke-width="1" stroke-dasharray="3 2"/>`;
        }
      }
    };
    const byWall = { front: [], back: [], left: [], right: [] };
    for (const o of ground) (byWall[o.wall] || byWall.front).push(o);
    draw("front", byWall.front); draw("back", byWall.back); draw("left", byWall.left); draw("right", byWall.right);

    // structural column grid
    const bay = Math.min(Math.max(spec.structure?.baySpacing || 3, 1.5), Math.max(2, L));
    const n = Math.max(2, Math.round(L / bay) + 1);
    for (let i = 0; i < n; i++) {
      const mz = (L * i) / (n - 1);
      for (const mx of [0, W]) {
        g += `<circle cx="${X(mx)}" cy="${Y(mz)}" r="4.5" fill="none" stroke="${RED}" stroke-width="1.2"/><line x1="${X(mx) - 3}" y1="${Y(mz)}" x2="${X(mx) + 3}" y2="${Y(mz)}" stroke="${RED}" stroke-width="0.8"/><line x1="${X(mx)}" y1="${Y(mz) - 3}" x2="${X(mx)}" y2="${Y(mz) + 3}" stroke="${RED}" stroke-width="0.8"/>`;
      }
      g += `<text x="${X(0) - 26}" y="${Y(mz) + 4}" fill="${INK2}" font-size="11" text-anchor="middle">${i + 1}</text>`;
    }
    g += `<text x="${X(0)}" y="${Y(L) + 40}" fill="${INK2}" font-size="11">A</text><text x="${X(W)}" y="${Y(L) + 40}" fill="${INK2}" font-size="11">B</text>`;

    // dimensions
    g += hDim(X(0), X(W), Y(L) + 44, fmt(W) + " m");
    g += vDim(Y(0), Y(L), X(0) - 44, fmt(L) + " m", true);
    // north arrow
    const nx = ox + w - 40, ny = oy + 40;
    g += `<g stroke="${INK}" fill="${INK}"><line x1="${nx}" y1="${ny + 22}" x2="${nx}" y2="${ny - 18}" stroke-width="1.4"/><path d="M ${nx} ${ny - 22} l -6 12 l 6 -4 l 6 4 z"/><text x="${nx}" y="${ny + 38}" text-anchor="middle" font-size="12" stroke="none">N</text></g>`;
    return g;
  });
}

// Roof outline (above eave) for an elevation, in model coords: returns points [u(0..fw), v(height)].
// `span` = the dimension the roof actually slopes across (gable-end width); rise derives from it,
// so ridge height is identical whether viewed from the gable end or the eave side.
function roofProfile(spec, faceWidth, span, gableEnd, wallTop) {
  const r = spec.roof || {}, o = Math.min(Math.max(r.overhang || 0.3, 0), 2);
  const pitch = (r.pitchDeg || 0) * Math.PI / 180;
  const fw = faceWidth;
  if (r.type === "flat") { const p = 0.4; return { pts: [[-o, wallTop], [fw + o, wallTop], [fw + o, wallTop + p], [-o, wallTop + p]], ridge: null }; }
  if (r.type === "skillion") {
    const rise = span * Math.tan(pitch);
    if (gableEnd) return { pts: [[-o, wallTop - o * Math.tan(pitch)], [fw + o, wallTop + rise + o * Math.tan(pitch)]], slope: true };
    return { pts: [[-o, wallTop], [fw + o, wallTop], [fw + o, wallTop + rise], [-o, wallTop + rise]], ridge: wallTop + rise };
  }
  if (r.type === "gable" || r.type === "hip") {
    const rise = (span / 2) * Math.tan(pitch);
    if (gableEnd) return { pts: [[-o, wallTop - o * Math.tan(pitch)], [fw / 2, wallTop + rise], [fw + o, wallTop - o * Math.tan(pitch)]], ridge: wallTop + rise };
    return { pts: [[-o, wallTop], [fw + o, wallTop], [fw + o, wallTop + rise], [-o, wallTop + rise]], ridge: wallTop + rise, eaveTop: true };
  }
  return { pts: [[-o, wallTop], [fw + o, wallTop]], ridge: null };
}

function elevationSVG(spec, view) {
  const W = spec.footprint.width, L = spec.footprint.length;
  const storeyH = Math.max(2.1, spec.wallHeight || 3), storeys = Math.min(Math.max(spec.storeys || 1, 1), 8);
  const wallTop = storeyH * storeys;
  const faceWidth = (view === "front" || view === "back") ? W : L;
  const r = spec.roof || {};
  const ridgeAlongZ = (r.ridgeAxis || (L >= W ? "length" : "width")) === "length";
  // gable end faces are perpendicular to the ridge
  const gableEnd = ridgeAlongZ ? (view === "front" || view === "back") : (view === "left" || view === "right");
  const span = ridgeAlongZ ? W : L;   // the roof slopes across this dimension
  const prof = roofProfile(spec, faceWidth, span, gableEnd, wallTop);
  const totalH = Math.max(wallTop, prof.ridge || wallTop) + 1;
  const title = { front: "FRONT ELEVATION", back: "REAR ELEVATION", left: "LEFT ELEVATION", right: "RIGHT ELEVATION" }[view];

  return sheet({ title, spec, bodyH: 430, scaleLabel: "SCALE TO FIT" }, ({ ox, oy, w, h }) => {
    const margin = 80;
    const s = Math.min((w - margin * 2) / (faceWidth + 1.2), (h - margin * 2) / totalH);
    const baseY = oy + h - margin;                 // ground line (v=0)
    const gx = ox + (w - faceWidth * s) / 2;
    const X = (u) => gx + u * s;
    const V = (v) => baseY - v * s;
    let g = "";
    // ground + hatch
    g += `<line x1="${ox + 30}" y1="${baseY}" x2="${ox + w - 30}" y2="${baseY}" stroke="${INK}" stroke-width="2"/>`;
    for (let x = ox + 34; x < ox + w - 34; x += 12) g += `<line x1="${x}" y1="${baseY}" x2="${x - 8}" y2="${baseY + 9}" stroke="${INK2}" stroke-width="0.7"/>`;
    // wall body — or posts if this side is open
    const isOpen = (spec.walls?.openWalls || []).includes(view);
    if (isOpen) {
      const bay = Math.min(Math.max(spec.structure?.baySpacing || 3, 1.5), Math.max(2, faceWidth));
      const np = Math.max(2, Math.round(faceWidth / bay) + 1);
      for (let i = 0; i < np; i++) {
        const u = (faceWidth * i) / (np - 1);
        g += `<rect x="${X(u) - 3}" y="${V(wallTop)}" width="6" height="${wallTop * s}" fill="#d7dadf" stroke="${INK}" stroke-width="1.2"/>`;
      }
      g += `<rect x="${X(0)}" y="${V(wallTop) - 5}" width="${faceWidth * s}" height="9" fill="#d7dadf" stroke="${INK}" stroke-width="1.2"/>`;
    } else {
      g += `<rect x="${X(0)}" y="${V(wallTop)}" width="${faceWidth * s}" height="${wallTop * s}" fill="#eef0ec" stroke="${INK}" stroke-width="1.8"/>`;
      for (let i = 1; i < storeys; i++) g += `<line x1="${X(0)}" y1="${V(i * storeyH)}" x2="${X(faceWidth)}" y2="${V(i * storeyH)}" stroke="${INK2}" stroke-width="0.7" stroke-dasharray="4 3"/>`;
    }
    // roof outline
    const pts = prof.pts.map(([u, v]) => `${X(u)},${V(v)}`).join(" ");
    if (prof.slope !== undefined && prof.pts.length === 2) {
      // skillion mono line -> closed polygon down to eave
      g += `<polygon points="${pts} ${X(faceWidth + (r.overhang || 0.3))},${V(wallTop)} ${X(-(r.overhang || 0.3))},${V(wallTop)}" fill="#dfe3de" stroke="${INK}" stroke-width="1.6"/>`;
    } else if (gableEnd && (r.type === "gable" || r.type === "hip")) {
      g += `<polygon points="${pts}" fill="#dfe3de" stroke="${INK}" stroke-width="1.6"/>`;
    } else {
      g += `<polygon points="${pts}" fill="#dfe3de" stroke="${INK}" stroke-width="1.6"/>`;
      if (prof.ridge) g += `<line x1="${X(-(r.overhang || 0.3))}" y1="${V(prof.ridge)}" x2="${X(faceWidth + (r.overhang || 0.3))}" y2="${V(prof.ridge)}" stroke="${INK}" stroke-width="1"/>`;
    }
    // openings on this wall, all storeys
    const arr = (spec.openings || []).filter(o => o.wall === view);
    const byStorey = {};
    for (const o of arr) (byStorey[o.storey || 1] = byStorey[o.storey || 1] || []).push(o);
    for (const st of Object.keys(byStorey)) {
      const floorV = (st - 1) * storeyH;
      for (const o of expandOpenings(faceWidth, byStorey[st])) {
        const x = X(o.center - o.width / 2), y = V(floorV + (o.sillHeight || 0) + o.height);
        const wpx = o.width * s, hpx = o.height * s;
        const fill = o.type === "window" ? "#cfe4fb" : o.type === "door" ? "#c9b79b" : "#d7dadf";
        g += `<rect x="${x}" y="${y}" width="${wpx}" height="${hpx}" fill="${fill}" stroke="${INK}" stroke-width="1.3"/>`;
        if (o.type === "window") g += `<line x1="${x + wpx / 2}" y1="${y}" x2="${x + wpx / 2}" y2="${y + hpx}" stroke="${INK2}" stroke-width="0.8"/><line x1="${x}" y1="${y + hpx / 2}" x2="${x + wpx}" y2="${y + hpx / 2}" stroke="${INK2}" stroke-width="0.8"/>`;
        if (o.type === "rollerDoor" || o.type === "garage") for (let yy = y + 4; yy < y + hpx; yy += 5) g += `<line x1="${x}" y1="${yy}" x2="${x + wpx}" y2="${yy}" stroke="${INK2}" stroke-width="0.6"/>`;
      }
    }
    // dimensions
    g += hDim(X(0), X(faceWidth), baseY + 34, fmt(faceWidth) + " m", true);
    g += vDim(V(wallTop), baseY, X(0) - 34, "eave " + fmt(wallTop) + " m", true);
    if (prof.ridge) g += vDim(V(prof.ridge), baseY, X(faceWidth) + 34, "ridge " + fmt(prof.ridge) + " m", false);
    return g;
  });
}

export function elevationsSVG(spec) {
  return elevationSVG(spec, "front") + elevationSVG(spec, "left");
}
export { elevationSVG };
