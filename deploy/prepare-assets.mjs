// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026.
// Stage only attested, watermarked loader exports and audit the public web tree.

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '../web/app/presets.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = resolve(ROOT, 'web');
const SOURCE = resolve(ROOT, 'design', 'loader', 'v1.1');
const DESTINATION = resolve(WEB, 'loader', 'v1.1');
const ATTESTATION = resolve(SOURCE, 'watermarked-assets.sha256');

// Cloudflare Workers Free limits checked against the official platform limits.
export const LIMITS = Object.freeze({
  files: 20_000,
  perFileBytes: 25 * 1024 * 1024,
  // This is a Star Shift safety budget, not a published Cloudflare total-byte cap.
  projectTotalBytes: 250 * 1024 * 1024,
});

const REQUIRED_LOADER_FILES = Object.freeze([
  'astronaut-still-720.webp',
  'astronaut-still-1080.webp',
  'astronaut-loop-720.webm',
  'astronaut-loop-720.mp4',
  'astronaut-loop-1080.webm',
  'astronaut-loop-1080.mp4',
  'astronaut-exit-720.webm',
  'astronaut-exit-720.mp4',
  'astronaut-exit-1080.webm',
  'astronaut-exit-1080.mp4',
]);
const REQUIRED_SET = new Set(REQUIRED_LOADER_FILES);
const TARGET_KEYS = ['barnard', 'eps-indi-b', 'wise-0855', 'rw-aur', 'r-dra'];
const FORBIDDEN_PART = /(^|[\\/])(_build|raw)([\\/]|$)|unwatermarked/i;

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function filesUnder(root) {
  const output = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in public assets: ${relative(WEB, path)}`);
      }
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  await walk(root);
  return output;
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function readAttestation() {
  let text;
  try { text = await readFile(ATTESTATION, 'utf8'); }
  catch {
    throw new Error(
      'Loader media exists, but design/loader/v1.1/watermarked-assets.sha256 is missing. ' +
      'Do not deploy media until the approved watermarked exports have SHA-256 entries.',
    );
  }
  const hashes = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([a-f\d]{64})\s+\*?([^\\/]+)$/i.exec(line);
    if (!match) throw new Error(`Bad watermarked-assets.sha256 line: ${raw}`);
    if (!REQUIRED_SET.has(match[2])) throw new Error(`Unapproved loader file in attestation: ${match[2]}`);
    hashes.set(match[2], match[1].toLowerCase());
  }
  return hashes;
}

async function stageLoader() {
  if (!(await exists(SOURCE))) {
    if (await exists(DESTINATION)) {
      throw new Error('web/loader/v1.1 exists without its attested source; remove or restore it before deployment.');
    }
    console.log('Loader media: source folder absent; using the built-in scan-loader fallback.');
    return 0;
  }

  const present = (await readdir(SOURCE, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && REQUIRED_SET.has(entry.name))
    .map((entry) => entry.name);
  if (!present.length) {
    if (await exists(DESTINATION)) {
      throw new Error('Staged loader media exists, but no approved source exports are available to verify it.');
    }
    console.log('Loader media: no exported media found; using the built-in scan-loader fallback.');
    return 0;
  }

  const missing = REQUIRED_LOADER_FILES.filter((name) => !present.includes(name));
  if (missing.length) throw new Error(`Loader export is incomplete: missing ${missing.join(', ')}`);
  const hashes = await readAttestation();
  await mkdir(DESTINATION, { recursive: true });

  for (const name of REQUIRED_LOADER_FILES) {
    const source = resolve(SOURCE, name);
    const expected = hashes.get(name);
    if (!expected) throw new Error(`No watermark attestation hash for ${name}`);
    const actual = await sha256(source);
    if (actual !== expected) throw new Error(`Watermark attestation hash mismatch for ${name}`);
    await copyFile(source, resolve(DESTINATION, name));
  }

  const staged = await filesUnder(DESTINATION);
  for (const path of staged) {
    const rel = relative(DESTINATION, path);
    if (FORBIDDEN_PART.test(rel) || !REQUIRED_SET.has(rel)) {
      throw new Error(`Unapproved or unwatermarked loader asset would be deployed: ${rel}`);
    }
    const expected = hashes.get(rel);
    if (!expected || await sha256(path) !== expected) {
      throw new Error(`Staged loader asset is not attested: ${rel}`);
    }
  }
  console.log(`Loader media: staged and verified ${staged.length} watermarked files.`);
  return staged.length;
}

function checkTargets() {
  const keys = PRESETS.map((preset) => preset.key);
  if (PRESETS.length !== 5 || TARGET_KEYS.some((key) => !keys.includes(key))) {
    throw new Error(`Expected the five NASA target presets in web/app/presets.js; found: ${keys.join(', ')}`);
  }
  for (const preset of PRESETS) {
    const values = [preset.target?.ra, preset.target?.dec, preset.target?.pmra, preset.target?.pmdec];
    if (!values.every(Number.isFinite)) throw new Error(`Target preset is incomplete: ${preset.key}`);
  }
  console.log('Target data: all five presets are already inside web/app/presets.js.');
}

async function auditWeb() {
  const files = await filesUnder(WEB);
  let total = 0;
  let largest = { path: '', size: 0 };
  const prebaked = { files: 0, bytes: 0 }; // web/prebaked/: the five targets' saved answers (Claude)
  for (const path of files) {
    const rel = relative(WEB, path).split(sep).join('/');
    if (FORBIDDEN_PART.test(rel)) throw new Error(`Forbidden public asset found: web/${rel}`);
    const size = (await stat(path)).size;
    if (size > LIMITS.perFileBytes) {
      throw new Error(`Asset exceeds Cloudflare's 25 MiB per-file limit: web/${rel} (${size} bytes)`);
    }
    if (rel.startsWith('prebaked/')) { prebaked.files++; prebaked.bytes += size; }
    total += size;
    if (size > largest.size) largest = { path: rel, size };
  }
  if (files.length > LIMITS.files) {
    throw new Error(`Asset count ${files.length} exceeds the Workers Free limit of ${LIMITS.files}.`);
  }
  if (total > LIMITS.projectTotalBytes) {
    throw new Error(`Public assets total ${total} bytes, above Star Shift's 250 MiB safety budget.`);
  }
  console.log(`Assets: ${files.length}/${LIMITS.files} files, ${(total / 1048576).toFixed(2)} MiB total.`);
  console.log(`Largest: web/${largest.path} (${(largest.size / 1048576).toFixed(2)} MiB / 25 MiB).`);
  console.log(prebaked.files
    ? `Prebaked targets: ${prebaked.files} files, ${(prebaked.bytes / 1048576).toFixed(2)} MiB (web/prebaked/, included above).`
    : 'Prebaked targets: web/prebaked/ is empty; run node tools/export_prebaked.mjs so the five targets load without IRSA.');
}

try {
  await stageLoader();
  checkTargets();
  await auditWeb();
  console.log('Asset preparation passed. Nothing outside web/ can be uploaded by wrangler.toml.');
} catch (error) {
  console.error(`Asset preparation FAILED: ${error.message}`);
  process.exitCode = 1;
}
