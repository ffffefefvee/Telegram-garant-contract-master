#!/usr/bin/env node
/**
 * Coverage gate for `hardhat coverage` (istanbul format).
 *
 * Reads ./coverage.json, aggregates line + statement coverage over the core
 * contracts (mocks excluded) and exits non-zero below the thresholds.
 * PRODUCT_PLAN §12 (Горизонт 1, Spr 1) requires ≥90% on the contracts.
 *
 * Usage: node scripts/check-coverage.js [minPercent]   (default 90)
 */
const fs = require('fs');
const path = require('path');

const MIN = parseFloat(process.argv[2] || '90');
const file = path.join(__dirname, '..', 'coverage.json');

if (!fs.existsSync(file)) {
  console.error(`coverage.json not found at ${file} — run \`npm run coverage\` first.`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));

let stTotal = 0;
let stHit = 0;
let lnTotal = 0;
let lnHit = 0;

for (const [name, cov] of Object.entries(data)) {
  if (name.includes('mocks/')) continue; // test-only helpers
  for (const hits of Object.values(cov.s || {})) {
    stTotal += 1;
    if (hits > 0) stHit += 1;
  }
  for (const hits of Object.values(cov.l || {})) {
    lnTotal += 1;
    if (hits > 0) lnHit += 1;
  }
}

const stPct = stTotal ? (100 * stHit) / stTotal : 100;
const lnPct = lnTotal ? (100 * lnHit) / lnTotal : 100;

console.log(`Statements: ${stHit}/${stTotal} (${stPct.toFixed(2)}%)`);
console.log(`Lines:      ${lnHit}/${lnTotal} (${lnPct.toFixed(2)}%)`);
console.log(`Threshold:  ${MIN}%`);

if (stPct < MIN || lnPct < MIN) {
  console.error(`\n❌ Contract coverage below ${MIN}% — add tests before merging.`);
  process.exit(1);
}
console.log('\n✅ Contract coverage gate passed.');
