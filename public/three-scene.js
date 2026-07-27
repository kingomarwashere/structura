import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";

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

// Assign centre positions to a wall's openings (auto-distribute when needed).
function layoutOpenings(L, list) {
  const out = [];
  // group by identical spec to expand `count`
  for (const o of list) {
    const count = Math.max(1, o.count || 1);
    const needsAuto = count > 1 || !(o.offset >= 0);
    for (let i = 0; i < count; i++) {
      let center;
      if (needsAuto) center = (L * (i + 1)) / (count + 1);
      else center = o.offset;
      center = Math.min(Math.max(center, o.width / 2 + 0.15), L - o.width / 2 - 0.15);
      out.push({ ...o, center });
    }
  }
  return out;
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

    const W = Math.max(1, spec.footprint.width);
    const L = Math.max(1, spec.footprint.length);
    const t = Math.min(Math.max(spec.walls?.thickness || 0.15, 0.05), 0.5);
    const storeyH = Math.max(2.1, spec.wallHeight || 3);
    const storeys = Math.min(Math.max(spec.storeys || 1, 1), 8);
    const hx = W / 2, hz = L / 2;

    // Foundation
    const found = box(-hx - 0.25, hx + 0.25, -0.35, 0, -hz - 0.25, hz + 0.25, M.slab);
    this.building.add(found);

    // Per-storey walls + floors
    const openingsByStorey = {};
    for (const o of spec.openings || []) {
      const s = Math.min(Math.max(o.storey || 1, 1), storeys);
      (openingsByStorey[s] = openingsByStorey[s] || []).push(o);
    }

    const openWalls = new Set(spec.walls?.openWalls || []);
    const bay0 = Math.min(Math.max(spec.structure?.baySpacing || 3, 1.5), Math.max(2, L));
    const addPosts = (along, fixed, isX, y0) => {
      // posts evenly along an open wall; `along` = span length, `fixed` = the perpendicular coord
      const np = Math.max(2, Math.round((isX ? W : L) / bay0) + 1);
      const c = 0.09, span = isX ? W : L;
      for (let i = 0; i < np; i++) {
        const p = -span / 2 + (span * i) / (np - 1);
        if (isX) this.building.add(box(p - c, p + c, y0, y0 + storeyH, fixed - c, fixed + c, M.post));
        else this.building.add(box(fixed - c, fixed + c, y0, y0 + storeyH, p - c, p + c, M.post));
      }
    };

    for (let s = 0; s < storeys; s++) {
      const y0 = s * storeyH;
      if (s > 0) this.building.add(box(-hx, hx, y0 - 0.12, y0, -hz, hz, M.floor)); // upper floor slab
      const ops = openingsByStorey[s + 1] || [];
      const byWall = { front: [], back: [], left: [], right: [] };
      for (const o of ops) (byWall[o.wall] || byWall.front).push(o);
      const eaveC = 0.1;

      // front (z=-hz) and back (z=+hz): run along X, length W
      for (const [wall, z] of [["front", -hz], ["back", hz]]) {
        if (openWalls.has(wall)) {
          addPosts(W, z, true, y0);
          this.building.add(box(-hx, hx, y0 + storeyH - eaveC, y0 + storeyH + eaveC, z - eaveC, z + eaveC, M.post));
        } else {
          const wg = buildWall(W, storeyH, t, 0, layoutOpenings(W, byWall[wall]), M);
          wg.position.set(-hx, y0, z); this.building.add(wg);
        }
      }
      // left (x=-hx) and right (x=+hx): run along Z, length L
      for (const [wall, x] of [["left", -hx], ["right", hx]]) {
        if (openWalls.has(wall)) {
          addPosts(L, x, false, y0);
          this.building.add(box(x - eaveC, x + eaveC, y0 + storeyH - eaveC, y0 + storeyH + eaveC, -hz, hz, M.post));
        } else {
          const wg = buildWall(L, storeyH, t, 0, layoutOpenings(L, byWall[wall]), M);
          wg.position.set(x, y0, -hz); wg.rotation.y = -Math.PI / 2; this.building.add(wg);
        }
      }
    }

    const wallTop = storeys * storeyH;
    this._buildRoof(spec, W, L, wallTop, M);
    this._buildFrame(spec, W, L, wallTop, storeys, storeyH, M);

    this.frameGroup.visible = false;
    this._fit();
  }

  _buildRoof(spec, W, L, wallTop, M) {
    const r = spec.roof || {};
    const type = r.type || "gable";
    const o = Math.min(Math.max(r.overhang || 0.3, 0), 2);
    const pitch = Math.min(Math.max(r.pitchDeg || 0, 0), 60) * DEG;
    const hx = W / 2, hz = L / 2;
    const rt = 0.12; // roof panel thickness

    const addSlopePair = (spanHalf, depthHalf, axis) => {
      // axis 'x' => ridge parallel to Z (slopes across X). axis 'z' => ridge parallel to X.
      const rise = spanHalf * Math.tan(pitch);
      const ridgeY = wallTop + rise;
      const outer = spanHalf + o;                    // horizontal half-span to outer eave
      const slopeLen = outer / Math.cos(pitch);      // rafter length along the slope
      const depth = 2 * (depthHalf + o);             // extent parallel to the ridge
      const eaveOuterY = wallTop - o * Math.tan(pitch);
      const midY = (eaveOuterY + ridgeY) / 2;
      for (const sign of [-1, 1]) {
        const geo = axis === "x"
          ? new THREE.BoxGeometry(slopeLen, rt, depth)   // slope length along X
          : new THREE.BoxGeometry(depth, rt, slopeLen);  // slope length along Z
        const mesh = new THREE.Mesh(geo, M.roof);
        if (axis === "x") {
          mesh.rotation.z = -sign * pitch;               // +X end rises toward ridge at x=0
          mesh.position.set(sign * outer / 2, midY, 0);
        } else {
          mesh.rotation.x = sign * pitch;
          mesh.position.set(0, midY, sign * outer / 2);
        }
        this.building.add(mesh);
      }
      return { rise, ridgeY };
    };

    if (type === "flat") {
      this.building.add(box(-hx - o, hx + o, wallTop, wallTop + rt, -hz - o, hz + o, M.roof));
      // low parapet
      const p = 0.4;
      this.building.add(box(-hx, hx, wallTop + rt, wallTop + p, -hz, -hz + 0.12, M.wall));
      this.building.add(box(-hx, hx, wallTop + rt, wallTop + p, hz - 0.12, hz, M.wall));
      this.building.add(box(-hx, -hx + 0.12, wallTop + rt, wallTop + p, -hz, hz, M.wall));
      this.building.add(box(hx - 0.12, hx, wallTop + rt, wallTop + p, -hz, hz, M.wall));
      this.roofPeak = wallTop + p;
      return;
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
      this.building.add(mesh);
      // triangular gable infills on the two high-side walls
      this.roofPeak = wallTop + rise;
      return;
    }

    if (type === "hip") { this._hipRoof(W, L, wallTop, o, pitch, M); return; }

    // gable
    const ridgeAlongZ = (r.ridgeAxis || (L >= W ? "length" : "width")) === "length";
    if (ridgeAlongZ) {
      const { ridgeY } = addSlopePair(hx, hz, "x");
      // gable triangles on front/back (z = ±hz), spanning X
      const tri = [[-hx, wallTop], [hx, wallTop], [0, ridgeY]];
      const gf = triPrism(tri, 0.12, M.wall); gf.position.z = -hz; this.building.add(gf);
      const gb = triPrism(tri, 0.12, M.wall); gb.position.z = hz; this.building.add(gb);
      this.roofPeak = ridgeY;
    } else {
      const { ridgeY } = addSlopePair(hz, hx, "z");
      const tri = [[-hz, wallTop], [hz, wallTop], [0, ridgeY]];
      const gl = triPrism(tri, 0.12, M.wall); gl.rotation.y = Math.PI / 2; gl.position.x = -hx; this.building.add(gl);
      const gr = triPrism(tri, 0.12, M.wall); gr.rotation.y = Math.PI / 2; gr.position.x = hx; this.building.add(gr);
      this.roofPeak = ridgeY;
    }
  }

  _hipRoof(W, L, wallTop, o, pitch, M) {
    const hx = W / 2 + o, hz = L / 2 + o;
    const shortHalf = Math.min(hx, hz);
    const rise = (Math.min(W, L) / 2) * Math.tan(pitch);
    const ridgeY = wallTop + rise;
    const alongZ = L >= W;
    const ridgeHalf = Math.max(0.01, (Math.max(W, L) - Math.min(W, L)) / 2);
    // eave corners (y=wallTop) and two ridge points (y=ridgeY)
    const v = [];
    const eave = [[-hx, wallTop, -hz], [hx, wallTop, -hz], [hx, wallTop, hz], [-hx, wallTop, hz]];
    let ridgeA, ridgeB;
    if (alongZ) { ridgeA = [0, ridgeY, -ridgeHalf]; ridgeB = [0, ridgeY, ridgeHalf]; }
    else { ridgeA = [-ridgeHalf, ridgeY, 0]; ridgeB = [ridgeHalf, ridgeY, 0]; }
    const all = [...eave, ridgeA, ridgeB]; // idx 0..3 eave, 4=A,5=B
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
    this.building.add(new THREE.Mesh(geo, M.roof));
    this.roofPeak = ridgeY;
  }

  _buildFrame(spec, W, L, wallTop, storeys, storeyH, M) {
    const st = spec.structure || {};
    const bay = Math.min(Math.max(st.baySpacing || 3, 1.5), Math.max(2, L));
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
