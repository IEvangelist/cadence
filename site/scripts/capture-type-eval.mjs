// @ts-check
/**
 * Typeface evaluation harness for issue #78.
 *
 * Renders the built landing page under three candidate pairings plus a "before"
 * baseline (generic system sans — what shipped, since the old Space Grotesk/Inter
 * names were referenced but never self-hosted, so every visitor got the system
 * fallback). Captures the hero + pricing sections at desktop and the hero at
 * 375px, and writes optimized WebP into site/docs/type-eval/ for the PR compare.
 *
 * Reproduce:
 *   1. cd site && npm ci
 *   2. npm run build
 *   3. npm run preview -- --port 4321        (leave running)
 *   4. node scripts/capture-type-eval.mjs    (in a second shell)
 *
 * Zero new dependencies — uses the site's existing @playwright/test devDependency
 * and encodes WebP via the browser canvas (no native image toolchain required).
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs', 'type-eval');
const BASE_URL = process.env.CADENCE_SITE_URL ?? 'http://localhost:4321/cadence/';

/** before = shipped baseline (system sans); the three keys match tokens.css. */
const VARIANTS = [
  { key: 'before', label: 'Before (system sans)' },
  { key: 'bricolage', label: 'Bricolage Grotesque + Inter' },
  { key: 'fraunces', label: 'Fraunces + Manrope' },
  { key: 'sora', label: 'Sora + Inter' },
];

/** Screenshot-only tweaks: settle motion, unstick the header so it never overlays
 *  a scrolled section, and trim the tall compare table so the pricing shot frames
 *  the plan cards (the type-relevant part). Never shipped. */
const EVAL_CSS = `
  *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
  .site-header { position: static !important; }
  #pricing .compare-head, #pricing .compare-wrap, #pricing .pricing-note { display: none !important; }
`;

async function encodeWebp(page, pngBuffer, { quality = 0.9, maxWidth = 0 } = {}) {
  const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  return page.evaluate(
    async ({ dataUrl, quality, maxWidth }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (maxWidth && w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/webp', quality).split(',')[1];
    },
    { dataUrl, quality, maxWidth },
  );
}

/** Swap the active pairing (or force the system-sans baseline) and wait for the
 *  real webfont bytes so the capture never shows a mid-swap frame. */
async function applyVariant(page, key) {
  await page.evaluate((v) => {
    const html = document.documentElement;
    const prior = document.getElementById('type-eval-before');
    if (v === 'before') {
      html.removeAttribute('data-typeface');
      if (!prior) {
        const s = document.createElement('style');
        s.id = 'type-eval-before';
        s.textContent =
          ":root{--font-display:'Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif !important;" +
          "--font-body:'Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif !important;}";
        document.head.appendChild(s);
      }
    } else {
      if (prior) prior.remove();
      html.setAttribute('data-typeface', v);
    }
  }, key);

  await page.evaluate(async () => {
    const cs = getComputedStyle(document.documentElement);
    const first = (v) => v.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    const disp = first(cs.getPropertyValue('--font-display'));
    const body = first(cs.getPropertyValue('--font-body'));
    await Promise.allSettled([
      document.fonts.load(`800 64px "${disp}"`),
      document.fonts.load(`600 32px "${disp}"`),
      document.fonts.load(`400 18px "${body}"`),
      document.fonts.load(`700 40px "${body}"`),
    ]);
    await document.fonts.ready;
  });
  await page.waitForTimeout(350);
}

async function shoot(page, encoder, { selector, name, maxWidth }) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const png = await el.screenshot({ type: 'png' });
  const b64 = await encodeWebp(encoder, png, { quality: 0.9, maxWidth });
  const file = join(OUT_DIR, `${name}.webp`);
  await writeFile(file, Buffer.from(b64, 'base64'));
  const kb = (Buffer.byteLength(b64, 'base64') / 1024).toFixed(0);
  console.log(`  ✓ ${name}.webp  ${kb} KB`);
}

/** Hero shot from the very top of the page (header + wordmark + headline + lede +
 *  CTAs), clipped just below the CTA row so the product frame stays out. */
async function shootHero(page, encoder, { name, maxWidth }) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(120);
  const cta = await page.locator('.hero .cta').boundingBox();
  const width = page.viewportSize().width;
  const height = Math.ceil(cta.y + cta.height + 32);
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } });
  const b64 = await encodeWebp(encoder, png, { quality: 0.9, maxWidth });
  const file = join(OUT_DIR, `${name}.webp`);
  await writeFile(file, Buffer.from(b64, 'base64'));
  const kb = (Buffer.byteLength(b64, 'base64') / 1024).toFixed(0);
  console.log(`  ✓ ${name}.webp  ${kb} KB`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
  const encoder = await context.newPage();
  await encoder.setContent('<!doctype html><title>encoder</title>');

  const page = await context.newPage();

  // --- Desktop: hero + pricing across all variants ---
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: EVAL_CSS });
  for (const v of VARIANTS) {
    await applyVariant(page, v.key);
    await shootHero(page, encoder, { name: `hero-desktop-${v.key}`, maxWidth: 1400 });
    await shoot(page, encoder, { selector: '#pricing', name: `pricing-desktop-${v.key}`, maxWidth: 1400 });
  }

  // --- Mobile 375: hero across all variants (also proves no overflow) ---
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: EVAL_CSS });
  for (const v of VARIANTS) {
    await applyVariant(page, v.key);
    await shootHero(page, encoder, { name: `hero-mobile-${v.key}`, maxWidth: 750 });
  }

  await browser.close();
  console.log('\nType eval screenshots written to site/docs/type-eval/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
