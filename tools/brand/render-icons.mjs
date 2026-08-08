/**
 * Cadence — reproducible raster export.
 *
 * Renders the source SVGs in docs/brand/logo/ into every raster the apps need:
 *   - Tauri desktop icons  -> apps/desktop/src-tauri/icons/
 *   - PWA / web favicons    -> apps/web/public/
 *
 * Deterministic: delete the outputs and re-run `npm run render` to reproduce them
 * byte-for-similar (PNG encoders are stable for identical input).
 *
 * Usage:  cd tools/brand && npm ci && npm run render
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import png2icons from 'png2icons';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const logo = resolve(repo, 'docs', 'brand', 'logo');
const tauriIcons = resolve(repo, 'apps', 'desktop', 'src-tauri', 'icons');
const webPublic = resolve(repo, 'apps', 'web', 'public');

const APP_ICON = resolve(logo, 'app-icon.svg');
const APP_ICON_MASKABLE = resolve(logo, 'app-icon-maskable.svg');
const LOGOMARK = resolve(logo, 'logomark.svg');

// High render density so small rasters stay crisp.
const DENSITY = 512;

mkdirSync(tauriIcons, { recursive: true });
mkdirSync(webPublic, { recursive: true });

/** Render an SVG file to a square PNG buffer of the given size. */
async function pngBuf(svgPath, size) {
  return sharp(svgPath, { density: DENSITY })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writePng(svgPath, size, outPath) {
  const buf = await pngBuf(svgPath, size);
  writeFileSync(outPath, buf);
  console.log(`  ${outPath.replace(repo, '.').replace(/\\/g, '/')}  (${size}x${size})`);
}

async function main() {
  console.log('Tauri desktop icons:');
  const tauriSquares = {
    '32x32.png': 32,
    '128x128.png': 128,
    '128x128@2x.png': 256,
    'icon.png': 512,
    'Square30x30Logo.png': 30,
    'Square44x44Logo.png': 44,
    'Square71x71Logo.png': 71,
    'Square89x89Logo.png': 89,
    'Square107x107Logo.png': 107,
    'Square142x142Logo.png': 142,
    'Square150x150Logo.png': 150,
    'Square284x284Logo.png': 284,
    'Square310x310Logo.png': 310,
    'StoreLogo.png': 50,
  };
  for (const [name, size] of Object.entries(tauriSquares)) {
    await writePng(APP_ICON, size, resolve(tauriIcons, name));
  }

  // .ico + .icns from a 1024 master (png2icons builds the multi-resolution files).
  const master1024 = await pngBuf(APP_ICON, 1024);
  const icoBuf = png2icons.createICO(master1024, png2icons.BICUBIC, 0, false, true);
  writeFileSync(resolve(tauriIcons, 'icon.ico'), icoBuf);
  console.log('  ./apps/desktop/src-tauri/icons/icon.ico  (multi-size)');
  const icnsBuf = png2icons.createICNS(master1024, png2icons.BICUBIC, 0);
  writeFileSync(resolve(tauriIcons, 'icon.icns'), icnsBuf);
  console.log('  ./apps/desktop/src-tauri/icons/icon.icns  (multi-size)');

  console.log('Web / PWA favicons:');
  // Vector favicon (scales for modern browsers).
  copyFileSync(APP_ICON, resolve(webPublic, 'favicon.svg'));
  console.log('  ./apps/web/public/favicon.svg');

  const webPngs = {
    'favicon-96x96.png': 96,
    'apple-touch-icon.png': 180,
    'pwa-192x192.png': 192,
    'pwa-512x512.png': 512,
  };
  for (const [name, size] of Object.entries(webPngs)) {
    await writePng(APP_ICON, size, resolve(webPublic, name));
  }
  // Maskable (full-bleed, safe-zone padded) for Android/installable PWAs.
  await writePng(APP_ICON_MASKABLE, 512, resolve(webPublic, 'maskable-512x512.png'));

  // Multi-size favicon.ico (16/24/32/48) from a 256 master.
  const fav256 = await pngBuf(APP_ICON, 256);
  const favIco = png2icons.createICO(fav256, png2icons.BICUBIC, 0, false, true);
  writeFileSync(resolve(webPublic, 'favicon.ico'), favIco);
  console.log('  ./apps/web/public/favicon.ico  (multi-size)');

  // Monochrome mark PNGs for docs / social (transparent).
  const socialDir = resolve(repo, 'docs', 'brand', 'logo', 'raster');
  mkdirSync(socialDir, { recursive: true });
  await writePng(LOGOMARK, 512, resolve(socialDir, 'logomark-512.png'));
  await writePng(APP_ICON, 512, resolve(socialDir, 'app-icon-512.png'));

  console.log('\nDone. Rasters regenerated from source SVGs.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
