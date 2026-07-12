#!/usr/bin/env node
// Corroborate — MCP server. Two tools, tight JSON out. stdio transport (works in Claude, goose, Cursor, etc.).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { corroborate, findSources } from "./engine.js";

const server = new McpServer({ name: "corroborate", version: "0.1.0" });

server.registerTool("corroborate_claim", {
  title: "Corroborate a claim",
  // Agent-first description: what it does, WHEN to call it, what it returns, the one honest caveat,
  // and the trust signal — dense and decision-useful (agents pay a context-token tax for verbose metadata).
  description: "Given a factual/news claim, returns how INDEPENDENTLY it is being reported. Use before " +
    "relying on a current-event claim. Output: verdict (CONFIRMED = 2+ independent origins | SINGLE_SOURCE | " +
    "UNCORROBORATED), count of independent story origins (wire/syndication echoes collapse to one), per-source " +
    "evidence (outlet, domain, url, date), confidence 0-1, coverage flag, honest caveats. Measures REPORTING " +
    "corroboration, not truth — no stance detection, so a distorted claim about a real event may still show " +
    "coverage; verify specifics against the returned sources. Keyless, read-only, deterministic; if all sources " +
    "are unreachable it errors rather than returning a false negative.",
  inputSchema: {
    claim: z.string().describe("The claim to check, as a plain declarative sentence"),
    window_days: z.number().int().min(1).max(90).optional().describe("Lookback window in days (default 7)"),
    max_sources: z.number().int().min(1).max(20).optional().describe("Max evidence sources returned (default 8)"),
  },
}, async ({ claim, window_days, max_sources }) => {
  try {
    const res = await corroborate(claim, { window_days, max_sources });
    return { content: [{ type: "text", text: JSON.stringify(res, null, 1) }] };
  } catch (e) {
    // e.g. all source engines down — refuse to guess rather than return a fake UNCORROBORATED
    return { isError: true, content: [{ type: "text", text: `corroborate_claim failed: ${e.message}` }] };
  }
});

server.registerTool("find_sources", {
  title: "Find sources",
  description: "Multi-engine news/source search (Google News, GDELT, Hacker News) for a query: a deduped list of " +
    "{outlet, domain, url, date}. Use when you want raw coverage to judge yourself, not a scored verdict — the " +
    "cheaper primitive under corroborate_claim. Keyless, read-only.",
  inputSchema: {
    query: z.string().describe("Search query or claim"),
    window_days: z.number().int().min(1).max(90).optional(),
    max_sources: z.number().int().min(1).max(30).optional(),
  },
}, async ({ query, window_days, max_sources }) => {
  try {
    const res = await findSources(query, { window_days, max_sources });
    return { content: [{ type: "text", text: JSON.stringify(res, null, 1) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `find_sources failed: ${e.message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
