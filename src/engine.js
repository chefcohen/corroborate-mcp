// Core judgment: search -> dedupe -> syndication clustering -> independence -> verdict.
// Independence = distinct STORY ORIGINS, not distinct domains: near-identical headlines across many
// outlets (wire syndication) collapse to one origin. This is the layer generic scrapers don't have.
import { searchAll } from "./sources.js";
import { keywords, normTitle, jaccard, domainOf, ageDays, coreTokens, relevance } from "./text.js";

const WIRES = new Set(["apnews.com", "reuters.com", "afp.com", "upi.com"]);
const SIM_THRESHOLD = 0.55;

export async function findSources(query, { window_days = 7, max_sources = 10 } = {}) {
  const q = keywords(query).join(" ");
  const { articles, engine_errors, n_engines_ok, n_engines } = await searchAll(q, window_days, Math.max(10, max_sources));
  if (n_engines_ok === 0) {
    // No verdict is better than a fake one: with every engine down, "no coverage" would be a lie.
    throw new Error(`all source engines failed (${engine_errors.join("; ")}) — cannot corroborate right now, retry later`);
  }
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const d = domainOf(a.source_url || "") || domainOf(a.url) || a.source.toLowerCase();
    const key = d + "|" + normTitle(a.title).slice(0, 8).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...a, domain: d, age_days: round1(ageDays(a.published_at)) });
  }
  return { query_used: q, n_results: out.length, results: out.slice(0, max_sources * 2), engine_errors, n_engines_ok, n_engines };
}

export async function corroborate(claim, { window_days = 7, max_sources = 8 } = {}) {
  const { query_used, results, engine_errors, n_engines_ok, n_engines } =
    await findSources(claim, { window_days, max_sources: 20 });
  return assess(claim, results, { query_used, window_days, max_sources, engine_errors, n_engines_ok, n_engines });
}

// Pure judgment over already-fetched articles — no network. This is what the golden tests pin down.
export function assess(claim, rawResults, {
  query_used = "", window_days = 7, max_sources = 8,
  engine_errors = [], n_engines_ok = 3, n_engines = 3,
} = {}) {
  // RELEVANCE GATE (honesty): an article only corroborates if its title genuinely addresses the claim —
  // >=2 core-token hits AND >=35% of the claim's core tokens. Loose keyword echoes don't count.
  const core = coreTokens(claim);
  const results = rawResults.filter(a => {
    const tt = normTitle(a.title);
    const r = relevance(tt, core);
    const hits = Math.round(r * core.length);
    return hits >= 2 && r >= 0.35;
  });
  const n_discarded = rawResults.length - results.length;

  // cluster near-identical titles across domains -> one origin each (wire/syndication detection)
  const clusters = [];
  for (const a of results) {
    const toks = normTitle(a.title);
    let home = clusters.find(c => jaccard(c.toks, toks) >= SIM_THRESHOLD);
    if (!home) { home = { toks, items: [] }; clusters.push(home); }
    home.items.push(a);
  }
  for (const c of clusters) {
    c.domains = [...new Set(c.items.map(i => i.domain))];
    c.isWire = c.items.some(i => WIRES.has(i.domain));
    c.syndicated = c.domains.length >= 3;
    // representative = earliest dated item (closest to the origin)
    c.rep = c.items.slice().sort((x, y) => (x.published_at || "9") < (y.published_at || "9") ? -1 : 1)[0];
  }

  const n = clusters.length;
  const engines = new Set(results.map(r => r.engine));
  const ages = results.map(r => r.age_days).filter(x => x != null);
  const allSameDay = ages.length >= 2 && Math.max(...ages) - Math.min(...ages) < 1.0;
  const degraded = engine_errors.length > 0;

  let confidence = n >= 3 ? 0.8 : n === 2 ? 0.6 : n === 1 ? 0.3 : 0.05;
  if (engines.size >= 2 && n >= 2) confidence += 0.1;               // cross-engine agreement
  if (clusters.some(c => c.syndicated) && n === 1) confidence -= 0.05; // wide echo of a single origin
  confidence = Math.max(0, Math.min(0.95, round2(confidence)));

  const notes = [];
  if (degraded) notes.push(`incomplete coverage: ${engine_errors.length} of ${n_engines} source engine(s) failed (${engine_errors.join("; ")}) — a weak result may reflect the outage, not the claim`);
  if (clusters.some(c => c.syndicated)) notes.push("syndication detected: near-identical headlines across multiple domains were collapsed into one origin");
  if (allSameDay && n >= 1) notes.push("all coverage is <24h old — breaking-news cascade; independence is weaker than the source count suggests");
  if (n === 0) notes.push("no dated coverage found in the window — the claim may be older than the window, misphrased, or unreported");
  if (n_discarded > 0) notes.push(`${n_discarded} loosely-related article(s) found but discarded by the relevance gate (they mention the topic, not the claim)`);

  return {
    claim,
    query_used,
    window_days,
    corroboration: n >= 2 ? "CONFIRMED" : n === 1 ? "SINGLE_SOURCE" : "UNCORROBORATED",
    n_independent_sources: n,
    confidence,
    coverage: degraded ? "degraded" : "full",
    sources: clusters.slice(0, max_sources).map(c => ({
      headline: c.rep.title,
      outlet: c.rep.source || c.rep.domain,
      domain: c.rep.domain,
      url: c.rep.url,
      published_at: c.rep.published_at || null,
      age_days: c.rep.age_days ?? null,
      wire: c.isWire,
      echoed_by_n_domains: c.domains.length,
    })),
    notes,
    method: "reporting-corroboration: counts INDEPENDENT story origins (syndication-aware), not raw article count; does not adjudicate truth",
  };
}

const round1 = x => (x == null ? null : Math.round(x * 10) / 10);
const round2 = x => Math.round(x * 100) / 100;
