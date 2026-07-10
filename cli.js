#!/usr/bin/env node
// Direct engine smoke-test: node cli.js "<claim>" [window_days]
import { corroborate } from "./src/engine.js";
const claim = process.argv[2] || "The Federal Reserve held interest rates steady";
const window_days = Number(process.argv[3] || 7);
const t0 = Date.now();
try {
  const res = await corroborate(claim, { window_days });
  console.log(JSON.stringify(res, null, 2));
  console.error(`\n[${Date.now() - t0}ms]`);
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
