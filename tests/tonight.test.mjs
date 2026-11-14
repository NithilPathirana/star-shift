// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// "Can I see it tonight?" answer card (night window, verdicts, wording) and the JPL Horizons
// small-body provider (parsing, interpolation, date-only requests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observer, starAltAz, sunAltitude } from '../web/app/planet/astro.js';
import { nightWindow, upIntervals, answer } from '../web/app/planet/tonight.js';
import { parseHorizons, interpolate, horizonsUrl, makeProvider, BRIGHT } from '../web/app/planet/jpl-small.js';

const COLOMBO = observer(6.927, 79.861, 5);
const fmt = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const at = (iso) => new Date(iso);
const star = (ra, dec, obs = COLOMBO) => (d) => starAltAz(ra, dec, d, obs).alt;

test('night window: daytime -> the coming sunset to sunrise; night -> the night we are in', () => {
  const day = nightWindow(at('2026-11-14T06:00:00Z'), COLOMBO); // 11:30 in Colombo
  assert.equal(day.inNight, false);
  assert.ok(Math.abs(sunAltitude(day.start, COLOMBO)) < 1.2 && Math.abs(sunAltitude(day.end, COLOMBO)) < 1.2);
  assert.equal(fmt(day.start).slice(0, 2), '17'); assert.equal(fmt(day.end).slice(0, 2), '06');
  const night = nightWindow(at('2026-11-14T17:30:00Z'), COLOMBO); // 23:00 in Colombo
  assert.equal(night.inNight, true); assert.ok(night.start < at('2026-11-14T17:30:00Z') && night.end > at('2026-11-14T17:30:00Z'));
  assert.ok(nightWindow(at('2026-06-21T12:00:00Z'), observer(78.2, 15.6, 0)).polarDay); // Svalbard, midsummer
  assert.ok(nightWindow(at('2026-12-21T12:00:00Z'), observer(78.2, 15.6, 0)).polarNight);
});

test('up intervals and highest point from sampled altitudes', () => {
  const s = at('2026-01-01T00:00:00Z'), e = at('2026-01-01T10:00:00Z');
  const r = upIntervals((d) => 30 - Math.abs((d - s) / 3600000 - 4) * 10, s, e, 10); // up 1 h to 7 h, peak 30 at 4 h
  assert.equal(r.intervals.length, 1); assert.equal(Math.round(r.best.alt), 30);
  assert.equal((r.best.at - s) / 3600000, 4);
});

test("Barnard's Star from Colombo: yes in the evening, 'not any more' late at night", () => {
  const evening = answer({ altFn: star(269.452, 4.693), date: at('2026-11-14T12:00:00Z'), obs: COLOMBO, place: 'Colombo', fmt });
  assert.equal(evening.verdict, 'yes');
  assert.match(evening.head, /^Yes, tonight from Colombo: up 17:\d\d to 20:\d\d, highest 4\d° at 17:\d\d$/);
  const late = answer({ altFn: star(269.452, 4.693), date: at('2026-11-14T17:30:00Z'), obs: COLOMBO, place: 'Colombo', fmt });
  assert.equal(late.verdict, 'set'); assert.match(late.head, /^Not any more tonight: it set at 20:\d\d$/);
  assert.match(late.detail, /^Tomorrow night: up 17:\d\d to 20:\d\d/);
});

test('never up from here -> No; up only by day -> Only in daylight', () => {
  const polaris = answer({ altFn: star(37.95, 89.26, observer(-33.9, 151.2, 20)), date: at('2026-11-14T06:00:00Z'), obs: observer(-33.9, 151.2, 20), place: 'Sydney', fmt });
  assert.equal(polaris.verdict, 'no'); assert.equal(polaris.head, 'No: it stays below the horizon tonight from here');
  // a point next to the Sun is up only in daylight
  const nearSun = answer({ altFn: star(229.5, -18.3), date: at('2026-11-14T06:00:00Z'), obs: COLOMBO, place: 'Colombo', fmt });
  assert.equal(nearSun.verdict, 'day'); assert.equal(nearSun.head, 'Only in daylight tonight');
});

test('Horizons rows parse, interpolate across RA 0/360, and ask only for the date (geocentric)', () => {
  const txt = `junk\n$$SOE\n 2026-Nov-14 00:00, , ,   359.90000,   -4.50000,    6.971,  5.054,  1.6476, 15.37,\n 2026-Nov-14 01:00, , ,     0.10000,   -4.40000,    6.972,  5.055,  1.6480, 15.39,\n$$EOE\nmore`;
  const rows = parseHorizons(txt); assert.equal(rows.length, 2);
  const mid = interpolate(rows, Date.UTC(2026, 10, 14, 0, 30));
  assert.ok(Math.abs(mid.ra - 0) < 1e-9 || Math.abs(mid.ra - 360) < 1e-9); assert.ok(Math.abs(mid.dec + 4.45) < 1e-9);
  assert.equal(interpolate(rows, Date.UTC(2026, 10, 15, 5)), null);
  assert.equal(parseHorizons('no table'), null);
  const u = new URL(horizonsUrl('http://r', '4;', '2026-11-14'));
  assert.equal(u.pathname, '/jpl/horizons'); assert.equal(u.searchParams.get('CENTER'), "'500@399'");
  assert.equal(u.searchParams.get('START_TIME'), "'2026-11-14 00:00'"); assert.equal(u.searchParams.get('STOP_TIME'), "'2026-11-15 00:00'");
  assert.ok(![...u.searchParams.keys()].some(k => /SITE|COORD_TYPE|lat|lon/i.test(k)));
});

test('provider: one request per asteroid per day (cached), failures show nothing', async () => {
  let calls = 0;
  const body = { result: `$$SOE\n 2026-Nov-14 00:00, , , 10, 1, 7, 5, 1.6, 1,\n 2026-Nov-15 00:00, , , 11, 2, 7, 5, 1.6, 1,\n$$EOE` };
  const prov = makeProvider({ base: 'http://t1', fetchFn: async () => { calls++; return new Response(JSON.stringify(body)); } });
  const a = await prov(at('2026-11-14T12:00:00Z')); await prov(at('2026-11-14T13:00:00Z'));
  assert.equal(a.length, BRIGHT.length); assert.equal(calls, BRIGHT.length);
  assert.ok(Math.abs(a[0].ra - 10.5) < 1e-9);
  const bad = makeProvider({ base: 'http://t2', fetchFn: async () => new Response('down', { status: 502 }) });
  assert.deepEqual(await bad(at('2026-11-14T12:00:00Z')), []);
});
