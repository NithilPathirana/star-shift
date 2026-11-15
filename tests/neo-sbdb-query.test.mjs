// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Full function test neo-1: "Add to comparison" must send SBDB a number or designation, never the
// full sb_ident name with parentheses (SBDB answers HTTP 400 to that).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sbdbQuery } from '../web/app/neo/sb-ident.js';

test('sb_ident names become SBDB search strings without parentheses', () => {
  assert.equal(sbdbQuery('541093 (2018 RJ4)'), '541093');
  assert.equal(sbdbQuery('(2013 AA145)'), '2013 AA145');
  assert.equal(sbdbQuery('1354 Botha (1935 GK)'), '1354');
  assert.equal(sbdbQuery('99942 Apophis (2004 MN4)'), '99942');
  assert.equal(sbdbQuery('C/2020 F3 (NEOWISE)'), 'C/2020 F3');
  assert.equal(sbdbQuery('P/2019 LD2 (ATLAS)'), 'P/2019 LD2');
  assert.equal(sbdbQuery('29P/Schwassmann-Wachmann 1'), '29P');
  assert.equal(sbdbQuery('Ceres'), 'Ceres');
  for (const name of ['541093 (2018 RJ4)', '(2013 AA145)', 'C/2020 F3 (NEOWISE)']) assert.doesNotMatch(sbdbQuery(name), /[()]/);
});
