// Keyless source engines. Each returns {engine, items, error?} — failures are REPORTED, never silent:
// a network outage must be distinguishable from "nobody reports this claim" (honesty requirement).
import { XMLParser } from "fast-xml-parser";

const UA = { "User-Agent": "corroborate-mcp/0.1 (+https://github.com/corroborate-mcp)" };
const xml = new XMLParser({ ignoreAttributes: false });

// Small TTL cache: repeated checks of the same claim within minutes hit the network once.
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map();

async function get(url, asJson = true, timeoutMs = 6000, retries = 1) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.data;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
      // 429/5xx are usually transient — worth one backoff retry. Other 4xx are not.
      if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`HTTP ${r.status}`), { transient: true });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = asJson ? await r.json() : await r.text();
      cache.set(url, { t: Date.now(), data });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return data;
    } catch (e) {
      lastErr = e;
      // retry only transient HTTP errors; a timeout already spent its budget
      if (!e.transient || attempt >= retries) break;
      await new Promise(res => setTimeout(res, 500 + Math.random() * 500));
    }
  }
  throw lastErr;
}

const errMsg = e => (e?.name === "TimeoutError" || e?.name === "AbortError") ? "timeout" : String(e?.message || e);

export async function gnews(q, windowDays = 7, n = 15) {
  const engine = "google-news";
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ` when:${windowDays}d`)}&hl=en-US&gl=US&ceid=US:en`;
    const doc = xml.parse(await get(url, false));
    let items = doc?.rss?.channel?.item || [];
    if (!Array.isArray(items)) items = [items];
    return { engine, items: items.slice(0, n).map(it => ({
      title: String(it.title || ""),
      url: String(it.link || ""),
      // Google News links are redirects; the real outlet lives in <source url="...">
      source: String(it.source?.["#text"] || it.source || ""),
      source_url: String(it.source?.["@_url"] || ""),
      published_at: it.pubDate ? new Date(it.pubDate).toISOString() : "",
      engine,
    })) };
  } catch (e) { return { engine, items: [], error: errMsg(e) }; }
}

// Circuit breaker: GDELT has slow phases where no sane timeout catches it — after 2 consecutive
// failures, skip it for 5 min (disclosed via engine_errors) instead of burning 10s on every call.
const gdeltBreaker = { fails: 0, until: 0 };

export async function gdelt(q, windowDays = 7, n = 15) {
  const engine = "gdelt";
  if (Date.now() < gdeltBreaker.until) {
    return { engine, items: [], error: "skipped — circuit open after repeated timeouts, retries in a few minutes" };
  }
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q + " sourcelang:english")}` +
      `&mode=artlist&format=json&maxrecords=${n}&timespan=${windowDays}d&sort=datedesc`;
    // GDELT is chronically slow (observed 2026-07: 10-15s responses, aggressive per-IP 429s).
    // Longer timeout, NO retry — a 429 retry would stack another 10s onto the call.
    const d = await get(url, true, 10000, 0);
    gdeltBreaker.fails = 0;
    return { engine, items: (d.articles || []).map(a => ({
      title: a.title || "",
      url: a.url || "",
      source: a.domain || "",
      published_at: a.seendate ? a.seendate.replace(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2}).*$/, "$1-$2-$3T$4:$5:$6Z") : "",
      engine,
    })) };
  } catch (e) {
    if (++gdeltBreaker.fails >= 2) gdeltBreaker.until = Date.now() + 5 * 60 * 1000;
    return { engine, items: [], error: errMsg(e) };
  }
}

export async function hackernews(q, windowDays = 7, n = 10) {
  const engine = "hackernews";
  try {
    const since = Math.floor(Date.now() / 1000) - windowDays * 86400;
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=${n}`;
    const d = await get(url);
    return { engine, items: (d.hits || []).map(h => ({
      title: h.title || "",
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: "Hacker News",
      published_at: h.created_at || "",
      engine,
    })) };
  } catch (e) { return { engine, items: [], error: errMsg(e) }; }
}

export async function searchAll(q, windowDays, perEngine) {
  const runs = await Promise.all([
    gnews(q, windowDays, perEngine),
    gdelt(q, windowDays, perEngine),
    hackernews(q, windowDays, Math.ceil(perEngine / 2)),
  ]);
  return {
    articles: runs.flatMap(r => r.items).filter(x => x.title && x.url),
    engine_errors: runs.filter(r => r.error).map(r => `${r.engine}: ${r.error}`),
    n_engines_ok: runs.filter(r => !r.error).length,
    n_engines: runs.length,
  };
}
