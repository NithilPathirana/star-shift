// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Shared rail behaviour for every page (DESIGN.md 25, Design review round 2). Browser only.
// - "Notebook" keys (rail and Pages sheet) open the Lab notebook (web/app/notebook, docs/codex-notebook.md),
//   loaded on first use.
// - "More" key: on short windows (under 700 px tall) the rail folds Notebook, Help and About into one
//   key that opens the page's own Pages sheet beside the rail. The page must have #pagesBtn and #pagesPop.

for (const b of document.querySelectorAll('[data-notebook]')) {
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (b.closest('.pop')) document.getElementById('pagesBtn')?.click(); // close the Pages sheet first
    (await import('./notebook/notebook.js')).openNotebook();
  });
}

const more = document.querySelector('[data-rail-more]');
const pagesBtn = document.getElementById('pagesBtn'), pagesPop = document.getElementById('pagesPop');
if (more && pagesBtn && pagesPop) {
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    pagesBtn.click(); // the page's own open/close logic (focus, Escape, click outside); it places the sheet synchronously
    if (pagesPop.hidden) return;
    const r = more.getBoundingClientRect(), h = pagesPop.offsetHeight; // then move it beside the rail
    pagesPop.style.left = `${Math.round(r.right + 10)}px`;
    pagesPop.style.right = 'auto';
    pagesPop.style.top = `${Math.round(Math.max(8, Math.min(r.bottom - h, innerHeight - h - 8)))}px`;
  });
  // mirror the sheet's open state on the More key
  new MutationObserver(() => more.setAttribute('aria-expanded', pagesBtn.getAttribute('aria-expanded') || 'false'))
    .observe(pagesBtn, { attributes: true, attributeFilter: ['aria-expanded'] });
}
