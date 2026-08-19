"""12가지 테마의 CSS 를 생성한다. 다크 모드 값은 규칙으로 파생시키고 대비를 검산한다."""

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

W, DARK_PLANE, DARK_SURF = '#ffffff', '#12141a', '#1b1e26'

# key, 이름, 방식, plane, surface, hairline, ink, muted, primary, fill, accent
T = [
 ('blue',  '기본 블루',        'solid', '#f8fafc','#ffffff','#e2e8f0','#0f172a','#94a3b8','#41609c','#41609c','#10b981'),
 ('sblue', '옅은 블루',        'soft',  '#f7f8fa','#ffffff','#e4e7ec','#1b2430','#98a2b0','#41609c','#dfe7f4','#3f8f72'),
 ('ssage', '옅은 세이지',       'soft',  '#f6f4ef','#fffdf9','#e6e1d6','#2b2823','#918a7c','#6b7f6a','#e0e8dd','#8a9a5b'),
 ('smono', '옅은 먹색',        'soft',  '#f4f4f2','#ffffff','#e3e3df','#1c1c1a','#8c8c86','#3f3f3c','#e4e4e0','#6b7a5e'),
 ('sclay', '옅은 테라코타',     'soft',  '#f7f3f0','#fffcfa','#e8ded7','#2e2724','#9c8b81','#a8674f','#f0ded5','#7d8b6a'),
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
        f_edge = mix(primary, W, .38)           # 옅은 채움은 테두리로 구분을 만든다
        f_ink  = mix(primary, '#000000', .28)
        while cr(fill, f_ink) < 4.6: f_ink = mix(f_ink, '#000000', .08)
        d_fill = mix(primary, DARK_SURF, .68); d_edge = mix(primary, W, .18); d_ink = mix(primary, W, .62)
        while cr(d_fill, d_ink) < 4.6: d_ink = mix(d_ink, W, .10)

    d_primary = mix(primary, W, .34)
    d_accent  = mix(accent,  W, .30)

    out.append(f"""[data-theme-name="{key}"] {{
  --plane:{plane}; --surface:{surf}; --surface-2:{mix(plane,'#000000',.045)}; --hairline:{line};
  --text-primary:{ink}; --text-secondary:{mix(ink,muted,.55)}; --text-muted:{muted};
  --primary:{primary}; --primary-hover:{mix(primary,'#000000',.14)}; --primary-soft:{mix(primary,W,.90)};
  --fill:{fill}; --fill-edge:{f_edge}; --fill-ink:{f_ink}; --accent:{accent};
}}
@media (prefers-color-scheme: dark) {{
  :root:where(:not([data-theme="light"]))[data-theme-name="{key}"] {{
    --plane:{DARK_PLANE}; --surface:{DARK_SURF}; --surface-2:{mix(DARK_SURF,W,.07)}; --hairline:{mix(DARK_SURF,W,.13)};
    --text-primary:#f2f3f5; --text-secondary:#b3b8c2; --text-muted:#7d838f;
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
