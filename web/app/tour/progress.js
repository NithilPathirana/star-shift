// First-visit tutorials, one per tool (spec design/spec-tutorials-consent.md): which ones were finished or
// skipped, kept per tool in browser storage (necessary storage: it works whatever consent is chosen).
// Pure: no DOM, so tests/tutorials.test.mjs runs it in Node.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

export const TUTORIAL_KEY = 'star-shift-tutorials-v1';
const RANK = { skipped: 1, done: 2 };

/** { [chapterId]: 'done' | 'skipped' } (empty when nothing is stored or storage is blocked). */
export function readTutorials(storage) {
  let o = null; try { o = JSON.parse(storage?.getItem(TUTORIAL_KEY) || 'null'); } catch { o = null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const out = {}; for (const [k, v] of Object.entries(o)) if (RANK[v]) out[k] = v;
  return out;
}
/** Does this tool's tutorial still start by itself? (never once finished or skipped) */
export const needsTutorial = (storage, id) => !readTutorials(storage)[id];
/**
 * Record how a tutorial ended. Never goes backwards: 'done' stays 'done' when a replay is skipped,
 * so replaying from Tour never resets completion. Returns the stored status (or null when storage fails).
 */
export function markTutorial(storage, id, how) {
  if (!storage || !id || !RANK[how]) return null;
  const all = readTutorials(storage), cur = all[id];
  if (cur && RANK[cur] >= RANK[how]) return cur;
  all[id] = how;
  try { storage.setItem(TUTORIAL_KEY, JSON.stringify(all)); return how; } catch { return null; }
}
/** Settings → "Reset tutorial progress": every tutorial starts by itself again. */
export function resetTutorials(storage) {
  try { storage?.removeItem(TUTORIAL_KEY); return true; } catch { return false; }
}

/**
 * Did the visitor arrive on a deep link (a shared view)? Then no tutorial takes over the stage: only a small chip.
 * Any ?q=, ?ra=&dec=, scene=, mjd= or #hash counts, unless they came from another page of this site (the rail's links carry ?q=).
 */
export function isDeepLink(url = '', referrer = '') {
  let u; try { u = new URL(url, 'http://x/'); } catch { return false; }
  try { if (referrer && new URL(referrer).origin === u.origin) return false; } catch { /* bad referrer: treat as outside */ }
  const q = u.searchParams;
  return q.has('q') || q.has('scene') || q.has('mjd') || (q.has('ra') && q.has('dec')) || u.hash.length > 1;
}
