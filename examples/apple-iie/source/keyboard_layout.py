"""Apple IIe key layout (flat build, mm): name, x, y, w, d. Rows from brief.md."""
import json
U=19.05; X0=-14.5*U/2; Y0=-256.0
ROWS=[
 (0,[('Esc',1)]+[(c,1) for c in '1234567890']+[('Minus',1),('Equals',1),('Delete',1.5)]),
 (1,[('Tab',1.5)]+[(c,1) for c in 'QWERTYUIOP']+[('LBracket',1),('RBracket',1)]),
 (2,[('Control',1.75)]+[(c,1) for c in 'ASDFGHJKL']+[('Semicolon',1),('Quote',1),('Backtick',1)]),
 (3,[('LShift',1.25),('Backslash',1)]+[(c,1) for c in 'ZXCVBNM']+[('Comma',1),('Period',1),('Slash',1),('RShift',2.25)]),
 (4,[('CapsLock',2),('LED',1),('OpenApple',1),('Space',5.5),('ClosedApple',1),('Left',1),('Right',1),('Down',1),('Up',1)]),
]
GAP=1.05
keys=[]
for r,row in ROWS:
    x=X0; y=Y0+(4-r)*U
    for n,w in row:
        if n!='LED': keys.append(dict(name='key_'+n,x=round(x+GAP/2,3),y=round(y+GAP/2,3),w=round(w*U-GAP,3),d=round(U-GAP,3)))
        x+=w*U
keys.append(dict(name='key_Return',x=round(X0+13.5*U+GAP/2,3),y=round(Y0+2*U+GAP/2,3),w=round(U-GAP,3),d=round(2*U-GAP,3)))
keys.append(dict(name='key_Reset',x=149.0,y=round(Y0+4*U+GAP/2,3),w=18.0,d=18.0))
if __name__=='__main__':
    print(len(keys))
    for k in keys: print(k['name'],k['x'],k['y'],k['w'],k['d'])
    json.dump(keys,open(__file__.replace('.py','.json'),'w'),indent=0)
