// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026

const STORAGE_KEY = 'star-shift-lab-notebooks-v1';

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function defaultId() {
  try { return crypto.randomUUID(); } catch { return `nb-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function blankTemplate() {
  return { observation: '', question: '', hypothesis: '', prediction: '', test: '', result: '', conclusion: '' };
}

function notebookRecord(name, id, timestamp) {
  return { id, name, createdAt: timestamp, updatedAt: timestamp, entries: [], notes: '', template: blankTemplate() };
}

export function createNotebookStore({ storage = safeStorage(), key = STORAGE_KEY, now = () => new Date().toISOString(), id = defaultId } = {}) {
  let state;
  try {
    const parsed = JSON.parse(storage?.getItem(key) || 'null');
    if (parsed?.version === 1 && Array.isArray(parsed.notebooks) && parsed.notebooks.length) state = parsed;
  } catch { /* Blocked or malformed storage falls back to memory. */ }
  if (!state) {
    const first = notebookRecord('Lab notebook 1', id(), now());
    state = { version: 1, activeId: first.id, notebooks: [first] };
  }

  function persist() {
    try { storage?.setItem(key, JSON.stringify(state)); } catch { /* Keep the authoritative in-memory copy. */ }
  }

  function currentRecord() {
    return state.notebooks.find(item => item.id === state.activeId) || state.notebooks[0];
  }

  function touch(notebook) {
    notebook.updatedAt = now();
    persist();
    return copy(notebook);
  }

  return {
    snapshot: () => copy(state),
    current: () => copy(currentRecord()),
    select(notebookId) {
      if (!state.notebooks.some(item => item.id === notebookId)) return null;
      state.activeId = notebookId;
      persist();
      return copy(currentRecord());
    },
    create(name = `Lab notebook ${state.notebooks.length + 1}`) {
      const item = notebookRecord(String(name).trim() || `Lab notebook ${state.notebooks.length + 1}`, id(), now());
      state.notebooks.push(item);
      state.activeId = item.id;
      persist();
      return copy(item);
    },
    rename(notebookId, name) {
      const item = state.notebooks.find(candidate => candidate.id === notebookId);
      const clean = String(name || '').trim();
      if (!item || !clean) return null;
      item.name = clean;
      return touch(item);
    },
    delete(notebookId) {
      const index = state.notebooks.findIndex(item => item.id === notebookId);
      if (index < 0) return false;
      state.notebooks.splice(index, 1);
      if (!state.notebooks.length) state.notebooks.push(notebookRecord('Lab notebook 1', id(), now()));
      if (!state.notebooks.some(item => item.id === state.activeId)) state.activeId = state.notebooks[Math.min(index, state.notebooks.length - 1)].id;
      persist();
      return true;
    },
    addEntry(input) {
      const item = currentRecord();
      const entry = {
        id: id(),
        capturedAt: now(),
        label: String(input?.label || 'Captured value'),
        value: input?.value ?? '',
        unit: String(input?.unit || ''),
        uncertainty: input?.uncertainty ?? '',
        source: String(input?.source || 'Unspecified source'),
        tag: String(input?.tag || ''),
        context: {
          page: String(input?.context?.page || ''), ra: input?.context?.ra ?? '', dec: input?.context?.dec ?? '',
          date: String(input?.context?.date || ''), frameId: String(input?.context?.frameId || ''),
          url: String(input?.context?.url || ''),
        },
      };
      item.entries.push(entry);
      touch(item);
      return copy(entry);
    },
    updateNotes(notes) {
      const item = currentRecord();
      item.notes = String(notes || '');
      return touch(item);
    },
    updateTemplate(field, value) {
      const item = currentRecord();
      if (!(field in item.template)) return null;
      item.template[field] = String(value || '');
      return touch(item);
    },
    attachEntry(field, entryId) {
      const item = currentRecord();
      const entry = item.entries.find(candidate => candidate.id === entryId);
      if (!entry || !(field in item.template)) return null;
      const value = `${entry.label}: ${entry.value}${entry.unit ? ` ${entry.unit}` : ''}${entry.uncertainty !== '' ? ` ± ${entry.uncertainty}${entry.unit ? ` ${entry.unit}` : ''}` : ''}`;
      item.template[field] = [item.template[field], value].filter(Boolean).join('\n');
      return touch(item);
    },
  };
}

export { STORAGE_KEY, blankTemplate };
