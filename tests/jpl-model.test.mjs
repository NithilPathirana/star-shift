// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AU_KM, LD_KM, estimateDiameterKm, parseCad, parseSentry, parseSbdb,
  summarizeThreat,
} from '../web/app/neo/model.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/jpl/${name}.json`, import.meta.url), 'utf8'));
const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

test('CAD fixtures parse distances, UTC dates, speed, H and diameter estimates', () => {
  const rows = parseCad(fixture('cad_upcoming'), 'upcoming');
  assert.equal(rows.length, 34);
  assert.equal(rows[0].designation, '2019 XF2');
  close(rows[0].distanceKm, 0.00795386356544704 * AU_KM, 0.001);
  close(rows[0].distanceLd, rows[0].distanceKm / LD_KM, 1e-9);
  assert.equal(rows[0].date.toISOString(), '2026-12-04T00:34:01.045Z');
  assert.equal(rows[0].speedKms, 10.2034308257869);
  assert.equal(rows[0].diameterSource, 'Estimated from H for albedo 0.05–0.25');
  assert.ok(rows[0].diameterMinKm < rows[0].diameterMaxKm);
});

test('H/albedo diameter formula brackets the expected diameter', () => {
  const range = estimateDiameterKm(22);
  close(range.min, 0.1058169, 0.00001);
  close(range.max, 0.236614, 0.00001);
  assert.equal(estimateDiameterKm(null), null);
});

test('Sentry fixture sorts by cumulative Palermo and reports honest summary', () => {
  const risks = parseSentry(fixture('sentry_list'));
  assert.equal(risks.length, 2251);
  assert.equal(risks[0].designation, '29075');
  assert.equal(risks[0].palermoCumulative, -0.98);
  const approaches = parseCad(fixture('cad_upcoming'), 'upcoming');
  const summary = summarizeThreat(approaches, risks, new Date('2026-11-14T00:00:00Z'));
  assert.equal(summary.maxTorino, 0);
  assert.equal(summary.upcomingCount, 34);
  assert.equal(summary.withinOneLd, approaches.filter(item => item.distanceLd <= 1).length);
  assert.ok(summary.closest.distanceKm <= Math.min(...approaches.map(item => item.distanceKm)));
});

test('SBDB fixture exposes elements, physical values and future Earth approaches', () => {
  const apophis = parseSbdb(fixture('sbdb_apophis'), new Date('2026-11-14T00:00:00Z'));
  assert.equal(apophis.name, '99942 Apophis');
  assert.equal(apophis.orbitClass, 'Aten');
  assert.equal(apophis.elements.a, 0.922);
  assert.equal(apophis.physical.diameterKm, 0.34);
  assert.equal(apophis.moidAu, 0.000108);
  assert.ok(apophis.nextCloseApproaches.length > 0);
  assert.ok(apophis.nextCloseApproaches.every(item => item.body === 'Earth'));
});
