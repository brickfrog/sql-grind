import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function assetFile(url, root = repoRoot) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || /[\\?#]/.test(url) || decodeURIComponent(url) !== url || url.split('/').some(part => part === '.' || part === '..')) throw new Error(`Unsafe publication asset: ${url}`);
  if (url.startsWith('/bundle/')) return resolve(root, 'readiness', url.slice(8));
  if (url.startsWith('/data/')) return resolve(root, 'readiness', url.slice(1));
  if (url.startsWith('/engine/') || url.startsWith('/extensions/')) return resolve(root, 'public', url.slice(1));
  throw new Error(`Unsupported publication asset: ${url}`);
}
export function assetReferences(value) {
  if (typeof value === 'string') return /^\/(bundle|data|engine|extensions)\//.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(assetReferences);
  if (value && typeof value === 'object') return Object.values(value).flatMap(assetReferences);
  return [];
}
export async function inventory(overrides = new Map(), root = repoRoot) {
  const entries = new Map();
  async function visit(url) {
    if (entries.has(url)) return;
    const bytes = overrides.has(url) ? Buffer.from(overrides.get(url)) : await readFile(assetFile(url, root));
    entries.set(url, bytes);
    if (!url.endsWith('.json')) return;
    const value = JSON.parse(bytes.toString());
    for (const child of assetReferences(value)) await visit(child);
    if (value.challengeId && value.reference) {
      await visit(`/bundle/challenges/${value.challengeId}/checks.json`);
    }
  }
  await visit('/bundle/curriculum.json');
  return entries;
}
export async function createManifest({ overrides = new Map(), root = repoRoot } = {}) {
  const previous = JSON.parse(await readFile(resolve(root, 'readiness/manifest.json'), 'utf8'));
  const assets = await inventory(overrides, root);
  const runtime = previous.files.filter(entry => /^public\/(engine|extensions)\//.test(entry.path));
  if (!runtime.length) throw new Error('Pinned runtime inventory is missing.');
  const files = [];
  for (const entry of runtime) {
    let path = resolve(root, entry.path);
    try { await access(path); } catch { path = resolve(root, 'experiments/engine', entry.path); }
    const bytes = await readFile(path);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`Pinned runtime changed: ${entry.path}`);
    files.push({ ...entry });
  }
  for (const [url, bytes] of [...assets].sort(([a], [b]) => a.localeCompare(b))) {
    const path = url.startsWith('/bundle/') ? `../../readiness/${url.slice(8)}` : `public${url}`;
    files.push({ path, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length, sha256: hash(bytes) });
  }
  const curriculum = JSON.parse(assets.get('/bundle/curriculum.json').toString());
  const { challengeVersion: _challenge, schemaVersion: _schema, generatorVersion: _generator, datasetVersion: _dataset, boundaryVersion: _boundary, seed: _seed, ...retained } = previous;
  return {
    ...retained, bundleVersion: curriculum.version, releaseReady: true,
    engineVersion: 'v1.5.4', curriculum: '/bundle/curriculum.json', files,
    configurationHash: hash(JSON.stringify(previous.configuration)),
    smallParquetBytes: files.filter(file => file.path.endsWith('.parquet')).reduce((sum, file) => sum + file.bytes, 0),
    engineAndExtensionBytes: runtime.reduce((sum, file) => sum + file.bytes, 0),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).join(' ') !== '--check') throw new Error('Manifest publication is owned by curriculum.mjs --publish. Use manifest.mjs --check to verify inventory.');
  const manifest = await createManifest();
  console.log(JSON.stringify({ files: manifest.files.length, bundleVersion: manifest.bundleVersion }));
}
