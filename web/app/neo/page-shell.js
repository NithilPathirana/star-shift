// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Asteroid Spotter in the shared page shell (DESIGN.md 25 and 30 "As built"): the shared Clarity settings
// (same storage key, tgi-clarity-v1, as every page) and the phone Pages sheet, exactly as on proof.html.

import { initClarity, showPop, closePop } from '../archive/shell.js';

const $ = (id) => document.getElementById(id);
initClarity();
const toggler = (popId, btnId) => (e) => { e.stopPropagation(); $(popId).hidden ? showPop($(popId), $(btnId)) : closePop(); };
$('clarityBtn').onclick = toggler('clarity', 'clarityBtn');
$('pagesBtn').onclick = toggler('pagesPop', 'pagesBtn');
document.addEventListener('click', (e) => { const p = document.querySelector('.pop:not([hidden])'); if (p && !p.contains(e.target)) closePop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(true); });
