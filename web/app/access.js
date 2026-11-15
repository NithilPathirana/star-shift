/* Colours and accessibility for Star Shift: three changeable colours (primary, secondary, tertiary), palettes made for the
   common kinds of colour blindness, and reading / seeing / touch options. One classic script, loaded in <head> before the
   page paints, so a saved palette is there from the first frame. Needs styles/access.css. Saved in this browser only.
   The colour you pick is kept as the hue; lightness is adjusted so text stays readable (WCAG contrast, checked in code).
   Fires a 'star-shift-colours' event on <html> after every colour change, for anything drawn on a canvas.
   AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026. Asked for by Nithil, Sun 15 Nov 2026. */
(function () {
  'use strict';
  var KEY = 'star-shift-access-v1', root = document.documentElement;
  var BRAND = { p: '#8A4719', s: '#46604A', t: '#A4452F' };           // the team's own Star Shift colours
  var PRESETS = [
    { id: 'star', name: 'Star Shift', note: 'The team’s copper, sage and coral', p: BRAND.p, s: BRAND.s, t: BRAND.t },
    // Graphite keys plus two hues on the axis each kind of colour blindness still sees (blue and orange; teal and crimson).
    // Simulated (Machado 2009): every pair of the three stays at least 17 apart (OKLab x100) for the eyes it is made for;
    // the team palette's "agrees" and "differs" are 3.8 apart under protanopia.
    { id: 'rg', name: 'Red-green safe', note: 'For protanopia and deuteranopia', p: '#2B2622', s: '#0072B2', t: '#D55E00' },
    { id: 'by', name: 'Blue-yellow safe', note: 'For tritanopia', p: '#2B2622', s: '#00707A', t: '#B3123E' },
    { id: 'mono', name: 'No colour', note: 'For achromatopsia: shade and marks only', p: '#2B2622', s: '#5B5148', t: '#111111' }
  ];
  var DEF = { preset: 'star', p: BRAND.p, s: BRAND.s, t: BRAND.t, leading: 'normal', spacing: 'normal', face: 'star',
    bold: false, soft: false, marks: false, links: false, shapes: false, focus: false, targets: false };
  var S = read();

  /* ---------- colour maths: sRGB <-> OKLCH, WCAG contrast ---------- */
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function gam(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  function hex2rgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); var n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgb2hex(r) { return '#' + r.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('').toUpperCase(); }
  function okHex(h) { return /^#?[0-9a-f]{6}$/i.test(String(h)); }
  function rgb2lch(rgb) {
    var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
      s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    var L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [L, Math.sqrt(a * a + bb * bb), Math.atan2(bb, a)];
  }
  function lch2lin(L, C, h) {
    var a = C * Math.cos(h), b = C * Math.sin(h);
    var l = L + 0.3963377774 * a + 0.2158037573 * b, m = L - 0.1055613458 * a - 0.0638541728 * b, s = L - 0.0894841775 * a - 1.291485548 * b;
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  }
  function lch2rgb(L, C, h) { // chroma is pulled in until the colour fits sRGB, so the hue never shifts
    for (var i = 0; i < 48; i++) {
      var q = lch2lin(L, C, h);
      if (q[0] >= -1e-4 && q[0] <= 1.0001 && q[1] >= -1e-4 && q[1] <= 1.0001 && q[2] >= -1e-4 && q[2] <= 1.0001) return q.map(function (v) { return 255 * gam(Math.max(0, Math.min(1, v))); });
      C *= 0.93;
    }
    var g = 255 * gam(Math.max(0, Math.min(1, L * L * L))); return [g, g, g];
  }
  function lum(rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  var SHELL = hex2rgb('#E9E2D8'), SOFT = hex2rgb('#DCD4C8'), CREAM = hex2rgb('#FFF8F0'), STAGE = hex2rgb('#15110E');
  /** One picked colour -> the family the interface needs. Lightness moves until each use meets its contrast target. */
  function family(hex, soft) {
    var c = rgb2lch(hex2rgb(hex)), C = c[1], h = c[2], bg = soft ? SOFT : SHELL;
    function tone(L, cmax, against, target, step) {
      var rgb = lch2rgb(L, Math.min(C, cmax), h);
      for (var i = 0; i < 70 && contrast(rgb, against) < target; i++) { L += step; if (L < 0.08 || L > 0.97) break; rgb = lch2rgb(L, Math.min(C, cmax), h); }
      return rgb;
    }
    var mid = lch2rgb(0.62, Math.min(C, 0.11), h);
    return {
      // a pick that is already dark is kept as dark as it was picked (only lighter picks are pulled down)
      ink: rgb2hex(tone(Math.min(c[0], 0.52), 0.16, bg, 5.2, -0.01)),          // text and icons on the light shell: at least 5.2:1
      deep: rgb2hex(tone(Math.min(c[0] - 0.05, 0.44), 0.14, bg, 7.2, -0.01)),  // small bold text on its own tint: at least 7.2:1
      fill: rgb2hex(tone(Math.min(c[0] + 0.09, 0.6), 0.17, CREAM, 4.6, -0.01)),// key fill under cream text: at least 4.6:1 (a little lighter than the ink, for the key's gradient)
      deco: rgb2hex(lch2rgb(0.68, Math.min(C, 0.13), h)),  // decoration only, never text
      glow: rgb2hex(tone(0.78, 0.12, STAGE, 8, 0.01)),     // on the dark stage: at least 8:1
      tint: 'rgba(' + mid.map(Math.round).join(',') + ',.17)',
      asked: rgb2hex(hex2rgb(hex))
    };
  }

  /* ---------- state ---------- */
  function read() {
    var o = {}; try { o = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { o = {}; }
    var out = {}; for (var k in DEF) out[k] = (typeof o[k] === typeof DEF[k]) ? o[k] : DEF[k];
    ['p', 's', 't'].forEach(function (k) { if (!okHex(out[k])) out[k] = DEF[k]; });
    return out;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private window: the choice lasts for this page only */ } }

  var VARS = ['--copper', '--copper-ink', '--copper-key', '--copper-deco', '--focus', '--ring', '--ax-p-tint', '--color-accent', '--color-focus',
    '--sage', '--sage-ink', '--sage-tint', '--cross', '--coral', '--color-danger', '--ax-t-glow', '--ax-t-tint'];
  function setVar(n, v) { root.style.setProperty(n, v); }
  function apply() {
    var custom = !(S.p === BRAND.p && S.s === BRAND.s && S.t === BRAND.t);
    VARS.forEach(function (n) { root.style.removeProperty(n); });
    if (custom) {
      var P = family(S.p, S.soft), Q = family(S.s, S.soft), T = family(S.t, S.soft);
      if (S.p !== BRAND.p) { setVar('--copper', P.ink); setVar('--copper-ink', P.deep); setVar('--copper-key', P.fill); setVar('--copper-deco', P.deco); setVar('--focus', P.ink); setVar('--ring', P.glow); setVar('--ax-p-tint', P.tint); setVar('--color-accent', P.deep); setVar('--color-focus', P.ink); }
      if (S.s !== BRAND.s) { setVar('--sage', Q.ink); setVar('--sage-ink', Q.deep); setVar('--sage-tint', Q.tint); setVar('--cross', Q.glow); }
      if (S.t !== BRAND.t) { setVar('--coral', T.ink); setVar('--color-danger', T.ink); setVar('--ax-t-glow', T.glow); setVar('--ax-t-tint', T.tint); }
    }
    root.dataset.axColors = custom ? S.preset : 'off';
    root.dataset.axLeading = S.leading; root.dataset.axSpacing = S.spacing; root.dataset.axFace = S.face;
    ['bold', 'soft', 'marks', 'links', 'shapes', 'focus', 'targets'].forEach(function (k) { root.dataset['ax' + k[0].toUpperCase() + k.slice(1)] = S[k] ? 'on' : 'off'; });
    try { root.dispatchEvent(new CustomEvent('star-shift-colours', { detail: { primary: S.p, secondary: S.s, tertiary: S.t, preset: S.preset } })); } catch (e) { /* old browser */ }
  }
  apply();                                     // before first paint
  window.StarShiftAccess = { family: family, contrast: contrast, hex2rgb: hex2rgb, get: function () { return JSON.parse(JSON.stringify(S)); }, presets: PRESETS };

  /* ---------- the panel ---------- */
  var panel = null, opener = null;
  var ICON_X = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>';
  var ICON_PAL = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="8" r="4.2"/><circle cx="13" cy="8" r="4.2"/><circle cx="10" cy="13" r="4.2"/></svg>';
  // Machado, Oliveira and Fernandes (2009), full severity, applied in linear RGB
  var SIM = [
    { id: 'none', name: 'Typical colour vision', m: null },
    { id: 'prot', name: 'Red-blind (protanopia)', m: '0.152286 1.052583 -0.204868 0 0  0.114503 0.786281 0.099216 0 0  -0.003882 -0.048116 1.051998 0 0  0 0 0 1 0' },
    { id: 'deut', name: 'Green-blind (deuteranopia)', m: '0.367322 0.860646 -0.227968 0 0  0.280085 0.672501 0.047413 0 0  -0.011820 0.042940 0.968881 0 0  0 0 0 1 0' },
    { id: 'trit', name: 'Blue-blind (tritanopia)', m: '1.255528 -0.076749 -0.178779 0 0  -0.078411 0.930809 0.147602 0 0  0.004733 0.691367 0.303900 0 0  0 0 0 1 0' },
    { id: 'achr', name: 'No colour (achromatopsia)', m: '0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0' }
  ];
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sw(k, label, hint) {
    return '<div class="ax-row"><span class="ax-l">' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span>' +
      '<button type="button" class="switch well" role="switch" data-ax="' + k + '" aria-checked="false" aria-label="' + esc(label) + '"><i></i></button></div>';
  }
  function seg(k, label, opts, hint) {
    return '<div class="ax-row ax-stack"><span class="ax-l" id="axl-' + k + '">' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span>' +
      '<div class="ax-seg well" role="group" aria-labelledby="axl-' + k + '">' + opts.map(function (o) {
        return '<button type="button" data-ax-seg="' + k + '" data-v="' + o[0] + '" aria-pressed="false">' + o[1] + '</button>'; }).join('') + '</div></div>';
  }
  function specimen() {
    return '<span class="ax-sp-key">Play</span><span class="ax-sp-tag ax-sp-ok">Agrees</span><span class="ax-sp-tag ax-sp-no">Differs</span>' +
      '<span class="ax-sp-stage"><i class="ax-sp-ring"></i><i class="ax-sp-cross"></i></span>';
  }
  function build() {
    var d = document.createElement('dialog');
    d.className = 'ax'; d.id = 'axPanel'; d.setAttribute('aria-labelledby', 'axTitle');
    d.innerHTML =
      '<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>' + SIM.filter(function (s) { return s.m; }).map(function (s) {
        return '<filter id="ax-f-' + s.id + '" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="' + s.m + '"/></filter>'; }).join('') + '</defs></svg>' +
      '<header class="ax-head"><h2 id="axTitle">Colours and accessibility</h2><button type="button" class="key icon ax-x" aria-label="Close">' + ICON_X + '</button></header>' +
      '<div class="ax-body">' +
      '<section aria-labelledby="axh-c"><h3 id="axh-c">Colours</h3>' +
      '<p class="ax-p">Choose a palette made for your eyes, or set your own three colours. The page behind changes as you go.</p>' +
      '<div class="ax-presets" role="radiogroup" aria-label="Palette">' + PRESETS.map(function (p) {
        return '<button type="button" class="ax-preset" role="radio" aria-checked="false" data-preset="' + p.id + '"><span class="ax-dots" aria-hidden="true"><i style="background:' + p.p + '"></i><i style="background:' + p.s + '"></i><i style="background:' + p.t + '"></i></span>' +
          '<span class="ax-pn">' + p.name + '<small>' + p.note + '</small></span></button>'; }).join('') + '</div>' +
      '<div class="ax-picks">' + [['p', 'Primary', 'Keys, links and the ring'], ['s', 'Secondary', 'Observed values and “agrees”'], ['t', 'Tertiary', 'Warnings and “differs”']].map(function (r) {
        return '<label class="ax-pick"><input type="color" data-ax-col="' + r[0] + '" aria-describedby="axn-' + r[0] + '"><span class="ax-l">' + r[1] + '<small>' + r[2] + '</small></span><output class="ax-hex num" id="axn-' + r[0] + '"></output></label>'; }).join('') + '</div>' +
      '<p class="ax-note" id="axAdj" hidden></p>' +
      '<figure class="ax-spec" aria-labelledby="axh-s"><figcaption id="axh-s">How these three colours look to different eyes</figcaption>' + SIM.map(function (s) {
        return '<div class="ax-sp-row"><span class="ax-sp-name">' + s.name + '</span><span class="ax-sp-set"' + (s.m ? ' style="filter:url(#ax-f-' + s.id + ')"' : '') + ' aria-hidden="true">' + specimen() + '</span></div>'; }).join('') +
      '<p class="ax-fine">A simulation (Machado et al. 2009), not a medical test.</p></figure>' +
      sw('marks', 'Marks, not colour alone', 'A tick, cross or dash on every verdict and tag') +
      '</section>' +
      '<section aria-labelledby="axh-t"><h3 id="axh-t">Text</h3>' +
      sw('c:text', 'Larger text', 'Everything 15% bigger. For more, use your browser’s zoom, which this layout follows') +
      seg('face', 'Typeface', [['star', 'Star Shift'], ['system', 'System'], ['wide', 'Wide']], 'Wide sets the reading text in broader letters that are easier to tell apart') +
      sw('leading', 'Roomy lines', 'More space between lines of text') +
      sw('spacing', 'Wider letters and words') +
      sw('bold', 'Bolder text') +
      '</section>' +
      '<section aria-labelledby="axh-v"><h3 id="axh-v">Seeing</h3>' +
      sw('c:contrast', 'Increase contrast', 'Darker text and edges') +
      sw('c:glass', 'Reduce transparency', 'Glass becomes solid') +
      sw('soft', 'Softer light', 'A dimmer shell for bright rooms or sore eyes') +
      sw('links', 'Underline links') +
      sw('shapes', 'Outline every key') +
      sw('focus', 'Stronger focus ring', 'A thicker outline around what the keyboard is on') +
      '</section>' +
      '<section aria-labelledby="axh-m"><h3 id="axh-m">Motion, touch and sound</h3>' +
      sw('c:motion', 'Reduce motion', 'No springs, glare or number ticking') +
      sw('targets', 'Larger keys', 'Every key at least 44 pixels tall') +
      sw('c:sounds', 'Sounds', 'Quiet clicks and ticks') +
      '</section>' +
      '</div>' +
      '<footer class="ax-foot"><p>Saved on this device only.</p><button type="button" class="key" id="axReset">Reset all</button><button type="button" class="key primary" id="axDone">Done</button></footer>';
    document.body.appendChild(d);
    d.addEventListener('click', onClick);
    d.addEventListener('input', onColour);
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      var r = e.target.closest && e.target.closest('.ax-preset');           // arrow keys move between palettes
      if (r && /^Arrow/.test(e.key)) { e.preventDefault(); var all = [].slice.call(d.querySelectorAll('.ax-preset')), i = all.indexOf(r) + (/Right|Down/.test(e.key) ? 1 : -1); var n = all[(i + all.length) % all.length]; n.focus(); n.click(); }
    });
    return d;
  }
  /* The four comfort switches the app already has (Clarity) stay the single source: ours press theirs. */
  function theirs(name) { return document.querySelector('#clarity [data-set="' + name + '"]'); }
  function theirOn(name) { var b = theirs(name); return !!b && b.getAttribute('aria-checked') === 'true'; }
  function setTheirs(name, on) { var b = theirs(name); if (b && theirOn(name) !== on) b.click(); }

  function sync() {
    if (!panel) return;
    [].forEach.call(panel.querySelectorAll('[data-ax]'), function (b) {
      var k = b.dataset.ax, on = k.slice(0, 2) === 'c:' ? theirOn(k.slice(2)) : (k === 'leading' ? S.leading === 'roomy' : k === 'spacing' ? S.spacing === 'wide' : !!S[k]);
      b.setAttribute('aria-checked', String(on));
      if (k.slice(0, 2) === 'c:' && !theirs(k.slice(2))) b.closest('.ax-row').hidden = true;
    });
    [].forEach.call(panel.querySelectorAll('[data-ax-seg]'), function (b) {
      var k = b.dataset.axSeg, cur = S[k]; b.setAttribute('aria-pressed', String(b.dataset.v === cur));
    });
    [].forEach.call(panel.querySelectorAll('.ax-preset'), function (b) { var on = b.dataset.preset === S.preset; b.setAttribute('aria-checked', String(on)); b.tabIndex = on || (S.preset === 'custom' && b.dataset.preset === 'star') ? 0 : -1; });
    var adj = [];
    ['p', 's', 't'].forEach(function (k) {
      var inp = panel.querySelector('[data-ax-col="' + k + '"]'), brand = S[k] === BRAND[k];
      inp.value = S[k].toLowerCase(); panel.querySelector('#axn-' + k).textContent = S[k].toUpperCase();
      if (!brand && contrast(hex2rgb(S[k]), S.soft ? SOFT : SHELL) < 5.2) adj.push({ p: 'Primary', s: 'Secondary', t: 'Tertiary' }[k]);
    });
    var note = panel.querySelector('#axAdj'); note.hidden = !adj.length;
    note.textContent = adj.length ? adj.join(' and ') + (adj.length > 1 ? ' are' : ' is') + ' darkened a little where ' + (adj.length > 1 ? 'they are' : 'it is') + ' used as text, so the words stay readable. Keys and the dark image keep the shade you picked.' : '';
  }
  function onClick(e) {
    var b = e.target.closest('button'); if (!b || !panel.contains(b)) return;
    if (b.classList.contains('ax-x') || b.id === 'axDone') { close(); return; }
    if (b.id === 'axReset') {
      for (var k in DEF) S[k] = DEF[k];
      ['motion', 'glass', 'contrast', 'text'].forEach(function (n) { setTheirs(n, false); });
    } else if (b.dataset.preset) {
      var p = PRESETS.filter(function (x) { return x.id === b.dataset.preset; })[0]; S.preset = p.id; S.p = p.p; S.s = p.s; S.t = p.t;
      if (p.id === 'mono') S.marks = true;                       // with no colour, the marks carry the meaning
    } else if (b.dataset.ax) {
      var key = b.dataset.ax, on = b.getAttribute('aria-checked') !== 'true';
      if (key.slice(0, 2) === 'c:') setTheirs(key.slice(2), on);
      else if (key === 'leading') S.leading = on ? 'roomy' : 'normal';
      else if (key === 'spacing') S.spacing = on ? 'wide' : 'normal';
      else S[key] = on;
    } else if (b.dataset.axSeg) {
      var v = b.dataset.v;
      S[b.dataset.axSeg] = v;
    } else return;
    save(); apply(); sync();
  }
  function onColour(e) {
    var k = e.target.dataset && e.target.dataset.axCol; if (!k || !okHex(e.target.value)) return;
    S[k] = e.target.value.toUpperCase();
    var hit = PRESETS.filter(function (x) { return x.p === S.p && x.s === S.s && x.t === S.t; })[0]; S.preset = hit ? hit.id : 'custom';
    save(); apply(); sync();
  }
  function open(from) {
    if (!panel) panel = build();
    opener = from || document.activeElement;
    var cb = document.getElementById('clarityBtn'), pop = document.getElementById('clarity');
    if (cb && pop && !pop.hidden) cb.click();                    // one options surface at a time
    sync(); panel.show();                                        // not modal: the page stays in view and recolours live
    void panel.offsetWidth; panel.classList.add('in');           // reflow, then the class: the slide-in runs without waiting for a frame callback
    var f = panel.querySelector('.ax-preset[tabindex="0"]') || panel.querySelector('.ax-x'); if (f) f.focus({ preventScroll: true });
  }
  function close() {
    if (!panel || !panel.open) return;
    panel.classList.remove('in');
    var done = function () { if (panel.open) panel.close(); if (opener && opener.focus && document.contains(opener)) opener.focus(); };
    root.dataset.motion === 'reduce' ? done() : setTimeout(done, 180);
  }
  window.StarShiftAccess.open = open;

  function hook() {
    var pop = document.getElementById('clarity'); if (!pop || pop.querySelector('.ax-open')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'key ax-open'; b.innerHTML = ICON_PAL + '<span>Colours and accessibility</span>';
    b.setAttribute('aria-haspopup', 'dialog');
    b.onclick = function (e) { e.stopPropagation(); open(document.getElementById('clarityBtn') || b); };
    var foot = pop.querySelector('.foot'); foot ? pop.insertBefore(b, foot) : pop.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
  addEventListener('storage', function (e) { if (e.key === KEY) { S = read(); apply(); sync(); } });   // another tab changed it
})();
