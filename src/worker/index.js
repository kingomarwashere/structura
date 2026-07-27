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
      type: "object", additionalProperties: false, required: ["width", "length"],
      properties: {
        width: { type: "number", description: "Overall width in metres (X axis / front face width)." },
        length: { type: "number", description: "Overall depth in metres (Z axis)." },
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
      required: ["thickness", "material", "colorHex"],
      properties: {
        thickness: { type: "number", description: "Wall thickness in metres (e.g. 0.15 timber, 0.2 masonry, 0.05 steel cladding)." },
        material: { type: "string", description: "Wall material description." },
        colorHex: { type: "string", description: "Hex colour for wall cladding, e.g. #c9c2b6." },
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
- For gable roofs the ridge usually runs parallel to the LONGER dimension. Skillion = mono-pitch. Give a small overhang (0.3–0.6m) unless flat.
- Default to Australian standards & metric units unless the user names another country. Keep engineeringNotes concise and practical (spans, load assumptions, key connections).
- Always return one complete design via the tool. Never omit required fields. If the user is vague, make reasonable professional assumptions and note them.
- When given an existing design plus an edit request, return the FULL updated design (not a diff), preserving unchanged aspects.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function handleDesign(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const prompt = (body.prompt || "").toString().trim();
  if (!prompt) return json({ error: "Missing prompt" }, 400);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  const userContent = body.current
    ? `Here is the existing design as JSON:\n\n${JSON.stringify(body.current)}\n\nApply this change and return the full updated design:\n${prompt}`
    : prompt;

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
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: "Upstream request failed: " + e.message }, 502);
  }

  if (!resp.ok) {
    const txt = await resp.text();
    return json({ error: "Anthropic API error", status: resp.status, detail: txt.slice(0, 800) }, 502);
  }

  const data = await resp.json();
  const toolUse = (data.content || []).find((c) => c.type === "tool_use" && c.name === "emit_building");
  if (!toolUse) return json({ error: "Model did not return a design", raw: data }, 502);

  return json({ spec: toolUse.input });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/design" && request.method === "POST") {
      return handleDesign(request, env);
    }
    if (url.pathname === "/api/health") return json({ ok: true, model: MODEL });
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    // Everything else -> static assets
    return env.ASSETS.fetch(request);
  },
};
