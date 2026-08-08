/**
 * WCAG 2.1 contrast verification for the Cadence semantic tokens.
 *
 * Reads docs/brand/color/tokens.json, resolves the light & dark semantic sets,
 * and asserts every text/background and UI pair meets AA. Exits non-zero on any
 * failure so it can gate CI or a pre-commit hook.
 *
 * Usage:  cd tools/brand && npm ci && npm run contrast
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const tokens = JSON.parse(
  readFileSync(resolve(repo, 'docs', 'brand', 'color', 'tokens.json'), 'utf8'),
);

/** Resolve a "{a.b.c}" reference or return the literal value. */
function resolveRef(value) {
  const m = /^\{(.+)\}$/.exec(value);
  if (!m) return value;
  return resolveRef(
    m[1].split('.').reduce((o, k) => o[k], tokens).value,
  );
}

function chan(c) {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
function lum(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function ratio(fg, bg) {
  const l1 = lum(fg);
  const l2 = lum(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

let failures = 0;
function check(label, fg, bg, kind = 'normal') {
  const need = kind === 'normal' ? 4.5 : 3.0;
  const r = ratio(fg, bg);
  const ok = r >= need;
  if (!ok) failures += 1;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(
    `${tag}  ${r.toFixed(2).padStart(5)}:1  (>=${need})  ${label.padEnd(34)} ${fg} on ${bg} [${kind}]`,
  );
}

for (const themeName of ['light', 'dark']) {
  const t = tokens.theme[themeName];
  const g = (k) => resolveRef(t[k].value);
  console.log(`\n== ${themeName.toUpperCase()} ==`);
  check('text on bg', g('text'), g('bg'));
  check('text on surface', g('text'), g('surface'));
  check('muted on bg', g('text-muted'), g('bg'));
  check('subtle on bg', g('text-subtle'), g('bg'));
  check('primary-text on bg', g('primary-text'), g('bg'));
  check('on-primary on primary', g('on-primary'), g('primary'));
  check('on-secondary on secondary', g('on-secondary'), g('secondary'));
  check('accent-text on bg', g('accent-text'), g('bg'));
  check('on-accent on accent', g('on-accent'), g('accent'));
  check('success on bg', g('success'), g('bg'));
  check('warning on bg', g('warning'), g('bg'));
  check('danger on bg', g('danger'), g('bg'));
  check('info on bg', g('info'), g('bg'));
  check('focus ring on bg', g('focus'), g('bg'), 'ui');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
