// `npm audit --audit-level=high` with a short list of advisories that are let through
// for now. npm audit itself has no way to skip one advisory.
//
// Usage: node scripts/audit.mjs [npm audit flags, e.g. --omit=dev or --package-lock-only]
//
// Fails when a high or critical advisory remains after the list is applied.
// Warns when a listed advisory no longer appears, so the entry can be removed.

import { execFileSync } from 'node:child_process';

// Each entry: the advisory, why it is let through, and when to remove it.
const IGNORED = {
  // picomatch ReDoS. On 2026-11-17 the range grew to every release (<= 4.0.7) and no fixed
  // release exists. It comes in through next-intl -> @parcel/watcher, a file watcher used at
  // build time that is never given patterns from users. Remove once a fixed picomatch ships.
  'GHSA-fc5q-39xc-vjpf': 'picomatch <= 4.0.7, no fixed release yet',
};

const LEVELS = ['high', 'critical'];

let out;
try {
  out = execFileSync('npm', ['audit', '--json', ...process.argv.slice(2)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  // npm audit exits non-zero when it finds anything; the report is still on stdout.
  out = err.stdout;
  if (!out) throw err;
}
const report = JSON.parse(out);
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(1);
}

// The advisories themselves; entries whose `via` is a package name only pass one on.
const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== 'object') continue;
    const id = via.url?.split('/').pop() ?? String(via.source);
    advisories.set(id, { ...via, id });
  }
}

const seen = new Set();
const failing = [];
for (const a of advisories.values()) {
  if (IGNORED[a.id]) {
    seen.add(a.id);
    console.log(`Let through: ${a.id} (${a.name}, ${a.severity}) - ${IGNORED[a.id]}`);
  } else if (LEVELS.includes(a.severity)) {
    failing.push(a);
  }
}
for (const id of Object.keys(IGNORED)) {
  if (!seen.has(id)) console.log(`::warning::${id} no longer appears in npm audit; remove it from scripts/audit.mjs`);
}

if (failing.length > 0) {
  for (const a of failing) console.error(`${a.severity}: ${a.name} ${a.range} - ${a.title} (${a.url})`);
  process.exit(1);
}
console.log('No high or critical advisories (apart from the list above).');
