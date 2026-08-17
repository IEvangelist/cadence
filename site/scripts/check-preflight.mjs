// Mechanical landing-page checks for the non-negotiable design constraints.
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'src', 'pages', 'index.astro'), 'utf8');

const failures = [];
const sectionCount = (source.match(/<section\b/g) ?? []).length;
const eyebrowCount = (source.match(/class="[^"]*eyebrow/g) ?? []).length;
const marqueeCount = (source.match(/\bmarquee\b/gi) ?? []).length;
const imageCount = (source.match(/<img\b/g) ?? []).length;
const missingDimensions = [...source.matchAll(/<img\b[\s\S]*?\/>/g)]
  .filter(([tag]) => !/\bwidth=/.test(tag) || !/\bheight=/.test(tag));

if (/[—–]/.test(source)) failures.push('landing source contains an em dash or en dash');
if (/\bh-screen\b/.test(source)) failures.push('landing source uses h-screen');
if (eyebrowCount > Math.ceil(sectionCount / 3)) {
  failures.push(`eyebrow count ${eyebrowCount} exceeds ${Math.ceil(sectionCount / 3)}`);
}
if (marqueeCount > 1) failures.push(`marquee count ${marqueeCount} exceeds 1`);
if (imageCount < 3) failures.push(`real image count ${imageCount} is below 3`);
if (missingDimensions.length > 0) {
  failures.push(`${missingDimensions.length} image(s) lack intrinsic dimensions`);
}
if (!source.includes('min-height: calc(100dvh')) {
  failures.push('hero does not use a stable dynamic viewport height');
}
if (!source.includes('prefers-reduced-motion')) {
  failures.push('landing source lacks reduced-motion coverage');
}

const builtAssets = join(here, '..', 'dist', '_astro');
const assetNames = await readdir(builtAssets);
let rawJavaScript = 0;
let gzipJavaScript = 0;
let cssBytes = 0;
for (const name of assetNames) {
  const path = join(builtAssets, name);
  const bytes = await readFile(path);
  if (name.endsWith('.js')) {
    rawJavaScript += bytes.length;
    gzipJavaScript += gzipSync(bytes).length;
  } else if (name.endsWith('.css')) {
    cssBytes += bytes.length;
  }
}

const screenshots = join(here, '..', 'public', 'screenshots');
const screenshotNames = await readdir(screenshots);
let screenshotBytes = 0;
for (const name of screenshotNames) {
  screenshotBytes += (await stat(join(screenshots, name))).size;
}

if (gzipJavaScript > 115 * 1024) {
  failures.push(`compressed JavaScript ${(gzipJavaScript / 1024).toFixed(1)} KB exceeds 115 KB`);
}
if (cssBytes > 60 * 1024) {
  failures.push(`CSS ${(cssBytes / 1024).toFixed(1)} KB exceeds 60 KB`);
}
if (screenshotBytes > 500 * 1024) {
  failures.push(`screenshots ${(screenshotBytes / 1024).toFixed(1)} KB exceed 500 KB`);
}

if (failures.length > 0) {
  console.error(`Landing pre-flight failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(
  [
    `Landing pre-flight passed: ${sectionCount} sections, ${eyebrowCount} eyebrows,`,
    `${imageCount} real images, ${marqueeCount} marquees,`,
    `${(rawJavaScript / 1024).toFixed(1)} KB JS raw / ${(gzipJavaScript / 1024).toFixed(1)} KB gzip,`,
    `${(cssBytes / 1024).toFixed(1)} KB CSS, ${(screenshotBytes / 1024).toFixed(1)} KB screenshots.`,
  ].join(' '),
);
