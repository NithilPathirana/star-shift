// web/data/releases.json is the one list of SPHEREx releases: the image queries use it and every
// credit line must match it (judging panel a4: credits match the data).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadReleases, listImagesSIA, listImages, moreImagesInTAP, mergeImageLists, exposureOf, creditText, releaseFolder } from '../web/core/irsa.js';

const WEB = new URL('../web/', import.meta.url);
const releases = JSON.parse(readFileSync(new URL('data/releases.json', WEB), 'utf8'));
const DOI = /10\.26131\/IRSA\d+/g;

test('releases.json: SPHEREx collections, each with a label and an IRSA DOI', async () => {
  assert.ok(releases.length >= 1);
  for (const r of releases) {
    assert.match(r.collection, /^spherex_[a-z0-9]+$/);
    assert.ok(r.label.length > 5);
    assert.match(r.doi, /^10\.26131\/IRSA\d+$/);
  }
  assert.deepEqual(await loadReleases(), releases);
  assert.deepEqual(releases.map(r => releaseFolder(r.collection)), ['dr1', 'qr3']);
  assert.match(creditText(releases), /10\.26131\/IRSA678.*10\.26131\/IRSA662/);
});

test('the SIA image list asks exactly the collections in releases.json', async () => {
  const asked = [];
  const fetchFn = async (url) => { asked.push(new URL(url).searchParams.get('COLLECTION')); return new Response('<VOTABLE><TABLE></TABLE></VOTABLE>'); };
  await listImagesSIA(10, 20, { fetchFn });
  assert.deepEqual(asked, releases.map(r => r.collection));
});

// the 2MASS and AllWISE image services (Telescopes view), cited from DataCite: not SPHEREx releases
const OTHER_IMAGE_DOIS = new Set(['10.26131/IRSA121', '10.26131/IRSA153']);

test('every page that credits SPHEREx images cites every release DOI and no other IRSA DOI', () => {
  const want = new Set(releases.map(r => r.doi));
  const pages = readdirSync(WEB).filter(f => f.endsWith('.html'));
  let crediting = 0;
  for (const f of pages) {
    const html = readFileSync(new URL(f, WEB), 'utf8');
    const dois = new Set((html.match(DOI) || []).filter(d => !OTHER_IMAGE_DOIS.has(d)));
    for (const d of dois) assert.ok(want.has(d), `${f} cites ${d}, which is not in releases.json`);
    if (!dois.size) continue;
    crediting++;
    for (const d of want) assert.ok(dois.has(d), `${f} credits SPHEREx images but misses ${d}`);
  }
  assert.ok(crediting >= 5, `expected the viewer, archive, spectral, proof and spot pages to credit the images (found ${crediting})`);
});

test('complete image list (a4b): SIA + TAP merged by exposure and detector, releases.json only', async () => {
  const im = (rel, exp, det, mjd) => ({ uri: `ibe/data/spherex/${rel}/level2/x/l2b/${det}/level2_${exp}D${det}_spx_l2b-v1.fits`, mjdStart: mjd, detector: det, obsid: exp });
  const sia = [im('dr1', '2025W20_1A_0001_1', 1, 60800), im('dr1', '2025W20_1A_0001_1', 4, 60800), im('qr3', '2026W30_1A_0002_1', 1, 61200)];
  // TAP: the same files (UUID obsids), one SIA missed, and a QR2 copy that is not in releases.json
  const tap = [...sia.map(x => ({ ...x, obsid: 'uuid-' + x.detector })), im('dr1', '2025W40_1A_0003_2', 3, 60950), im('qr2', '2025W41_1A_0004_1', 2, 60960)];
  assert.equal(exposureOf(sia[0].uri), '2025W20_1A_0001_1');
  assert.equal(mergeImageLists([sia, tap.slice(0, 3)]), sia, 'nothing new: the SIA list itself, same order');
  const m = mergeImageLists([sia, tap], ['dr1', 'qr3']);
  assert.deepEqual(m.map(x => x.mjdStart), [60800, 60800, 60950, 61200]);
  // listImages in Node ('always'): both services asked, TAP rows outside releases.json dropped
  const vot = (rows) => `<VOTABLE><TABLE><FIELD name="access_url"/><FIELD name="t_min"/><FIELD name="t_max"/><FIELD name="energy_bandpassname"/><FIELD name="em_min"/><FIELD name="em_max"/><FIELD name="obs_id"/><FIELD name="dataproduct_subtype"/>${rows.map(r => `<TR>${r.map(v => `<TD>${v}</TD>`).join('')}</TR>`).join('')}</TABLE></VOTABLE>`;
  const fetchFn = async (url) => {
    if (url.includes('/SIA')) {
      const c = new URL(url).searchParams.get('COLLECTION').replace('spherex_', '');
      return new Response(vot(sia.filter(x => x.uri.includes(`/${c}/`)).map(x => [`https://irsa.ipac.caltech.edu/${x.uri}`, x.mjdStart, x.mjdStart + 0.01, `SPHEREx-D${x.detector}`, '1e-6', '2e-6', x.obsid, 'science'])));
    }
    return new Response('uri,time_bounds_lower,time_bounds_upper,energy_bandpassname,energy_bounds_lower,energy_bounds_upper,obsid,quality_flag\n'
      + tap.map(x => `${x.uri},${x.mjdStart},${x.mjdStart + 0.01},SPHEREx-D${x.detector},1e-6,2e-6,${x.obsid},0`).join('\n') + '\n');
  };
  const all = await listImages(10, 20, { fetchFn, base: 'http://r' });
  assert.equal(all.length, 4);
  assert.deepEqual(all.sources, { sia: 3, tap: 4 });
  assert.equal(all.find(x => x.mjdStart === 60950).obsid, '2025W40_1A_0003_2', 'TAP rows carry the exposure name, not the UUID');
  const more = await moreImagesInTAP(10, 20, all.slice(0, 2), { fetchFn, base: 'http://r' });
  assert.equal(more.extra.length, 2);
});

test('README cites the same DOIs', () => {
  const md = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const dois = new Set((md.match(DOI) || []).filter(d => !OTHER_IMAGE_DOIS.has(d)));
  for (const r of releases) assert.ok(dois.has(r.doi), `README misses ${r.doi}`);
  for (const d of dois) assert.ok(releases.some(r => r.doi === d), `README cites ${d}, not in releases.json`);
});
