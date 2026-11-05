# WCAG 2.x contrast check for the mockup palettes. Run: python3 design/tools/contrast.py
def lum(h):
    h=h.lstrip('#'); c=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    c=[x/12.92 if x<=0.04045 else ((x+0.055)/1.055)**2.4 for x in c]
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
def ratio(a,b):
    la,lb=sorted([lum(a),lum(b)],reverse=True); return (la+0.05)/(lb+0.05)
assert abs(ratio('#000000','#ffffff')-21)<0.01 and abs(ratio('#777777','#ffffff')-4.48)<0.01

P = {
 'A · Протокол · light': {'bg':'#F3F4F6','surface':'#FFFFFF','ink':'#0E1116','muted':'#545B66','accent':'#1F3FD6','onAccent':'#FFFFFF','danger':'#B42318','ok':'#18794E','accentSoft':'#E6EAFC'},
 'A · Протокол · dark':  {'bg':'#0D0F13','surface':'#161A20','ink':'#ECEEF2','muted':'#9AA2AE','accent':'#8DA2FF','onAccent':'#0D0F13','danger':'#FF8A7A','ok':'#5CD49A','accentSoft':'#1C2440'},
 'B · Редакция · light': {'bg':'#E9EAE4','surface':'#F7F7F3','ink':'#16171A','muted':'#555851','accent':'#16171A','onAccent':'#F7F7F3','mark':'#F2D74B','onMark':'#16171A','danger':'#A8321E','ok':'#2E6B3A'},
 'B · Редакция · dark':  {'bg':'#141517','surface':'#1D1F22','ink':'#EDEDE7','muted':'#A3A69E','accent':'#EDEDE7','onAccent':'#141517','mark':'#E9CE45','onMark':'#141517','danger':'#F08C72','ok':'#8FCB8F'},
 'C · Морское стекло · light': {'bg':'#E6EEEA','surface':'#FFFFFF','ink':'#0F201B','muted':'#4A5D56','accent':'#0E6B5C','onAccent':'#FFFFFF','warm':'#9A4A0B','danger':'#B3261E','ok':'#1F7A4D','accentSoft':'#CFE6DF','warmSoft':'#F7E6D4','onWarm':'#FFFFFF'},
 'C · Морское стекло · dark':  {'bg':'#0C1613','surface':'#14221E','ink':'#E6F1EC','muted':'#9DB3AB','accent':'#7FD8C4','onAccent':'#0C1613','warm':'#F2A65A','danger':'#FF9C92','ok':'#6EDAA4','accentSoft':'#173A33','warmSoft':'#33261A','onWarm':'#14221E'},
 'D · Итог · light': {'bg':'#E8EEED','surface':'#FFFFFF','ink':'#0E1C1F','muted':'#4B5C60','accent':'#0A5F73','onAccent':'#FFFFFF','accentSoft':'#D3E6EA','warm':'#9A4A0B','warmSoft':'#F8E7D2','onWarm':'#FFFFFF','mark':'#FAE8CF','onMark':'#0E1C1F','danger':'#B3261E','ok':'#1F7A4D'},
 'D · Итог · dark':  {'bg':'#0B1517','surface':'#132124','ink':'#E6F0F1','muted':'#9AAFB3','accent':'#7DCFE0','onAccent':'#0B1517','accentSoft':'#173840','warm':'#F2A65A','warmSoft':'#33261A','onWarm':'#132124','mark':'#4A3418','onMark':'#F6E7D3','danger':'#FF9C92','ok':'#6EDAA4'},
}
pairs=[('ink','bg'),('ink','surface'),('muted','bg'),('muted','surface'),('onAccent','accent'),('accent','bg'),('accent','surface'),('danger','surface'),('ok','surface'),('warm','surface'),('onMark','mark'),('accent','accentSoft'),('ink','warmSoft'),('muted','warmSoft'),('warm','warmSoft'),('onWarm','warm')]
bad=0
for name,p in P.items():
    print(f'\n{name}')
    for f,b in pairs:
        if f in p and b in p:
            r=ratio(p[f],p[b]); lvl='AAA' if r>=7 else 'AA' if r>=4.5 else 'AA-large/UI' if r>=3 else 'FAIL'
            if r<4.5: bad+=1
            print(f'  {f:9}{p[f]} on {b:8}{p[b]}  {r:5.2f}  {lvl}')
print('\ntext pairs below 4.5:', bad)
