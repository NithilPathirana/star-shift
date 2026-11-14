// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026

export const TEMPLATE_FIELDS = Object.freeze([
  ['observation', 'Observation'], ['question', 'Question'], ['hypothesis', 'Hypothesis'],
  ['prediction', 'Prediction'], ['test', 'Test'], ['result', 'Result'], ['conclusion', 'Conclusion'],
]);

export function serializeTemplate(template = {}) {
  return TEMPLATE_FIELDS.map(([key, label]) => `### ${label}\n\n${String(template[key] || '').trim() || '_Not recorded._'}`).join('\n\n');
}
