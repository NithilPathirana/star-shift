// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import {
  AU_KM, LD_KM, parseCad, parseSentry, parseSbdb, palermoMeaning,
  summarizeThreat, torinoLabel,
} from './model.js';

const $ = id => document.getElementById(id);
const state = {
  approaches: [], risks: [], approachSort: { key: 'date', direction: 1 },
  riskSort: { key: 'palermoCumulative', direction: -1 }, selectedId: null,
};

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function missing(reason) {
  const span = element('span', 'missing', '—');
  span.title = reason;
  span.setAttribute('aria-label', `Unavailable: ${reason}`);
  return span;
}

function number(value, digits = 2) {
  return value === null || !Number.isFinite(value)
    ? null
    : value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function significant(value, digits = 3) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 8 });
}

function utc(date) {
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).replace(',', ' ·');
}

function setStatus(message, isError = false) {
  $('neo-status').textContent = message;
  $('neo-status').classList.toggle('error', isError);
}

function td(label, content, className = '', title = '') {
  const cell = element('td', className);
  cell.dataset.label = label;
  if (content instanceof Node) cell.append(content); else cell.textContent = content;
  if (title) cell.title = title;
  return cell;
}

function compare(key, direction) {
  return (left, right) => {
    let a = left[key], b = right[key];
    if (a instanceof Date) { a = a.valueOf(); b = b.valueOf(); }
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    return (typeof a === 'string' ? a.localeCompare(b) : a - b) * direction;
  };
}

function diameterText(item) {
  if (item.diameterMinKm === null) return null;
  const minMetres = item.diameterMinKm * 1000;
  const maxMetres = item.diameterMaxKm * 1000;
  if (Math.abs(maxMetres - minMetres) < 0.01) return `${significant(minMetres)} m`;
  return `${significant(minMetres)}–${significant(maxMetres)} m`;
}

function renderApproaches() {
  const allRows = [...state.approaches].sort(compare(state.approachSort.key, state.approachSort.direction));
  const rows = allRows.slice(0, 10);
  const body = $('approach-table').tBodies[0];
  body.replaceChildren();
  for (const item of rows) {
    const row = element('tr', item.id === state.selectedId ? 'selected' : '');
    row.tabIndex = 0;
    row.dataset.id = item.id;
    const object = element('span', 'object-cell');
    object.append(element('strong', '', item.name));
    if (item.name !== item.designation) object.append(element('small', 'num', item.designation));
    const period = element('span', 'period-chip', item.period === 'recent' ? 'Recent' : 'Upcoming');
    object.append(period);
    row.append(td('Object', object));
    row.append(td('Date (UTC)', utc(item.date), 'num', item.dateSource));
    const distance = element('span', 'distance-cell num');
    distance.append(element('strong', '', `${number(item.distanceLd, 2)} LD`));
    distance.append(element('small', '', `${Math.round(item.distanceKm).toLocaleString('en-US')} km · ${item.distanceAu.toFixed(6)} au`));
    row.append(td('Distance', distance));
    row.append(td('Relative speed', item.speedKms === null ? missing('JPL did not report relative speed') : `${number(item.speedKms, 2)} km/s`, 'num'));
    row.append(td('H', item.h === null ? missing('Absolute magnitude is unavailable') : `${number(item.h, 2)} mag`, 'num'));
    const size = diameterText(item);
    row.append(td('Diameter', size || missing('Neither diameter nor H is available'), 'num', item.diameterSource));
    body.append(row);
  }
  $('approach-count').textContent = `Top ${rows.length} of ${allRows.length}`;
  updateSortHeaders('approach-table', 'data-sort', state.approachSort);
}

function probability(value) {
  if (value === null) return null;
  return value >= 0.001 ? `${number(value * 100, 4)}%` : value.toExponential(3);
}

function renderRisks() {
  const allRows = [...state.risks].sort(compare(state.riskSort.key, state.riskSort.direction));
  const rows = allRows.slice(0, 10);
  const body = $('risk-table').tBodies[0];
  body.replaceChildren();
  for (const item of rows) {
    const row = element('tr');
    row.tabIndex = 0;
    row.dataset.designation = item.designation;
    const object = element('span', 'object-cell');
    object.append(element('strong', '', item.name));
    if (item.name !== item.designation) object.append(element('small', 'num', item.designation));
    row.append(td('Object', object));
    row.append(td('Cumulative probability', probability(item.impactProbability) || missing('Sentry did not report a cumulative probability'), 'num'));
    const palermo = element('span', 'palermo');
    palermo.append(element('strong', 'num', item.palermoCumulative === null ? '—' : `${item.palermoCumulative >= 0 ? '+' : ''}${item.palermoCumulative.toFixed(2)}`));
    palermo.append(element('small', '', palermoMeaning(item.palermoCumulative)));
    row.append(td('Palermo cumulative', palermo));
    row.append(td('Palermo max', item.palermoMax === null ? missing('Sentry did not report a maximum Palermo value') : `${item.palermoMax >= 0 ? '+' : ''}${item.palermoMax.toFixed(2)}`, 'num'));
    const torino = element('span', `torino-chip torino-${Math.trunc(item.torino ?? 0)}`, `${Math.trunc(item.torino ?? 0)} · ${torinoLabel(item.torino)}`);
    row.append(td('Torino', torino));
    row.append(td('Diameter', item.diameterKm === null ? missing('Sentry did not report a diameter') : `${significant(item.diameterKm * 1000)} m`, 'num'));
    row.append(td('Potential years', item.impactYears || missing('No potential-impact year range was reported'), 'num'));
    row.append(td('Potential impacts', item.potentialImpacts === null ? missing('No count was reported') : item.potentialImpacts.toLocaleString('en-US'), 'num'));
    body.append(row);
  }
  $('risk-count').textContent = `Top ${rows.length} of ${allRows.length.toLocaleString('en-US')}`;
  updateSortHeaders('risk-table', 'data-risk-sort', state.riskSort);
}

function updateSortHeaders(tableId, attribute, sort) {
  const table = $(tableId);
  table.querySelectorAll('th').forEach(header => {
    const button = header.querySelector(`[${attribute}]`);
    const active = button?.getAttribute(attribute) === sort.key;
    header.setAttribute('aria-sort', active ? (sort.direction > 0 ? 'ascending' : 'descending') : 'none');
    const arrow = button?.querySelector('span');
    if (arrow) arrow.textContent = active ? (sort.direction > 0 ? '↑' : '↓') : '';
  });
}

function renderSummary() {
  const summary = summarizeThreat(state.approaches, state.risks);
  $('summary-torino').textContent = summary.maxTorino.toFixed(0);
  $('summary-torino-note').textContent = summary.maxTorino === 0
    ? 'No known object has a Torino rating above 0.'
    : `The highest listed rating is ${summary.maxTorino.toFixed(0)} · ${torinoLabel(summary.maxTorino)}.`;
  if (summary.closest) {
    $('summary-closest').textContent = `${number(summary.closest.distanceLd, 2)} LD`;
    $('summary-closest-note').textContent = `${summary.closest.name} · ${utc(summary.closest.date)} UTC`;
  } else {
    $('summary-closest').textContent = '—';
    $('summary-closest').title = 'No upcoming approach was returned';
    $('summary-closest-note').textContent = 'No upcoming approach is available.';
  }
  $('summary-moon').textContent = summary.withinOneLd.toLocaleString('en-US');
}

function dlRow(list, label, value, reason) {
  list.append(element('dt', '', label));
  const definition = element('dd', 'num');
  definition.append(value === null || value === undefined ? missing(reason) : document.createTextNode(value));
  list.append(definition);
}

function renderDrawer(detail) {
  $('drawer-title').textContent = detail.name;
  const body = $('drawer-body');
  body.replaceChildren();
  const identity = element('section', 'drawer-section');
  const identityGrid = element('dl', 'drawer-grid');
  dlRow(identityGrid, 'Designation', detail.designation, 'No designation was returned');
  dlRow(identityGrid, 'Orbit class', detail.orbitClass, 'JPL did not classify this orbit');
  dlRow(identityGrid, 'Earth MOID', detail.moidAu === null ? null : `${detail.moidAu.toFixed(6)} au · ${(detail.moidAu * AU_KM / LD_KM).toFixed(2)} LD`, 'JPL did not report an Earth MOID');
  dlRow(identityGrid, 'Potentially hazardous', detail.pha === null ? null : (detail.pha ? 'Yes' : 'No'), 'JPL did not report PHA status');
  identity.append(identityGrid);
  body.append(identity);

  const orbit = element('section', 'drawer-section');
  orbit.append(element('h3', '', 'Orbit elements · JPL'));
  const orbitGrid = element('dl', 'drawer-grid');
  const fields = [
    ['Semi-major axis a', 'a', 'au'], ['Eccentricity e', 'e', ''], ['Inclination i', 'i', '°'],
    ['Longitude of node Ω', 'om', '°'], ['Argument of perihelion ω', 'w', '°'],
    ['Perihelion q', 'q', 'au'], ['Aphelion Q', 'ad', 'au'], ['Period P', 'per', 'd'],
  ];
  for (const [label, key, unit] of fields) {
    const value = detail.elements[key];
    dlRow(orbitGrid, label, value === null || value === undefined ? null : `${significant(value, 5)}${unit ? ` ${unit}` : ''}`, `JPL did not report ${label}`);
  }
  orbit.append(orbitGrid);
  body.append(orbit);

  const physical = element('section', 'drawer-section');
  physical.append(element('h3', '', 'Physical data · JPL'));
  const physicalGrid = element('dl', 'drawer-grid');
  dlRow(physicalGrid, 'Absolute magnitude H', detail.physical.h === null ? null : `${number(detail.physical.h, 2)} mag`, 'No H value is available');
  dlRow(physicalGrid, 'Diameter', detail.physical.diameterKm === null ? null : `${significant(detail.physical.diameterKm * 1000)} m`, 'No measured/compiled diameter is available');
  dlRow(physicalGrid, 'Geometric albedo', detail.physical.albedo === null ? null : significant(detail.physical.albedo), 'No albedo is available');
  dlRow(physicalGrid, 'Rotation period', detail.physical.rotationHours === null ? null : `${significant(detail.physical.rotationHours)} h`, 'No rotation period is available');
  physical.append(physicalGrid);
  body.append(physical);

  const approaches = element('section', 'drawer-section');
  approaches.append(element('h3', '', 'Next close approaches to Earth · JPL'));
  if (!detail.nextCloseApproaches.length) {
    approaches.append(missing('No future sufficiently certain Earth approach was returned'));
  } else {
    const list = element('ul', 'drawer-ca');
    for (const item of detail.nextCloseApproaches) {
      const li = element('li');
      li.append(element('span', '', `${utc(item.date)} TDB`));
      li.append(element('strong', 'num', `${(item.distanceAu * AU_KM / LD_KM).toFixed(2)} LD`));
      li.append(element('small', '', `${item.distanceAu.toFixed(6)} au`));
      li.append(element('small', 'num', item.speedKms === null ? '—' : `${item.speedKms.toFixed(2)} km/s`));
      list.append(li);
    }
    approaches.append(list);
  }
  body.append(approaches);
}

async function openObject(designation, selectedId = null) {
  if (!designation) return;
  state.selectedId = selectedId;
  renderApproaches();
  const drawer = $('object-drawer');
  $('drawer-title').textContent = designation;
  $('drawer-body').replaceChildren(element('p', '', 'Loading JPL object details…'));
  if (!drawer.open) drawer.showModal();
  try {
    const query = new URLSearchParams({ sstr: designation, 'phys-par': '1', 'ca-data': '1', 'ca-body': 'Earth', 'full-prec': '1' });
    const response = await fetch(`/jpl/sbdb?${query}`);
    if (!response.ok) throw new Error(`relay returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.list) throw new Error('the designation matched more than one object');
    renderDrawer(parseSbdb(payload));
  } catch (error) {
    $('drawer-body').replaceChildren(element('p', '', `Object details could not be loaded: ${error.message}.`));
  }
}

function bindTable(tableId, attribute, sortKey, render) {
  $(tableId).querySelector('thead').addEventListener('click', event => {
    const button = event.target.closest(`[${attribute}]`);
    if (!button) return;
    const key = button.getAttribute(attribute);
    const sort = state[sortKey];
    sort.direction = sort.key === key ? -sort.direction : 1;
    sort.key = key;
    render();
  });
}

async function load() {
  const recentStart = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const baseCad = { 'dist-max': '0.05', body: 'Earth', diameter: 'true', fullname: 'true' };
  const upcomingQuery = new URLSearchParams({ ...baseCad, 'date-min': 'now', 'date-max': '+60' });
  const recentQuery = new URLSearchParams({ ...baseCad, 'date-min': recentStart, 'date-max': 'now' });
  try {
    const [upcomingResponse, recentResponse, sentryResponse] = await Promise.all([
      fetch(`/jpl/cad?${upcomingQuery}`), fetch(`/jpl/cad?${recentQuery}`), fetch('/jpl/sentry'),
    ]);
    for (const response of [upcomingResponse, recentResponse, sentryResponse]) {
      if (!response.ok) throw new Error(`relay returned HTTP ${response.status}`);
    }
    const [upcoming, recent, sentry] = await Promise.all([upcomingResponse.json(), recentResponse.json(), sentryResponse.json()]);
    state.approaches = [...parseCad(recent, 'recent'), ...parseCad(upcoming, 'upcoming')];
    state.risks = parseSentry(sentry);
    renderApproaches();
    renderRisks();
    renderSummary();
    const fetched = new Date();
    const cacheAge = Math.max(...[upcomingResponse, recentResponse, sentryResponse].map(response => Number(response.headers.get('Age')) || 0));
    const freshnessText = `Data: NASA/JPL (CNEOS) · fetched ${fetched.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${cacheAge > 86_400 ? ' · cached data is more than a day old' : ''}`;
    $('freshness').replaceChildren(element('span', 'tag tag-jpl', 'JPL'), element('span', '', freshnessText));
    setStatus(`Loaded ${state.approaches.length} close approaches and ${state.risks.length.toLocaleString('en-US')} Sentry objects.`);
  } catch (error) {
    setStatus(`NASA/JPL data could not be loaded: ${error.message}. Check that the local relay includes the JPL route.`, true);
  }
}

bindTable('approach-table', 'data-sort', 'approachSort', renderApproaches);
bindTable('risk-table', 'data-risk-sort', 'riskSort', renderRisks);
$('approach-table').tBodies[0].addEventListener('click', event => {
  const row = event.target.closest('tr[data-id]');
  const item = state.approaches.find(candidate => candidate.id === row?.dataset.id);
  if (item) openObject(item.designation, item.id);
});
$('approach-table').tBodies[0].addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  const row = event.target.closest('tr[data-id]');
  const item = state.approaches.find(candidate => candidate.id === row?.dataset.id);
  if (item) openObject(item.designation, item.id);
});
$('risk-table').tBodies[0].addEventListener('click', event => {
  const row = event.target.closest('tr[data-designation]');
  if (row) openObject(row.dataset.designation);
});
$('risk-table').tBodies[0].addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  const row = event.target.closest('tr[data-designation]');
  if (row) openObject(row.dataset.designation);
});
$('drawer-close').addEventListener('click', () => $('object-drawer').close());
$('object-drawer').addEventListener('click', event => {
  if (event.target === $('object-drawer')) $('object-drawer').close();
});

load();
