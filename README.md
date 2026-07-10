# corroborate-mcp

**An MCP server that tells AI agents how independently corroborated a claim is.**

Give it a claim, get back an honest verdict: how many *independent* story origins are reporting it — not how many articles mention it. An AP story echoed by 40 outlets counts as **one** origin. That judgment layer is what raw search doesn't give you.

```
"NASA delayed the Artemis III landing"  →  CONFIRMED    (4 independent origins, confidence 0.9)
"Zorblatt Corp acquired Portugal"       →  UNCORROBORATED (0 origins, confidence 0.05)
```

**What it measures — and what it doesn't:** *reporting corroboration*, not truth. A claim every outlet syndicated from one wire story comes back `SINGLE_SOURCE`. A claim nobody covers comes back `UNCORROBORATED` even if true. The verdict says exactly what was measured, flags its own weaknesses (`notes`), and discloses when a source engine was down (`coverage: "degraded"`) so absence of evidence is never silently confused with evidence of absence.

- **Keyless & free to run locally** — Google News RSS + GDELT + Hacker News. No API keys, no accounts.
- **Deterministic** — no LLM calls. Same evidence in, same verdict out. Typical call: 1–3s (10s worst case when an engine lags; repeat queries are cached ~10 min).
- **Agent-first output** — small, tight JSON an agent can act on directly.

## Quickstart

Requires Node ≥ 18.

**Claude Code**
```bash
claude mcp add corroborate -- npx -y corroborate-mcp
```

**Claude Desktop / Cursor / any MCP client** (`claude_desktop_config.json`, `.cursor/mcp.json`, …)
```json
{
  "mcpServers": {
    "corroborate": { "command": "npx", "args": ["-y", "corroborate-mcp"] }
  }
}
```

**Straight from a checkout**
```bash
npm install
node cli.js "The Federal Reserve held interest rates steady"   # engine smoke test, no MCP client needed
```

## Tools

### `corroborate_claim`
The main event. `{ claim, window_days?=7, max_sources?=8 }` →

```json
{
  "claim": "Acme Corp acquires Widget Industries for $2 billion",
  "corroboration": "CONFIRMED",
  "n_independent_sources": 3,
  "confidence": 0.9,
  "coverage": "full",
  "sources": [
    {
      "headline": "Acme Corp to acquire Widget Industries in $2 billion deal",
      "outlet": "Financial Times", "domain": "ft.com", "url": "https://…",
      "published_at": "2026-07-09T14:02:00Z", "age_days": 0.9,
      "wire": false, "echoed_by_n_domains": 1
    }
  ],
  "notes": ["syndication detected: near-identical headlines across multiple domains were collapsed into one origin"],
  "method": "reporting-corroboration: counts INDEPENDENT story origins (syndication-aware), not raw article count; does not adjudicate truth"
}
```

| Field | Meaning |
|---|---|
| `corroboration` | `CONFIRMED` (≥2 independent origins) · `SINGLE_SOURCE` (1) · `UNCORROBORATED` (0) |
| `n_independent_sources` | Distinct story *origins* after syndication clustering — not article count |
| `confidence` | 0–1. Scales with origins and cross-engine agreement; penalized for wide single-origin echo |
| `coverage` | `full`, or `degraded` when a source engine failed this call — a weak verdict then may reflect the outage, not the claim |
| `sources[].wire` | Origin is a wire service (AP/Reuters/AFP/UPI) |
| `sources[].echoed_by_n_domains` | How many domains carried this same story |
| `notes` | Honest caveats: syndication collapse, breaking-news cascade (<24h coverage), relevance-gate discards, engine outages |

### `find_sources`
Cheaper primitive: `{ query, window_days?=7, max_sources?=10 }` → deduped multi-engine article list (outlet, domain, date, engine) with no verdict. Use it when you want the evidence but your own judgment.

## How the independence judgment works

1. **Search** Google News RSS, GDELT, and Hacker News in parallel (keyword extraction from the claim; quoted phrases preserved).
2. **Relevance gate** — an article only counts if its headline genuinely addresses the claim (≥2 core-token hits AND ≥35% of core tokens). Loose topical echoes are discarded and the discard count is reported.
3. **Syndication clustering** — near-identical headlines across different domains (Jaccard similarity ≥ 0.55) collapse into one origin; wire domains are flagged.
4. **Verdict** — independent origins = distinct clusters. Confidence rises with origins and cross-engine agreement, falls for wide single-origin echoes. Every weakness the engine knows about goes in `notes`.

## Honest limitations

- English-language, headline-level analysis. Paywalled body text is not fetched.
- Recency-biased: the default window is 7 days (max 90). Old claims come back `UNCORROBORATED` — that's a window statement, not a falsity verdict.
- Two outlets independently rewriting the same wire story can occasionally slip past clustering; genuinely different phrasings of one origin may occasionally count as two.
- If all three engines are down, tools return an **error** — never a fake `UNCORROBORATED`.

## Development

```bash
npm test              # golden-claim suite — deterministic, no network
npm run test:mcp      # MCP stdio handshake + tools/list
npm run test:live     # live invariants against real engines
npm run test:release  # all of the above — run before every release
```

MIT © Ezra Cohen
