// Smoke test: run the core through a relay (local `wrangler dev` or deployed Worker).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Usage: node tools/relay_smoke.mjs http://127.0.0.1:8788
import { listImages, fetchCutout } from '../web/core/irsa.js';
import { gaiaCone } from '../web/core/resolve.js';
const base = process.argv[2] || 'http://127.0.0.1:8788';
const t0 = Date.now();
const imgs = await listImages(269.4461, 4.7707, { base, detectors: [1] });
console.log('TAP via relay:', imgs.length, 'D1 images', (Date.now() - t0) + 'ms');
const t1 = Date.now();
const res = await fetch(`${base}/${imgs[0].uri}?center=269.4461,4.7707d&size=0.05`);
const buf = new Uint8Array(await res.arrayBuffer());
console.log('cutout via relay:', res.status, buf.length, 'bytes, CORS =', res.headers.get('access-control-allow-origin'), (Date.now() - t1) + 'ms');
const c = await fetchCutout(imgs[1].uri, 269.4461, 4.7707, 0.05, { base });
console.log('decoded', c.image.nx + 'x' + c.image.ny, c.date, 'D' + c.detector);
const g = await gaiaCone(269.4461, 4.7707, 60, { endpoint: `${base}/gaia/tap/sync`, top: 3 });
console.log('Gaia via relay:', g.length, 'sources, brightest G =', g[0]?.g);
