#!/usr/bin/env node
// Live golden run — real network, invariant-based (news changes daily; exact outputs can't be pinned).
// Used pre-release and by the daily self-test cron once listed. Exit 0 = healthy, 1 = hard failure.
// HARD invariants: engines reachable; fabricated claims never come back corroborated.
// SOFT check (reported, non-fatal): today's top headline should corroborate as >= SINGLE_SOURCE.
import { corroborate, findSources } from "../src/engine.js";

let hardFail = false;
const ok = (label, extra = "") => console.log(`PASS  ${label}${extra ? " — " + extra : ""}`);
const fail = (label, extra = "") => { hardFail = true; console.log(`FAIL  ${label}${extra ? " — " + extra : ""}`); };
const warn = (label, extra = "") => console.log(`WARN  ${label}${extra ? " — " + extra : ""}`);

// 1. Engines reachable (>=2 of 3 up, real results for an evergreen query)
try {
  const t0 = Date.now();
  const s = await findSources("Federal Reserve interest rates", { window_days: 7, max_sources: 10 });
  const ms = Date.now() - t0;
  if (s.n_engines_ok >= 2 && s.n_results > 0) ok("engines reachable", `${s.n_engines_ok}/${s.n_engines} up, ${s.n_results} results, ${ms}ms`);
  else fail("engines reachable", `${s.n_engines_ok}/${s.n_engines} up, ${s.n_results} results (${(s.engine_errors || []).join("; ")})`);
} catch (e) { fail("engines reachable", e.message); }

// 2. No false positives: a fabricated claim must NEVER come back corroborated
try {
  const v = await corroborate("Zorblatt Aeronautics acquired the Duchy of Grand Fenwick for 12 trillion dollars", { window_days: 7 });
  if (v.corroboration === "UNCORROBORATED" && v.n_independent_sources === 0) ok("fabricated claim rejected", `confidence ${v.confidence}`);
  else fail("fabricated claim rejected", `got ${v.corroboration} with ${v.n_independent_sources} source(s) — FALSE POSITIVE`);
} catch (e) { warn("fabricated claim rejected", `engines down mid-check: ${e.message}`); }

// 3. Soft: today's top story (from Google News front page) should corroborate
try {
  const r = await fetch("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en", {
    headers: { "User-Agent": "corroborate-mcp-selftest" }, signal: AbortSignal.timeout(8000),
  });
  const m = (await r.text()).match(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/);
  const headline = m?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/ - [^-]+$/, "").trim();
  if (!headline) warn("top-headline corroborates", "could not extract a headline");
  else {
    const t0 = Date.now();
    const v = await corroborate(headline, { window_days: 3 });
    const ms = Date.now() - t0;
    if (v.n_independent_sources >= 1) ok("top-headline corroborates", `"${headline}" -> ${v.corroboration} (${v.n_independent_sources} origins, ${ms}ms)`);
    else warn("top-headline corroborates", `"${headline}" -> UNCORROBORATED (soft: phrasing/recency may explain it)`);
  }
} catch (e) { warn("top-headline corroborates", e.message); }

console.log(hardFail ? "\nRESULT: FAIL" : "\nRESULT: HEALTHY");
process.exit(hardFail ? 1 : 0);
