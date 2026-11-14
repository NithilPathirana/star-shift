// SIA image listing + relay route (offline).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVOTable, listImagesSIA, listImages } from '../web/core/irsa.js';
import { handle } from '../proxy/worker.js';

const vot = (rows) => `<?xml version="1.0"?><VOTABLE><RESOURCE><TABLE>
<FIELD name="access_url" datatype="char"/><FIELD name="t_min" datatype="double"/><FIELD name="t_max" datatype="double"/>
<FIELD name="energy_bandpassname" datatype="char"/><FIELD name="em_min" datatype="double"/><FIELD name="em_max" datatype="double"/>
<FIELD name="obs_id" datatype="char"/><FIELD name="dataproduct_subtype" datatype="char"/>
<DATA><TABLEDATA>${rows.map(r => `<TR>${r.map(v => `<TD>${v}</TD>`).join('')}</TR>`).join('')}</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>`;
const U = (c, n) => `https://irsa.ipac.caltech.edu/ibe/data/spherex/${c}/level2/x/${n}.fits`;

test('VOTable parser handles entities and empty cells', () => {
  const rows = parseVOTable(vot([['a&amp;b', '1', '2', 'SPHEREx-D3', '1e-6', '2e-6', 'o1', '']]));
  assert.equal(rows[0].access_url, 'a&b');
  assert.equal(rows[0].dataproduct_subtype, '');
});

test('SIA listing merges DR1 + QR3, keeps science only, sorts by time, maps fields', async () => {
  const fetchFn = async (url) => new Response(url.includes('spherex_dr1')
    ? vot([[U('dr1', 'b'), '60900.5', '60900.6', 'SPHEREx-D6', '4.4115e-06', '5.0096e-06', 'o2', 'science'], [U('dr1', 'c'), '60800', '60800.1', 'SPHEREx-D1', '7e-7', '1.1e-6', 'o3', 'calibration']])
    : vot([[U('qr3', 'a'), '60700.25', '60700.3', 'SPHEREx-D2', '1.1e-6', '1.6e-6', 'o1', 'science']]));
  const list = await listImagesSIA(10, 20, { fetchFn, base: 'http://r' });
  assert.deepEqual(list.map(i => i.uri), ['ibe/data/spherex/qr3/level2/x/a.fits', 'ibe/data/spherex/dr1/level2/x/b.fits']);
  assert.equal(list[1].detector, 6);
  assert.ok(Math.abs(list[1].bandMinUm - 4.4115) < 1e-9);
});

test('listImages falls back to TAP when SIA fails', async () => {
  const seen = [];
  const fetchFn = async (url) => { seen.push(url); if (url.includes('/SIA')) return new Response('down', { status: 503 });
    return new Response('uri,time_bounds_lower,time_bounds_upper,energy_bandpassname,energy_bounds_lower,energy_bounds_upper,obsid,quality_flag\nibe/data/spherex/dr1/a.fits,60000,60000.1,SPHEREx-D1,7e-7,1e-6,o,0\n'); };
  const list = await listImages(10, 20, { fetchFn, base: 'http://r' });
  assert.equal(list.length, 1);
  assert.ok(seen.some(u => u.includes('/TAP/sync')));
});

test('relay allows only SPHEREx SIA position searches', async () => {
  const log = []; const fetchFn = async (u) => { log.push(u); return new Response('<VOTABLE/>'); };
  let r = await handle(new Request('https://r.example/SIA?COLLECTION=spherex_dr1&POS=circle+10.5+-20.25+0.0005&RESPONSEFORMAT=VOTABLE'), { fetchFn, cache: null });
  assert.equal(r.status, 200);
  assert.equal(log[0], 'https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_dr1&POS=circle+10.5+-20.25+0.0005&RESPONSEFORMAT=VOTABLE');
  for (const bad of ['/SIA?COLLECTION=wise_allwise&POS=circle+1+2+0.1', '/SIA?COLLECTION=spherex_dr1&POS=polygon+1+2+3', '/SIA?COLLECTION=spherex_dr1&POS=circle+1+2+0.1;drop'])
    assert.ok((await handle(new Request('https://r.example' + bad), { fetchFn, cache: null })).status >= 400, bad);
  assert.equal(log.length, 1);
});
