"""화면 색 테마 3가지의 CSS 를 만든다 — 토스 디자인 시스템(TDS) 색 단계 기반.

밝은 화면의 회색·파랑·초록 값은 TDS 공식 색표에서 그대로 가져왔다.
  https://tossmini-docs.toss.im/tds-mobile/foundation/colors/
어두운 화면 값은 같은 느낌으로 직접 맞춘 것이다 (공식 값 아님).
흰 글씨 대비는 WCAG AA(4.5:1)를 넘는지 검산한다.

사용: python3 tools-themes.py > /tmp/themes.css  → styles.css 의 테마 구역에 붙여넣기
"""
import sys

def hx(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def lum(h):
    f = lambda c: c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
    r, g, b = [f(c/255) for c in hx(h)]
    return .2126*r + .7152*g + .0722*b
def cr(a, b):
    la, lb = lum(a), lum(b); return (max(la, lb)+.05)/(min(la, lb)+.05)

# TDS 회색 — 세 테마가 같이 쓴다
LIGHT = dict(plane='#f2f4f6', surface='#ffffff', surface_2='#f2f4f6', hairline='#e5e8eb', line='#d1d6db',
             text_primary='#191f28', text_secondary='#4e5968', text_muted='#8b95a1')
DARK  = dict(plane='#101113', surface='#1b1c1f', surface_2='#2a2b2f', hairline='#2e3034', line='#45474c',
             text_primary='#eceef1', text_secondary='#b0b5bd', text_muted='#7e848c')

# key, 이름, 밝은 화면 {채움, 테두리, 글씨, 숫자색, 연한바탕, 확인색}, 어두운 화면 {...}
T = [
 ('blue',  '기본 블루',
  dict(fill='#1b64da', edge='#1957c2', ink='#ffffff', data='#1b64da', soft='#e8f3ff', accent='#03b26c'),   # TDS blue700/800/50, green500
  dict(fill='#1b64da', edge='#4593fc', hover='#1957c2', ink='#ffffff', data='#64a8ff', soft='#1d2a42', accent='#3fd599')),
 ('ssage', '차분한 초록',
  dict(fill='#028450', edge='#027648', ink='#ffffff', data='#028450', soft='#f0faf6', accent='#028450'),   # TDS green800/900/50
  dict(fill='#028450', edge='#15c47e', hover='#027648', ink='#ffffff', data='#3fd599', soft='#173026', accent='#3fd599')),
 ('smono', '먹색',
  dict(fill='#333d4b', edge='#191f28', ink='#ffffff', data='#333d4b', soft='#f2f4f6', accent='#03b26c'),   # TDS grey800/900
  dict(fill='#eceef1', edge='#ffffff', ink='#191f28', data='#d1d6db', soft='#2a2b2f', accent='#3fd599')),
]

def block(sel, base, c, indent=''):
    i = indent + '  '
    return (f"{indent}{sel} {{\n"
            f"{i}--plane:{base['plane']}; --surface:{base['surface']}; --surface-2:{base['surface_2']}; --hairline:{base['hairline']}; --line:{base['line']};\n"
            f"{i}--text-primary:{base['text_primary']}; --text-secondary:{base['text_secondary']}; --text-muted:{base['text_muted']};\n"
            f"{i}--primary:{c['fill']}; --primary-hover:{c.get('hover', c['edge'])}; --primary-soft:{c['soft']}; --primary-ink:{c['ink']};\n"
            f"{i}--fill:{c['fill']}; --fill-edge:{c['edge']}; --fill-ink:{c['ink']}; --accent:{c['accent']}; --data:{c['data']};\n"
            f"{indent}}}")

out, bad = [], 0
for key, name, lt, dk in T:
    out.append(block(f'[data-theme-name="{key}"]', LIGHT, lt))
    out.append('@media (prefers-color-scheme: dark) {\n'
               + block(f':root:where(:not([data-theme="light"]))[data-theme-name="{key}"]', DARK, dk, '  ') + '\n}')
    checks = [('밝은 체크 글씨', cr(lt['fill'], lt['ink']), 4.5), ('밝은 숫자색', cr(lt['data'], LIGHT['surface']), 4.5),
              ('어두운 체크 글씨', cr(dk['fill'], dk['ink']), 4.5), ('어두운 숫자색', cr(dk['data'], DARK['surface']), 4.5)]
    line = ' · '.join(f'{n} {v:.2f}' + ('' if v >= m else ' ←미달') for n, v, m in checks)
    bad += sum(v < m for _, v, m in checks)
    print(f'{name:8s} {line}', file=sys.stderr)

print('\n'.join(out))
print(f'\n테마 {len(T)}개 · 기준 미달 {bad}개', file=sys.stderr)
