import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const noticePath = join(siteRoot, '..', 'THIRD-PARTY-NOTICES.md');
const acknowledgementsPath = join(
  siteRoot,
  'src',
  'pages',
  'docs',
  'acknowledgements.md',
);

const islandRuntime = ['astro', '@astrojs/react'];
const expectedRuntimeVersions = new Map([
  ['@astrojs/react', '6.0.3'],
  ['astro', '7.2.2'],
  ['framer-motion', '13.1.0'],
  ['motion', '13.1.0'],
  ['motion-dom', '13.0.0'],
  ['motion-utils', '13.0.0'],
  ['react', '19.2.8'],
  ['react-dom', '19.2.8'],
  ['scheduler', '0.27.0'],
]);
const expectedRuntimeNames = [...expectedRuntimeVersions.keys()].sort();

const packagePath = (name) =>
  join(siteRoot, 'node_modules', ...name.split('/'));

const packages = new Map();
const skippedManifestOnlyDependencies = new Set();
// Motion and Framer Motion declare tslib for alternate distribution targets,
// but the published ESM modules consumed by this site use native syntax. The
// production `_astro` chunks contain neither a tslib import nor its helper
// identifiers, so tslib is tree-shaken and is not redistributed by the site.
const manifestOnlyDependencies = new Set(['tslib']);
const siteManifest = JSON.parse(
  await readFile(join(siteRoot, 'package.json'), 'utf8'),
);
const directProductionDependencies = Object.keys(
  siteManifest.dependencies ?? {},
).sort();

async function readPackage(name) {
  const directory = packagePath(name);
  const manifest = JSON.parse(
    await readFile(join(directory, 'package.json'), 'utf8'),
  );
  const licenseFile = (await readdir(directory)).find((file) =>
    /^licen[cs]e(?:\.|$)/i.test(file),
  );
  if (!licenseFile) throw new Error(`${name} does not ship a license file`);

  return {
    name,
    version: manifest.version,
    license: manifest.license,
    dependencies: Object.keys(manifest.dependencies ?? {}),
    licenseText: await readFile(join(directory, licenseFile), 'utf8'),
  };
}

async function visitRuntimeDependency(name) {
  if (manifestOnlyDependencies.has(name)) {
    skippedManifestOnlyDependencies.add(name);
    return;
  }
  if (packages.has(name)) return;
  const info = await readPackage(name);
  packages.set(name, info);
  for (const dependency of info.dependencies) {
    await visitRuntimeDependency(dependency);
  }
}

for (const name of directProductionDependencies) {
  if (islandRuntime.includes(name)) {
    packages.set(name, await readPackage(name));
  } else {
    await visitRuntimeDependency(name);
  }
}
for (const name of islandRuntime) {
  if (!directProductionDependencies.includes(name)) {
    throw new Error(`Expected island runtime dependency ${name} is not installed`);
  }
}

const actualRuntimeNames = [...packages.keys()].sort();
if (actualRuntimeNames.join('\n') !== expectedRuntimeNames.join('\n')) {
  throw new Error(
    [
      'Browser runtime graph changed.',
      `Expected: ${expectedRuntimeNames.join(', ')}`,
      `Actual: ${actualRuntimeNames.join(', ')}`,
    ].join('\n'),
  );
}
for (const [name, expectedVersion] of expectedRuntimeVersions) {
  const actualVersion = packages.get(name)?.version;
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Browser runtime version changed for ${name}: expected ${expectedVersion}, actual ${actualVersion}`,
    );
  }
}
for (const name of manifestOnlyDependencies) {
  if (!skippedManifestOnlyDependencies.has(name)) {
    throw new Error(`Stale manifest-only exclusion: ${name} is no longer reachable`);
  }
}

const [notice, acknowledgements] = await Promise.all([
  readFile(noticePath, 'utf8'),
  readFile(acknowledgementsPath, 'utf8'),
]);
const normalizedNotice = notice.replace(/\s+/g, ' ').trim();

const builtAssetDirectory = join(siteRoot, 'dist', '_astro');
const builtJavaScript = (
  await Promise.all(
    (await readdir(builtAssetDirectory))
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFile(join(builtAssetDirectory, file), 'utf8')),
  )
).join('\n');
const tslibBundleMarkers = [
  /\btslib\b/,
  /\b__extends\b/,
  /\b__assign\b/,
  /\b__awaiter\b/,
  /\b__generator\b/,
  /\b__spreadArray\b/,
];
if (tslibBundleMarkers.some((marker) => marker.test(builtJavaScript))) {
  throw new Error('tslib is marked manifest-only but appears in the built browser chunks');
}

for (const info of packages.values()) {
  const rowPrefix = `| [\`${info.name}\`]`;
  const row = notice.split(/\r?\n/).find((line) => line.startsWith(rowPrefix));
  if (!row) throw new Error(`Missing notice table row for ${info.name}`);
  if (!row.includes(`| ${info.version} | ${info.license} |`)) {
    throw new Error(
      `Notice row for ${info.name} does not match ${info.version} / ${info.license}`,
    );
  }

  const normalizedLicense = info.licenseText.replace(/\s+/g, ' ').trim();
  if (!normalizedNotice.includes(normalizedLicense)) {
    throw new Error(`Complete license text is missing for ${info.name}`);
  }
}

const runtimeSection = notice.split('## Landing site browser runtime')[1]
  ?.split('\n## ')[0] ?? '';
for (const buildOnly of ['tailwindcss', '@tailwindcss/vite', '@vitejs/plugin-react']) {
  if (runtimeSection.includes(`\`${buildOnly}@`)) {
    throw new Error(`Build-only package ${buildOnly} is listed as browser runtime`);
  }
}

const noticeLink =
  'https://github.com/IEvangelist/cadence/blob/main/THIRD-PARTY-NOTICES.md#landing-site-browser-runtime';
if (!acknowledgements.includes(noticeLink)) {
  throw new Error('Deployed acknowledgements do not link to the runtime notice');
}
for (const surface of [
  ['root notice', notice],
  ['deployed acknowledgements', acknowledgements],
]) {
  if (surface[1].includes('| [`tslib`]') || surface[1].includes('`tslib@')) {
    throw new Error(`${surface[0]} incorrectly claims tree-shaken tslib is deployed`);
  }
}

console.log(
  `Runtime notices passed: ${[...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((info) => `${info.name}@${info.version}`)
    .join(', ')}; manifest-only exclusions: ${[...manifestOnlyDependencies].join(', ')}.`,
);
