// Coordinate maths checked against Astropy reference values.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toGalactic, toEcliptic, constellation, setConstellationData, altAz, riseTransitSet, gmstDeg, sunRaDec, visibleTonight } from '../web/app/sky.js';
import { separationArcsec } from '../web/core/motion.js';

const ref = JSON.parse(readFileSync(new URL('./fixtures/sky_ref.json', import.meta.url), 'utf8'));
setConstellationData(JSON.parse(readFileSync(new URL('../web/app/data/constellations.json', import.meta.url), 'utf8')));

test('galactic and ecliptic match Astropy to < 0.1″', () => {
  for (const p of ref) {
    const g = toGalactic(p.ra, p.dec), e = toEcliptic(p.ra, p.dec);
    assert.ok(separationArcsec(g.l, g.b, p.l, p.b) < 0.1, `gal ${p.ra},${p.dec}`);
    assert.ok(separationArcsec(e.lon, e.lat, p.elon, p.elat) < 0.1, `ecl ${p.ra},${p.dec}`);
  }
});

test('constellation matches Astropy for 308 positions', () => {
  const bad = ref.filter(p => constellation(p.ra, p.dec)?.abbr !== p.con);
  assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 3)));
  assert.equal(constellation(269.4461, 4.7707).name, 'Ophiuchus');
});

test('sidereal time and alt/az sanity', () => {
  // GMST at J2000.0 (2000-01-01 12:00 UT) = 280.46062°
  assert.ok(Math.abs(gmstDeg(new Date(Date.UTC(2000, 0, 1, 12))) - 280.46062) < 1e-4);
  const now = new Date(Date.UTC(2026, 10, 14, 18));
  // A star at the zenith: dec = latitude, RA = local sidereal time
  const lat = 7.0, lon = 79.9, lst = (gmstDeg(now) + lon) % 360;
  assert.ok(altAz(lst, lat, lat, lon, now, { j2000: false }).alt > 89.99); // of-date coordinates
  // Celestial pole altitude = latitude
  assert.ok(Math.abs(altAz(0, 90, 51.5, 0, now, { j2000: false }).alt - 51.5) < 1e-6);
});

test('rise / transit / set', () => {
  const now = new Date(Date.UTC(2026, 10, 14, 12));
  const r = riseTransitSet(269.4461, 4.7707, 7.3, 79.86, now);
  assert.equal(r.always, null);
  // up now -> this pass (transit may be behind us); otherwise the next pass
  assert.ok(r.up ? r.transit <= now && r.set > now : r.transit > now);
  assert.ok(Math.abs(r.transit - now) < 86400000);
  assert.ok(Math.abs(altAz(269.4461, 4.7707, 7.3, 79.86, r.transit).alt - r.transitAlt) < 0.01);
  assert.ok(Math.abs(altAz(269.4461, 4.7707, 7.3, 79.86, r.set).alt + 0.5667) < 0.3); // standard -0.5667° horizon
  assert.equal(riseTransitSet(248.17, 66.75, 60, 0, now).always, 'up');    // R Dra from 60°N
  assert.equal(riseTransitSet(248.17, 66.75, -45, 0, now).always, 'down'); // ... from 45°S
});

test('sun and visibility', () => {
  const s = sunRaDec(new Date(Date.UTC(2026, 2, 20, 15)));   // near the March equinox
  assert.ok(Math.abs(s.dec) < 0.5);
  const v = visibleTonight(248.17, 66.75, -45, 0, new Date(Date.UTC(2026, 10, 14, 12)));
  assert.equal(v.hours, 0);
});
