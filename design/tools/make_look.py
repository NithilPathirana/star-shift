"""Makes web/styles/look.css and look-late.css: the default look of Star Shift, blue, white and neon yellow.
Nithil (team leader), Sun 15 Nov 2026: "change the color scheme to be not AI-generated looking", then, after a first cool-grey
try, "Looks AI. Use Blue with white with neon yellow". White paper, navy ink, vivid blue for links and controls; neon yellow
only as a fill or a mark: the one main key on a screen, text selection, and the ring and marks on the dark image.

How: reads every stylesheet in web/styles/, finds every rule that names a colour, and writes the same rule again with the
colour moved in OKLCH (see move(): paper goes towards white, ink and fills keep or lower their lightness, so text contrast
never drops). Every copied rule carries a
zero-weight switch, :where(html:not([data-ax-look=classic])), so the first copper look is one attribute away (the Colours
panel has a palette for it) and the cascade is exactly the original one.
Nothing in the app's own stylesheets is edited. Run again after any change to them:  python design/tools/make_look.py
AI-written (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026."""
import re, glob, math, os, sys
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'web', 'styles'); OUT = os.path.join(SRC, 'look.css')
SWITCH = ':not([data-ax-look=classic])'   # wrapped in :where(), so a copied rule weighs exactly what the original weighs
HUE = math.radians(264)          # the blue (a vivid cobalt)
YEL = math.radians(113)          # the neon yellow
REPORT = '--report' in sys.argv
# Hand-written rules added after the copies: where neon yellow goes. It is a fill and a mark, never text on white.
# [data-ax-colors=off] = nobody has picked their own colours; with a picked palette the main key follows that palette instead.
OFF = ':where(html:not([data-ax-look=classic])[data-ax-colors=off]) '
EXTRAS = '\n'.join([
    '/* hand-written in make_look.py: where the neon yellow goes */',
    OFF + ':is(.key.primary,.ax-sp-key){background:linear-gradient(180deg,#F1FF5C,#DCF514);color:#0A1238;border-color:rgba(84,104,0,.6);'
          'box-shadow:inset 0 1px 0 rgba(255,255,255,.75),inset 0 -1.5px 0 rgba(84,104,0,.28),var(--sh-contact),var(--sh-near)}',
    OFF + '.key.primary:active{background:linear-gradient(180deg,#D3EC0C,#E6F93C);box-shadow:inset 0 2px 4px rgba(60,76,0,.45)}',
    OFF + '::selection{background:#E8FF45;color:#0A1238}',
    '/* hand-written: where the blue leads. The page rail is solid blue with white labels; plain keys carry blue lettering on white */',
    OFF + '.rail{background:linear-gradient(165deg,#2456E6,#0F37B0);border-color:rgba(6,26,96,.5);box-shadow:inset 0 1px 0 rgba(255,255,255,.28),var(--sh-near),var(--sh-far)}',
    OFF + '.rail .nav-btn{color:rgba(255,255,255,.92)}',
    OFF + '.rail :is(.nav-btn.nav-demote,.nav-btn.nav-util){color:rgba(255,255,255,.9)}',
    OFF + '.rail .nav-btn[aria-current=page]{color:#0C34A6;background:linear-gradient(180deg,#FFFFFF,#E9EEFA);box-shadow:inset 0 1px 0 #fff,0 1px 1px rgba(3,14,60,.35),0 3px 6px -1px rgba(3,14,60,.3)}',
    '@media (hover:hover) and (pointer:fine){' + OFF + '.rail .nav-btn:not([aria-current]):hover{background:rgba(255,255,255,.16)}}',
    OFF + '.rail .logo-slot{background:#fff;border-radius:11px;box-shadow:0 0 0 4px #fff,0 2px 5px 3px rgba(3,14,60,.28)}',
    OFF + '.rail :is(.rail-ai,.ai-mark,.expert-l,.expert-sw){color:#fff}',
    OFF + '.rail :focus-visible{outline-color:#E8FF45}',
    OFF + ':is(.key,.pick){color:var(--copper-ink)}',
    OFF + ':is(.key.primary,.ax-sp-key){color:#0A1238}',
])

# ---------- colour maths (OKLCH) ----------
def lin(c): c /= 255; return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def gam(c): return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
def to_lch(rgb):
    r, g, b = (lin(v) for v in rgb)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3); m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s; a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s; bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    return L, math.hypot(a, bb), math.atan2(bb, a)
def to_rgb(L, C, h):
    for _ in range(60):
        a, b = C * math.cos(h), C * math.sin(h)
        l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3; m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3; s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
        q = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
        if all(-1e-4 <= v <= 1.0001 for v in q): return tuple(round(255 * gam(min(1, max(0, v)))) for v in q)
        C *= 0.94
    g = round(255 * gam(min(1, max(0, L ** 3)))); return (g, g, g)
def lum(rgb): return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])

def move(rgb):
    """The whole design decision, in one place. Returns the new rgb, or None to leave the colour alone."""
    L, C, h = to_lch(rgb); deg = math.degrees(h) % 360
    if C < 0.004: return None                                   # pure white, black and greys
    if C < 0.05 and (15 <= deg <= 125):                         # warm neutrals: cream paper, brown ink, brown shadows and edges
        if L > 0.8: return to_rgb(1 - (1 - L) * 0.38, min(C * 0.4 + 0.002, 0.008), HUE)   # paper: pulled most of the way to white, the faintest blue (the order of the shades is kept)
        if L > 0.5: return to_rgb(L, 0.022, HUE)                # mid greys (quiet text on the stage, edges): blue-grey
        return to_rgb(L, min(C * 1.6 + 0.02, 0.06), HUE)        # ink and the dark stage: navy at the same lightness
    if C >= 0.05 and 42 <= deg <= 115:                          # the copper family
        if L >= 0.74: return to_rgb(0.93 if C > 0.09 else 0.95, min(C * 2.3, 0.21), YEL)   # light copper = the ring and marks on the dark image: neon yellow
        if L < 0.62: return to_rgb(L - 0.03, min(C * 1.9, 0.21), HUE)   # ink, links and control fills: vivid blue, a little darker than the copper was (contrast only goes up)
        return to_rgb(L, min(C * 1.3, 0.13), HUE)               # decoration and tints: lighter blue
    return None                                                 # sage, coral, band colours: unchanged

# ---------- colour literals ----------
LIT = re.compile(r'#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)')
seen = {}
def conv(m):
    t = m.group(0); alpha = None
    if t[0] == '#':
        hx = t[1:]
        if len(hx) in (3, 4): hx = ''.join(c * 2 for c in hx)
        if len(hx) not in (6, 8): return t
        rgb = tuple(int(hx[i:i + 2], 16) for i in (0, 2, 4)); alpha = hx[6:8] if len(hx) == 8 else None
        new = move(rgb)
        if new is None: return t
        out = '#' + ''.join('%02X' % v for v in new) + (alpha or '')
    else:
        parts = [p for p in re.split(r'[,\s/]+', t[t.index('(') + 1:-1].strip()) if p]
        if len(parts) < 3 or any('%' in p or not re.match(r'^[\d.]+$', p) for p in parts[:3]): return t
        rgb = tuple(min(255, round(float(p))) for p in parts[:3]); new = move(rgb)
        if new is None: return t
        out = ('rgba(%d,%d,%d,%s)' % (*new, parts[3])) if len(parts) > 3 else 'rgb(%d,%d,%d)' % new
    seen[t.upper().replace(' ', '')] = out
    return out
def recolour(value):
    """Transforms colour literals in a declaration value, leaving url(...) and quoted strings alone."""
    out, i, n = [], 0, len(value)
    while i < n:
        if value.startswith('url(', i):
            j = i + 4; depth = 1; q = None
            while j < n and depth:
                c = value[j]
                if q: q = None if c == q else q
                elif c in '"\'': q = c
                elif c == '(': depth += 1
                elif c == ')': depth -= 1
                j += 1
            out.append(value[i:j]); i = j; continue
        if value[i] in '"\'':
            j = value.index(value[i], i + 1) + 1 if value[i] in value[i + 1:] else n
            out.append(value[i:j]); i = j; continue
        m = LIT.match(value, i)
        if m: out.append(conv(m)); i = m.end(); continue
        out.append(value[i]); i += 1
    return ''.join(out)

# ---------- a small CSS reader (rules, and at-rules that wrap rules) ----------
def split_top(s, sep):
    parts, depth, q, cur = [], 0, None, []
    for c in s:
        if q: cur.append(c); q = None if c == q else q; continue
        if c in '"\'': q = c
        elif c in '([': depth += 1
        elif c in ')]': depth -= 1
        if c == sep and depth == 0: parts.append(''.join(cur)); cur = []
        else: cur.append(c)
    parts.append(''.join(cur)); return parts
def block_end(s, i):
    depth, q = 0, None
    while i < len(s):
        c = s[i]
        if q: q = None if c == q else q
        elif c in '"\'': q = c
        elif c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: return i
        i += 1
    raise ValueError('unbalanced braces')
def prefix(sel):
    sel = sel.strip()
    if sel.startswith(':root'): return ':root:where(' + SWITCH + ')' + sel[5:]
    if re.match(r'^html(?![\w-])', sel): return 'html:where(' + SWITCH + ')' + sel[4:]
    return ':where(html' + SWITCH + ') ' + sel
# Every declaration that paints is copied, changed or not, in the original order. Copying only the changed ones would let a
# copied rule overtake a later rule of equal weight that uses var() (that is how the copper key lost its fill in the first try).
# Whole families are copied (border*, background*, outline*) because a shorthand resets its longhands.
PAINT = re.compile(r'^(--|color$|background|border|outline|box-shadow|text-shadow|fill$|stroke$|caret-color|accent-color|scrollbar-color|text-decoration|column-rule|-webkit-text-stroke|-webkit-text-fill-color|filter$|backdrop-filter|-webkit-backdrop-filter|opacity$)')
skipped = []
def walk(css, out, indent=''):
    i = 0
    while i < len(css):
        j = css.find('{', i)
        if j < 0: break
        semi = css.find(';', i)
        if 0 <= semi < j and css[i:semi].strip().startswith('@'): i = semi + 1; continue     # @import, @charset
        head = css[i:j].strip(); k = block_end(css, j); body = css[j + 1:k]; i = k + 1
        if head.startswith('@'):
            name = head.split()[0].split('(')[0]
            if name in ('@media', '@container', '@supports', '@layer'):
                inner = []; walk(body, inner, indent + '  ')
                if inner: out.append('%s%s{\n%s\n%s}' % (indent, head, '\n'.join(inner), indent))
            else:
                if LIT.search(body): skipped.append(head)
            continue
        if '{' in body: skipped.append('nested: ' + head[:60]); continue
        decls = []
        for d in split_top(body, ';'):
            if ':' not in d: continue
            p, v = d.split(':', 1); nv = recolour(v)
            if nv != v or PAINT.match(p.strip().lower()): decls.append('%s:%s' % (p.strip(), nv.strip()))
        if decls: out.append('%s%s{%s}' % (indent, ','.join(prefix(s) for s in split_top(head, ',')), ';'.join(decls)))

parts = []
# The order the pages load them in (each page loads a subset, always in this order), so the copies keep the original order.
# expert.css is added by script after everything else, and access.css is the sheet that imports look.css, so the copies of
# those two go into look-late.css, which access.js adds at the end of <head> (and after expert.css when that arrives).
ORDER = ['tokens.css', 'e.css', 'live.css', 'pages.css', 'scan-loader.css', 'astro-loader.css', 'tour.css', 'story.css', 'neo.css',
         'planetarium.css', 'notebook.css', 'spot.css']
LATE = ['access.css', 'expert.css']   # access.css imports look.css, so copies of its own rules must come after it too
NOT_LOADED = {'app.css', 'look.css', 'look-late.css'}
have = {os.path.basename(f) for f in glob.glob(os.path.join(SRC, '*.css'))} - NOT_LOADED
assert have == set(ORDER) | set(LATE), 'a stylesheet was added or removed; put it in ORDER, in page load order: %s' % sorted(have ^ (set(ORDER) | set(LATE)))
def build(names):
    res = []
    for name in names:
        css = re.sub(r'/\*.*?\*/', '', open(os.path.join(SRC, name), encoding='utf8').read(), flags=re.S)
        rules = []; walk(css, rules)
        if rules: res.append('/* from %s */\n%s' % (name, '\n'.join(rules)))
    return res
parts = build(ORDER); late = build(LATE)
head = ('/* GENERATED by design/tools/make_look.py. Do not edit by hand: change that script and run it again (also after any change\n'
        '   to another stylesheet here). The default look: blue, white and neon yellow (Nithil, Sun 15 Nov 2026). White paper, navy\n'
        '   ink, vivid blue for links and controls; neon yellow only as a fill or a mark. Sage and coral are unchanged.\n'
        '   html[data-ax-look=classic] switches every rule here off (Colours and accessibility, palette "First look: copper").\n'
        '   AI-written (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026. Asked for by Nithil, Sun 15 Nov 2026. */\n')
if REPORT:
    def hexrgb(t):
        if t[0] == '#': return tuple(int(t[i:i + 2], 16) for i in (1, 3, 5))
        return tuple(int(v) for v in re.findall(r'\d+', t)[:3])
    for k in sorted(seen, key=lambda t: -to_lch(hexrgb(seen[t]))[0]): print(k.ljust(26), '->', seen[k])
    print('changed', len(seen), 'unique colours; skipped at-rules:', skipped)
else:
    open(OUT, 'w', encoding='utf8', newline='\n').write(head + '\n'.join(parts) + '\n')
    open(os.path.join(SRC, 'look-late.css'), 'w', encoding='utf8', newline='\n').write(head + '\n'.join(late) + '\n' + EXTRAS + '\n')   # the yellow rules go last of all
    print('wrote', OUT, os.path.getsize(OUT), 'bytes;', sum(p.count('\n') for p in parts), 'lines;', len(seen), 'unique colours moved; skipped:', skipped)
