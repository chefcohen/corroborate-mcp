# Corroborate — claim corroboration for AI agents (MCP server)

**Give your agent a claim, get back an honest verdict: how many *independent* story origins are reporting it.** An AP story echoed by 40 outlets counts as **one** origin — that syndication-aware judgment layer is what raw search doesn't give you.

```
"NASA delayed the Artemis III landing"  →  CONFIRMED      (4 independent origins, confidence 0.9)
"Zorblatt Corp acquired Portugal"       →  UNCORROBORATED (0 origins, confidence 0.05)
```

## Why agents use it

- **Honest by construction.** The verdict says exactly what was measured, flags its own weaknesses (`notes`), discloses degraded source coverage (`coverage`), and returns an *error* — never a fake verdict — if sources are unreachable.
- **Published error rates.** Measured on a public 40-claim labeled benchmark: **0/10** fabricated claims falsely CONFIRMED, **0/12** widely-reported true claims missed. Distorted versions of real events confirm 3/5 — no stance detection yet, and we tell you so. Full table and methodology in the [GitHub repo](https://github.com/OWNER/corroborate-mcp).
- **Fast and deterministic.** No LLM in the loop — p50 ~0.4s, worst case ~8s. Same evidence in, same verdict out.
- **Pay per verdict.** Tool calls are the only charged event ($0.05). Connecting, listing tools, and inspecting schemas are free.

## Tools

**`corroborate_claim`** `{ claim, window_days?=7, max_sources?=8 }` → verdict:
`corroboration` (CONFIRMED ≥2 independent origins / SINGLE_SOURCE / UNCORROBORATED) · `n_independent_sources` · per-source evidence (outlet, domain, url, date, wire flag, echo count) · `confidence` 0–1 · `coverage` full/degraded · honest `notes`.

**`find_sources`** `{ query, window_days?, max_sources? }` → deduped multi-engine source list, no verdict — when you want the evidence but your own judgment.

## Connect

MCP endpoint (Streamable HTTP), any MCP client:

```json
{
  "mcpServers": {
    "corroborate": {
      "url": "https://USERNAME--corroborate-mcp.apify.actor/mcp",
      "headers": { "Authorization": "Bearer <YOUR_APIFY_API_TOKEN>" }
    }
  }
}
```

## What it measures — and what it doesn't

*Reporting corroboration*, not metaphysical truth. A claim every outlet syndicated from one wire story returns `SINGLE_SOURCE`. A claim nobody covers returns `UNCORROBORATED` even if true. CONFIRMED on a detail-critical claim means "independent coverage of this topic exists — verify the specific figures against the returned sources." English-language, headline-level, recency-windowed (default 7 days, max 90).

Prefer to run it locally for free? The full open-source version is on [GitHub](https://github.com/OWNER/corroborate-mcp) and npm (`npx corroborate-mcp`).
