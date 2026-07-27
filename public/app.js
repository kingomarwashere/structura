import { Scene3D } from "/three-scene.js";
import { floorPlanSVG, elevationsSVG } from "/blueprint.js";

const $ = (s) => document.querySelector(s);
const chat = $("#chat"), promptEl = $("#prompt"), sendBtn = $("#send");
let scene = null, spec = null, busy = false;

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
  } catch (e) {
    addMsg("err", "Couldn't generate that design: " + escapeHtml(e.message));
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

// ---- composer ----
$("#composer").addEventListener("submit", (e) => { e.preventDefault(); design(promptEl.value); });
promptEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); design(promptEl.value); } });
document.querySelectorAll(".ex").forEach(b => b.addEventListener("click", () => { promptEl.value = b.dataset.p; design(b.dataset.p); }));

// ---- toolbar ----
$("#toggle-frame").addEventListener("change", (e) => scene && scene.setFrameVisible(e.target.checked));
$("#btn-stl").addEventListener("click", () => { if (scene) download(scene.exportSTL(), slug(spec) + ".stl"); });
$("#btn-json").addEventListener("click", () => { if (spec) download(new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" }), slug(spec) + ".json"); });
$("#btn-csv").addEventListener("click", () => { if (spec) download(new Blob([toCSV(spec)], { type: "text/csv" }), slug(spec) + "-bom.csv"); });
$("#btn-print").addEventListener("click", printSheets);

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
