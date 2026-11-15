// Page-load guard (Master, Sun 15 Nov, after 3c42b80 blanked the app while npm test passed):
// loads the pages a judge lands on in a fresh headless Chrome/Edge and FAILS on any uncaught page
// error, console error or unhandled promise rejection. Run before every deploy (local server) and
// after it (live URL):  node deploy/page-check.mjs [base-url]   (default http://127.0.0.1:8787)
// Network errors from the live archives (IRSA/JPL/Gaia/SIMBAD answering busy) are listed but do not
// fail the check: the five demo targets load from pre-baked files and must not need them.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAPTERS } from '../web/app/tour/chapters.js';

const base = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const PAGES = [
  ['/', 9000], ["/index.html?q=Barnard's%20Star&scene=viewer", 15000], ['/index.html?q=WISE%200855&scene=viewer', 12000],
  ['/proof.html', 5000], ['/spot.html', 6000], ['/archive.html?q=Barnard%27s%20Star', 6000], ['/spectral.html?q=Barnard%27s%20Star', 6000],
  ['/neo.html', 5000], ['/planetarium.html?q=Barnard%27s%20Star', 5000],
  // spec-team-extras.md item 1: "Measure it yourself" (two clicks on Barnard's Star give a sane speed)
  ['/measure.html', 4000],
  // the other three demo targets' deep links (Master's freeze gate: all five presets must open in the viewer)
  ['/index.html?q=Epsilon%20Indi%20B&scene=viewer', 10000], ['/index.html?q=RW%20Aurigae&scene=viewer', 10000], ['/index.html?q=R%20Draconis&scene=viewer', 10000],
  // other pages' About link (full test global-1: it lost its #about and opened nothing)
  ['/index.html#about', 6000],
  // Judging panel round 4, item 11: the first-screen key plays Barnard's Star through to a verdict on the plate
  ['/?cta', 7000],
  // IRSA outage (Sun 15 Nov): IRSA's relay routes fail; the status pill shows, a search for a non-saved name gets the calm note, the error screen has its saved-target chips
  ['/?irsa-down', 8000],
  // extra 4 (spec-team-extras.md): Spot's Barnard example -> "Prepare a report" -> the report holds RA/Dec and the share link
  ['/spot.html?field=barnard&click=269.44625,4.768778', 6000],
  // Your photo -> the sky (judges' suggestion C): the committed synthetic test image must solve, verified, in the browser
  ['/photo.html?sample', 6000],
  // fresh profile (Judging panel round 7): no consent bar and no tutorial modal; the hero card and CTA stay, with only the
  // "Quick tour of this page" chip; changing a colour shows the inline consent ask. A fresh deep link gets only the chip. Kept last: they clear storage.
  ['/', 9000, 'fresh'], ['/index.html?q=Epsilon%20Indi%20B&scene=viewer', 10000, 'deep'],
];
// Every other page loads as a returning visitor: consent chosen and every tutorial done, so nothing pops up over what is checked.
const CONSENT = 'star-shift-consent-v1', TUTORIALS = 'star-shift-tutorials-v1';
const SEEN = `(() => { try { if (!localStorage.getItem('${CONSENT}')) localStorage.setItem('${CONSENT}', '{"v":1,"personal":false}');
  if (!localStorage.getItem('${TUTORIALS}')) localStorage.setItem('${TUTORIALS}', '${JSON.stringify(Object.fromEntries(CHAPTERS.map(c => [c.id, 'done'])))}'); } catch { /* blocked */ } })()`;
// a fresh profile for this tab only (the browser profile is shared by every page above)
const FRESH = (consent) => `(() => { try { if (sessionStorage.getItem('pc-fresh')) return; sessionStorage.setItem('pc-fresh', '1'); localStorage.clear();
  ${consent ? `localStorage.setItem('${CONSENT}', '{"v":1,"personal":false}');` : ''} } catch { /* blocked */ } })()`;
const GATE = "(() => { const b = document.getElementById('ssConsent'), c = document.getElementById('tourChip'), on = e => !!e && e.getClientRects().length > 0;"
  + " const br = on(b) ? b.getBoundingClientRect() : null; const hit = br && [...document.querySelectorAll('.story-go, #mdPlay, #cdPlay, #play')].some(e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.left < br.right && br.left < r.right && r.top < br.bottom && br.top < r.bottom; });"
  + " return { bar: on(b), barCovers: !!hit, chip: on(c), tour: document.documentElement.dataset.tour === 'on', count: document.getElementById('tourCount')?.textContent || '',"
  + " ask: on(document.getElementById('ssAsk')), hero: document.documentElement.dataset.story === 'on' && [...document.querySelectorAll('.story-go')].some(on) }; })()";
// Help and About are two different panels (Nithil: "Help and About open the same thing")
const POPS = "(() => { const v = id => { const p = document.getElementById(id); return !!p && !p.hidden && p.getClientRects().length > 0; };"
  + " const t = id => document.getElementById(id)?.textContent || ''; return { help: v('help'), about: v('about'), helpTour: /Tour/.test(t('help')), helpTeam: /Who is this for/.test(t('help')), aboutTeam: /Who is this for/.test(t('about')) }; })()";
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
// archive / catalogue hosts and relay routes whose failures are "the archive is busy", not our bug
const ARCHIVE = /\/(SIA|TAP\/sync|ibe\/|gaia\/|jpl\/|hips\/)|simbad|irsa|gea\.esac|ssd-api|fonts\.g/i;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// hard limits so a stuck browser can never hold the commit gate (a hang held it 10 min, Sun 13:02)
const CDP_TIMEOUT_MS = 30000, TOTAL_TIMEOUT_MS = 9 * 60 * 1000;
let browserProc = null;
setTimeout(() => { console.error(`page check could not run: no result after ${TOTAL_TIMEOUT_MS / 60000} min (browser stuck)`); try { browserProc?.kill(); } catch { /* gone */ } process.exit(2); }, TOTAL_TIMEOUT_MS).unref();

// Judging panel round 5, item 1 (deploy-lag guard): every key module answers 200, and on a deploy the live
// /version.json names the commit just deployed (deploy.sh sets EXPECT_SHA), so a stale or partial deploy fails loudly
const MODULES = ['/app/ui.js', '/app/seasons.js', '/app/distances.js', '/app/gaia-overlay.js', '/app/spot/colour.js', '/app/spot/botha.js',
  '/app/spot/logic.js', '/app/proof/logic.js', '/app/diffview.js', '/app/erender.js', '/app/astro-loader.js', '/data/proof.json', '/data/botha-check.json', '/data/spot-botha.json',
  '/app/consent.js', '/app/consent-ui.js', '/app/lightcurve/make.js', '/app/lightcurve/maker.js', '/app/photo/solve.js', '/app/photo/main.js', '/data/photo-test.png', '/app/measure/main.js', '/app/measure/logic.js'];
async function preflight() {
  const bad = [];
  for (const m of MODULES) { try { const r = await fetch(base + m, { cache: 'no-store' }); if (r.status !== 200) bad.push(`${m} ${r.status}`); } catch (e) { bad.push(`${m} ${e.message}`); } }
  if (process.env.EXPECT_SHA) {
    try { const v = await (await fetch(base + '/version.json', { cache: 'no-store' })).json();
      if (!v.sha || !String(process.env.EXPECT_SHA).startsWith(v.sha.slice(0, 7)) && !v.sha.startsWith(process.env.EXPECT_SHA)) bad.push(`live /version.json is ${v.sha}, expected ${process.env.EXPECT_SHA}`);
    } catch (e) { bad.push(`live /version.json unreadable (${e.message})`); }
  }
  return bad;
}

async function run() {
  const pre = await preflight();
  if (pre.length) { console.error('page check FAILED before the browser: ' + pre.join('; ')); process.exit(1); }
  const exe = process.env.BROWSER || BROWSERS.find(p => existsSync(p));
  if (!exe) throw new Error('No Chrome/Edge found (set BROWSER=path)');
  const port = 9300 + Math.floor(Math.random() * 600), dir = mkdtempSync(join(tmpdir(), 'pagecheck-'));
  const chrome = browserProc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let ws, id = 0; const pend = new Map(), handlers = [];
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error(`browser did not answer ${method} in ${CDP_TIMEOUT_MS / 1000} s`)); } }, CDP_TIMEOUT_MS); });
  const rows = [];
  try {
    let info;
    for (let k = 0; k < 75 && !info; k++) { try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); } }
    if (!info) throw new Error('browser did not start');
    ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else handlers.forEach(h => h(d)); };
    for (const [path, wait, mode] of PAGES) {
      const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
      const { result: { sessionId: s } } = await send('Target.attachToTarget', { targetId, flatten: true });
      const errs = [], soft = [];
      const h = (d) => {
        if (d.sessionId !== s) return;
        if (d.method === 'Fetch.requestPaused') { send('Fetch.failRequest', { requestId: d.params.requestId, errorReason: 'Failed' }, s).catch(() => {}); return; } // /?irsa-down only
        if (d.method === 'Runtime.exceptionThrown') { const e = d.params.exceptionDetails; errs.push(`uncaught: ${(e.exception?.description || e.text || '').split('\n').slice(0, 2).map(x => x.trim()).join(' ')}`); }
        if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
          const t = d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200);
          (ARCHIVE.test(t) ? soft : errs).push(`console.error: ${t}`);
        }
        if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') {
          const e = d.params.entry, t = `${e.text} ${e.url || ''}`.slice(0, 220);
          (e.source === 'network' && (ARCHIVE.test(t) || /\b50[234]\b/.test(t)) ? soft : errs).push(`${e.source}: ${t}`);
        }
      };
      handlers.push(h);
      await send('Runtime.enable', {}, s); await send('Log.enable', {}, s); await send('Page.enable', {}, s);
      // unhandled rejections surface as Runtime.exceptionThrown ("Uncaught (in promise)")
      await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false }, s);
      // returning visitor (consent + tutorials done) on every page but the two fresh cases, /?cta and /?irsa-down included
      await send('Page.addScriptToEvaluateOnNewDocument', { source: mode ? FRESH(false) : SEEN }, s);
      if (path === '/?irsa-down') await send('Fetch.enable', { patterns: ['*/SIA?*', '*/TAP/*', '*/ibe/*'].map(urlPattern => ({ urlPattern })) }, s);
      await send('Page.navigate', { url: base + path }, s);
      await sleep(wait);
      if (/scene=viewer/.test(path)) { // the viewer really opened and has images (not just "no errors");
        // poll up to 25 s more, so a busy machine (several gates queued) is not mistaken for a broken link
        let v = {};
        for (let k = 0; k < 25; k++) {
          const r = await send('Runtime.evaluate', { expression: "(() => ({ scene: document.querySelector('.app')?.dataset.scene, n: document.getElementById('d-n')?.textContent || '' }))()", returnByValue: true }, s);
          v = r.result?.result?.value || {};
          if (v.scene === 'viewer' && /\d+ of [\d,]+ images/.test(v.n)) break;
          await sleep(1000);
        }
        if (v.scene !== 'viewer' || !/\d+ of [\d,]+ images/.test(v.n)) errs.push(`deep link did not open the viewer with images within ${Math.round(wait / 1000) + 25} s (scene=${v.scene}, "${String(v.n).slice(0, 60)}")`);
        // Barnard: Compare > Difference must really switch on (its key was dead on live, Judging panel round 3)
        else if (/Barnard/.test(path)) {
          // Spec A: click the star (the patch centre) and an SNR line must appear in "This spot: signal-to-noise"
          const snrClick = "(() => { const A = document.getElementById('cvA'), r = A.getBoundingClientRect(); A.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));"
            + " const b = document.getElementById('snrBody'), d = [...document.querySelectorAll('#tlDate > span')].pop()?.textContent || '';"
            + " return { line: b?.querySelector('.snr-line')?.textContent || '', at: b?.querySelector('.snr-at')?.textContent || '', shown: d }; })()";
          // ...and it measures the picture on screen: the SNR line names the shown image's (or Blink stack's) date (judging panel round 7)
          const snrOk = v => /^(Signal-to-noise -?\d|SNR not meaningful here|No detectable source here)/.test(v.line) && /clicked/.test(v.at) && !!v.shown && v.at.includes(v.shown);
          let sn = {};
          for (let k = 0; k < 15; k++) {
            sn = (await send('Runtime.evaluate', { expression: snrClick, returnByValue: true }, s)).result?.result?.value || {};
            if (snrOk(sn)) break;
            await sleep(1000);
          }
          if (!snrOk(sn)) errs.push(`clicking the star gave no SNR line naming the picture on screen (${JSON.stringify(sn).slice(0, 200)})`);
          // spec-team-extras 3: Blink > "Save as GIF" makes a non-empty file that starts with GIF89a (no download: __ssNoDownload)
          const gifStep = "(async () => { window.__ssNoDownload = true; const st = document.getElementById('stage'), k = document.getElementById('gifKey');"
            + " if (!st.classList.contains('mode-blink')) { document.querySelector('#viewSeg [data-mode=blink]')?.click(); return { wait: 'blink' }; }"
            + " if (!k || k.style.display === 'none' || k.disabled) return { wait: 'key' };"
            + " if (!k._last) { if (!window.__gifClicked) { window.__gifClicked = 1; k.click(); } return { wait: 'file' }; }"
            + " const b = k._last.blob; return { size: b.size, head: new TextDecoder().decode(new Uint8Array(await b.slice(0, 6).arrayBuffer())), name: k._last.name }; })()";
          let gf = {};
          for (let k = 0; k < 25; k++) {
            gf = (await send('Runtime.evaluate', { expression: gifStep, returnByValue: true, awaitPromise: true }, s)).result?.result?.value || {};
            if (gf.size != null) break;
            await sleep(1000);
          }
          if (!(gf.size > 0) || gf.head !== 'GIF89a') errs.push(`Blink > Save as GIF made no valid GIF (${JSON.stringify(gf).slice(0, 120)})`);
          // the preset may still be in its early Blink / second season when the counter first shows, so retry for up to 20 s
          const step = "(() => { const st = document.getElementById('stage'), k = document.getElementById('diffKey'), l = document.getElementById('diffLgd');"
            + " const d = { p: k?.getAttribute('aria-pressed'), lg: !!l && !l.hidden && l.getClientRects().length > 0 };"
            + " if (!st.classList.contains('mode-compare')) document.querySelector('#viewSeg [data-mode=compare]')?.click();"
            + " else if (!window.__sq) { const A = document.getElementById('cvA'), B = document.getElementById('cvB'); window.__sq = { a: [A.width, A.height], b: [B.width, B.height] }; }"
            + " else if (d.p !== 'true' && k?.getClientRects().length) k.click(); return d; })()";
          let d = {};
          for (let k = 0; k < 20; k++) {
            d = (await send('Runtime.evaluate', { expression: step, returnByValue: true }, s)).result?.result?.value || {};
            if (d.p === 'true' && d.lg) break;
            await sleep(1000);
          }
          if (d.p !== 'true' || !d.lg) errs.push(`Compare > Difference did not switch on (aria-pressed=${d.p}, legend shown=${d.lg})`);
          // Judging panel round 4, item 11: Compare's two canvases are square (the 300x150 stretch), and Telescopes
          // shows 3 panels, each with its image or the IRSA-outage note (never blank)
          const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true }, s)).result?.result?.value;
          const sq = await ev('window.__sq || null');
          if (!sq || sq.a[0] !== sq.a[1] || sq.b[0] !== sq.b[1]) errs.push(`Compare canvases are not square (${JSON.stringify(sq)})`);
          await ev("document.querySelector('#viewSeg [data-mode=telescopes]')?.click(), 1");
          let tp = null;
          for (let k = 0; k < 25; k++) {
            tp = await ev("(() => { const ps = [...document.querySelectorAll('.tele-p')]; return { n: ps.length, ok: ps.filter(p => p.classList.contains('has-img') || /isn.t answering/.test(p.textContent)).length }; })()");
            if (tp && tp.n === 3 && tp.ok === 3) break;
            await sleep(1000);
          }
          if (!tp || tp.n !== 3 || tp.ok !== 3) errs.push(`Telescopes did not fill its 3 panels (${JSON.stringify(tp)})`);
        }
      }
      // Judges' suggestion B: RW Aurigae's viewer -> "Make a light curve" -> points plotted (saved target, no network needed)
      if (/RW%20Aurigae&scene=viewer/.test(path) && !errs.length) {
        const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true }, s)).result?.result?.value;
        await ev("document.getElementById('lcMake')?.click(), 1");
        let lc = null;
        for (let k = 0; k < 20; k++) {
          lc = await ev("(() => { const d = document.getElementById('lcm'); return { open: !!d?.open, pts: d ? d.querySelectorAll('#lcmPlot .lcm-pt').length : 0, csv: !!d?.querySelector('#lcmCsv'), cav: !!d?.querySelector('#lcmCav')?.textContent, proof: d?.querySelector('#lcmSum .lcm-pc')?.dataset.match || '' }; })()");
          if (lc?.open && lc.pts > 0 && lc.proof === 'true') break;
          await sleep(1000);
        }
        if (!lc?.open || !(lc.pts > 0) || !lc.csv || !lc.cav) errs.push(`Make a light curve did not plot RW Aurigae (${JSON.stringify(lc)})`);
        else if (lc.proof !== 'true') errs.push(`Make a light curve did not open on Proof's numbers for RW Aurigae (no 'same as Proof ✓': ${JSON.stringify(lc)})`); // Judging panel round 8
      }
      if (path === '/measure.html') { // click the star's centre (the catalogue's spot) in both seasons: a speed of 8-13″/yr must appear
        const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true }, s)).result?.result?.value;
        const two = "(() => { if (document.body.dataset.measureReady !== 'true') return { ready: false };"
          + " for (const id of ['cvA', 'cvB']) { const c = document.getElementById(id), r = c.getBoundingClientRect(), x = +c.dataset.catX, y = +c.dataset.catY;"
          + " c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + (x + 0.5) * r.width / 15, clientY: r.top + (y + 0.5) * r.height / 15 })); }"
          + " const b = document.querySelector('#calc4 .ms-big'), res = document.getElementById('result');"
          + " return { ready: true, speed: b ? parseFloat(b.textContent) : null, result: !!res && !res.hidden && /fit/.test(res.textContent) }; })()";
        let m = {};
        for (let k = 0; k < 25; k++) { m = await ev(two) || {}; if (m.ready) break; await sleep(1000); }
        if (!m.ready) errs.push('Measure it yourself: the saved Barnard images did not load');
        else if (!(m.speed >= 8 && m.speed <= 13) || !m.result) errs.push(`Measure it yourself: two clicks on the star gave no sane speed (${JSON.stringify(m)})`);
      }
      if (path === '/' && !mode) { // open Help, then About: each must show its own content, never the other's
        const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true }, s)).result?.result?.value || {};
        await ev("document.getElementById('helpBtn').click()"); await sleep(500);
        const a = await ev(POPS);
        await ev("document.getElementById('aboutBtn').click()"); await sleep(500);
        const b = await ev(POPS);
        if (!(a.help && !a.about && a.helpTour && !a.helpTeam)) errs.push(`Help did not open as its own panel (${JSON.stringify(a)})`);
        if (!(b.about && !b.help && b.aboutTeam)) errs.push(`About did not open as its own panel (${JSON.stringify(b)})`);
      }
      if (path === '/?cta') {
        const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true }, s)).result?.result?.value;
        const clicked = await ev("(() => { const b = [...document.querySelectorAll('.story-go')].find(x => x.getClientRects().length); b?.click(); return !!b; })()");
        let v = '';
        for (let k = 0; k < 45 && clicked; k++) {
          v = await ev("document.getElementById('rpRes')?.textContent || ''") || '';
          if (/AGREES|DIFFERS|AT THE LIMIT|NOT MEASURABLE/.test(v)) break;
          await sleep(1000);
        }
        if (!clicked) errs.push('the first-screen story key was not on screen');
        else if (!/AGREES|DIFFERS|AT THE LIMIT|NOT MEASURABLE/.test(v)) errs.push(`the story key did not reach a verdict within 45 s ("${v.slice(0, 80)}")`);
      }
      if (path === '/?irsa-down') {
        const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, s)).result?.result?.value || {};
        let p = {};
        for (let k = 0; k < 15; k++) { p = await ev("(() => { const e = document.getElementById('irsaPill'); return { pill: !!e && !e.hidden && e.getClientRects().length > 0 }; })()"); if (p.pill) break; await sleep(1000); }
        if (!p.pill) errs.push('IRSA blocked: the status pill did not show');
        const n = await ev("(async () => { const q = document.getElementById('q'); q.value = 'Altair'; document.querySelector('form.search').requestSubmit(); await new Promise(r => setTimeout(r, 1200)); const e = document.getElementById('serr'); return { note: !e.hidden && e.classList.contains('calm'), chips: e.querySelectorAll('button[data-n]').length, saved: document.querySelectorAll('#openSaved button[data-n]').length }; })()");
        if (!n.note || n.chips < 5) errs.push(`IRSA blocked: no calm search note with the saved stars (${JSON.stringify(n)})`);
        if (n.saved < 5) errs.push(`the error screen lacks its saved-target chips (${n.saved})`);
      }
      if (path.startsWith('/spot.html?field=barnard&click=')) {
        const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true }, s)).result?.result?.value || {};
        const REP = "(() => { const b = document.getElementById('prepRep'), r = document.getElementById('report'), t = document.getElementById('sum')?.textContent || '';"
          + " if (b && r.hidden) b.click(); return { key: !!b, open: !r.hidden && r.getClientRects().length > 0, radec: /RA \\d\\dh \\d\\dm [\\d.]+s, Dec [+−]\\d\\d°/.test(t),"
          + " link: /spot\\.html\\?field=barnard&click=26\\d\\.\\d+,4\\.\\d+/.test(t), irsa: /irsa\\.ipac\\.caltech\\.edu\\/ibe\\/data\\/spherex\\//.test(t), json: !!document.getElementById('repJson') }; })()";
        let r = {};
        for (let k = 0; k < 25; k++) { r = await ev(REP); if (r.open && r.radec && r.link) break; await sleep(1000); }
        if (!r.key || !r.open || !r.radec || !r.link || !r.irsa || !r.json) errs.push(`Spot's "Prepare a report" did not give a report with RA/Dec, IRSA links and the share link (${JSON.stringify(r)})`);
      }
      if (path === '/photo.html?sample') { // a verified solve: centre near Orion's belt, and the SPHEREx key points there
        let d = {};
        for (let k = 0; k < 20; k++) {
          d = (await send('Runtime.evaluate', { expression: "(() => { const r = document.getElementById('result'), g = document.getElementById('goViewer'); return { s: r?.dataset.solved, t: document.getElementById('resTxt')?.textContent || '', go: !!g && !g.hidden && /ra=8[34][.][0-9]+&dec=[12][.]/.test(g.href) }; })()", returnByValue: true }, s)).result?.result?.value || {};
          if (d.s === 'true' || d.s === 'fail') break;
          await sleep(1000);
        }
        if (d.s !== 'true' || !d.go) errs.push(`Your photo: the test image did not solve (${JSON.stringify(d).slice(0, 160)})`);
      }
      if (path === '/index.html#about') { // the hash must survive the viewer's address rewrite and open About
        let d = {};
        for (let k = 0; k < 10; k++) {
          d = (await send('Runtime.evaluate', { expression: POPS, returnByValue: true }, s)).result?.result?.value || {};
          if (d.about) break;
          await sleep(1000);
        }
        if (!d.about || d.help) errs.push(`/index.html#about did not open About (${JSON.stringify(d)})`);
      }
      if (mode === 'fresh') {
        const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true }, s)).result?.result?.value || {};
        let a = {};
        for (let k = 0; k < 15; k++) { a = await ev(GATE); if (a.chip || a.tour || a.bar) break; await sleep(1000); }
        await sleep(2000); a = await ev(GATE); // nothing else may arrive later
        if (a.bar || a.tour || a.ask || !a.chip || !a.hero) errs.push(`fresh visit: only the hero card, its CTA and the tour chip may show (no consent bar, no tutorial) (${JSON.stringify(a)})`);
        // the visitor changes the image colours (userGesture: as a click in the options panel would): the inline ask shows
        const g = await send('Runtime.evaluate', { expression: "(() => { const A = window.StarShiftAccess, c = A?.get().img; A?.setImg(c === 'viridis' ? 'magma' : 'viridis'); return !!A; })()", returnByValue: true, userGesture: true }, s);
        await sleep(400);
        const b = await ev(GATE);
        if (!g.result?.result?.value || !b.ask || b.bar || b.tour) errs.push(`fresh visit: changing a colour must show only the inline consent ask (${JSON.stringify(b)})`);
      }
      if (mode === 'deep') {
        const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true }, s)).result?.result?.value || {};
        let d = {};
        for (let k = 0; k < 15; k++) { d = await ev(GATE); if (d.chip || d.tour) break; await sleep(1000); }
        if (!d.chip || d.tour || d.bar || d.ask) errs.push(`deep link: only the "Quick tour of this page" chip may show, never a tutorial or a consent bar (${JSON.stringify(d)})`);
      }
      handlers.splice(handlers.indexOf(h), 1);
      await send('Target.closeTarget', { targetId });
      rows.push({ page: mode ? `${path} (${mode})` : path, result: errs.length ? 'FAIL' : 'PASS', errors: errs.length, archiveBusy: soft.length, first: (errs[0] || soft[0] || '').slice(0, 120) });
    }
  } finally { try { ws?.close(); } catch { /* */ } chrome.kill(); await sleep(400); try { rmSync(dir, { recursive: true, force: true }); } catch { /* profile still locked */ } }
  console.table(rows);
  const bad = rows.filter(r => r.result === 'FAIL');
  console.log(bad.length ? `page check FAILED on ${bad.length} page(s) at ${base}` : `page check passed: ${rows.length} pages at ${base}, no page errors`);
  process.exit(bad.length ? 1 : 0);
}
run().catch(e => { console.error('page check could not run:', e.message); process.exit(2); });
