/* Astronaut loader (loader v1.1): a full-stage video loop of an astronaut riding a rocket, with honest text progress on top.
   Same calls as ScanLoader (set / add / slow / done / destroy), so the app can swap one for the other.
   The video is AI-generated (made by Claude in Blender) and carries a baked "Animation: SI-generated (made by Claude in Blender)" mark (Design Studio re-encode, Sun 11:13); this code is AI-written (Claude, Anthropic).
   Team Proper Motion, NASA Space Apps 2026. Needs astro-loader.css and the astronaut-* media files in the same folder. */
(function () {
  'use strict';
  var SELF = (document.currentScript && document.currentScript.src) || '';
  var BASE = SELF ? SELF.replace(/[^\/]*(\?.*)?$/, '') : '';
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  window.AstroLoader = function (root, opts) {
    var o = Object.assign({ target: 'this patch', total: 0, plan: null, bands: [], reducedMotion: false, startAfter: 8, base: BASE, onStart: null, onRetry: null }, opts || {});
    var got = [], dead = false, leaving = false, slowed = false, fallback = null, exitReady = false, timers = [], born = Date.now();
    var small = (window.matchMedia && matchMedia('(max-width: 900px), (max-height: 560px)').matches) || !!(navigator.connection && navigator.connection.saveData);
    var size = small ? '720' : '1080', still = o.base + 'astronaut-still-' + size + '.webp';
    function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }

    root.innerHTML = ''; root.classList.add('al'); root.classList.toggle('al-reduce', !!o.reducedMotion);
    var media = el('div', 'al-media'), shade = el('div', 'al-shade'), foot = el('div', 'al-foot');
    var pill = el('div', 'al-pill'), pillTxt = el('span'), retry = el('button', 'key', 'Retry now'); retry.type = 'button';
    var start = el('button', 'key primary al-start', 'Start watching'); start.type = 'button';
    var line = el('p', 'al-line'); line.setAttribute('aria-live', 'polite');
    var capt = el('p', 'al-capt', 'Animation: SI-generated (made by Claude in Blender) · Background: NASA SPHEREx all-sky map (IRSA)');
    var hair = el('i', 'al-hair'), hairFill = el('b'); hair.appendChild(hairFill);
    pill.hidden = true; start.hidden = true; pill.appendChild(pillTxt); pill.appendChild(retry);
    foot.appendChild(pill); foot.appendChild(start); foot.appendChild(line);
    root.appendChild(media); root.appendChild(shade); root.appendChild(foot); root.appendChild(capt); root.appendChild(hair);
    retry.onclick = function () { if (o.onRetry) o.onRetry(); };
    start.onclick = function () { if (o.onStart) o.onStart(); };

    /* media: the still is always there (poster, Reduce motion, and what shows if the video cannot play) */
    var img = el('img'); img.alt = ''; img.decoding = 'async'; img.src = still; media.appendChild(img);
    img.onerror = function () { useFallback(); };
    var loop = null, exit = null;
    function video(name, looped) {
      var v = el('video'); v.muted = true; v.playsInline = true; v.loop = looped; v.preload = 'auto'; v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1; v.disablePictureInPicture = true;
      [['webm', 'video/webm'], ['mp4', 'video/mp4']].forEach(function (s) { var e = el('source'); e.src = o.base + name + '-' + size + '.' + s[0]; e.type = s[1]; v.appendChild(e); });
      return v;
    }
    if (!o.reducedMotion) {
      loop = video('astronaut-loop', true); loop.className = 'al-loop';
      loop.addEventListener('playing', function () { loop.classList.add('al-on'); });
      media.appendChild(loop); play(loop);
      exit = video('astronaut-exit', false); exit.className = 'al-exit';
      exit.addEventListener('canplaythrough', function () { exitReady = true; });
      media.appendChild(exit);
    }
    function play(v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }   // autoplay refused: the still stays, which is fine

    /* if the media folder is missing altogether, hand over to the code-based scan loader when the page has it */
    function useFallback() {
      if (dead || fallback || !window.ScanLoader) return;
      root.innerHTML = ''; root.classList.remove('al', 'al-reduce');
      fallback = window.ScanLoader(root, Object.assign({}, o, { mode: 'scan' }));
      got.forEach(function (f) { fallback.add(f); }); if (slowed) fallback.slow(slowed);
    }
    function text() {
      var tot = o.total || (o.plan ? o.plan.length : 0);
      line.innerHTML = 'Finding images of ' + esc(o.target) + ' · <span><b>' + got.length + '</b>' + (tot ? ' of ' + tot : '') + ' loaded</span>';
      hairFill.style.transform = 'scaleX(' + (tot ? Math.min(1, got.length / tot) : 0) + ')';
      if (got.length >= o.startAfter && o.onStart && !leaving) start.hidden = false;
    }
    function fade() { root.classList.add('al-done'); }

    var api = {
      add: function (f) { if (dead) return; got.push(f); if (fallback) return fallback.add(f); text(); },
      set: function (p) { Object.assign(o, p || {}); if (fallback) return fallback.set(p); text(); },
      slow: function (msg) {
        slowed = msg || false; if (fallback) return fallback.slow(msg);
        pill.hidden = !msg; if (msg) pillTxt.textContent = msg;
        if (loop && !leaving) { if (msg) loop.pause(); else play(loop); }       // the picture holds still while the archive is slow
      },
      /* Leaves the loader. Returns how long the caller should wait (ms) before hiding and destroying it. */
      done: function () {
        if (fallback) { fallback.done(); return 400; }
        if (dead || leaving) return 0;
        leaving = true; root.classList.add('al-leaving');                       // text, pill and hairline fade out (150 ms)
        if (o.reducedMotion) { fade(); return 0; }
        // Play the exit clip only from the loop's seam: it is rendered to start from the loop's FIRST frame, so starting it
        // anywhere else was a jump cut about 7 loads in 8 (Design Studio, design/spec-loader-exit.md). Otherwise a plain fade.
        var rem = (loop && loop.duration && !loop.paused) ? loop.duration - loop.currentTime : Infinity;   // seconds until the loop is back at its first frame
        if (!exit || !exitReady || Date.now() - born < 4000 || rem > 0.7) { fade(); return 400; }           // not near the seam: plain fade, never a jump
        var started = false, ended = false, finish = function () { if (ended) return; ended = true; fade(); };
        var go = function () {
          if (started || dead) return; started = true;
          exit.style.transition = 'none';                                       // a cut, not a dissolve: the two frames are the same picture
          exit.classList.add('al-on'); exit.currentTime = 0; play(exit);
          exit.addEventListener('ended', finish); exit.addEventListener('error', finish);
          later(function () { if (exit.currentTime < 0.05) finish(); }, 400);   // clip did not start: plain fade instead
          later(finish, 1700);
        };
        var prev = loop.currentTime;
        (function tick() { if (started || dead) return; var tt = loop.currentTime; if (tt < prev) return go(); prev = tt; requestAnimationFrame(tick); })();   // the loop wrapped: now
        later(go, Math.round(rem * 1000) + 120);                                // safety, if frames are not being painted
        return Math.round(rem * 1000) + 1900;                                   // wait for the seam + 1.5 s clip + 400 ms fade
      },
      destroy: function () {
        dead = true; timers.forEach(clearTimeout);
        if (fallback) { fallback.destroy(); fallback = null; return; }
        [loop, exit].forEach(function (v) { if (v) { v.pause(); v.removeAttribute('src'); while (v.firstChild) v.removeChild(v.firstChild); v.load(); } });
        root.innerHTML = ''; root.classList.remove('al', 'al-done', 'al-reduce', 'al-leaving');
      }
    };
    text();
    return api;
  };
})();
