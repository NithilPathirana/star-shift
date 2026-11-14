// App state as a pure reducer (easy to test) plus a tiny store.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// status: 'idle'      first visit, nothing searched yet
//         'resolving' looking up a star name
//         'listing'   asking IRSA which SPHEREx images cover the spot
//         'loading'   downloading frames (playable as they arrive)
//         'ready'     all planned frames tried
//         'empty'     SPHEREx has no images of this spot (for the chosen band)
//         'error'     something failed; `error.retryable` says if Retry makes sense

import { DEFAULT_SETTINGS } from './query.js';

export const initialState = Object.freeze({
  status: 'idle',
  query: null,
  target: null,       // { name, ra, dec, pmra, pmdec, epoch, source }
  plan: null,         // { total, planned, firstDate, lastDate }
  frames: [],         // loaded frames, sorted by time
  failed: 0,
  retries: 0,
  error: null,        // { message, retryable }
  index: 0,           // current frame (or stack) shown
  playing: false,
  settings: DEFAULT_SETTINGS,
  requestId: 0,       // increases with each search; stale async results are ignored
});

function clampIndex(state, n) {
  return Math.min(Math.max(0, state.index), Math.max(0, n - 1));
}

export function reducer(state, a) {
  // Ignore results that belong to an older search.
  if (a.requestId != null && a.requestId !== state.requestId) return state;
  switch (a.type) {
    case 'SEARCH':
      return { ...initialState, settings: state.settings, query: a.query, status: a.query.type === 'name' ? 'resolving' : 'listing',
        requestId: state.requestId + 1, target: a.query.type === 'coords' ? { name: null, ra: a.query.ra, dec: a.query.dec, pmra: 0, pmdec: 0, epoch: 2000 } : null };
    case 'RESOLVED':
      return { ...state, status: 'listing', target: a.target };
    case 'PLANNED':
      if (a.plan.planned === 0) return { ...state, status: 'empty', plan: a.plan };
      return { ...state, status: 'loading', plan: a.plan };
    case 'FRAME': {
      const frames = [...state.frames, a.frame].sort((p, q) => p.mjd - q.mjd);
      // keep showing the same frame while new ones slot in before it
      const cur = state.frames[state.index];
      const index = cur ? frames.indexOf(cur) : 0;
      return { ...state, frames, index };
    }
    case 'FRAME_FAILED':
      return { ...state, failed: state.failed + 1 };
    case 'RETRY_WAIT':
      return { ...state, retries: state.retries + 1 };
    case 'DONE':
      if (!state.frames.length) {
        return { ...state, status: 'error', playing: false,
          error: { message: 'The image archive (IRSA) did not send any frames. It is often busy; try again in a minute.', retryable: true } };
      }
      return { ...state, status: 'ready' };
    case 'ERROR':
      return { ...state, status: 'error', playing: false, error: { message: a.message, retryable: a.retryable !== false } };
    case 'NOT_FOUND':
      return { ...state, status: 'error', playing: false, error: { message: a.message, retryable: false } };
    case 'SET_SETTING':
      return { ...state, settings: { ...state.settings, [a.key]: a.value } };
    case 'SET_INDEX':
      return { ...state, index: a.index };
    case 'STEP': {
      const n = a.count;
      if (!n) return state;
      return { ...state, index: ((state.index + a.delta) % n + n) % n };
    }
    case 'PLAY':
      return { ...state, playing: true };
    case 'PAUSE':
      return { ...state, playing: false };
    case 'RESET':
      return { ...initialState, settings: state.settings, requestId: state.requestId + 1 };
    default:
      return state;
  }
}

export function visibleCount(state, stacks) {
  return state.settings.view === 'stacks' ? (stacks?.length || 0) : state.frames.length;
}

export function clamp(state, n) { return { ...state, index: clampIndex(state, n) }; }

export function createStore(reduce = reducer, init = initialState) {
  let state = init;
  const subs = new Set();
  return {
    get: () => state,
    dispatch(action) {
      const next = reduce(state, action);
      if (next !== state) { const prev = state; state = next; subs.forEach(f => f(state, prev, action)); }
      return state;
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}
