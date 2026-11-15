// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Makes web/data/photo-test.png: a synthetic night-sky "photo" (Orion, 50 deg wide, tilted 20 deg) drawn
// from the app's Hipparcos stars, for the Your photo page's "Try a test image" key and the page check.
// Run: node tools/make_photo_fixture.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { prepareCatalogue } from '../web/app/photo/solve.js';
import { renderField } from '../web/app/photo/synth.js';

const cat = prepareCatalogue(JSON.parse(readFileSync(new URL('../web/app/data/stars.json', import.meta.url))));
const w = 720, h = 480;
const { img, centre } = renderField(cat, { ra: 83.8, dec: 2.0, up: 20, w, h, scale: 50 / w, magLimit: 5.8, noise: 1.2, bg: 10, sigma: 1.1, seed: 11 });

const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.from(type, 'ascii'), len = Buffer.alloc(4), c = Buffer.alloc(4);
  len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};
const raw = Buffer.alloc((w + 1) * h);
for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = Math.round(img[y * w + x]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; // 8-bit greyscale
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(new URL('../web/data/photo-test.png', import.meta.url), png);
console.log(`web/data/photo-test.png ${w}x${h}, ${png.length} bytes, centre RA ${centre.ra.toFixed(2)} Dec ${centre.dec.toFixed(2)}`);
