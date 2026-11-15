/* Design Studio page audit: the same checks on every live page. Read-only: it measures, it changes nothing.
   AI-written (Claude). Load from a page with a <script src> and call window.__audit(). */
window.__audit = function () {
  var vw = innerWidth, vh = innerHeight, phone = vw < 700, out = {};
  function vis(e) { var r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && r.bottom > 0 && r.top < document.documentElement.scrollHeight; }
  function name(e) { return (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '')); }
  function label(e) { return (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || e.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 28); }
  out.size = vw + 'x' + vh; out.title = document.title;
  out.icon = !!document.querySelector('link[rel~=icon]');
  out.docW = document.documentElement.scrollWidth; out.overflowX = out.docW > vw;
  out.rail = [].map.call(document.querySelectorAll('nav.rail .nav-btn, nav.rail a'), function (a) { return a.innerText.trim() + (a.getAttribute('aria-current') ? '*' : ''); }).join(' · ');
  out.railShown = !!document.querySelector('nav.rail') && getComputedStyle(document.querySelector('nav.rail')).display !== 'none';
  out.keys = { pages: !!(document.querySelector('#pagesBtn') && vis(document.querySelector('#pagesBtn'))), clarity: !!(document.querySelector('#clarityBtn') && vis(document.querySelector('#clarityBtn'))), help: !!(document.querySelector('#helpBtn') && vis(document.querySelector('#helpBtn'))) };
  out.h1 = [].map.call(document.querySelectorAll('h1'), function (h) { return h.innerText.trim().slice(0, 40); });
  out.lang = document.documentElement.lang || null;
  out.leftover = /\[Tool name\]|Lorem|TODO|undefined|NaN/.test(document.body.innerText) ? (document.body.innerText.match(/.{0,30}(\[Tool name\]|Lorem|TODO|undefined|NaN).{0,30}/) || [''])[0] : null;
  // interactive targets
  var min = phone ? 44 : 24, small = [], noName = [];
  [].forEach.call(document.querySelectorAll('button, a[href], input, select, [role=button], [role=switch], [role=tab], summary'), function (e) {
    if (!vis(e)) return; var r = e.getBoundingClientRect();
    if (e.type === 'range' || e.type === 'hidden') return;
    if (Math.min(r.width, r.height) < min - 0.5) small.push(name(e) + ' "' + label(e) + '" ' + Math.round(r.width) + 'x' + Math.round(r.height));
    if (!label(e) && e.tagName !== 'INPUT') noName.push(name(e));
    if (e.tagName === 'INPUT' && !e.getAttribute('aria-label') && !e.labels.length && !e.getAttribute('aria-labelledby')) noName.push(name(e) + ' (input, no label)');
  });
  out.smallTargets = small.slice(0, 14); out.smallCount = small.length; out.noName = noName.slice(0, 8);
  out.imgNoAlt = [].filter.call(document.querySelectorAll('img'), function (i) { return vis(i) && !i.hasAttribute('alt'); }).length;
  // text: tiny type, clipped text, contrast
  function rgb(c) { var m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; var p = m[1].split(/[,\/ ]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  function lum(c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  function over(top, bot) { var a = top.a; return { r: top.r * a + bot.r * (1 - a), g: top.g * a + bot.g * (1 - a), b: top.b * a + bot.b * (1 - a), a: 1 }; }
  function bgOf(e) {
    var layers = [];
    for (var n = e; n && n.nodeType === 1; n = n.parentElement) {
      var s = getComputedStyle(n), c = rgb(s.backgroundColor), g = s.backgroundImage;
      if (g && g.indexOf('gradient') >= 0) { var gm = g.match(/rgba?\([^)]+\)/g); if (gm) { var gc = rgb(gm[Math.floor(gm.length / 2)]); if (gc && gc.a > 0.5) { layers.push({ r: gc.r, g: gc.g, b: gc.b, a: 1 }); break; } else if (gc) layers.push(gc); } }
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; }
    }
    var base = { r: 233, g: 226, b: 216, a: 1 };
    for (var i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  }
  var tiny = [], clipped = [], low = [], seen = {};
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), node;
  while ((node = walker.nextNode())) {
    var txt = node.nodeValue.trim(); if (txt.length < 2) continue;
    var e = node.parentElement; if (!e || !vis(e) || e.closest('[hidden], [aria-hidden=true], script, style, svg')) continue;
    var s = getComputedStyle(e), fs = parseFloat(s.fontSize), key = name(e) + '|' + txt.slice(0, 18);
    if (seen[key]) continue; seen[key] = 1;
    if (fs < 11) tiny.push(name(e) + ' "' + txt.slice(0, 22) + '" ' + fs + 'px');
    if ((s.overflow === 'hidden' || s.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 2) clipped.push(name(e) + ' "' + txt.slice(0, 26) + '"');
    var fg = rgb(s.color); if (!fg) continue; var bg = bgOf(e); fg = over(fg, bg);
    var L1 = lum(fg), L2 = lum(bg), cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    var big = fs >= 24 || (fs >= 18.66 && parseInt(s.fontWeight, 10) >= 700), need = big ? 3 : 4.5;
    if (cr < need) low.push({ cr: Math.round(cr * 100) / 100, t: name(e) + ' "' + txt.slice(0, 24) + '" ' + fs + 'px' });
  }
  low.sort(function (a, b) { return a.cr - b.cr; });
  out.tiny = tiny.slice(0, 8); out.clipped = clipped.slice(0, 8); out.lowContrast = low.slice(0, 10).map(function (x) { return x.cr + ' ' + x.t; }); out.lowCount = low.length;
  // things hanging off the right edge or under the fold in fixed layouts
  out.offRight = [].filter.call(document.querySelectorAll('body *'), function (e) { var r = e.getBoundingClientRect(); return vis(e) && r.right > vw + 2 && r.left < vw && getComputedStyle(e).position !== 'fixed' && !e.closest('[style*="overflow"], .tl, #track'); }).slice(0, 5).map(name);
  return out;
};
