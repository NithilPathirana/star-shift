// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Shared rail behaviour for every page (DESIGN.md 25, Design review round 2). Browser only.
// - "Notebook" keys (rail and Pages sheet) open the Lab notebook (web/app/notebook, docs/codex-notebook.md),
//   loaded on first use.
// - "More" key: on short windows (under 700 px tall) the rail folds Notebook, Help and About into one
//   key that opens the page's own Pages sheet beside the rail. The page must have #pagesBtn and #pagesPop.
// - The Simple / Expert switch (web/app/expert.js, Master item 5): one remembered setting, placed at the foot of
//   the rail and at the foot of the Pages sheet (phone, and the More key on short windows). Default Simple.

import { expertSwitch } from './expert.js';

{
  const place = () => {
    const rail = document.querySelector('.rail');
    if (rail && !rail.querySelector('.expert-sw')) rail.append(expertSwitch('nav-expert'));
    const pop = document.getElementById('pagesPop');
    if (pop && !pop.querySelector('.expert-sw')) {
      const b = expertSwitch('expert-sheet');
      b.querySelector('.expert-l').innerHTML = 'Expert<small>Full coordinates, ±σ, χ², MJD, detector and flag details, CSV</small>';
      const nav = pop.querySelector('nav');
      if (nav) nav.after(b); else pop.append(b); // straight under the page list
    }
    // the logo credit, visible wherever the Pages sheet opens (Submission Check: 'SI' must be spelled out on screen)
    if (pop && !pop.querySelector('.sheet-credit')) pop.append(Object.assign(document.createElement('p'), { className: 'sheet-credit', textContent: 'Logo: AI-generated (SI) with ChatGPT; small version and favicon redrawn as SVG by Claude.' }));
  };
  if (document.querySelector('link[href$="styles/expert.css"]')) place();
  else { // inject the stylesheet, and place the switch once it has loaded (no unstyled flash)
    const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'styles/expert.css' });
    l.onload = l.onerror = place;
    document.head.append(l);
  }
}

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
import('./tour/boot.js').catch(() => {}); // guided tour on every page (Tour this page, full tour, resume)
