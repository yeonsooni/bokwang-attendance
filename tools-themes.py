"""5가지 테마의 CSS 를 생성한다 (종이 같은 바탕 · 먹색 글씨 · 강조색 하나). 다크 모드 값은 규칙으로 파생시키고 대비를 검산한다."""

def hx(h): h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def st(t): return '#%02x%02x%02x' % tuple(max(0,min(255,round(c))) for c in t)
def mix(a,b,t):  # a 에서 b 쪽으로 t 만큼
    A,B=hx(a),hx(b); return st(tuple(A[i]+(B[i]-A[i])*t for i in range(3)))
def lum(h):
    r,g,b=[c/255 for c in hx(h)]
    f=lambda c: c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
    return .2126*f(r)+.7152*f(g)+.0722*f(b)
def cr(a,b):
    la,lb=lum(a),lum(b); hi,lo=max(la,lb),min(la,lb); return (hi+.05)/(lo+.05)

W, DARK_PLANE, DARK_SURF = '#ffffff', '#171614', '#1f1e1b'

# key, 이름, 방식, plane, surface, hairline, ink, muted, primary, fill, accent
T = [
 ('blue',  '기본 블루',        'solid', '#f6f3ec','#fffdf8','#e3ddd0','#1f1d1a','#8a8478','#2c4a7c','#2c4a7c','#5f7f5a'),
 ('sblue', '옅은 블루',        'soft',  '#f5f4f0','#fffefb','#e1ded6','#1e2430','#8b909a','#2f4f86','#dbe4f3','#5f7f5a'),
 ('ssage', '옅은 세이지',       'soft',  '#f3f1ea','#fcfbf6','#dfdbd0','#262620','#8a877b','#4f6a4e','#dbe5d6','#7a8a52'),
 ('smono', '옅은 먹색',        'soft',  '#f4f2ee','#fdfcf9','#e1ded7','#1a1a18','#87857f','#2b2b29','#e2e0da','#66735a'),
 ('sclay', '옅은 테라코타',     'soft',  '#f6f1ea','#fffcf7','#e6dccf','#2b2420','#978a7e','#9a5a41','#f0dccf','#6f7d5e'),
]

out, report = [], []
for key,name,style,plane,surf,line,ink,muted,primary,fill,accent in T:
    if style == 'solid':
        # 흰 글씨가 4.6 이상 나올 때까지 채움을 어둡게 조인다
        while cr(fill, W) < 4.6: fill = mix(fill, '#000000', .06)
        f_edge = mix(fill, '#000000', .16)
        f_ink  = W
        # 다크 모드에서도 같은 채움을 쓰되, 어두운 바탕과 충분히 갈리게만 밝힌다
        d_fill = fill
        while cr(d_fill, DARK_SURF) < 1.9 and cr(mix(d_fill, W, .04), W) >= 4.6:
            d_fill = mix(d_fill, W, .04)
        d_edge = mix(d_fill, W, .16); d_ink = W
    else:
        f_edge = mix(primary, W, .15)           # 옅은 채움은 진한 테두리로 구분을 만든다
        f_ink  = mix(primary, '#000000', .28)
        while cr(fill, f_ink) < 4.6: f_ink = mix(f_ink, '#000000', .08)
        d_fill = mix(primary, DARK_SURF, .68); d_edge = mix(primary, W, .18); d_ink = mix(primary, W, .62)
        while cr(d_fill, d_ink) < 4.6: d_ink = mix(d_ink, W, .10)

    d_primary = mix(primary, W, .34)
    d_accent  = mix(accent,  W, .30)

    out.append(f"""[data-theme-name="{key}"] {{
  --plane:{plane}; --surface:{surf}; --surface-2:{mix(plane,'#000000',.04)}; --hairline:{line}; --line:{mix(line,ink,.16)};
  --text-primary:{ink}; --text-secondary:{mix(ink,muted,.55)}; --text-muted:{muted};
  --primary:{primary}; --primary-hover:{mix(primary,'#000000',.14)}; --primary-soft:{mix(primary,W,.90)};
  --fill:{fill}; --fill-edge:{f_edge}; --fill-ink:{f_ink}; --accent:{accent};
}}
@media (prefers-color-scheme: dark) {{
  :root:where(:not([data-theme="light"]))[data-theme-name="{key}"] {{
    --plane:{DARK_PLANE}; --surface:{DARK_SURF}; --surface-2:{mix(DARK_SURF,W,.06)}; --hairline:{mix(DARK_SURF,W,.11)}; --line:{mix(DARK_SURF,W,.2)};
    --text-primary:#ece8e0; --text-secondary:#b9b3a8; --text-muted:#857f74;
    --primary:{d_primary}; --primary-hover:{mix(d_primary,W,.18)}; --primary-soft:{mix(d_primary,DARK_SURF,.78)};
    --fill:{d_fill}; --fill-edge:{d_edge}; --fill-ink:{d_ink}; --accent:{d_accent};
  }}
}}""")
    report.append((name, style,
                   cr(fill, f_ink),          # 글씨 가독성
                   cr(f_edge, surf),         # 출석/결석 구분 (테두리 기준)
                   cr(d_fill, d_ink)))       # 다크 모드 글씨

open('/private/tmp/claude-501/-Users-yeonseop/26d4e183-a264-4a83-a0d9-c1df25f7d91d/scratchpad/themes.css','w').write('\n'.join(out)+'\n')

print(f"{'테마':16s} {'방식':6s} {'글씨':>6s} {'구분':>6s} {'다크글씨':>8s}")
bad=0
for n,s,a,b,c in report:
    warn = '' if (a>=4.5 and b>=1.9 and c>=4.5) else '  ←확인'
    if warn: bad+=1
    print(f'{n:16s} {s:6s} {a:6.1f} {b:6.2f} {c:8.1f}{warn}')
print(f'\n생성 {len(T)}개 · 기준 미달 {bad}개')
