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

const base = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const PAGES = [
  ['/', 9000], ["/index.html?q=Barnard's%20Star&scene=viewer", 15000], ['/index.html?q=WISE%200855&scene=viewer', 12000],
  ['/proof.html', 5000], ['/spot.html', 6000], ['/archive.html?q=Barnard%27s%20Star', 6000], ['/spectral.html?q=Barnard%27s%20Star', 6000],
  ['/neo.html', 5000], ['/planetarium.html?q=Barnard%27s%20Star', 5000],
  // the other three demo targets' deep links (Master's freeze gate: all five presets must open in the viewer)
  ['/index.html?q=Epsilon%20Indi%20B&scene=viewer', 10000], ['/index.html?q=RW%20Aurigae&scene=viewer', 10000], ['/index.html?q=R%20Draconis&scene=viewer', 10000],
];
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
// archive / catalogue hosts and relay routes whose failures are "the archive is busy", not our bug
const ARCHIVE = /\/(SIA|TAP\/sync|ibe\/|gaia\/|jpl\/|hips\/)|simbad|irsa|gea\.esac|ssd-api|fonts\.g/i;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// hard limits so a stuck browser can never hold the commit gate (a hang held it 10 min, Sun 13:02)
const CDP_TIMEOUT_MS = 30000, TOTAL_TIMEOUT_MS = 6 * 60 * 1000;
let browserProc = null;
setTimeout(() => { console.error(`page check could not run: no result after ${TOTAL_TIMEOUT_MS / 60000} min (browser stuck)`); try { browserProc?.kill(); } catch { /* gone */ } process.exit(2); }, TOTAL_TIMEOUT_MS).unref();

async function run() {
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
    for (const [path, wait] of PAGES) {
      const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
      const { result: { sessionId: s } } = await send('Target.attachToTarget', { targetId, flatten: true });
      const errs = [], soft = [];
      const h = (d) => {
        if (d.sessionId !== s) return;
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
          // the preset may still be in its early Blink / second season when the counter first shows, so retry for up to 20 s
          const step = "(() => { const st = document.getElementById('stage'), k = document.getElementById('diffKey'), l = document.getElementById('diffLgd');"
            + " const d = { p: k?.getAttribute('aria-pressed'), lg: !!l && !l.hidden && l.getClientRects().length > 0 };"
            + " if (!st.classList.contains('mode-compare')) document.querySelector('#viewSeg [data-mode=compare]')?.click();"
            + " else if (d.p !== 'true' && k?.getClientRects().length) k.click(); return d; })()";
          let d = {};
          for (let k = 0; k < 20; k++) {
            d = (await send('Runtime.evaluate', { expression: step, returnByValue: true }, s)).result?.result?.value || {};
            if (d.p === 'true' && d.lg) break;
            await sleep(1000);
          }
          if (d.p !== 'true' || !d.lg) errs.push(`Compare > Difference did not switch on (aria-pressed=${d.p}, legend shown=${d.lg})`);
        }
      }
      handlers.splice(handlers.indexOf(h), 1);
      await send('Target.closeTarget', { targetId });
      rows.push({ page: path, result: errs.length ? 'FAIL' : 'PASS', errors: errs.length, archiveBusy: soft.length, first: (errs[0] || soft[0] || '').slice(0, 120) });
    }
  } finally { try { ws?.close(); } catch { /* */ } chrome.kill(); await sleep(400); try { rmSync(dir, { recursive: true, force: true }); } catch { /* profile still locked */ } }
  console.table(rows);
  const bad = rows.filter(r => r.result === 'FAIL');
  console.log(bad.length ? `page check FAILED on ${bad.length} page(s) at ${base}` : `page check passed: ${rows.length} pages at ${base}, no page errors`);
  process.exit(bad.length ? 1 : 0);
}
run().catch(e => { console.error('page check could not run:', e.message); process.exit(2); });
