// Makes the Next.js `output: 'standalone'` build self-contained.
//
// With `output: 'standalone'`, Next does NOT copy `.next/static` (CSS/JS) or
// `public/` into `.next/standalone`. If you deploy the standalone server
// without those folders, the page loads as UNSTYLED HTML (messy CSS) and the
// client JS (e.g. the admin Settings tab) fails to load.
//
// This script (run automatically via the `postbuild` npm script) copies those
// assets in so `node .next/standalone/server.js` serves everything correctly.
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const standalone = resolve(root, ".next/standalone");

if (!existsSync(standalone)) {
  console.log("[copy-standalone-assets] No standalone output found — skipping.");
  process.exit(0);
}

const copies = [
  { from: resolve(root, ".next/static"), to: resolve(standalone, ".next/static") },
  { from: resolve(root, "public"), to: resolve(standalone, "public") },
];

for (const { from, to } of copies) {
  if (existsSync(from)) {
    cpSync(from, to, { recursive: true, force: true });
    console.log(`[copy-standalone-assets] Copied ${from} -> ${to}`);
  } else {
    console.log(`[copy-standalone-assets] Source missing, skipped: ${from}`);
  }
}

console.log("[copy-standalone-assets] Done — standalone output is self-contained.");
