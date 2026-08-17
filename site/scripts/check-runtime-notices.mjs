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
const expectedRuntimeNames = [
  '@astrojs/react',
  'astro',
  'framer-motion',
  'motion',
  'motion-dom',
  'motion-utils',
  'react',
  'react-dom',
  'scheduler',
  'tslib',
];

const packagePath = (name) =>
  join(siteRoot, 'node_modules', ...name.split('/'));

const packages = new Map();
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

const [notice, acknowledgements] = await Promise.all([
  readFile(noticePath, 'utf8'),
  readFile(acknowledgementsPath, 'utf8'),
]);
const normalizedNotice = notice.replace(/\s+/g, ' ').trim();

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

console.log(
  `Runtime notices passed: ${[...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((info) => `${info.name}@${info.version}`)
    .join(', ')}.`,
);
