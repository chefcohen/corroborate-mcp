#!/usr/bin/env node
// Corroborate — MCP server. Two tools, tight JSON out. stdio transport (works in Claude, goose, Cursor, etc.).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { corroborate, findSources } from "./engine.js";

const server = new McpServer({ name: "corroborate", version: "0.1.0" });

server.registerTool("corroborate_claim", {
  title: "Corroborate a claim",
  description: "Check how independently corroborated a claim is. Returns a syndication-aware verdict " +
    "(CONFIRMED / SINGLE_SOURCE / UNCORROBORATED), the number of INDEPENDENT story origins (wire echoes collapse " +
    "to one), per-source evidence with dates, a confidence score, and honest caveats. Measures reporting " +
    "corroboration, not truth.",
  inputSchema: {
    claim: z.string().describe("The claim to check, as a plain sentence"),
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
  description: "Raw multi-engine source search (Google News, GDELT, Hacker News) for a query — deduped list with " +
    "outlet, domain, date. Cheaper primitive when you just need coverage, not a verdict.",
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
