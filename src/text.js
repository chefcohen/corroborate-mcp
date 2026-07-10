// Text utilities: claim -> search keywords, title normalization, similarity (for syndication clustering).
const STOP = new Set(("a an the and or but of in on at to for from by with as is are was were be been being has have had " +
  "will would can could may might do does did not no this that these those it its their his her they he she we you i " +
  "than then so if about into over under after before during between announced announces says said say reportedly report").split(" "));

export function keywords(claim, max = 8) {
  const quoted = [...claim.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  const words = claim.replace(/["'’]/g, " ").split(/[^A-Za-z0-9$%.-]+/).filter(Boolean);
  const picked = [];
  for (const w of words) {
    const lw = w.toLowerCase();
    if (STOP.has(lw) || lw.length < 2) continue;
    // keep entities (capitalized), numbers, tickers, and any remaining content word
    picked.push(w);
  }
  const uniq = [...new Set([...quoted, ...picked])];
  return uniq.slice(0, max);
}

export function normTitle(t) {
  return (t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w && !STOP.has(w));
}

export function jaccard(aTokens, bTokens) {
  const A = new Set(aTokens), B = new Set(bTokens);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function domainOf(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const parts = h.split(".");
    const two = parts.slice(-2).join(".");
    // crude ccTLD handling (co.uk, com.au, ...) — good enough for independence grouping
    return /^(co|com|net|org|gov|ac)\.[a-z]{2}$/.test(two) ? parts.slice(-3).join(".") : two;
  } catch { return ""; }
}

// Relevance: does a title genuinely address the claim? Prefix-aware token match (fed~federal, rate~rates).
export function coreTokens(claim) {
  return [...new Set(normTitle(claim).filter(w => w.length >= 3))];
}
export function relevance(titleTokens, core) {
  if (!core.length) return 0;
  let hit = 0;
  for (const c of core) {
    if (titleTokens.some(t => t.startsWith(c) || c.startsWith(t) && t.length >= 3)) hit++;
  }
  return hit / core.length;
}

export function ageDays(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}
