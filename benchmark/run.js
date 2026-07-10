#!/usr/bin/env node
// Benchmark harness — measures the error rates we PUBLISH in the README (release law: no release
// without them; a regression blocks the release). Live network; runs serially with a polite gap.
//
// Scoring:
//   true_widely_reported  PASS=CONFIRMED · UNDER=SINGLE_SOURCE · FAIL=UNCORROBORATED (false-UNCORROBORATED)
//   true_niche            PASS=any corroboration · FAIL=UNCORROBORATED (false-UNCORROBORATED)
//   fabricated            PASS=UNCORROBORATED · WEAK=SINGLE_SOURCE · FAIL=CONFIRMED (false-CONFIRMED)
//   real_but_stale        PASS=UNCORROBORATED in default window (correct behavior) · LEAK otherwise
//   distorted             PASS=UNCORROBORATED · WEAK=SINGLE_SOURCE · FAIL=CONFIRMED (stance blindness)
//
// Release gates (exit 1): any fabricated claim CONFIRMED, or >25% of widely-reported claims missed.
import { corroborate } from "../src/engine.js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const { claims } = JSON.parse(readFileSync(join(dir, "claims.json"), "utf8"));
const GAP_MS = 1500;

const score = (category, verdict) => {
  const v = verdict.corroboration;
  switch (category) {
    case "true_widely_reported": return v === "CONFIRMED" ? "PASS" : v === "SINGLE_SOURCE" ? "UNDER" : "FAIL";
    case "true_niche": return v === "UNCORROBORATED" ? "FAIL" : "PASS";
    case "fabricated": return v === "UNCORROBORATED" ? "PASS" : v === "SINGLE_SOURCE" ? "WEAK" : "FAIL";
    case "real_but_stale": return v === "UNCORROBORATED" ? "PASS" : "LEAK";
    case "distorted": return v === "UNCORROBORATED" ? "PASS" : v === "SINGLE_SOURCE" ? "WEAK" : "FAIL";
  }
};

const results = [];
for (const c of claims) {
  const t0 = Date.now();
  let row;
  try {
    const v = await corroborate(c.claim, { window_days: 7 });
    row = { ...c, verdict: v.corroboration, n: v.n_independent_sources, confidence: v.confidence,
      coverage: v.coverage, ms: Date.now() - t0, grade: score(c.category, v) };
  } catch (e) {
    row = { ...c, verdict: "ERROR", error: e.message, ms: Date.now() - t0, grade: "ERROR" };
  }
  results.push(row);
  console.log(`${row.grade.padEnd(5)} ${c.id}  ${String(row.verdict).padEnd(15)} n=${row.n ?? "-"}  conf=${row.confidence ?? "-"}  ${row.ms}ms ${row.coverage === "degraded" ? "(degraded)" : ""}  ${c.claim.slice(0, 70)}`);
  await new Promise(r => setTimeout(r, GAP_MS));
}

const by = cat => results.filter(r => r.category === cat);
const count = (rows, g) => rows.filter(r => r.grade === g).length;
const lat = results.filter(r => r.ms != null).map(r => r.ms).sort((a, b) => a - b);
const pct = p => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];

const W = by("true_widely_reported"), N = by("true_niche"), F = by("fabricated"), S = by("real_but_stale"), D = by("distorted");
const summary = {
  date: new Date().toISOString().slice(0, 10),
  n_claims: results.length,
  fabricated_false_confirmed: `${count(F, "FAIL")}/${F.length}`,
  fabricated_any_corroboration: `${count(F, "FAIL") + count(F, "WEAK")}/${F.length}`,
  widely_reported_missed: `${count(W, "FAIL")}/${W.length}`,
  widely_reported_confirmed: `${count(W, "PASS")}/${W.length}`,
  niche_detected: `${count(N, "PASS")}/${N.length}`,
  stale_correctly_windowed: `${count(S, "PASS")}/${S.length}`,
  distorted_falsely_confirmed: `${count(D, "FAIL")}/${D.length}`,
  errors: results.filter(r => r.grade === "ERROR").length,
  degraded_coverage_calls: `${results.filter(r => r.coverage === "degraded").length}/${results.length}`,
  latency_ms: { p50: pct(0.5), p95: pct(0.95) },
};

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));

const outPath = join(dir, `results-${summary.date}.json`);
writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
console.log(`\nsaved ${outPath}`);

const gateFail =
  count(F, "FAIL") > 0 ? "RELEASE GATE FAILED: a fabricated claim came back CONFIRMED" :
  count(W, "FAIL") / W.length > 0.25 ? "RELEASE GATE FAILED: >25% of widely-reported claims missed" : null;
console.log(gateFail ? `\n${gateFail}` : "\nRELEASE GATES: PASS");
process.exit(gateFail ? 1 : 0);
