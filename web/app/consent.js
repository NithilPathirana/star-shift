/* Consent for browser storage (spec design/spec-tutorials-consent.md). Star Shift sets no cookies and has no
   analytics or tracking; it only keeps settings in this browser's storage. Two kinds:
   - Necessary (always on): the consent choice, tutorial progress, Simple/Expert, text size and comfort options, the session's view.
   - Personalisation (optional): colour look, image and mark colours, IR band ranges, the notebook, the observer location.
   Before the visitor allows Personalisation, optional keys go to sessionStorage (this visit only) and are never written
   to localStorage. Withdrawing consent deletes them. One classic script, loaded first in <head>, so every page script's
   localStorage calls pass through the gate (Storage.prototype is wrapped for localStorage only).
   No bar on page load (Judging panel round 7): the first time the visitor changes something optional, onNeed fires and
   consent-ui.js shows a small inline "Remember this on this device?" prompt next to what they touched.
   AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026. */
(function (root) {
  'use strict';
  var CONSENT_KEY = 'star-shift-consent-v1', TUTORIAL_KEY = 'star-shift-tutorials-v1', VISIT = 'ss-visit:';
  var NECESSARY = [CONSENT_KEY, TUTORIAL_KEY, 'star-shift-tour-v1', 'star-shift-tour-progress', 'star-shift-expert-v1', 'starshift.archive.selected'];
  // keys that hold both kinds: these fields are personalisation, every other field is necessary (text size, motion, contrast...)
  var SPLIT = {
    'star-shift-access-v1': ['preset', 'look', 'p', 's', 't', 'img', 'imgHue', 'mark'],
    'tgi-clarity-v1': ['str', 'ramp', 'hatch', 'ring', 'sounds']
  };

  /** The gate over raw storage functions: L = { get, set, remove, keys } for localStorage, S the same for sessionStorage. */
  function createGate(L, S, now, onNeed) {
    now = now || function () { return new Date().toISOString(); };
    function record() { var r = null; try { r = JSON.parse(L.get(CONSENT_KEY) || 'null'); } catch (e) { r = null; } return r && typeof r === 'object' && typeof r.personal === 'boolean' ? r : null; }
    function personal() { var r = record(); return !!(r && r.personal); }
    function necessary(k) { return NECESSARY.indexOf(k) >= 0; }
    function strip(k, raw) { // the necessary fields of a split key's JSON, or null
      var o; try { o = JSON.parse(raw); } catch (e) { return null; }
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
      var out = {}, opt = SPLIT[k]; for (var f in o) if (opt.indexOf(f) < 0) out[f] = o[f];
      return JSON.stringify(out);
    }
    function get(k) {
      if (necessary(k) || personal()) return L.get(k);
      var v = S.get(VISIT + k);
      return v !== null && v !== undefined ? v : L.get(k);
    }
    // the optional part of a value (split keys: only their personalisation fields), to tell a real change from a re-save
    function optPart(k, raw) {
      if (raw === null || raw === undefined) return null;
      if (!SPLIT[k]) return String(raw);
      var o; try { o = JSON.parse(raw); } catch (e) { return String(raw); }
      if (!o || typeof o !== 'object' || Array.isArray(o)) return String(raw);
      var out = {}, n = 0; SPLIT[k].forEach(function (f) { if (f in o) { out[f] = o[f]; n++; } }); return n ? JSON.stringify(out) : null;
    }
    function set(k, v) {
      v = String(v);
      if (necessary(k) || personal()) { L.set(k, v); S.remove(VISIT + k); return; }
      if (onNeed && !record() && optPart(k, v) !== optPart(k, get(k))) { try { onNeed(k); } catch (e) { /* the ask is optional */ } }
      S.set(VISIT + k, v);                                  // this visit only
      if (SPLIT[k]) { var n = strip(k, v); if (n !== null) L.set(k, n); }   // the necessary part is kept
    }
    function remove(k) { L.remove(k); S.remove(VISIT + k); }
    // After Reject or a withdrawal no optional data stays in localStorage, but nothing is lost silently: each value is
    // first copied to sessionStorage, so the notebook and settings keep working until this tab closes. Returns the keys moved.
    function dropOptional() {
      var moved = [];
      L.keys().forEach(function (k) {
        if (necessary(k)) return;
        var v = L.get(k);
        if (S.get(VISIT + k) === null || S.get(VISIT + k) === undefined) S.set(VISIT + k, v);
        if (SPLIT[k]) { var n = strip(k, v); if (n !== null) { if (n !== v) moved.push(k); L.set(k, n); return; } }
        moved.push(k); L.remove(k);
      });
      return moved;
    }
    function choose(on) {
      var held = {};
      if (on) S.keys().forEach(function (k) { if (k.indexOf(VISIT) === 0) held[k.slice(VISIT.length)] = S.get(k); });
      L.set(CONSENT_KEY, JSON.stringify({ v: 1, personal: !!on, at: now() }));
      if (on) { for (var k in held) { L.set(k, held[k]); S.remove(VISIT + k); } return []; }   // this visit's choices are kept from now on
      return dropOptional();
    }
    // optional data that lives only in this tab now (cleared when it closes)
    function visitOnly() { return S.keys().filter(function (k) { return k.indexOf(VISIT) === 0; }).map(function (k) { return k.slice(VISIT.length); }); }
    return {
      get: get, set: set, remove: remove, record: record, personal: personal, necessary: necessary,
      decided: function () { return !!record(); },
      accept: function () { return choose(true); }, reject: function () { return choose(false); }, choose: choose, visitOnly: visitOnly,
      clearAll: function () { L.keys().forEach(function (k) { L.remove(k); }); S.keys().forEach(function (k) { S.remove(k); }); }
    };
  }

  var api = { CONSENT_KEY: CONSENT_KEY, TUTORIAL_KEY: TUTORIAL_KEY, NECESSARY: NECESSARY, SPLIT: SPLIT, VISIT: VISIT, createGate: createGate };
  root.StarShiftConsent = api;

  // in the browser: wrap localStorage's getItem / setItem / removeItem with the gate
  var P = root.Storage && root.Storage.prototype, ls, ss;
  try { ls = root.localStorage; ss = root.sessionStorage; } catch (e) { ls = ss = null; }
  if (!P || !ls || !ss || P.__ssConsent) return;
  var oGet = P.getItem, oSet = P.setItem, oRem = P.removeItem, oKey = P.key;
  function raw(st) {
    return {
      get: function (k) { return oGet.call(st, k); },
      set: function (k, v) { try { oSet.call(st, k, v); } catch (e) { /* full or blocked */ } },
      remove: function (k) { oRem.call(st, k); },
      keys: function () { var a = []; for (var i = 0; i < st.length; i++) a.push(oKey.call(st, i)); return a; }
    };
  }
  // only a change the visitor just made asks (a page saving its defaults on load never does)
  function need(k) {
    var ua = root.navigator && root.navigator.userActivation;
    if (ua && !ua.isActive) return;
    try { root.dispatchEvent(new CustomEvent('star-shift-consent-needed', { detail: { key: k } })); } catch (e) { /* old browser */ }
  }
  var gate = createGate(raw(ls), raw(ss), null, need);
  P.getItem = function (k) { return this === ls ? gate.get(String(k)) : oGet.call(this, k); };
  P.setItem = function (k, v) { if (this === ls) gate.set(String(k), v); else oSet.call(this, k, v); };
  P.removeItem = function (k) { if (this === ls) gate.remove(String(k)); else oRem.call(this, k); };
  P.__ssConsent = true;
  function tell() { try { root.dispatchEvent(new CustomEvent('star-shift-consent', { detail: { personal: gate.personal() } })); } catch (e) { /* old browser */ } }
  api.decided = gate.decided; api.personal = gate.personal; api.record = gate.record; api.visitOnly = gate.visitOnly;
  api.accept = function () { var m = gate.accept(); tell(); return m; };
  api.reject = function () { var m = gate.reject(); tell(); return m; };
  api.choose = function (on) { var m = gate.choose(on); tell(); return m; };
  api.clearAll = function () { gate.clearAll(); tell(); };
})(typeof globalThis !== 'undefined' ? globalThis : this);
