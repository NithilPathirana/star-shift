// Scans what goes into web/source.zip (the same tracked files that tools/source_zip.mjs packs from HEAD)
// and fails if any of them is a secret, a log, a build folder or the data cache, or contains an email
// address, an absolute local path or something that looks like a key. Run by `npm run source-zip`
// and by tests/source-scan.test.mjs (Master, Sun 15 Nov: NASA's terms need a clean, licensed source).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import { join } from 'node:path';

export const EXCLUDE = [':(exclude,glob)**/_build/**', ':(exclude,glob)**/*.log', ':(exclude,glob)**/.env*', ':(exclude,glob)**/*.env',
  ':(exclude,glob)**/.dev.vars', ':(exclude)web/source.zip',
  ':(exclude)web/prebaked', // prebaked = cached archive answers, not source: rebuilt by tools/export_prebaked.mjs
  // loader media: served by the site and kept in the repo, but too big for the zip (Cloudflare's 25 MiB per file)
  ':(exclude,glob)design/loader/**/*.mp4', ':(exclude,glob)design/loader/**/*.webm', ':(exclude,glob)design/loader/**/*.webp'];

const BAD_NAME = [/(^|\/)\.env/i, /\.env$/i, /(^|\/)_build\//, /\.log$/i, /(^|\/)node_modules\//, /(^|\/)\.cache\//, /^web\/prebaked\//, /\.dev\.vars$/, /\.(pem|key|p12|pfx)$/i];
const BAD_TEXT = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, 'email address'],
  [/\b[A-Za-z]:[\\/]+Users[\\/]+[A-Za-z0-9._-]+/g, 'absolute Windows user path'],
  [/\/(Users|home)\/[A-Za-z0-9._-]+\//g, 'absolute home path'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'private key'],
  [/\b(sk|rk)-[A-Za-z0-9_-]{20,}/g, 'API key'],
  [/\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][A-Za-z0-9_-]{12,}['"]/gi, 'hard-coded secret'],
];
// public, non-personal addresses that are allowed (attribution lines, package metadata)
const ALLOWED_EMAIL = /^(noreply@anthropic\.com|[^@]+@users\.noreply\.github\.com|[^@]+@example\.(com|org))$/i;
const BINARY = /\.(png|jpe?g|gif|webp|webm|mp4|woff2?|fits|gz|zip|ico|glb|bin|pdf)$/i;

// git archive packs HEAD; ls-files (the index) takes the same pathspecs and matches HEAD once committed
export function filesInZip(root, { all = false } = {}) {
  return execFileSync('git', ['ls-files', '--', '.', ...(all ? [] : EXCLUDE)], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean);
}

export function scanText(name, text) {
  const out = [];
  for (const [re, what] of BAD_TEXT) {
    for (const m of text.matchAll(re)) {
      if (what === 'email address' && ALLOWED_EMAIL.test(m[0])) continue;
      if (what === 'email address' && name.startsWith('web/vendor/')) continue; // a bundled library's own licence notice: must be kept
      out.push(`${name}: ${what}: ${m[0].slice(0, 60)}`);
    }
  }
  return out;
}

// all: every tracked file (the GitHub repo, where web/prebaked/ belongs), not just the zip's list
export function scan(root, { all = false } = {}) {
  const problems = [], files = filesInZip(root, { all });
  const names = all ? BAD_NAME.filter(re => !re.test('web/prebaked/x')) : BAD_NAME;
  for (const f of files) for (const re of names) if (re.test(f)) problems.push(`${f}: file type that must not ship`);
  if (all) for (const f of files) { // GitHub warns over 50 MB and refuses over 100 MB
    try { const s = statSync(join(root, f)).size; if (s > 50 * 1048576) problems.push(`${f}: ${(s / 1048576).toFixed(1)} MB, over 50 MB`); } catch { /* deleted in the work tree */ }
  }
  const texts = files.filter(f => !BINARY.test(f)); // binaries: names only
  // one git process for every blob in the index (":path"), not one per file
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: texts.map(f => `:${f}`).join('\n') + '\n', maxBuffer: 1 << 30 });
  let at = 0;
  for (const f of texts) {
    const nl = out.indexOf(10, at), head = out.subarray(at, nl).toString('utf8'), size = Number(head.split(' ')[2]);
    if (!Number.isFinite(size)) { at = nl + 1; continue; } // "missing"
    problems.push(...scanText(f, out.subarray(nl + 1, nl + 1 + size).toString('utf8')));
    at = nl + 1 + size + 1;
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const p = scan(root, { all: process.argv.includes('--all') });
  if (p.length) { console.error(`source scan: ${p.length} problem(s)\n` + p.join('\n')); process.exit(1); }
  console.log('source scan: clean');
}
