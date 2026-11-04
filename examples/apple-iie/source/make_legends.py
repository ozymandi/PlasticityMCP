"""Turn keycap legends into SVG outlines for Plasticity's import_svg.

One SVG unit is 1 mm; x and y are model coordinates of the flat keyboard build,
written so that import_svg restores them (see FLIP_Y).
Run: python source/make_legends.py --test   (one trial letter)
     python source/make_legends.py          (all keys, source/legends.svg)
"""
import json
import os
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, 'fonts', 'Arimo[wght].ttf')
FLIP_Y = True  # SVG y runs down: write -y, checked on the trial key


def load_font():
    font = TTFont(FONT)
    return instantiateVariableFont(font, {'wght': 400})


def text_path(font, text, x, y, cap_mm):
    """SVG path of `text` with baseline start at model (x, y), cap height cap_mm."""
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    cap = font['OS/2'].sCapHeight or 1409
    s = cap_mm / cap
    sy = -s if FLIP_Y else s
    y0 = -y if FLIP_Y else y
    pen = SVGPathPen(glyphs, ntos=lambda v: f'{v:.4f}')
    cursor = 0
    for ch in text:
        name = cmap[ord(ch)]
        tp = TransformPen(pen, (s, 0, 0, sy, x + cursor * s, y0))
        glyphs[name].draw(tp)
        cursor += glyphs[name].width
    return pen.getCommands()


def write_svg(paths, out):
    body = '\n'.join(f'<path d="{d}"/>' for d in paths)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg">\n{body}\n</svg>\n')


def apple_path(cx, cy, size, hollow=False):
    """Hand-drawn apple glyph (not in any font), centre (cx, cy), size in mm."""
    def p(x, y, k=1.0):
        yy = cy + y * size * k
        return f'{cx + x * size * k:.4f} {(-yy if FLIP_Y else yy):.4f}'

    def body(k):
        return (f'M{p(0, .28, k)}Q{p(.22, .42, k)} {p(.40, .26, k)}Q{p(.33, .14, k)} {p(.33, .02, k)}'
                f'Q{p(.33, -.10, k)} {p(.46, -.16, k)}Q{p(.34, -.50, k)} {p(.16, -.48, k)}'
                f'Q{p(.06, -.48, k)} {p(0, -.44, k)}Q{p(-.06, -.48, k)} {p(-.16, -.48, k)}'
                f'Q{p(-.40, -.48, k)} {p(-.46, -.06, k)}Q{p(-.50, .26, k)} {p(-.24, .36, k)}'
                f'Q{p(-.10, .38, k)} {p(0, .28, k)}Z')
    leaf = f'M{p(.02, .40)}Q{p(.04, .58)} {p(.22, .62)}Q{p(.22, .44)} {p(.02, .40)}Z'
    return body(1.0) + (body(0.68) if hollow else '') + leaf


# key name -> list of lines, top line first
LEGENDS = {
    'key_Esc': ['esc'], 'key_Delete': ['delete'], 'key_Tab': ['tab'], 'key_Control': ['control'],
    'key_LShift': ['shift'], 'key_RShift': ['shift'], 'key_CapsLock': ['caps', 'lock'],
    'key_Return': ['return'], 'key_Reset': ['reset'],
    'key_Minus': ['_', '-'], 'key_Equals': ['+', '='], 'key_LBracket': ['{', '['], 'key_RBracket': ['}', ']'],
    'key_Semicolon': [':', ';'], 'key_Quote': ['"', "'"], 'key_Backtick': ['~', '`'],
    'key_Backslash': ['|', '\\'], 'key_Comma': ['<', ','], 'key_Period': ['>', '.'], 'key_Slash': ['?', '/'],
    'key_Left': ['←'], 'key_Right': ['→'], 'key_Down': ['↓'], 'key_Up': ['↑'],
}
for d, s in zip('1234567890', '!@#$%^&*()'):
    LEGENDS['key_' + d] = [s, d]
for c in 'QWERTYUIOPASDFGHJKLZXCVBNM':
    LEGENDS['key_' + c] = [c]

CAP = 2.6       # single characters
CAP_WORD = 1.8  # words
LEFT = 1.75     # from the left edge of the top face
FIRST = 1.5     # from the rear edge of the top face to the top of the first line
LINE = 4.9      # line pitch of two-line legends


def key_top(key):
    """Left x and rear y of a key's flat top face (2 mm inset from its base)."""
    return key['x'] + 2, key['y'] + key['d'] - 2


if __name__ == '__main__':
    font = load_font()
    if '--panel' in sys.argv:
        # Flat build: x0 = -X, y0 = Z; a turn of +90 about X and 180 about Z brings it to the rear panel
        ko = [(1, 112), (2, 93), (3, 74), (4, 55), (5, 36), (7, 17), (8, -2), (10, -21), (11, -40), (12, -59)]
        paths = [text_path(font, str(n), -(x + 18), 50, 3) for n, x in ko]
        paths += [text_path(font, '6', -(36 + 18), 21, 3), text_path(font, '9', -(17 + 18), 21, 3)]
        write_svg(paths, os.path.join(HERE, 'panel_digits.svg'))
        write_svg([text_path(font, 'I', 115.5, 42, 3), text_path(font, 'O', 116.2, 19.5, 3)],
                  os.path.join(HERE, 'panel_power.svg'))
        print('wrote panel_digits.svg, panel_power.svg')
    elif '--badges' in sys.argv:
        # Flat badge plates lie at y -337..-323; the monitor badge cutter is built at y 28
        bold = instantiateVariableFont(TTFont(FONT), {'wght': 700})
        s = [apple_path(-79, -330.6, 9.5), text_path(bold, 'apple', -71.5, -333, 7.2)]
        for x0 in (-25.2, -22.2):  # the two slanted strokes of //e
            pts = [(x0, -334), (x0 + 1.4, -334), (x0 + 4.0, -326), (x0 + 2.6, -326)]
            s.append('M' + 'L'.join(f'{px:.4f} {-py:.4f}' for px, py in pts) + 'Z')
        s.append(text_path(bold, 'e', -17.6, -334, 5))
        write_svg(s, os.path.join(HERE, 'badges.svg'))
        write_svg([apple_path(-322, 28, 12)], os.path.join(HERE, 'badge_monitor.svg'))
        print('wrote badges.svg, badge_monitor.svg')
    elif '--test' in sys.argv:
        # Key_A: top face x -102.25..-88.25, y -215.375..-201.375
        write_svg([text_path(font, 'A', -100.5, -205.5, 2.6)], os.path.join(HERE, 'legend_test.svg'))
        print('wrote legend_test.svg')
    else:
        keys = json.load(open(os.path.join(HERE, 'keyboard_layout.json')))
        cmap = font.getBestCmap()
        missing = sorted({ch for lines in LEGENDS.values() for t in lines for ch in t if ord(ch) not in cmap})
        print('missing glyphs:', missing)
        paths, glyphs, placed = [], 0, {}
        for key in keys:
            name = key['name']
            x, rear = key_top(key)
            if name == 'key_OpenApple':
                paths.append(apple_path(x + LEFT + 2, rear - FIRST - 2, 4, hollow=True))
                placed[name] = 'apple'
                continue
            if name == 'key_ClosedApple':
                paths.append(apple_path(x + LEFT + 2, rear - FIRST - 2, 4))
                placed[name] = 'apple'
                continue
            lines = LEGENDS.get(name)
            if not lines:
                continue
            placed[name] = lines
            for i, text in enumerate(lines):
                cap = CAP_WORD if len(text) > 1 else CAP
                baseline = rear - FIRST - cap - i * (LINE if cap == CAP else CAP_WORD + 1.2)
                paths.append(text_path(font, text, x + LEFT, baseline, cap))
                glyphs += len(text)
        write_svg(paths, os.path.join(HERE, 'legends.svg'))
        print('keys with legends:', len(placed), 'glyphs:', glyphs, 'paths:', len(paths))
        print('without legend:', sorted(k['name'] for k in keys if k['name'] not in placed))
