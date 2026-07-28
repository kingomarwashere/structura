// Structura — AI building/infrastructure designer on Cloudflare Workers.
// POST /api/design { prompt, current? } -> normalized building spec (JSON).
// Static assets served via the ASSETS binding.

const MODEL = "claude-sonnet-4-6";

// ---- The building spec schema. This is the contract between Claude and the
// ---- deterministic 3D / blueprint / BOM renderers on the client. ----
const BUILDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "name", "summary", "buildingType", "units", "footprint",
    "storeys", "wallHeight", "roof", "walls", "openings",
    "structure", "billOfMaterials", "engineeringNotes", "compliance",
  ],
  properties: {
    name: { type: "string", description: "Short project name for the structure." },
    summary: { type: "string", description: "1-3 sentence plain-language description of what was designed." },
    buildingType: { type: "string", description: "e.g. shed, house, warehouse, carport, barn, workshop, cabin, pavilion, bridge, water tank." },
    units: { type: "string", enum: ["m"], description: "All lengths are metres." },
    footprint: {
      type: "object", additionalProperties: false, required: ["width", "length", "wings"],
      properties: {
        width: { type: "number", description: "Overall bounding width in metres (X axis / front face width)." },
        length: { type: "number", description: "Overall bounding depth in metres (Z axis)." },
        wings: {
          type: "array",
          description: "For NON-rectangular buildings (L, T, U, cross shapes), the rectangular wings whose UNION forms the footprint. Each wing is positioned inside the width×length bounding box. Leave EMPTY ([]) for a plain rectangular building.",
          items: {
            type: "object", additionalProperties: false, required: ["x", "z", "width", "length"],
            properties: {
              x: { type: "number", description: "Wing near corner X offset from origin (0..width)." },
              z: { type: "number", description: "Wing near corner Z offset from origin (0..length)." },
              width: { type: "number", description: "Wing width along X (m)." },
              length: { type: "number", description: "Wing depth along Z (m)." },
            },
          },
        },
      },
    },
    storeys: { type: "integer", minimum: 1, maximum: 8, description: "Number of storeys/levels." },
    wallHeight: { type: "number", description: "Wall/eave height per storey in metres." },
    roof: {
      type: "object", additionalProperties: false,
      required: ["type", "pitchDeg", "overhang", "ridgeAxis"],
      properties: {
        type: { type: "string", enum: ["gable", "skillion", "flat", "hip"], description: "Roof form." },
        pitchDeg: { type: "number", description: "Roof pitch in degrees (0 for flat)." },
        overhang: { type: "number", description: "Eave overhang beyond walls in metres (e.g. 0.3)." },
        ridgeAxis: { type: "string", enum: ["width", "length"], description: "Which axis the ridge (or high side) runs parallel to." },
      },
    },
    walls: {
      type: "object", additionalProperties: false,
      required: ["thickness", "material", "colorHex", "openWalls"],
      properties: {
        thickness: { type: "number", description: "Wall thickness in metres (e.g. 0.15 timber, 0.2 masonry, 0.05 steel cladding)." },
        material: { type: "string", description: "Wall material description." },
        colorHex: { type: "string", description: "Hex colour for wall cladding, e.g. #c9c2b6." },
        openWalls: {
          type: "array", items: { type: "string", enum: ["front", "back", "left", "right"] },
          description: "Walls that are fully OPEN (no cladding — only posts), e.g. a carport or pavilion. Use [] for a fully enclosed building.",
        },
      },
    },
    openings: {
      type: "array",
      description: "Doors, windows, roller/garage doors on the perimeter walls.",
      items: {
        type: "object", additionalProperties: false,
        required: ["wall", "type", "width", "height", "sillHeight", "offset", "count", "storey"],
        properties: {
          wall: { type: "string", enum: ["front", "back", "left", "right"], description: "front = -Z, back = +Z, left = -X, right = +X." },
          type: { type: "string", enum: ["door", "window", "rollerDoor", "garage", "opening"] },
          width: { type: "number", description: "Opening width (m)." },
          height: { type: "number", description: "Opening height (m)." },
          sillHeight: { type: "number", description: "Height of bottom of opening above floor (0 for doors)." },
          offset: { type: "number", description: "Distance (m) from the wall's left/near corner to the opening's centre. Use -1 to auto-distribute." },
          count: { type: "integer", minimum: 1, description: "How many identical openings evenly spread on this wall." },
          storey: { type: "integer", minimum: 1, description: "Which storey the opening is on (1 = ground)." },
        },
      },
    },
    structure: {
      type: "object", additionalProperties: false,
      required: ["system", "baySpacing", "columnSize", "rafterSize", "foundation"],
      properties: {
        system: { type: "string", description: "Structural system, e.g. 'steel portal frame', 'timber stud & truss', 'reinforced concrete'." },
        baySpacing: { type: "number", description: "Spacing of main frames/portals along the length (m), e.g. 3.0." },
        columnSize: { type: "string", description: "Column/post member size, e.g. '150UC30', '90x90 SHS', '190x45 F7 pine'." },
        rafterSize: { type: "string", description: "Rafter/beam/truss chord size." },
        foundation: { type: "string", enum: ["slab", "piers", "strip"], description: "Foundation type." },
      },
    },
    billOfMaterials: {
      type: "array",
      description: "Engineering parts list / bill of materials. Be realistic with quantities derived from the geometry.",
      items: {
        type: "object", additionalProperties: false,
        required: ["category", "item", "spec", "qty", "unit", "material", "notes"],
        properties: {
          category: { type: "string", description: "e.g. Foundation, Structure, Roofing, Cladding, Openings, Fixings, Services." },
          item: { type: "string" },
          spec: { type: "string", description: "Size/grade/standard, e.g. '150UC30 Grade 300', 'N12 rebar', 'Colorbond 0.42 BMT'." },
          qty: { type: "number" },
          unit: { type: "string", description: "e.g. ea, m, m2, m3, kg, L, bags." },
          material: { type: "string" },
          notes: { type: "string" },
        },
      },
    },
    engineeringNotes: {
      type: "array", items: { type: "string" },
      description: "Key engineering/design notes: loads, spans, connections, assumptions.",
    },
    compliance: {
      type: "array", items: { type: "string" },
      description: "Relevant standards/codes assumed (default to Australian: NCC/BCA, AS 1170 loads, AS 4100 steel, AS 1684 timber, AS 3600 concrete) unless the user specifies a region.",
    },
  },
};

const SYSTEM_PROMPT = `You are Structura, an expert building & infrastructure design engine. A user describes a structure in plain language (a shed, house, warehouse, carport, barn, cabin, pavilion, tank stand, small bridge, etc.) and you produce a single complete, buildable, structurally-sane design by calling the emit_building tool.

Rules:
- Choose sensible real-world dimensions, materials, structural systems and a realistic bill of materials. Derive BOM quantities from the actual geometry you specify (perimeter, wall area, roof area, number of frames = length/baySpacing + 1, etc.).
- Pick an appropriate structural system for the type & span (timber stud+truss for small residential, steel portal frame for sheds/warehouses, RC for heavy/tall).
- Place doors and windows sensibly on the correct walls. front = -Z face, back = +Z, left = -X, right = +X. Use offset = -1 to auto-distribute multiple identical openings.
- For open structures (carports, pavilions, open-sided sheds, awnings), list the open sides in walls.openWalls — those sides get posts but no cladding and no openings. Enclosed buildings use walls.openWalls = [].
- For L-shaped, T-shaped, U-shaped or cross-shaped buildings, set footprint.wings to the rectangular wings whose union is the plan (each wing positioned within the width×length bounding box). A simple rectangle uses footprint.wings = []. Example L-shape in a 12×10 box: wings = [{x:0,z:0,width:12,length:5},{x:0,z:5,width:6,length:5}].
- For gable roofs the ridge usually runs parallel to the LONGER dimension. Skillion = mono-pitch. Give a small overhang (0.3–0.6m) unless flat.
- Default to Australian standards & metric units unless the user names another country. Keep engineeringNotes concise and practical (spans, load assumptions, key connections).
- Always return one complete design via the tool. Never omit required fields. If the user is vague, make reasonable professional assumptions and note them.
- When given an existing design plus an edit request, return the FULL updated design (not a diff), preserving unchanged aspects.`;

function json(data, status = 200, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(extraHeaders || {}) },
  });
}

// Anonymous per-browser id from the structura_uid cookie (created on first use).
function getUid(request) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)structura_uid=([a-f0-9-]{36})/);
  return m ? m[1] : null;
}
function uidCookie(uid) {
  return { "set-cookie": `structura_uid=${uid}; Path=/; Max-Age=31536000; SameSite=Lax` };
}

async function handleDesignsList(request, env, uid) {
  if (!uid) return json({ designs: [] });
  const { results } = await env.DB.prepare(
    "SELECT id, name, building_type, updated_at FROM designs WHERE uid = ? ORDER BY updated_at DESC LIMIT 100"
  ).bind(uid).all();
  return json({ designs: results || [] });
}

async function handleDesignGet(env, uid, id) {
  const row = await env.DB.prepare("SELECT spec FROM designs WHERE id = ? AND uid = ?").bind(id, uid).first();
  if (!row) return json({ error: "Not found" }, 404);
  return json({ spec: JSON.parse(row.spec) });
}

async function handleDesignSave(request, env, uid, setCookie) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.spec) return json({ error: "Missing spec" }, 400);
  const now = Date.now();
  const name = (body.spec.name || "Untitled").toString().slice(0, 120);
  const btype = (body.spec.buildingType || "").toString().slice(0, 60);
  const specStr = JSON.stringify(body.spec);
  const prompt = (body.prompt || "").toString().slice(0, 2000);
  const headers = setCookie ? uidCookie(uid) : undefined;
  if (body.id) {
    const owned = await env.DB.prepare("SELECT id FROM designs WHERE id = ? AND uid = ?").bind(body.id, uid).first();
    if (owned) {
      await env.DB.prepare("UPDATE designs SET name=?, building_type=?, prompt=?, spec=?, updated_at=? WHERE id=? AND uid=?")
        .bind(name, btype, prompt, specStr, now, body.id, uid).run();
      return json({ id: body.id }, 200, headers);
    }
  }
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO designs (id, uid, name, building_type, prompt, spec, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, uid, name, btype, prompt, specStr, now, now).run();
  return json({ id }, 200, headers);
}

async function handleDesignDelete(env, uid, id) {
  await env.DB.prepare("DELETE FROM designs WHERE id = ? AND uid = ?").bind(id, uid).run();
  return json({ ok: true });
}

// Pull a JSON object out of free-form model text (strip fences / prose).
function parseSpec(text) {
  if (!text) return null;
  let s = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < 0) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

const maxUrl = (env) => env.MAX_SERVICE_URL.replace(/\/$/, "");

// Owner-only fallback: generate via the owner's Claude Max (Claude Code headless)
// behind their tunnel. Async: start a job, return its id; the client polls status.
async function generateViaMax(env, userContent) {
  const system = `${SYSTEM_PROMPT}\n\nBE CONCISE AND FAST: billOfMaterials = 8–12 key line items only; engineeringNotes ≤ 4 short points; compliance ≤ 4 items; keep every string terse. Do NOT pad.\n\nReturn ONLY a single JSON object — no markdown, no code fences, no commentary — matching this JSON Schema, with every required field present:\n${JSON.stringify(BUILDING_SCHEMA)}`;
  let resp;
  try {
    resp = await fetch(maxUrl(env) + "/start", {
      method: "POST",
      headers: { "content-type": "application/json", "x-secret": env.MAX_SERVICE_SECRET || "" },
      body: JSON.stringify({ prompt: userContent, system }),
    });
  } catch {
    return json({ error: "max_unreachable", message: "Your Claude Max backup isn't reachable — is the service running on your Mac?" }, 502);
  }
  if (!resp.ok) return json({ error: "max_error", message: "Claude Max backup error (start): " + (await resp.text()).slice(0, 160) }, 502);
  const { jobId } = await resp.json();
  if (!jobId) return json({ error: "max_error", message: "Claude Max backup didn't start a job." }, 502);
  return json({ pending: true, jobId });
}

// Poll a Max job (owner-gated).
async function handleMaxStatus(request, env) {
  const ownerSecret = (request.headers.get("x-owner-secret") || "").trim();
  if (!(ownerSecret && env.OWNER_SECRET && ownerSecret === env.OWNER_SECRET && env.MAX_SERVICE_URL))
    return json({ error: "unauthorized" }, 401);
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return json({ error: "missing jobId" }, 400);
  let resp;
  try {
    resp = await fetch(maxUrl(env) + "/result?id=" + encodeURIComponent(jobId), { headers: { "x-secret": env.MAX_SERVICE_SECRET || "" } });
  } catch {
    return json({ error: "max_unreachable", message: "Your Claude Max backup isn't reachable." }, 502);
  }
  if (resp.status === 404) return json({ error: "job_gone", message: "That design job expired — try again." }, 404);
  if (!resp.ok) return json({ error: "max_error", message: "Claude Max backup error." }, 502);
  const data = await resp.json();
  if (data.status === "pending") return json({ pending: true });
  if (data.status === "error") return json({ error: "max_error", message: "Claude Max backup error: " + (data.error || "").slice(0, 160) }, 502);
  const spec = parseSpec(data.text);
  if (!spec) return json({ error: "max_parse", message: "Claude Max returned output I couldn't parse as a design — try again." }, 502);
  return json({ spec });
}

async function handleDesign(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const prompt = (body.prompt || "").toString().trim();
  if (!prompt) return json({ error: "Missing prompt" }, 400);

  const userContent = body.current
    ? `Here is the existing design as JSON:\n\n${JSON.stringify(body.current)}\n\nApply this change and return the full updated design:\n${prompt}`
    : prompt;

  // Auth priority: user's own Anthropic key → owner's Claude Max backup → shared server key.
  const userKey = (request.headers.get("x-user-key") || "").trim();
  const ownerSecret = (request.headers.get("x-owner-secret") || "").trim();
  const useMax = !userKey && ownerSecret && env.OWNER_SECRET && ownerSecret === env.OWNER_SECRET && env.MAX_SERVICE_URL;
  if (useMax) return generateViaMax(env, userContent);

  const apiKey = userKey || env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "no_key", keyIssue: true,
      message: "Add your Anthropic API key to generate designs — it runs on your own account. Tap the 🔑 Key button." }, 400);
  }

  const payload = {
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [{
      name: "emit_building",
      description: "Emit the complete structured building design.",
      input_schema: BUILDING_SCHEMA,
    }],
    tool_choice: { type: "tool", name: "emit_building" },
    messages: [{ role: "user", content: userContent }],
  };

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: "upstream", message: "Couldn't reach the AI service. Please try again." }, 502);
  }

  if (!resp.ok) {
    const txt = await resp.text();
    let code = "api_error", message = "The AI service returned an error. Please try again in a moment.", keyIssue = false;
    if (resp.status === 401 || /authentication|invalid x-api-key/i.test(txt)) {
      code = "bad_key"; keyIssue = true;
      message = "That Anthropic API key was rejected. Check it in the 🔑 Key panel.";
    } else if (/credit balance/i.test(txt)) {
      code = "no_credit"; keyIssue = true;
      message = userKey
        ? "Your Anthropic account is out of credit — top up at console.anthropic.com, then try again."
        : "Add your own Anthropic API key (🔑 Key) to generate designs — it runs on your account.";
    } else if (resp.status === 429) {
      code = "rate_limit"; message = "Anthropic rate-limited the request — wait a few seconds and try again.";
    }
    return json({ error: code, code, message, keyIssue }, 400);
  }

  const data = await resp.json();
  const toolUse = (data.content || []).find((c) => c.type === "tool_use" && c.name === "emit_building");
  if (!toolUse) return json({ error: "Model did not return a design", raw: data }, 502);

  return json({ spec: toolUse.input });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/design" && request.method === "POST") return handleDesign(request, env);
    if (path === "/api/design/status" && request.method === "GET") return handleMaxStatus(request, env);
    if (path === "/api/health") return json({ ok: true, model: MODEL });

    // Saved designs (D1) — anonymous uid cookie, created on first save.
    if (path === "/api/designs" || path.startsWith("/api/designs/")) {
      let uid = getUid(request), fresh = false;
      if (!uid) { uid = crypto.randomUUID(); fresh = true; }
      const idMatch = path.match(/^\/api\/designs\/([a-f0-9-]{36})$/);
      try {
        if (path === "/api/designs" && request.method === "GET") return await handleDesignsList(request, env, getUid(request));
        if (path === "/api/designs" && request.method === "POST") return await handleDesignSave(request, env, uid, fresh);
        if (idMatch && request.method === "GET") return await handleDesignGet(env, uid, idMatch[1]);
        if (idMatch && request.method === "DELETE") return await handleDesignDelete(env, uid, idMatch[1]);
      } catch (e) {
        return json({ error: "DB error: " + e.message }, 500);
      }
      return json({ error: "Not found" }, 404);
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
