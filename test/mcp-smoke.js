#!/usr/bin/env node
// MCP protocol smoke test: spawn the server over stdio, do the initialize handshake, list tools.
// No network needed — verifies the thing an MCP client sees before any tool call.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const serverPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "server.js");
const proc = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "inherit"] });

const send = obj => proc.stdin.write(JSON.stringify(obj) + "\n");
let buf = "";
const responses = [];
proc.stdout.on("data", d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) try { responses.push(JSON.parse(line)); } catch {}
  }
});

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
  protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });

const deadline = Date.now() + 8000;
const waitFor = async id => {
  while (Date.now() < deadline) {
    const r = responses.find(x => x.id === id);
    if (r) return r;
    await new Promise(res => setTimeout(res, 50));
  }
  throw new Error(`timeout waiting for response id=${id}`);
};

try {
  const init = await waitFor(1);
  if (init.result?.serverInfo?.name !== "corroborate") throw new Error("bad initialize: " + JSON.stringify(init));
  console.log(`PASS  initialize — server "${init.result.serverInfo.name}" v${init.result.serverInfo.version}`);

  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tools = (await waitFor(2)).result?.tools?.map(t => t.name).sort() ?? [];
  const expected = ["corroborate_claim", "find_sources"];
  if (JSON.stringify(tools) !== JSON.stringify(expected)) throw new Error(`tools mismatch: ${tools.join(", ")}`);
  console.log(`PASS  tools/list — ${tools.join(", ")}`);
  console.log("\nRESULT: HEALTHY");
  proc.kill();
  process.exit(0);
} catch (e) {
  console.log(`FAIL  ${e.message}\n\nRESULT: FAIL`);
  proc.kill();
  process.exit(1);
}
