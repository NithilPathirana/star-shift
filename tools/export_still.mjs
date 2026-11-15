// One time-coloured still of Barnard's Star from the real SPHEREx images: the observing seasons
// stacked (as the viewer's Compare/Blink do), each stretched like the viewer (asinh, 2-99.7 %,
// erender.js), tinted copper -> ivory -> blue and laid on top of each other (screen blend), so a
// star that stays put turns white and a moving star leaves a copper-to-blue trail.
// Writes evidence/still_barnard_1200x630.png (social/thumbnail) and evidence/still_barnard_1080.png.
// The picture is real data, not AI-generated; credit "Data: NASA SPHEREx via IRSA". The Star Shift symbol
// (web/brand/favicon.svg: the small cut on its ivory tile, never recoloured) sits beside the "Star Shift"
// line with the small SI mark (Space Apps' word for AI), because the logo is SI-generated (DESIGN.md, thumbnail still).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Usage: (server running on 8787) node tools/export_still.mjs [--crop 13]
// Needs Microsoft Edge (or Chrome: set BROWSER=path) for the headless text layout and screenshot.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { run, buildStacks } from '../web/app/data.js';
import { DEFAULT_SETTINGS } from '../web/app/query.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const SETTINGS = { ...DEFAULT_SETTINGS, fov: 2.5, max: 120, band: 'all' }; // the viewer's flip-book defaults (ui.js)
const TABLES = JSON.parse(readFileSync(new URL('../web/core/data/spectral_wcs.json', import.meta.url), 'utf8'));
const OUT = fileURLToPath(new URL('../evidence/', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CROP = Math.max(5, +arg('--crop', 13) | 1); // odd number of 6.15″ pixels across
// Season colours, in time order: copper -> ivory -> blue (orange vs blue stays apart for
// red-green colour-blind viewers; ivory sits between them in lightness, not hue).
const SEASON_RGB = [[227, 150, 80], [255, 246, 232], [96, 150, 255]];
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LOGO = 'data:image/svg+xml;base64,' + readFileSync(new URL('../web/brand/favicon.svg', import.meta.url)).toString('base64');
const fmtD = d => `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

// The viewer's own stretch (web/app/erender.js is a browser script: run it in a small sandbox).
function loadRender() {
  const window = { matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(readFileSync(new URL('../web/app/erender.js', import.meta.url), 'utf8'), { window });
  return window.MockRender;
}

// Minimal PNG encoder (8-bit RGB).
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

async function frames() {
  const fs = []; let plan = null, failed = 0;
  await run({ type: 'name', name: "Barnard's Star" }, SETTINGS, { base: BASE, tables: TABLES, concurrency: 4, emit: e => {
    if (e.type === 'PLANNED') plan = e.plan; else if (e.type === 'FRAME') fs.push(e.frame); else if (e.type === 'FRAME_FAILED') failed++;
    else if (e.type === 'ERROR' || e.type === 'NOT_FOUND') console.log('  ' + e.message);
  } });
  if (!plan || !fs.length) throw new Error(`no images loaded; is the server running at ${BASE}?`);
  fs.sort((a, b) => a.mjd - b.mjd);
  return { fs, plan, failed };
}

// Composite: one RGB pixel per data pixel, cropped to CROP×CROP around the star's track.
function composite(stacks, R, n) {
  const S = stacks.map(s => R.stretch(Array.from(s.data, v => (Number.isFinite(v) ? v : null)), 'auto'));
  const a = stacks[0].expected, b = stacks[stacks.length - 1].expected;
  const cx = Math.round((a[0] + b[0]) / 2), cy = Math.round((a[1] + b[1]) / 2), h = (CROP - 1) / 2;
  const x0 = Math.max(0, Math.min(n - CROP, cx - h)), y0 = Math.max(0, Math.min(n - CROP, cy - h));
  const out = Buffer.alloc(CROP * CROP * 3);
  let masked = 0;
  for (let y = 0; y < CROP; y++) for (let x = 0; x < CROP; x++) {
    const k = (y0 + y) * n + (x0 + x);
    const rgb = [0, 0, 0].map((_, ch) => {
      let keep = 1; // screen blend: 1 - Π(1 - layer)
      S.forEach((s, i) => { const t = s[k] ?? 0; keep *= 1 - t * SEASON_RGB[i][ch] / 255; });
      return Math.round((1 - keep) * 255);
    });
    if (S.some(s => s[k] == null)) masked++;
    // pixels blank in every season (saturated core) stay the viewer's no-data colour, not black
    if (S.every(s => s[k] == null)) rgb.splice(0, 3, 0x10, 0x0d, 0x0b);
    rgb.forEach((v, ch) => { out[(y * CROP + x) * 3 + ch] = v; });
  }
  return { rgb: out, x0, y0, masked, track: stacks.map(s => [s.expected[0] - x0, s.expected[1] - y0]) };
}

function page({ w, h, img, seasons, square, move }) {
  const legend = seasons.map(s => `<li><i style="background:${s.c}"></i><span>${s.dates}</span><small>${s.n} images</small></li>`).join('');
  const imgPx = square ? 770 : 550, imgL = square ? (w - imgPx) / 2 : 40, imgT = square ? 40 : 40;
  const cell = imgPx / CROP;
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:#15110E;color:#EDE5DA;font-family:"Instrument Sans","Segoe UI",system-ui,sans-serif}
.im{position:absolute;left:${imgL}px;top:${imgT}px;width:${imgPx}px;height:${imgPx}px;image-rendering:pixelated;border-radius:6px}
.px{position:absolute;left:${imgL + 12}px;top:${imgT + imgPx - 26}px;display:flex;align-items:center;gap:8px;font:500 13px "IBM Plex Mono",Consolas,monospace;color:#EDE5DA;background:rgba(21,17,14,.78);padding:3px 8px;border-radius:999px}
.px b{display:block;width:${cell.toFixed(1)}px;height:2px;background:#EDE5DA}
.nx{position:absolute;right:${w - imgL - imgPx + 12}px;top:${imgT + 12}px;white-space:nowrap;font:500 13px "IBM Plex Mono",Consolas,monospace;color:#EDE5DA;background:rgba(21,17,14,.78);padding:3px 8px;border-radius:999px}
.tx{position:absolute;${square ? `left:${imgL}px;right:${imgL}px;top:${imgT + imgPx + 22}px` : `left:${imgL + imgPx + 44}px;right:44px;top:56px`}}
h1{font-size:${square ? 34 : 40}px;line-height:1.08;font-weight:700;letter-spacing:-.02em;color:#FFF6E8}
.lab{margin-top:${square ? 6 : 12}px;font:500 ${square ? 17 : 18}px "IBM Plex Mono",Consolas,monospace;color:#E3A86B}
p.lede{margin-top:14px;font-size:18px;line-height:1.4;color:#EDE5DA;max-width:40ch}
ul{list-style:none;margin-top:${square ? 12 : 22}px;display:${square ? 'flex' : 'grid'};gap:${square ? '10px 26px' : '10px'};flex-wrap:wrap}
li{display:flex;align-items:center;gap:10px;font:500 17px "IBM Plex Mono",Consolas,monospace}
li i{display:block;width:18px;height:18px;border-radius:4px}
li small{font-size:14px;color:#B5A898}
.cr{position:absolute;right:${square ? imgL : 44}px;bottom:${square ? 18 : 26}px;${square ? `left:${imgL}px;display:flex;justify-content:space-between;align-items:center;` : 'text-align:right;'}font:500 14px "IBM Plex Mono",Consolas,monospace;color:#B5A898;line-height:1.5}
.cr b{color:#EDE5DA;font-weight:500}
.br{display:inline-flex;align-items:center;gap:8px}
.br img{width:48px;height:48px;display:block}
.br em{font-style:normal;color:#EDE5DA}
.lg{display:block;${square ? 'flex-basis:100%;text-align:right;margin-top:8px;font-size:16px' : 'margin-top:6px;font-size:14px'};color:#B5A898}
.cr{${square ? 'flex-wrap:wrap' : ''}}
.ai{display:inline-block;font:600 12px/1.3 "IBM Plex Mono",Consolas,monospace;letter-spacing:.03em;color:#B5A898;border:1px solid currentColor;border-radius:4px;padding:0 3px}
</style></head><body>
<img class="im" src="data:image/png;base64,${img.toString('base64')}" alt="">
<div class="nx">N ↑ E ←</div>
<div class="px"><b></b>1 pixel = 6.15″</div>
<div class="tx">
<h1>Barnard's Star moves</h1>
<div class="lab">SPHEREx images, colours = observing season</div>
${square ? '' : `<p class="lede">The same ${(CROP * 6.15 / 60).toFixed(1)}′ patch of sky, each season's images stacked and tinted. Where the seasons overlap the light adds up to white; the copper edge (first season) and the blue edge (last) show the star moving ${move}.</p>`}
<ul>${legend}</ul>
</div>
<div class="cr"><span><b>Data: NASA SPHEREx via IRSA</b></span>${square ? '' : '<br>'}<span class="br"><img src="${LOGO}" alt=""><em>Star Shift</em><span class="ai" title="Logo: SI-generated (SI = Super Intelligence)">SI</span>· team Proper Motion · NASA Space Apps 2026</span><span class="lg">Logo: SI-generated</span></div>
</body></html>`;
}

function browser() {
  const c = [process.env.BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean);
  const b = c.find(p => existsSync(p)); if (!b) throw new Error('No Edge or Chrome found: set BROWSER=path/to/browser');
  return b;
}
function shoot(html, w, h, file) {
  const dir = mkdtempSync(join(tmpdir(), 'still-'));
  const src = join(dir, 'still.html'); writeFileSync(src, html);
  try {
    execFileSync(browser(), ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${join(dir, 'profile')}`, `--window-size=${w},${h}`, '--virtual-time-budget=6000', `--screenshot=${file}`, pathToFileURL(src).href], { stdio: 'pipe', timeout: 60000 });
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* the browser may still hold the profile */ } }
  const b = readFileSync(file); const pw = b.readUInt32BE(16), ph = b.readUInt32BE(20);
  if (pw !== w || ph !== h) throw new Error(`${file}: got ${pw}×${ph}, wanted ${w}×${h}`);
}

const R = loadRender();
console.log(`export_still: Barnard's Star via ${BASE}, crop ${CROP} px`);
const { fs, plan, failed } = await frames();
const stacks = buildStacks(fs);
if (stacks.length < 2) throw new Error('needs at least two seasons');
const use = stacks.slice(0, 3).length === 3 ? stacks.slice(0, 3) : stacks;
const C = composite(use, R, plan.grid.n);
const scale = 40; // upsample with whole pixels (the viewer's crisp scaling); the page scales it again with image-rendering: pixelated
const big = Buffer.alloc(CROP * scale * CROP * scale * 3);
for (let y = 0; y < CROP * scale; y++) for (let x = 0; x < CROP * scale; x++) C.rgb.copy(big, (y * CROP * scale + x) * 3, (((y / scale) | 0) * CROP + ((x / scale) | 0)) * 3, (((y / scale) | 0) * CROP + ((x / scale) | 0)) * 3 + 3);
const img = png(CROP * scale, CROP * scale, big);
const seasons = use.map((s, i) => ({ c: hex(SEASON_RGB[i]), n: s.count, dates: `${fmtD(s.startDate)} – ${fmtD(s.endDate)}` }));
// How far the star's catalogue position moved between the first and last season (grid: north up, east left).
const [ta, tb] = [C.track[0], C.track[C.track.length - 1]];
const de = -(tb[0] - ta[0]), dn = -(tb[1] - ta[1]), dpx = Math.hypot(de, dn);
const dir = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((Math.atan2(de, dn) * 180 / Math.PI + 360) % 360) / 45) % 8];
const yrs = (use[use.length - 1].mjd - use[0].mjd) / 365.25;
const move = `${dir}, about ${dpx.toFixed(1)} pixels (${(dpx * 6.15).toFixed(0)}″) in ${yrs < 1.15 && yrs > 0.85 ? 'a year' : yrs.toFixed(1) + ' years'}`;
mkdirSync(OUT, { recursive: true });
const files = [['still_barnard_1200x630.png', 1200, 630, false], ['still_barnard_1080.png', 1080, 1080, true]];
for (const [name, w, h, square] of files) { shoot(page({ w, h, img, seasons, square, move }), w, h, join(OUT, name)); console.log('wrote evidence/' + name); }
writeFileSync(join(OUT, 'still_barnard.json'), JSON.stringify({
  about: 'tools/export_still.mjs: Barnard\'s Star, SPHEREx season stacks overlaid in colour. AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.',
  generated: new Date().toISOString(), images: fs.length, failed, crop: { px: CROP, x0: C.x0, y0: C.y0, arcsec: +(CROP * 6.15).toFixed(1) }, stretch: "viewer 'auto' (asinh, 2-99.7 percentile), per season stack",
  seasons: seasons.map((s, i) => ({ colour: s.c, dates: s.dates, images: s.n, star: C.track[i].map(v => +v.toFixed(2)) })),
  star: 'catalogue position (SIMBAD proper motion) averaged over each season, in crop pixels (computed)', move,
  maskedPixelsInCrop: C.masked, credit: 'Data: NASA SPHEREx via IRSA',
}, null, 1));
console.log(`seasons: ${seasons.map(s => s.dates + ' (' + s.n + ')').join(' | ')}; star track (crop px): ${C.track.map(t => t.map(v => v.toFixed(2)).join(',')).join(' -> ')}`);
