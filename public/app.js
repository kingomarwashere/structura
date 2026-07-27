import { Scene3D } from "/three-scene.js";
import { floorPlanSVG, elevationsSVG } from "/blueprint.js";
import { toDXF } from "/dxf.js";

const $ = (s) => document.querySelector(s);
const chat = $("#chat"), promptEl = $("#prompt"), sendBtn = $("#send");
let scene = null, spec = null, busy = false, currentId = null;

function addMsg(kind, html) {
  const el = document.createElement("div");
  el.className = "msg " + kind;
  el.innerHTML = kind === "bot" ? `<div class="mname">Structura</div>${html}` : html;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function setBusy(b, msg) {
  busy = b;
  sendBtn.disabled = b;
  $("#loading").hidden = !b;
  if (msg) $("#loading-msg").textContent = msg;
}

async function design(prompt) {
  if (busy || !prompt.trim()) return;
  addMsg("user", escapeHtml(prompt));
  promptEl.value = "";
  $("#mode-hint").textContent = "";
  setBusy(true, spec ? "Revising the design…" : "Engineering your design…");
  showScreen("view");   // reveal the stage so the loading spinner is visible on mobile
  try {
    const res = await fetch("/api/design", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, current: spec || undefined }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.detail || data.error || ("HTTP " + res.status));
    spec = data.spec;
    render(spec);
    addMsg("bot", escapeHtml(spec.summary || "Design ready.") +
      `<div style="margin-top:6px;font-size:11px;color:var(--muted);font-family:var(--mono)">${escapeHtml(spec.buildingType || "")} · ${fmt(spec.footprint.width)}×${fmt(spec.footprint.length)}m · ${escapeHtml(spec.structure?.system || "")}</div>`);
    saveDesign(prompt);
    showScreen("view");
  } catch (e) {
    addMsg("err", "Couldn't generate that design: " + escapeHtml(e.message));
    showScreen("design");   // surface the error message (in chat) on mobile
  } finally {
    setBusy(false);
    $("#mode-hint").textContent = spec ? "Ask for changes to refine it." : "";
  }
}

function render(spec) {
  $("#empty").classList.add("hidden");
  if (!scene) scene = new Scene3D($("#viewport"));
  scene.setSpec(spec);
  requestAnimationFrame(() => scene._resize());
  $("#toggle-frame").checked = false;
  scene.setFrameVisible(false);
  renderSpecbar(spec);
  $("#plan-wrap").innerHTML = floorPlanSVG(spec);
  $("#elev-wrap").innerHTML = elevationsSVG(spec);
  renderBOM(spec);
}

function renderSpecbar(spec) {
  const r = spec.roof || {}, st = spec.structure || {};
  const bits = [
    ["Type", spec.buildingType], ["Footprint", `${fmt(spec.footprint.width)}×${fmt(spec.footprint.length)} m`],
    ["Storeys", spec.storeys], ["Eave", fmt(spec.wallHeight) + " m"],
    ["Roof", `${r.type} ${r.pitchDeg ? r.pitchDeg + "°" : ""}`], ["System", st.system],
    ["Bays", fmt(st.baySpacing) + " m"], ["Foundation", st.foundation],
  ];
  $("#specbar").innerHTML = bits.filter(b => b[1] != null && b[1] !== "")
    .map(([k, v]) => `<span><span class="k">${k}</span> <b>${escapeHtml(String(v))}</b></span>`).join("");
}

function renderBOM(spec) {
  const rows = spec.billOfMaterials || [];
  const byCat = {};
  for (const r of rows) (byCat[r.category || "Other"] = byCat[r.category || "Other"] || []).push(r);
  let html = `<h2>${escapeHtml(spec.name || "Bill of Materials")}</h2>
    <div class="sub">Engineering parts list · ${rows.length} line items · quantities are indicative estimates from the design geometry</div>
    <table class="bom"><thead><tr><th>Item</th><th>Specification</th><th>Material</th><th class="num">Qty</th><th>Unit</th><th>Notes</th></tr></thead><tbody>`;
  for (const cat of Object.keys(byCat)) {
    html += `<tr class="cat-row"><td colspan="6">${escapeHtml(cat)}</td></tr>`;
    for (const r of byCat[cat]) {
      html += `<tr><td>${escapeHtml(r.item)}</td><td>${escapeHtml(r.spec)}</td><td>${escapeHtml(r.material)}</td><td class="num">${escapeHtml(String(r.qty))}</td><td>${escapeHtml(r.unit)}</td><td style="color:var(--muted)">${escapeHtml(r.notes || "")}</td></tr>`;
    }
  }
  html += `</tbody></table>`;
  const notes = spec.engineeringNotes || [], comp = spec.compliance || [];
  html += `<div class="notes-block">
    <div class="card"><h3>Engineering notes</h3><ul>${notes.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul></div>
    <div class="card"><h3>Standards &amp; compliance</h3><ul>${comp.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul></div>
  </div>`;
  $("#bom-wrap").innerHTML = html;
}

// ---- tabs ----
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  $("#view-" + t.dataset.view).classList.add("active");
  if (t.dataset.view === "model" && scene) requestAnimationFrame(() => scene._resize());
}));

// ---- mobile screen switching (Design ⇄ View) ----
function showScreen(name) {
  document.body.dataset.screen = name;
  document.querySelectorAll("#mobile-nav button").forEach(b => b.classList.toggle("active", b.dataset.screen === name));
  if (name === "view" && scene) requestAnimationFrame(() => { scene._resize(); requestAnimationFrame(() => scene._resize()); });
}
document.querySelectorAll("#mobile-nav button").forEach(b => b.addEventListener("click", () => showScreen(b.dataset.screen)));
showScreen("design");

function intro() {
  if (!chat.children.length)
    addMsg("bot", "Describe any structure — a shed, house, warehouse, carport or piece of infrastructure — and I'll engineer it into a 3D model, blueprints and a parts list. Tap an example below, or type your own.");
}
intro();

// ---- export menu (mobile) ----
$("#tools-toggle").addEventListener("click", (e) => { e.stopPropagation(); $("#toolbar").classList.toggle("open"); });
$("#toolbar").addEventListener("click", (e) => { if (e.target.closest("button")) $("#toolbar").classList.remove("open"); });
document.addEventListener("click", (e) => { if (!$("#toolbar").contains(e.target) && e.target !== $("#tools-toggle")) $("#toolbar").classList.remove("open"); });

// ---- composer ----
$("#composer").addEventListener("submit", (e) => { e.preventDefault(); design(promptEl.value); });
promptEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); design(promptEl.value); } });
document.querySelectorAll(".ex").forEach(b => b.addEventListener("click", () => { promptEl.value = b.dataset.p; design(b.dataset.p); }));

// ---- toolbar ----
$("#toggle-frame").addEventListener("change", (e) => scene && scene.setFrameVisible(e.target.checked));
$("#btn-stl").addEventListener("click", () => { if (scene) download(scene.exportSTL(), slug(spec) + ".stl"); });
$("#btn-json").addEventListener("click", () => { if (spec) download(new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" }), slug(spec) + ".json"); });
$("#btn-dxf").addEventListener("click", () => { if (spec) download(new Blob([toDXF(spec)], { type: "application/dxf" }), slug(spec) + "-plan.dxf"); });
$("#btn-csv").addEventListener("click", () => { if (spec) download(new Blob([toCSV(spec)], { type: "text/csv" }), slug(spec) + "-bom.csv"); });
$("#btn-print").addEventListener("click", printSheets);

// ---- saved designs (D1) ----
async function saveDesign(prompt) {
  try {
    const res = await fetch("/api/designs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: currentId, spec, prompt }),
    });
    const data = await res.json();
    if (data.id) currentId = data.id;
    if (!$("#designs-drawer").hidden) loadDesignsList();
  } catch { /* non-fatal */ }
}

async function loadDesignsList() {
  const list = $("#dd-list");
  try {
    const res = await fetch("/api/designs");
    const { designs } = await res.json();
    if (!designs || !designs.length) { list.innerHTML = `<div class="dd-empty">No saved designs yet. Design something to save it here.</div>`; return; }
    list.innerHTML = designs.map(d => `
      <div class="dd-item" data-id="${d.id}">
        <div class="di-main">
          <div class="di-name">${escapeHtml(d.name || "Untitled")}${currentId === d.id ? " ·" : ""}</div>
          <div class="di-sub">${escapeHtml(d.building_type || "")} · ${new Date(d.updated_at).toLocaleDateString()}</div>
        </div>
        <button class="di-del" data-del="${d.id}" title="Delete">🗑</button>
      </div>`).join("");
  } catch { list.innerHTML = `<div class="dd-empty">Couldn't load saved designs.</div>`; }
}

async function openDesign(id) {
  setBusy(true, "Loading design…");
  try {
    const res = await fetch("/api/designs/" + id);
    const data = await res.json();
    if (data.spec) {
      spec = data.spec; currentId = id;
      render(spec);
      chat.innerHTML = "";
      addMsg("bot", escapeHtml(spec.summary || spec.name || "Loaded design.") +
        `<div style="margin-top:6px;font-size:11px;color:var(--muted);font-family:var(--mono)">${escapeHtml(spec.buildingType || "")} · ${fmt(spec.footprint.width)}×${fmt(spec.footprint.length)}m</div>`);
      $("#designs-drawer").hidden = true;
      $("#mode-hint").textContent = "Ask for changes to refine it.";
      showScreen("view");
    }
  } catch { addMsg("err", "Couldn't load that design."); }
  finally { setBusy(false); }
}

$("#btn-designs").addEventListener("click", () => {
  const d = $("#designs-drawer");
  d.hidden = !d.hidden;
  if (!d.hidden) loadDesignsList();
});
$("#dd-close").addEventListener("click", () => { $("#designs-drawer").hidden = true; });
$("#dd-list").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    e.stopPropagation();
    await fetch("/api/designs/" + del.dataset.del, { method: "DELETE" });
    if (currentId === del.dataset.del) currentId = null;
    loadDesignsList();
    return;
  }
  const item = e.target.closest(".dd-item");
  if (item) openDesign(item.dataset.id);
});
$("#btn-new").addEventListener("click", () => {
  spec = null; currentId = null;
  chat.innerHTML = "";
  intro();
  $("#empty").classList.remove("hidden");
  $("#designs-drawer").hidden = true;
  $("#mode-hint").textContent = "";
  promptEl.value = "";
  showScreen("design");
  promptEl.focus();
});

function printSheets() {
  if (!spec) return;
  const w = window.open("", "_blank");
  w.document.write(`<html><head><title>${escapeHtml(spec.name || "Structura")} — Blueprints</title>
    <style>@page{margin:12mm} body{margin:0;background:#fff} svg{width:100%;height:auto;page-break-after:always;display:block}</style>
    <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@400;500;700&display=swap" rel="stylesheet"></head>
    <body>${floorPlanSVG(spec)}${elevationsSVG(spec)}</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 500);
}

function toCSV(spec) {
  const head = ["Category", "Item", "Specification", "Material", "Qty", "Unit", "Notes"];
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [head.join(",")];
  for (const r of spec.billOfMaterials || [])
    lines.push([r.category, r.item, r.spec, r.material, r.qty, r.unit, r.notes].map(esc).join(","));
  return lines.join("\n");
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function slug(spec) { return (spec?.name || "structura").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "structura"; }
function fmt(m) { return (Math.round(m * 100) / 100).toString(); }
function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
