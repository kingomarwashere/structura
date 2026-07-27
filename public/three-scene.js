import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { wingsOf, perimeterRuns, layoutOpeningsOn, longestRunForFace } from "/geometry.js";

const DEG = Math.PI / 180;

// Materials (created lazily, reused)
function mats(spec) {
  const wallColor = /^#[0-9a-f]{6}$/i.test(spec?.walls?.colorHex || "") ? spec.walls.colorHex : "#c9c2b6";
  return {
    wall: new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.92, metalness: 0.02 }),
    roof: new THREE.MeshStandardMaterial({ color: "#70757c", roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: "#a9d4ff", roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.42 }),
    door: new THREE.MeshStandardMaterial({ color: "#5b4632", roughness: 0.7 }),
    roller: new THREE.MeshStandardMaterial({ color: "#b7bcc2", roughness: 0.5, metalness: 0.4 }),
    slab: new THREE.MeshStandardMaterial({ color: "#8f8d88", roughness: 0.95 }),
    floor: new THREE.MeshStandardMaterial({ color: "#d8cfc0", roughness: 0.9 }),
    frame: new THREE.MeshStandardMaterial({ color: "#FF2D55", roughness: 0.4, metalness: 0.5 }),
    post: new THREE.MeshStandardMaterial({ color: "#5a5d62", roughness: 0.5, metalness: 0.35 }),
  };
}

function box(x0, x1, y0, y1, z0, z1, material) {
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
  const g = new THREE.BoxGeometry(Math.max(w, 1e-4), Math.max(h, 1e-4), Math.max(d, 1e-4));
  const m = new THREE.Mesh(g, material);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return m;
}

// Build one wall in local space: runs along local +X from 0..L, thickness t centred on z=0,
// base at y=y0. Openings: {type,width,height,sillHeight,center}. Returns a THREE.Group.
function buildWall(L, height, t, y0, openings, M) {
  const g = new THREE.Group();
  const th = t / 2;
  const oc = [...openings].sort((a, b) => a.center - b.center);
  let cursor = 0;
  for (const o of oc) {
    let left = o.center - o.width / 2;
    let right = o.center + o.width / 2;
    left = Math.max(left, cursor);
    if (right <= left) continue;
    right = Math.min(right, L);
    if (left > cursor + 1e-3) g.add(box(cursor, left, y0, y0 + height, -th, th, M.wall)); // solid pier
    const sill = Math.max(0, o.sillHeight || 0);
    const head = Math.min(height, sill + o.height);
    if (sill > 1e-3) g.add(box(left, right, y0, y0 + sill, -th, th, M.wall)); // under sill
    if (head < height - 1e-3) g.add(box(left, right, y0 + head, y0 + height, -th, th, M.wall)); // lintel/head
    // fill the opening
    let fillMat = M.glass, inset = th * 0.4;
    if (o.type === "door" || o.type === "garage") fillMat = M.door;
    else if (o.type === "rollerDoor") fillMat = M.roller;
    else if (o.type === "opening") fillMat = null;
    if (fillMat) g.add(box(left + 0.03, right - 0.03, y0 + sill + 0.03, y0 + head - 0.03, -inset, inset, fillMat));
    cursor = right;
  }
  if (cursor < L - 1e-3) g.add(box(cursor, L, y0, y0 + height, -th, th, M.wall));
  return g;
}

function triPrism(pts, thickness, material) {
  // pts: array of [x,y] in a plane, extruded along Z by `thickness` centred on 0.
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  return new THREE.Mesh(geo, material);
}

export class Scene3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x0e0d0b, 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0e0d0b, 60, 220);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    this.camera.position.set(18, 14, 22);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 3, 0);

    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x2a2620, 0.9);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff3e0, 1.6);
    dir.position.set(30, 45, 20);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
    dir2.position.set(-25, 20, -18);
    this.scene.add(dir2);

    // ground
    const grid = new THREE.GridHelper(400, 200, 0x2a2620, 0x1a1712);
    grid.position.y = 0;
    this.scene.add(grid);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(200, 64),
      new THREE.MeshStandardMaterial({ color: 0x14120d, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    this.scene.add(ground);

    this.building = new THREE.Group();
    this.frameGroup = new THREE.Group();
    this.scene.add(this.building);
    this.scene.add(this.frameGroup);

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
    this._resize();
    this._animate();
  }

  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    this._raf = requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  clear(group) { while (group.children.length) { const c = group.children.pop(); c.geometry?.dispose?.(); group.remove(c); } }

  setSpec(spec) {
    this.spec = spec;
    this.clear(this.building);
    this.clear(this.frameGroup);
    const M = mats(spec);
    this.M = M;

    const { W, L, wings } = wingsOf(spec);
    const t = Math.min(Math.max(spec.walls?.thickness || 0.15, 0.05), 0.5);
    const storeyH = Math.max(2.1, spec.wallHeight || 3);
    const storeys = Math.min(Math.max(spec.storeys || 1, 1), 8);
    const ox = -W / 2, oz = -L / 2;                 // offset that centres the bounding box
    const runs = perimeterRuns(wings, W, L);
    const openWalls = new Set(spec.walls?.openWalls || []);
    const bay0 = Math.min(Math.max(spec.structure?.baySpacing || 3, 1.5), Math.max(2, L));
    const eaveC = 0.1;

    // Foundation slab per wing
    for (const wg of wings)
      this.building.add(box(ox + wg.x - 0.2, ox + wg.x + wg.w + 0.2, -0.35, 0, oz + wg.z - 0.2, oz + wg.z + wg.l + 0.2, M.slab));

    const openingsByStorey = {};
    for (const o of spec.openings || []) {
      const s = Math.min(Math.max(o.storey || 1, 1), storeys);
      (openingsByStorey[s] = openingsByStorey[s] || []).push(o);
    }

    const placeWall = (run, y0, ops) => {
      const wg = buildWall(run.length, storeyH, t, 0, layoutOpeningsOn(run.length, ops), M);
      const [ix, iz] = run.inward;
      if (run.orient === "h") wg.position.set(ox + run.x0, y0, oz + run.z0 + iz * t / 2);
      else { wg.position.set(ox + run.x0 + ix * t / 2, y0, oz + run.z0); wg.rotation.y = -Math.PI / 2; }
      this.building.add(wg);
    };
    const placePosts = (run, y0) => {
      const [ix, iz] = run.inward, len = run.length, c = 0.09;
      const np = Math.max(2, Math.round(len / bay0) + 1);
      for (let i = 0; i < np; i++) {
        const f = (len * i) / (np - 1);
        const x = run.orient === "h" ? ox + run.x0 + f : ox + run.x0 + ix * t / 2;
        const z = run.orient === "h" ? oz + run.z0 + iz * t / 2 : oz + run.z0 + f;
        this.building.add(box(x - c, x + c, y0, y0 + storeyH, z - c, z + c, M.post));
      }
      if (run.orient === "h") { const z = oz + run.z0 + iz * t / 2; this.building.add(box(ox + run.x0, ox + run.x1, y0 + storeyH - eaveC, y0 + storeyH + eaveC, z - eaveC, z + eaveC, M.post)); }
      else { const x = ox + run.x0 + ix * t / 2; this.building.add(box(x - eaveC, x + eaveC, y0 + storeyH - eaveC, y0 + storeyH + eaveC, oz + run.z0, oz + run.z1, M.post)); }
    };

    for (let s = 0; s < storeys; s++) {
      const y0 = s * storeyH;
      if (s > 0) for (const wg of wings) this.building.add(box(ox + wg.x, ox + wg.x + wg.w, y0 - 0.12, y0, oz + wg.z, oz + wg.z + wg.l, M.floor));
      const ops = openingsByStorey[s + 1] || [];
      const byFace = { front: [], back: [], left: [], right: [] };
      for (const o of ops) (byFace[o.wall] || byFace.front).push(o);
      const runOps = new Map();
      for (const face of ["front", "back", "left", "right"]) {
        if (!byFace[face].length || openWalls.has(face)) continue;
        const run = longestRunForFace(runs, face);
        if (run) runOps.set(run, byFace[face]);
      }
      for (const run of runs) {
        if (openWalls.has(run.face)) placePosts(run, y0);
        else placeWall(run, y0, runOps.get(run) || []);
      }
    }

    const wallTop = storeys * storeyH;
    // Roof per wing (single-wing = respect the spec's ridgeAxis; multi-wing = ridge along each wing's longer axis)
    let peak = wallTop;
    for (const wg of wings) {
      const grp = new THREE.Group();
      const roof = wings.length === 1 ? (spec.roof || {}) : { ...(spec.roof || {}), ridgeAxis: wg.l >= wg.w ? "length" : "width" };
      const p = this._roofForRect(roof, wg.w, wg.l, wallTop, M, grp);
      grp.position.set(ox + wg.x + wg.w / 2, 0, oz + wg.z + wg.l / 2);
      this.building.add(grp);
      peak = Math.max(peak, p);
    }
    this.roofPeak = peak;
    this._buildFrame(spec, W, L, wallTop, storeys, storeyH, M, wings, runs, ox, oz);

    this.frameGroup.visible = false;
    this._fit();
  }

  // Build a roof for a w×l rectangle centred at the target group's origin. Returns the peak height.
  _roofForRect(r, W, L, wallTop, M, target) {
    const type = r.type || "gable";
    const o = Math.min(Math.max(r.overhang || 0.3, 0), 2);
    const pitch = Math.min(Math.max(r.pitchDeg || 0, 0), 60) * DEG;
    const hx = W / 2, hz = L / 2;
    const rt = 0.12; // roof panel thickness

    const addSlopePair = (spanHalf, depthHalf, axis) => {
      const rise = spanHalf * Math.tan(pitch);
      const ridgeY = wallTop + rise;
      const outer = spanHalf + o;
      const slopeLen = outer / Math.cos(pitch);
      const depth = 2 * (depthHalf + o);
      const eaveOuterY = wallTop - o * Math.tan(pitch);
      const midY = (eaveOuterY + ridgeY) / 2;
      for (const sign of [-1, 1]) {
        const geo = axis === "x"
          ? new THREE.BoxGeometry(slopeLen, rt, depth)
          : new THREE.BoxGeometry(depth, rt, slopeLen);
        const mesh = new THREE.Mesh(geo, M.roof);
        if (axis === "x") { mesh.rotation.z = -sign * pitch; mesh.position.set(sign * outer / 2, midY, 0); }
        else { mesh.rotation.x = sign * pitch; mesh.position.set(0, midY, sign * outer / 2); }
        target.add(mesh);
      }
      return { rise, ridgeY };
    };

    if (type === "flat") {
      target.add(box(-hx - o, hx + o, wallTop, wallTop + rt, -hz - o, hz + o, M.roof));
      const p = 0.4;
      target.add(box(-hx, hx, wallTop + rt, wallTop + p, -hz, -hz + 0.12, M.wall));
      target.add(box(-hx, hx, wallTop + rt, wallTop + p, hz - 0.12, hz, M.wall));
      target.add(box(-hx, -hx + 0.12, wallTop + rt, wallTop + p, -hz, hz, M.wall));
      target.add(box(hx - 0.12, hx, wallTop + rt, wallTop + p, -hz, hz, M.wall));
      return wallTop + p;
    }

    if (type === "skillion") {
      const alongZ = (r.ridgeAxis === "length");
      const span = alongZ ? L : W;
      const rise = span * Math.tan(pitch);
      const outerLen = (span + 2 * o) / Math.cos(pitch);
      const depth = (alongZ ? W : L) + 2 * o;
      const geo = new THREE.BoxGeometry(alongZ ? depth : outerLen, rt, alongZ ? outerLen : depth);
      const mesh = new THREE.Mesh(geo, M.roof);
      const midY = wallTop + rise / 2;
      if (alongZ) { mesh.rotation.x = -pitch; mesh.position.set(0, midY, 0); }
      else { mesh.rotation.z = pitch; mesh.position.set(0, midY, 0); }
      target.add(mesh);
      return wallTop + rise;
    }

    if (type === "hip") return this._hipRoof(W, L, wallTop, o, pitch, M, target);

    // gable
    const ridgeAlongZ = (r.ridgeAxis || (L >= W ? "length" : "width")) === "length";
    if (ridgeAlongZ) {
      const { ridgeY } = addSlopePair(hx, hz, "x");
      const tri = [[-hx, wallTop], [hx, wallTop], [0, ridgeY]];
      const gf = triPrism(tri, 0.12, M.wall); gf.position.z = -hz; target.add(gf);
      const gb = triPrism(tri, 0.12, M.wall); gb.position.z = hz; target.add(gb);
      return ridgeY;
    } else {
      const { ridgeY } = addSlopePair(hz, hx, "z");
      const tri = [[-hz, wallTop], [hz, wallTop], [0, ridgeY]];
      const gl = triPrism(tri, 0.12, M.wall); gl.rotation.y = Math.PI / 2; gl.position.x = -hx; target.add(gl);
      const gr = triPrism(tri, 0.12, M.wall); gr.rotation.y = Math.PI / 2; gr.position.x = hx; target.add(gr);
      return ridgeY;
    }
  }

  _hipRoof(W, L, wallTop, o, pitch, M, target) {
    const hx = W / 2 + o, hz = L / 2 + o;
    const rise = (Math.min(W, L) / 2) * Math.tan(pitch);
    const ridgeY = wallTop + rise;
    const alongZ = L >= W;
    const ridgeHalf = Math.max(0.01, (Math.max(W, L) - Math.min(W, L)) / 2);
    const eave = [[-hx, wallTop, -hz], [hx, wallTop, -hz], [hx, wallTop, hz], [-hx, wallTop, hz]];
    let ridgeA, ridgeB;
    if (alongZ) { ridgeA = [0, ridgeY, -ridgeHalf]; ridgeB = [0, ridgeY, ridgeHalf]; }
    else { ridgeA = [-ridgeHalf, ridgeY, 0]; ridgeB = [ridgeHalf, ridgeY, 0]; }
    const all = [...eave, ridgeA, ridgeB];
    const faces = alongZ
      ? [[0, 1, 4], [1, 2, 5, 4], [2, 3, 5], [3, 0, 4, 5]]
      : [[0, 1, 5, 4], [1, 2, 5], [2, 3, 4, 5], [3, 0, 4]];
    const pos = [];
    const push = (i) => pos.push(all[i][0], all[i][1], all[i][2]);
    for (const f of faces) {
      if (f.length === 3) { push(f[0]); push(f[1]); push(f[2]); }
      else { push(f[0]); push(f[1]); push(f[2]); push(f[0]); push(f[2]); push(f[3]); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    target.add(new THREE.Mesh(geo, M.roof));
    return ridgeY;
  }

  _buildFrame(spec, W, L, wallTop, storeys, storeyH, M, wings, runs, ox, oz) {
    const st = spec.structure || {};
    const bay = Math.min(Math.max(st.baySpacing || 3, 1.5), Math.max(2, L));

    // Non-rectangular footprint: columns along the perimeter runs + a top perimeter beam.
    if (wings && wings.length > 1) {
      const c = 0.13;
      for (const run of runs) {
        const len = run.length, np = Math.max(2, Math.round(len / bay) + 1);
        for (let i = 0; i < np; i++) {
          const f = (len * i) / (np - 1);
          const x = run.orient === "h" ? ox + run.x0 + f : ox + run.x0;
          const z = run.orient === "h" ? oz + run.z0 : oz + run.z0 + f;
          this.frameGroup.add(box(x - c, x + c, 0, wallTop, z - c, z + c, M.frame));
        }
        if (run.orient === "h") this.frameGroup.add(box(ox + run.x0, ox + run.x1, wallTop - c, wallTop + c, oz + run.z0 - c, oz + run.z0 + c, M.frame));
        else this.frameGroup.add(box(ox + run.x0 - c, ox + run.x0 + c, wallTop - c, wallTop + c, oz + run.z0, oz + run.z1, M.frame));
      }
      return;
    }

    const n = Math.max(2, Math.round(L / bay) + 1);
    const hx = W / 2, hz = L / 2;
    const c = 0.14; // member half-size
    const r = spec.roof || {};
    const pitch = Math.min(Math.max(r.pitchDeg || 0, 0), 60) * DEG;
    const ridgeAlongZ = (r.ridgeAxis || (L >= W ? "length" : "width")) === "length";
    const peak = this.roofPeak || wallTop + 1;

    for (let i = 0; i < n; i++) {
      const z = -hz + (L * i) / (n - 1);
      // columns full height
      this.frameGroup.add(box(-hx - c, -hx + c, 0, wallTop, z - c, z + c, M.frame));
      this.frameGroup.add(box(hx - c, hx + c, 0, wallTop, z - c, z + c, M.frame));
      // rafters (gable) or single (skillion/flat use a top beam)
      if ((r.type === "gable" || r.type === "hip") && ridgeAlongZ) {
        this.frameGroup.add(this._beam(-hx, wallTop, z, 0, peak, z, c, M.frame));
        this.frameGroup.add(this._beam(hx, wallTop, z, 0, peak, z, c, M.frame));
      } else {
        this.frameGroup.add(box(-hx - c, hx + c, wallTop - c, wallTop + c, z - c, z + c, M.frame)); // top chord
      }
    }
    // ridge / eave purlins along Z
    if ((r.type === "gable") && ridgeAlongZ) this.frameGroup.add(box(-c, c, peak - c, peak + c, -hz, hz, M.frame));
    this.frameGroup.add(box(-hx - c, -hx + c, wallTop - c, wallTop + c, -hz, hz, M.frame));
    this.frameGroup.add(box(hx - c, hx + c, wallTop - c, wallTop + c, -hz, hz, M.frame));
  }

  _beam(x0, y0, z0, x1, y1, z1, c, mat) {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const geo = new THREE.BoxGeometry(2 * c, 2 * c, len);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.lookAt(new THREE.Vector3(x1, y1, z1));
    return m;
  }

  setFrameVisible(v) {
    this.frameGroup.visible = v;
    if (!this.M) return;
    for (const mat of [this.M.wall, this.M.roof]) {
      mat.transparent = v;
      mat.opacity = v ? 0.22 : 1;
      mat.depthWrite = !v;
      mat.needsUpdate = true;
    }
  }

  _fit() {
    const boxb = new THREE.Box3().setFromObject(this.building);
    if (boxb.isEmpty()) return;
    const size = boxb.getSize(new THREE.Vector3());
    const center = boxb.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.9;
    this.controls.target.copy(center);
    this.camera.position.set(center.x + dist * 0.7, center.y + dist * 0.55, center.z + dist * 0.9);
    this.camera.near = maxDim / 100; this.camera.far = maxDim * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  exportSTL() {
    const exporter = new STLExporter();
    const str = exporter.parse(this.building, { binary: false });
    return new Blob([str], { type: "model/stl" });
  }
}
