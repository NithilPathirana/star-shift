// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSbIdentParams, observationDates, parseSbIdent,
} from '../web/app/neo/sb-ident.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/jpl/sb_ident.json', import.meta.url), 'utf8'));

test('SB Identification parameters use JPL coordinate formats and FOV half-widths', () => {
  const params = buildSbIdentParams({ ra: 269.4461, dec: 4.7707, fov: 0.5, date: '2026-03-15', kind: 'a' });
  assert.equal(params.get('mpc-code'), '500');
  assert.equal(params.get('obs-time'), '2026-03-15_12:00:00');
  assert.match(params.get('fov-ra-center'), /^17-57-/);
  assert.match(params.get('fov-dec-center'), /^04-46-/);
  assert.equal(params.get('fov-ra-hwidth'), '0.25');
  assert.equal(params.get('fov-dec-hwidth'), '0.25');
  assert.equal(params.get('sb-kind'), 'a');
  assert.equal(params.get('two-pass'), 'true');
});

test('geocentric-state retry keeps rates available without using forbidden MPC 500', () => {
  const params = buildSbIdentParams({ ra: 10, dec: -2.5, fov: 1, date: '2025-08-15', kind: 'c', observer: 'geocentric-state' });
  assert.equal(params.get('mpc-code'), null);
  assert.equal(params.get('xobs'), '0,0,0,0,0,0');
  assert.match(params.get('fov-dec-center'), /^M02-30-/);
});

test('SB Identification parser follows documented dynamic field names', () => {
  const rows = parseSbIdent(fixture, { date: '2026-03-15', kind: 'a' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, '99942 Apophis (2004 MN4)');
  assert.equal(rows[0].ra, '17:57:46.10');
  assert.equal(rows[0].visualMagnitude, 19.4);
  assert.ok(Math.abs(rows[0].motionArcsecHour - Math.hypot(12.96, -25.92)) < 1e-10);
  assert.equal(rows[1].visualMagnitude, null);
});

test('observation dates are valid, unique and fall back to survey mid-dates', () => {
  assert.deepEqual(observationDates('2026-03-15,bad,2026-03-15,2026-08-15'), ['2026-03-15', '2026-08-15']);
  assert.deepEqual(observationDates(''), ['2025-08-15', '2026-03-15', '2026-08-15']);
});
