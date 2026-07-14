# corroborate-mcp

**The honest corroboration layer for AI agents.** Hand it a claim; it tells you how *independently* that claim is actually being reported — and shows its work.

[![npm](https://img.shields.io/npm/v/corroborate-mcp)](https://www.npmjs.com/package/corroborate-mcp)
[![downloads](https://img.shields.io/npm/dm/corroborate-mcp)](https://www.npmjs.com/package/corroborate-mcp)
[![license](https://img.shields.io/npm/l/corroborate-mcp)](./LICENSE)
![node](https://img.shields.io/node/v/corroborate-mcp)
![MCP](https://img.shields.io/badge/MCP-server-blue)
![API keys](https://img.shields.io/badge/API%20keys-0-brightgreen)

> An AP story echoed by 40 outlets is **one** origin, not 40 citations. Other verifiers count citations; Corroborate counts independent *origins* — syndication-aware — then publishes its own error rates and discloses coverage gaps. That's the judgment layer raw search and citation-checkers skip.

```text
corroborate_claim("NASA delayed the Artemis III landing")   → CONFIRMED       4 independent origins · conf 0.9
corroborate_claim("Zorblatt Corp acquired Portugal")        → UNCORROBORATED  0 origins · conf 0.05
```

## When an agent should call this
- Before **relying on a current-event / news claim** — is it independently reported, or one source echoed everywhere?
- To **rank or filter sources** by genuine independence, with a confidence score.
- When you need a **verdict you can defend** — every answer ships its evidence, its confidence, and its own caveats.

Not a web search engine (use Exa/Tavily/Brave for that) and not a human fact-checking network. It's the narrow, honest primitive in between: *how independently is this reported?*

## Why it's trustworthy — by design
| | |
|---|---|
| 🔑 **Zero API keys, zero accounts** | Keyless engines (Google News RSS · GDELT · Hacker News). Nothing to sign up for. |
| 👁 **Read-only** | It reads public news. It cannot act, write, spend, or touch your data. |
| 🎯 **Deterministic** | No LLM in the loop — same evidence in, same verdict out. p50 ~0.4s. |
| 📖 **Open source (MIT)** | Read every line of the judgment. |
| 📊 **Published error rates** | We measure our own false-CONFIRMED / false-UNCORROBORATED rates on a public benchmark and print them below. Most "fact-check" tools don't. |
| 🚫 **Never lies by omission** | If sources are unreachable it returns an **error**, never a fake "UNCORROBORATED." |

## What it measures — and what it doesn't
*Reporting corroboration*, not truth. A claim every outlet syndicated from one wire story comes back `SINGLE_SOURCE`. A claim nobody covers comes back `UNCORROBORATED` even if true. The verdict states exactly what was measured, flags its weaknesses in `notes`, and sets `coverage:"degraded"` when an engine was down — so absence of evidence is never quietly sold as evidence of absence.

## Quickstart
Requires Node ≥ 18. No keys, no config.

**Claude Code**
```bash
claude mcp add corroborate -- npx -y corroborate-mcp
```

**Claude Desktop / Cursor / any MCP client** (`claude_desktop_config.json`, `.cursor/mcp.json`, …)
```json
{ "mcpServers": { "corroborate": { "command": "npx", "args": ["-y", "corroborate-mcp"] } } }
```

**Try it with no MCP client**
```bash
npx corroborate-mcp   # starts the stdio server (silent = healthy)
# or from a checkout:  node cli.js "The Federal Reserve held interest rates steady"
```

## Tools

### `corroborate_claim` — the verdict
`{ claim, window_days?=7, max_sources?=8 }` →
```json
{
  "claim": "Acme Corp acquires Widget Industries for $2 billion",
  "corroboration": "CONFIRMED",
  "n_independent_sources": 3,
  "confidence": 0.9,
  "coverage": "full",
  "sources": [
    { "headline": "Acme Corp to acquire Widget Industries in $2 billion deal",
      "outlet": "Financial Times", "domain": "ft.com", "url": "https://…",
      "published_at": "2026-07-09T14:02:00Z", "age_days": 0.9,
      "wire": false, "echoed_by_n_domains": 1 }
  ],
  "notes": ["syndication detected: near-identical headlines across multiple domains collapsed into one origin"],
  "method": "reporting-corroboration: counts INDEPENDENT story origins (syndication-aware), not raw article count; does not adjudicate truth"
}
```

| Field | Meaning |
|---|---|
| `corroboration` | `CONFIRMED` (≥2 independent origins) · `SINGLE_SOURCE` (1) · `UNCORROBORATED` (0) |
| `n_independent_sources` | Distinct story *origins* after syndication clustering — not article count |
| `confidence` | 0–1. Rises with origins + cross-engine agreement; penalized for wide single-origin echo |
| `coverage` | `full`, or `degraded` when an engine failed this call — a weak verdict may then reflect the outage, not the claim |
| `sources[].wire` | Origin is a wire service (AP/Reuters/AFP/UPI) |
| `sources[].echoed_by_n_domains` | How many domains carried this same story |
| `notes` | Honest caveats: syndication collapse, breaking-news cascade (<24h), relevance-gate discards, engine outages |

### `find_sources` — the raw evidence
`{ query, window_days?=7, max_sources?=10 }` → deduped multi-engine list (outlet, domain, url, date), no verdict. The cheaper primitive when you want the coverage and your own judgment.

## Measured accuracy — because you should demand it from any fact-check tool
Against a public 40-claim labeled benchmark ([benchmark/](benchmark/) — claims, labels, category definitions, and harness are all public; run it yourself with `npm run benchmark`). Latest run **2026-07-12**:

| Metric | Result |
|---|---|
| Fabricated claims falsely CONFIRMED | **0/10** |
| Widely-reported true claims missed | **0/12** (12/12 CONFIRMED) |
| Niche true claims detected | 7/8 |
| Stale claims correctly windowed | 3/5 |
| **Distorted claims falsely CONFIRMED** | **4/6 — read the warning ↓** |
| Latency | p50 0.4s · p95 ≤8s (engine-outage worst case) |

**⚠️ Respect the distorted-claim number.** This tool checks whether independent reporting exists around a claim's topic and entities — it does **not** do stance detection. A distorted version of a real event ("OpenAI released GPT-6" when it's GPT-5.6; "the EPA *strengthened* rules" when it *weakened* them) can come back CONFIRMED because real coverage token-matches it. For adversarial or detail-critical input, read CONFIRMED as *"this topic has independent coverage — now check the specifics against the returned sources."* Stance detection is on the v1.1 roadmap. (Recurring events like championships/elections can likewise match the current cycle's coverage.)

## How the judgment works
1. **Search** Google News RSS, GDELT, Hacker News in parallel (keywords extracted from the claim; quoted phrases preserved).
2. **Relevance gate** — an article counts only if its headline genuinely addresses the claim (≥2 core-token hits AND ≥35% of core tokens). Loose topical echoes are discarded; the discard count is reported.
3. **Syndication clustering** — near-identical headlines across domains (Jaccard ≥ 0.55) collapse into one origin; wire domains flagged.
4. **Verdict** — independent origins = distinct clusters; confidence rises with origins + cross-engine agreement, falls for wide single-origin echoes; every known weakness goes in `notes`.

## Honest limitations
- **No stance detection** (the 4/6 above). CONFIRMED = independently *covered*, not verified in every detail.
- English-language, headline-level. Paywalled body text isn't fetched.
- Recency-windowed (default 7 days, max 90). Old claims read `UNCORROBORATED` — a window statement, not a falsity verdict.
- Independent rewrites of one wire story can occasionally slip clustering; distinct phrasings of one origin can occasionally count as two.
- All engines down → **error**, never a fake `UNCORROBORATED`.

## Development
```bash
npm test              # golden-claim suite — deterministic, no network
npm run test:mcp      # MCP stdio handshake + tools/list
npm run test:live     # live invariants against real engines
npm run benchmark     # 40-claim labeled accuracy benchmark (live, ~2 min)
npm run test:release  # all of the above — required green before every release
```

MIT © Ezra Cohen · [github](https://github.com/chefcohen/corroborate-mcp) · [npm](https://www.npmjs.com/package/corroborate-mcp)
