// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import { serializeTemplate } from './template.js';

function text(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim();
}

function entryLine(entry) {
  const value = `${text(entry.value)}${entry.unit ? ` ${text(entry.unit)}` : ''}`;
  const uncertainty = entry.uncertainty === '' || entry.uncertainty === null || entry.uncertainty === undefined
    ? '' : ` ± ${text(entry.uncertainty)}${entry.unit ? ` ${text(entry.unit)}` : ''}`;
  const source = entry.source ? ` — ${text(entry.source)}${entry.tag ? ` [${text(entry.tag)}]` : ''}` : '';
  const link = entry.context?.url ? ` ([exact view](${entry.context.url}))` : '';
  return `- **${text(entry.label)}:** ${value}${uncertainty}${source}${link}`;
}

export function notebookToMarkdown(notebook, { exportedAt = new Date().toISOString() } = {}) {
  const entries = Array.isArray(notebook?.entries) ? notebook.entries : [];
  const sources = [...new Set(entries.map(entry => text(entry.source)).filter(Boolean))];
  return [
    `# ${text(notebook?.name) || 'Lab notebook'}`,
    `Exported: ${exportedAt}`,
    '## Captured values',
    entries.length ? entries.map(entryLine).join('\n') : '_No captured values._',
    '## Notes',
    String(notebook?.notes || '').trim() || '_No notes._',
    '## Hypothesis template',
    serializeTemplate(notebook?.template),
    '## Data sources',
    sources.length ? sources.map(source => `- ${source}`).join('\n') : '_No data sources captured._',
  ].join('\n\n') + '\n';
}
