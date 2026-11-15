// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import { createNotebookStore } from './store.js';
import { notebookToMarkdown } from './export.js';
import { TEMPLATE_FIELDS } from './template.js';

const store = createNotebookStore();
let dialog = null;
let toastTimer = null;

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showToast(message = 'Added to lab notebook') {
  let toast = document.getElementById('notebook-toast');
  if (!toast) {
    toast = element('div', 'notebook-toast', message);
    toast.id = 'notebook-toast';
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.dataset.visible = 'false'; }, 1800);
}

function attach(entryId, field) {
  store.attachEntry(field, entryId);
  render();
  showToast('Attached to hypothesis template');
}

function renderEntries(notebook) {
  const list = dialog.querySelector('.notebook-entries');
  list.replaceChildren();
  if (!notebook.entries.length) list.append(element('p', 'notebook-empty', 'Capture values with a + button anywhere in Star Shift.'));
  for (const entry of notebook.entries) {
    const card = element('article', 'notebook-entry');
    card.draggable = true;
    card.dataset.entryId = entry.id;
    card.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', entry.id));
    const heading = element('div', 'notebook-entry-head');
    const tag = element('span', 'notebook-source-tag', entry.tag || entry.source);
    tag.dataset.tag = String(entry.tag || '').toUpperCase(); // OBSERVED gets the sage tag colour
    heading.append(element('strong', '', entry.label), tag);
    const value = element('p', 'notebook-entry-value', `${entry.value}${entry.unit ? ` ${entry.unit}` : ''}${entry.uncertainty !== '' ? ` ± ${entry.uncertainty}${entry.unit ? ` ${entry.unit}` : ''}` : ''}`);
    if (value.textContent.length > 60) value.dataset.long = ''; // a sentence, not a number
    const meta = element('p', 'notebook-entry-meta', entry.source);
    if (entry.context?.url) {
      const link = element('a', '', 'Back to exact view');
      link.href = entry.context.url;
      meta.append(' · ', link);
    }
    const controls = element('div', 'notebook-attach');
    const select = element('select');
    select.setAttribute('aria-label', `Template field for ${entry.label}`);
    TEMPLATE_FIELDS.forEach(([key, label]) => select.append(new Option(label, key)));
    const button = element('button', 'notebook-small-key', 'Attach');
    button.type = 'button';
    button.addEventListener('click', () => attach(entry.id, select.value));
    controls.append(select, button);
    card.append(heading, value, meta, controls);
    list.append(card);
  }
}

function renderTemplate(notebook) {
  const wrap = dialog.querySelector('.notebook-template');
  wrap.replaceChildren();
  for (const [key, label] of TEMPLATE_FIELDS) {
    const field = element('label', 'notebook-template-field');
    field.append(element('span', '', label));
    if (key === 'test') field.append(element('small', '', 'Choose: time-lapse, Ghost, flags, spectrum, or ground vs space'));
    const area = element('textarea');
    area.rows = 3;
    area.value = notebook.template[key] || '';
    area.dataset.field = key;
    area.addEventListener('input', () => store.updateTemplate(key, area.value));
    area.addEventListener('dragover', event => { event.preventDefault(); field.dataset.dragover = 'true'; });
    area.addEventListener('dragleave', () => { field.dataset.dragover = 'false'; });
    area.addEventListener('drop', event => {
      event.preventDefault();
      field.dataset.dragover = 'false';
      attach(event.dataTransfer.getData('text/plain'), key);
    });
    field.append(area);
    wrap.append(field);
  }
}

function render() {
  if (!dialog) return;
  const state = store.snapshot();
  const notebook = store.current();
  const select = dialog.querySelector('.notebook-picker');
  select.replaceChildren(...state.notebooks.map(item => new Option(item.name, item.id, false, item.id === state.activeId)));
  renderEntries(notebook);
  const notes = dialog.querySelector('.notebook-notes');
  if (document.activeElement !== notes) notes.value = notebook.notes;
  renderTemplate(notebook);
}

function downloadMarkdown() {
  const notebook = store.current();
  const blob = new Blob([notebookToMarkdown(notebook)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${notebook.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'lab-notebook'}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildDialog() {
  const panel = element('dialog', 'notebook-dialog');
  panel.id = 'lab-notebook-dialog';
  panel.setAttribute('aria-labelledby', 'notebook-title');
  const header = element('header', 'notebook-header');
  const title = element('div'); title.append(element('small', '', 'STAR SHIFT'), element('h2', '', 'Lab notebook')); title.querySelector('h2').id = 'notebook-title';
  const close = element('button', 'notebook-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close lab notebook'); close.addEventListener('click', () => panel.close());
  header.append(title, close);

  const manager = element('div', 'notebook-manager');
  const picker = element('select', 'notebook-picker'); picker.setAttribute('aria-label', 'Current notebook'); picker.addEventListener('change', () => { store.select(picker.value); render(); });
  const create = element('button', 'notebook-small-key', 'New'); create.type = 'button'; create.addEventListener('click', () => { store.create(); render(); });
  const rename = element('button', 'notebook-small-key', 'Rename'); rename.type = 'button'; rename.addEventListener('click', () => { const name = prompt('Notebook name', store.current().name); if (name) { store.rename(store.current().id, name); render(); } });
  const remove = element('button', 'notebook-small-key', 'Delete'); remove.type = 'button'; remove.addEventListener('click', () => { if (confirm(`Delete “${store.current().name}”?`)) { store.delete(store.current().id); render(); } });
  manager.append(picker, create, rename, remove);

  const content = element('div', 'notebook-content');
  const captured = element('section', 'notebook-section'); captured.append(element('h3', '', 'Captured values'), element('div', 'notebook-entries'));
  const notesSection = element('section', 'notebook-section'); const notes = element('textarea', 'notebook-notes'); notes.rows = 5; notes.placeholder = 'Free-text notes'; notes.setAttribute('aria-label', 'Free-text notes'); notes.addEventListener('input', () => store.updateNotes(notes.value)); notesSection.append(element('h3', '', 'Notes'), notes);
  const hypothesis = element('section', 'notebook-section'); hypothesis.append(element('h3', '', 'Hypothesis template'), element('p', 'notebook-help', 'Drag a captured value into a field, or use its Attach control.'), element('div', 'notebook-template'));
  content.append(captured, notesSection, hypothesis);

  const footer = element('footer', 'notebook-footer');
  const markdown = element('button', 'notebook-small-key', 'Export Markdown'); markdown.type = 'button'; markdown.addEventListener('click', downloadMarkdown);
  const print = element('button', 'notebook-small-key', 'Print'); print.type = 'button'; print.addEventListener('click', () => window.print());
  footer.append(markdown, print);
  panel.append(header, manager, content, footer);
  panel.addEventListener('cancel', () => panel.close());
  document.body.append(panel);
  return panel;
}

export function notebookAdd(entry) {
  const added = store.addEntry(entry);
  render();
  return added;
}

export function openNotebook(notebookId) {
  if (!dialog) dialog = buildDialog();
  if (notebookId) store.select(notebookId);
  render();
  if (!dialog.open) dialog.showModal();
  return dialog;
}

export function plusButton(el, getEntry) {
  if (!el || typeof getEntry !== 'function') throw new TypeError('plusButton needs an element and getEntry function');
  const button = element('button', 'notebook-plus', '+');
  button.type = 'button';
  button.setAttribute('aria-label', 'Add to notebook');
  button.addEventListener('click', event => {
    event.stopPropagation();
    notebookAdd(getEntry());
    showToast();
  });
  if (el.matches?.('input, img, br, hr')) el.insertAdjacentElement('afterend', button);
  else el.append(button);
  return button;
}
