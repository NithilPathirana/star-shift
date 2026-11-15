// The source download (web/source.zip) must hold no secrets, logs, build folders, data cache,
// email addresses or local paths (Master, Sun 15 Nov 2026). AI-written code (Claude, Anthropic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { scan, scanText } from '../tools/source_scan.mjs';

test('every file that goes into the source zip passes the scan', () => {
  assert.deepEqual(scan(fileURLToPath(new URL('..', import.meta.url))), []);
});

test('the scan catches what it is meant to catch', () => {
  const bad = ['mail me at someone@gmail.com', String.raw`C:\Users\someone\project`, '/home/someone/x', '-----BEGIN RSA PRIVATE KEY-----', 'api_key = "abcdefghijklmnop1234"'];
  for (const t of bad) assert.ok(scanText('x.md', t).length, t);
  assert.deepEqual(scanText('x.md', 'Co-Authored-By: Claude <noreply@anthropic.com>'), []);
});
