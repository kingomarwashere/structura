// Structura Max service — a tiny local bridge that runs Claude Code headless
// (on the owner's Claude Max subscription) so Structura can generate designs
// without an Anthropic API key. Personal/owner use only. Reached by the Worker
// through a dedicated Cloudflare Tunnel; every request must present x-secret.
import http from "http";
import { spawn } from "child_process";

const PORT = Number(process.env.PORT || 8791);
const SECRET = process.env.MAX_SERVICE_SECRET;
// Haiku by default: fast enough to finish a full design within Cloudflare's
// 100s tunnel limit (Sonnet's larger output can exceed it). Override with MAX_MODEL.
const MODEL = process.env.MAX_MODEL || "haiku";
if (!SECRET) { console.error("MAX_SERVICE_SECRET not set"); process.exit(1); }

function runClaude(prompt, system) {
  return new Promise((resolve, reject) => {
    // Print mode, lean: skip MCP servers and Claude Code's default agent system
    // prompt (replace with ours) so it behaves like a fast plain LLM call.
    const args = ["-p", prompt, "--model", MODEL, "--output-format", "json",
      "--strict-mcp-config", "--setting-sources", ""];
    if (system) args.push("--system-prompt", system);
    const child = spawn("/Users/maverick/.local/bin/claude", args, {
      cwd: "/tmp", env: process.env,
    });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("claude timed out")); }, 150000);
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.slice(0, 500) || `claude exited ${code}`));
      try { resolve(JSON.parse(out).result || ""); }
      catch { resolve(out); }   // fall back to raw stdout
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// Async job store so the Worker never has to hold a long request open
// (Cloudflare Tunnel caps synchronous requests at ~100s). Jobs are fire-and-poll.
const jobs = new Map(); // id -> { status, text?, error?, t }
setInterval(() => { const now = Date.now(); for (const [k, v] of jobs) if (now - v.t > 10 * 60 * 1000) jobs.delete(k); }, 60000);

// Cap concurrent claude processes — the backup is public but runs on ONE Max plan,
// so protect the Mac and the account's rate limits.
const MAX_ACTIVE = Number(process.env.MAX_CONCURRENCY || 2);
let active = 0;

const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", c => (b += c)); req.on("end", () => resolve(b)); });

http.createServer(async (req, res) => {
  const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") return send(200, { ok: true, model: MODEL });
  if (req.headers["x-secret"] !== SECRET) return send(401, { error: "unauthorized" });

  // Kick off a generation, return a job id immediately.
  if (req.method === "POST" && path === "/start") {
    let prompt, system;
    try { const p = JSON.parse(await readBody(req)); prompt = p.prompt; system = p.system; } catch { return send(400, { error: "bad json" }); }
    if (!prompt || typeof prompt !== "string") return send(400, { error: "missing prompt" });
    if (active >= MAX_ACTIVE) return send(429, { error: "busy", active });
    const id = crypto.randomUUID();
    jobs.set(id, { status: "pending", t: Date.now() });
    const t0 = Date.now();
    active++;
    console.log(`[job ${id.slice(0, 8)}] start (active=${active}) prompt=${prompt.length}b system=${(system || "").length}b`);
    runClaude(prompt, system)
      .then(text => { jobs.set(id, { status: "done", text, t: Date.now() }); console.log(`[job ${id.slice(0, 8)}] done in ${Date.now() - t0}ms out=${text.length}b`); })
      .catch(e => { jobs.set(id, { status: "error", error: String(e.message || e).slice(0, 400), t: Date.now() }); console.log(`[job ${id.slice(0, 8)}] error: ${e.message}`); })
      .finally(() => { active--; });
    return send(200, { jobId: id });
  }

  // Poll a job (consumes it once finished).
  if (req.method === "GET" && path === "/result") {
    const id = url.searchParams.get("id");
    const j = id && jobs.get(id);
    if (!j) return send(404, { error: "unknown job" });
    if (j.status === "pending") return send(200, { status: "pending" });
    jobs.delete(id);
    return send(200, j.status === "done" ? { status: "done", text: j.text } : { status: "error", error: j.error });
  }

  // Synchronous path (kept for local testing).
  if (req.method === "POST" && path === "/generate") {
    let prompt, system;
    try { const p = JSON.parse(await readBody(req)); prompt = p.prompt; system = p.system; } catch { return send(400, { error: "bad json" }); }
    if (!prompt) return send(400, { error: "missing prompt" });
    try { send(200, { text: await runClaude(prompt, system) }); }
    catch (e) { send(502, { error: String(e.message || e).slice(0, 500) }); }
    return;
  }

  send(404, { error: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`structura-max on 127.0.0.1:${PORT} (model ${MODEL})`));
