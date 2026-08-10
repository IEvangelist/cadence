// @ts-check
/**
 * Capture real product screenshots of the Cadence web app for the marketing site.
 *
 * This drives the *actual* app (apps/web) with Playwright — no mockups. The app is
 * offline-first: signed out, the composer renders client-side from a seeded demo
 * project in localStorage, so we never need the Aspire backend. The only network
 * call we stub is `/api/entitlements` (so the pricing page shows a clean Free tier)
 * and other `/api/*` routes (kept fast + deterministic).
 *
 * Reproduce:
 *   1. From the repo root: `npm ci` (installs the apps/web workspace, read-only).
 *   2. Start the app:      `npm run dev --workspace @cadence/web -- --port 5199`
 *      (or `cd apps/web && npx vite --port 5199`)
 *   3. From site/:         `node scripts/capture-screenshots.mjs`
 *
 * Outputs optimized WebP into site/public/screenshots/. Determinism: fixed viewport,
 * device scale factor, dark theme, reduced motion, and a seeded demo project.
 *
 * Zero new dependencies — uses the site's existing @playwright/test devDependency
 * and encodes WebP via the browser canvas (no native image toolchain required).
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'screenshots');
const BASE_URL = process.env.CADENCE_APP_URL ?? 'http://localhost:5199';

/** Fixed capture geometry — 2x for crisp retina, downscaled on encode. */
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;

/** Free-tier entitlements so the in-app pricing page renders a clean, current state. */
const FREE_ENTITLEMENTS = {
  tier: 'Free',
  watermarkExports: true,
  maxProjects: 10,
  aiGenerationsPerDay: 50,
  advancedFormats: false,
  stemSeparation: false,
  collaborationSeats: 0,
};

/**
 * Stub `/api/*` so captures are deterministic and never hang on a missing backend.
 * Entitlements → Free; everything else → 401 (the app's signed-out default).
 */
async function stubApi(context) {
  await context.route('**/api/entitlements', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FREE_ENTITLEMENTS),
    }),
  );
  await context.route('**/api/**', (route) => {
    if (route.request().url().includes('/api/entitlements')) return route.fallback();
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  });
}

/** Cosmetic-only tweaks for capture (never touches app source): force dark, hide the
 *  headless-only "no audio" note, and settle any residual motion. */
const CAPTURE_CSS = `
  *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
  .audio-note { display: none !important; }
  /* The assistant reuses .field-grow (flex: 1 1 12rem) inside a *column* layout,
     which stretches the sliders vertically. Pack to natural height for the panel
     capture — same controls, without the incidental vertical whitespace. */
  .assistant-panel .field-grow { flex: 0 0 auto !important; }
`;

async function newPage(context) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    // Explicit dark theme (the app honors [data-theme]); belt-and-suspenders with emulateMedia.
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  return page;
}

/** Encode a PNG buffer to WebP via the browser canvas, optionally capping width. */
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
      const base64 = canvas.toDataURL('image/webp', quality).split(',')[1];
      return { base64, width: w, height: h };
    },
    { dataUrl, quality, maxWidth },
  );
}

async function capture(page, encoderPage, { name, selector, clip, maxWidth, quality = 0.9 }) {
  let png;
  if (clip) {
    png = await page.screenshot({ type: 'png', clip });
  } else {
    const target = selector ? page.locator(selector).first() : page;
    if (selector) await target.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(350);
    png = await target.screenshot({ type: 'png' });
  }
  const { base64, width, height } = await encodeWebp(encoderPage, png, { quality, maxWidth });
  const file = join(OUT_DIR, `${name}.webp`);
  await writeFile(file, Buffer.from(base64, 'base64'));
  const bytes = Buffer.byteLength(base64, 'base64');
  console.log(`  ✓ ${name}.webp  ${width}x${height}  ${(bytes / 1024).toFixed(0)} KB`);
  return { name, width, height, bytes };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  await stubApi(context);

  const encoderPage = await context.newPage();
  await encoderPage.setContent('<!doctype html><title>encoder</title>');

  const results = [];

  // --- Composer surfaces (one page load covers composer, piano-roll, AI, plugins, toolbar) ---
  const app = await newPage(context);
  await app.goto(BASE_URL, { waitUntil: 'networkidle' });
  await app.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await app.addStyleTag({ content: CAPTURE_CSS });
  await app.locator('.composer').waitFor({ state: 'visible', timeout: 20000 });
  // Ensure the seeded demo is loaded (non-empty piano roll).
  await app.locator('.piano-roll').waitFor({ state: 'visible', timeout: 20000 });
  await app.locator('.pr-note').first().waitFor({ state: 'visible', timeout: 20000 });
  // The piano roll opens scrolled to the top octaves; center the demo note cluster
  // so the composition is actually visible in the capture.
  await app.evaluate(() => {
    const scroll = document.querySelector('.pr-scroll');
    const notes = Array.from(document.querySelectorAll('.pr-note'));
    if (!scroll || notes.length === 0) return;
    const sRect = scroll.getBoundingClientRect();
    let min = Infinity;
    let max = -Infinity;
    for (const n of notes) {
      const r = n.getBoundingClientRect();
      min = Math.min(min, r.top);
      max = Math.max(max, r.bottom);
    }
    const clusterCenter = (min + max) / 2;
    const viewportCenter = sRect.top + sRect.height / 2;
    scroll.scrollTop += clusterCenter - viewportCenter;
  });
  await app.waitForTimeout(300);

  // Hero: a landscape crop from the toolbar down through the piano roll, trimming
  // the tall empty canvas below the sidebar so the hero image reads wide, not square.
  const composerBox = await app.locator('.composer').boundingBox();
  const pianoBox = await app.locator('.piano-roll').boundingBox();
  const heroClip = composerBox && pianoBox
    ? {
        x: composerBox.x,
        y: composerBox.y,
        width: composerBox.width,
        height: Math.min(
          composerBox.height,
          pianoBox.y + pianoBox.height - composerBox.y + 24,
        ),
      }
    : undefined;

  results.push(await capture(app, encoderPage, { name: 'composer', clip: heroClip, maxWidth: 1600 }));
  results.push(await capture(app, encoderPage, { name: 'piano-roll', selector: '.piano-roll', maxWidth: 1200 }));
  results.push(await capture(app, encoderPage, { name: 'ai-assistant', selector: '.assistant-panel', maxWidth: 900 }));
  results.push(await capture(app, encoderPage, { name: 'plugins', selector: '.plugins-panel', maxWidth: 900 }));
  results.push(await capture(app, encoderPage, { name: 'import-export-share', selector: '.toolbar', maxWidth: 1600 }));
  await app.close();

  // --- Pricing page (Free/Pro, clean Free-tier state) ---
  const pricing = await newPage(context);
  await pricing.goto(BASE_URL, { waitUntil: 'networkidle' });
  await pricing.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await pricing.addStyleTag({ content: CAPTURE_CSS });
  await pricing.getByRole('button', { name: 'Pricing' }).click();
  await pricing.locator('.pricing').waitFor({ state: 'visible', timeout: 20000 });
  await pricing.getByText('$12', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
  results.push(await capture(pricing, encoderPage, { name: 'pricing', selector: '.pricing', maxWidth: 1400 }));
  await pricing.close();

  await browser.close();

  console.log('\nCaptured screenshots:');
  for (const r of results) console.log(`  ${r.name}: ${r.width}x${r.height}`);
  console.log(`\nTotal: ${(results.reduce((n, r) => n + r.bytes, 0) / 1024).toFixed(0)} KB across ${results.length} images`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
