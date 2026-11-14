// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jplRoute } from '../proxy/jpl.js';

const LOCAL = 'https://star-shift.example';

test('JPL relay maps each approved local endpoint to a fixed upstream', () => {
  const cases = [
    ['/jpl/cad?date-min=now&date-max=%2B60&dist-max=0.05&diameter=true', 'https://ssd-api.jpl.nasa.gov/cad.api', 3600],
    ['/jpl/sentry?ps-min=-2', 'https://ssd-api.jpl.nasa.gov/sentry.api', 21600],
    ['/jpl/sbdb?sstr=99942&phys-par=1&ca-data=1&ca-body=Earth', 'https://ssd-api.jpl.nasa.gov/sbdb.api', 3600],
    ['/jpl/sb_ident?mpc-code=F51&obs-time=2026-11-14&fov-ra-center=10-10-10&fov-dec-center=10-00-00', 'https://ssd-api.jpl.nasa.gov/sb_ident.api', 3600],
    ["/jpl/horizons?format=json&COMMAND='499'&EPHEM_TYPE=VECTORS", 'https://ssd.jpl.nasa.gov/api/horizons.api', 3600],
  ];

  for (const [path, upstream, ttl] of cases) {
    const route = jplRoute(new URL(path, LOCAL));
    assert.equal(route.kind, 'jpl');
    assert.equal(route.ttl, ttl);
    assert.ok(route.target.startsWith(upstream + '?'), path);
    assert.equal(route.target.slice(upstream.length), new URL(path, LOCAL).search);
  }
});

test('JPL relay refuses unknown paths and endpoint-inappropriate parameters', () => {
  const bad = [
    '/jpl',
    '/jpl/cad?url=https://example.com',
    '/jpl/cad?sstr=Apophis',
    '/jpl/sbdb?date-min=now',
    '/jpl/sentry?COMMAND=499',
    '/jpl/horizons?EMAIL_ADDR=someone@example.com',
    '/jpl/sb_ident?callback=alert',
    '/jpl/cad?des=' + 'x'.repeat(513),
  ];
  for (const path of bad) assert.equal(jplRoute(new URL(path, LOCAL)), null, path);
});

test('empty approved queries are valid and malformed URLs are not', () => {
  assert.deepEqual(jplRoute('/jpl/sentry'), {
    target: 'https://ssd-api.jpl.nasa.gov/sentry.api',
    kind: 'jpl',
    ttl: 21600,
  });
  assert.equal(jplRoute('http://['), null);
});

