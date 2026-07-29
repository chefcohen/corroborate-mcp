// Golden-claim tests — deterministic, no network. These pin down the HONESTY behaviors:
// relevance gate, syndication collapse, wire detection, cascade warning, degraded-coverage disclosure.
// Run before every release: `npm test`. A fact-checker that's wrong is worse than none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess } from "../src/engine.js";
import { keywords, domainOf, jaccard, relevance, coreTokens, normTitle } from "../src/text.js";

const CLAIM = "Acme Corp acquires Widget Industries for $2 billion";
const art = ({ title, domain, engine = "google-news", age = 2 }) => ({
  title, domain, engine,
  url: `https://${domain}/story`,
  source: domain,
  published_at: new Date(Date.now() - age * 864e5).toISOString(),
  age_days: age,
});

// --- text utilities ---

test("keywords: keeps entities/numbers, drops stopwords, honors quoted phrases", () => {
  const k = keywords('The Federal Reserve "held rates" steady');
  assert.ok(k.includes("held rates"), "quoted phrase preserved");
  assert.ok(k.includes("Federal") && k.includes("Reserve"));
  assert.ok(!k.includes("The") && !k.includes("the"));
});

test("domainOf: strips www, handles ccTLDs, empty on garbage", () => {
  assert.equal(domainOf("https://www.bbc.co.uk/news/x"), "bbc.co.uk");
  assert.equal(domainOf("https://apnews.com/article/x"), "apnews.com");
  assert.equal(domainOf("not a url"), "");
});

test("jaccard: identity is 1, disjoint is 0", () => {
  assert.equal(jaccard(["a", "b"], ["a", "b"]), 1);
  assert.equal(jaccard(["a", "b"], ["c", "d"]), 0);
});

test("relevance: prefix-aware matching (fed~federal, billion~billions)", () => {
  assert.equal(relevance(["federal", "reserve"], ["fed"]), 1);
  assert.equal(relevance(["billions"], ["billion"]), 1);
});

// --- golden verdicts ---

test("GOLDEN true multi-origin claim -> CONFIRMED, high confidence, full coverage", () => {
  const v = assess(CLAIM, [
    art({ title: "Acme Corp to acquire Widget Industries in $2 billion deal", domain: "nytimes.com", age: 0.5 }),
    art({ title: "Widget Industries bought by Acme for billions, sources say", domain: "ft.com", engine: "gdelt", age: 2.1 }),
    art({ title: "Acme Corp buys Widget Industries", domain: "wsj.com", age: 3.0 }),
  ]);
  assert.equal(v.corroboration, "CONFIRMED");
  assert.equal(v.n_independent_sources, 3);
  assert.equal(v.confidence, 0.9); // 3 origins + cross-engine agreement
  assert.equal(v.coverage, "full");
  assert.equal(v.sources.length, 3);
});

test("GOLDEN wire echo across 4 outlets -> collapses to ONE origin, SINGLE_SOURCE", () => {
  const title = "Acme Corp to acquire Widget Industries in $2 billion deal";
  const v = assess(CLAIM, [
    art({ title, domain: "apnews.com", age: 0.1 }),
    art({ title, domain: "sfgate.com", age: 0.3 }),
    art({ title, domain: "yahoo.com", age: 0.9 }),
    art({ title, domain: "startribune.com", age: 1.5 }),
  ]);
  assert.equal(v.corroboration, "SINGLE_SOURCE");
  assert.equal(v.n_independent_sources, 1);
  assert.equal(v.confidence, 0.25); // single origin, penalized for wide echo
  assert.equal(v.sources[0].wire, true);
  assert.equal(v.sources[0].echoed_by_n_domains, 4);
  assert.ok(v.notes.some(n => n.includes("syndication detected")));
});

test("GOLDEN fabricated claim with only loose topical matches -> UNCORROBORATED, gate discards", () => {
  const claim = "Zorblatt Industries announces teleportation breakthrough";
  const v = assess(claim, [
    art({ title: "Industries report quarterly growth", domain: "cnbc.com" }),
    art({ title: "Teleportation in science fiction: a history", domain: "wired.com" }),
  ]);
  assert.equal(v.corroboration, "UNCORROBORATED");
  assert.equal(v.n_independent_sources, 0);
  assert.equal(v.confidence, 0.05);
  assert.ok(v.notes.some(n => n.includes("discarded by the relevance gate")));
});

test("GOLDEN no coverage at all -> UNCORROBORATED with the no-coverage note", () => {
  const v = assess(CLAIM, []);
  assert.equal(v.corroboration, "UNCORROBORATED");
  assert.ok(v.notes.some(n => n.includes("no dated coverage")));
});

test("GOLDEN breaking-news cascade (<24h, distinct origins) -> CONFIRMED but flagged", () => {
  const v = assess(CLAIM, [
    art({ title: "Acme Corp to acquire Widget Industries in $2 billion deal", domain: "nytimes.com", age: 0.2 }),
    art({ title: "Widget Industries bought by Acme for billions, sources say", domain: "ft.com", engine: "gdelt", age: 0.6 }),
  ]);
  assert.equal(v.corroboration, "CONFIRMED");
  assert.equal(v.confidence, 0.7);
  assert.ok(v.notes.some(n => n.includes("breaking-news cascade")));
});

test("GOLDEN engine outage -> coverage degraded and disclosed, outage is not evidence of absence", () => {
  const v = assess(CLAIM, [
    art({ title: "Acme Corp to acquire Widget Industries in $2 billion deal", domain: "nytimes.com" }),
  ], { engine_errors: ["gdelt: HTTP 429"], n_engines_ok: 2, n_engines: 3 });
  assert.equal(v.coverage, "degraded");
  assert.ok(v.notes.some(n => n.includes("incomplete coverage")));
  assert.equal(v.corroboration, "SINGLE_SOURCE");
});

test("verdict shape: every field an agent relies on is present", () => {
  const v = assess(CLAIM, []);
  for (const key of ["claim", "query_used", "window_days", "corroboration", "n_independent_sources",
    "confidence", "coverage", "sources", "notes", "method"]) {
    assert.ok(key in v, `missing field: ${key}`);
  }
});

test("core tokens ignore short words and stopwords", () => {
  const core = coreTokens(CLAIM);
  assert.ok(core.includes("acme") && core.includes("billion"));
  assert.ok(!core.includes("for") && !core.includes("2"));
  assert.deepEqual(normTitle("The Cat AND the Hat!"), ["cat", "hat"]);
});

// --- DEFECT FIXES 2026-07-29: two customer-facing honesty defects (Adam-flagged, verified at source) ---

test("DEFECT-1: old-but-clustered coverage must NOT be reported as '<24h old'", () => {
  // 5 days old, published within ~4h of each other: tight SPREAD, but NOT recent.
  // Old code emitted "all coverage is <24h old" — a false statement to a paying caller.
  const v = assess(CLAIM, [
    art({ title: "Acme Corp to acquire Widget Industries in $2 billion deal", domain: "nytimes.com", age: 5.0 }),
    art({ title: "Widget Industries bought by Acme for billions, sources say", domain: "ft.com", engine: "gdelt", age: 5.15 }),
  ]);
  const cascade = v.notes.find(n => n.includes("breaking-news cascade"));
  assert.ok(cascade, "cascade should still be detected (tight publication window)");
  assert.ok(!cascade.includes("<24h old"), "must NOT claim the coverage is <24h old when it is 5 days old");
  assert.ok(cascade.includes("older than 24h"), "must state the story is older than 24h");
});

test("DEFECT-1: genuinely fresh clustered coverage MAY state <24h old", () => {
  const v = assess(CLAIM, [
    art({ title: "Acme Corp to acquire Widget Industries in $2 billion deal", domain: "nytimes.com", age: 0.2 }),
    art({ title: "Widget Industries bought by Acme for billions, sources say", domain: "ft.com", engine: "gdelt", age: 0.6 }),
  ]);
  const cascade = v.notes.find(n => n.includes("breaking-news cascade"));
  assert.ok(cascade && cascade.includes("<24h old"), "genuinely recent coverage may truthfully claim <24h old");
});

test("DEFECT-2: truncated sources[] must be disclosed and machine-readable", () => {
  // 12 distinct origins, max_sources 3 -> caller must be able to audit the gap.
  // Titles must be genuinely DISSIMILAR or our own syndication clustering (correctly) collapses them
  // into one origin — which is exactly what happened on the first draft of this test.
  const WORDINGS = [
    "Acme Corp acquires Widget Industries for $2 billion",
    "Widget purchase completed by Acme in landmark transaction",
    "Regulators review the Acme Widget merger agreement",
    "Analysts weigh Acme takeover of Widget manufacturing arm",
    "Widget shareholders approve billion-dollar Acme offer",
    "Acme expands portfolio through Widget acquisition deal",
    "Antitrust questions raised over Acme Widget consolidation",
    "Widget Industries staff briefed on Acme ownership change",
    "Acme financing structure for Widget purchase detailed",
    "Widget brand to continue operating under Acme control",
    "Market reacts to Acme Widget billion dollar agreement",
    "Acme executives defend Widget acquisition price tag",
  ];
  const many = WORDINGS.map((t, i) => art({ title: t, domain: `outlet${i}.com`, age: 1 + i * 0.5 }));
  const v = assess(CLAIM, many, { max_sources: 3 });
  assert.equal(v.sources.length, 3, "sources[] truncated to max_sources");
  assert.ok(v.n_independent_sources > v.sources.length, "count exceeds shown (the auditability gap)");
  assert.equal(v.n_sources_returned, 3, "n_sources_returned must report what was actually returned");
  assert.ok(v.notes.some(n => n.includes("truncated to max_sources")), "the gap must be disclosed in notes");
});

test("DEFECT-2: no truncation note when everything is shown", () => {
  const v = assess(CLAIM, [
    art({ title: "Acme Corp to acquire Widget Industries in $2 billion deal", domain: "nytimes.com", age: 1 }),
  ]);
  assert.equal(v.n_sources_returned, v.n_independent_sources, "no gap when nothing is truncated");
  assert.ok(!v.notes.some(n => n.includes("truncated to max_sources")), "must not cry truncation when none occurred");
});
