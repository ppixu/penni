"""Project the approved Blender curves into a shaded, bitmap-free SVG."""
import json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parent
ref=json.loads((ROOT/'blender-reference.json').read_text())
view=ref['view']['view_matrix']
SCALE=100
# Keep the approved 15-degree orthographic view, centered in the existing asset box.
def project(part,p,z):
    m=part['matrix']; x,y=p
    w=[m[i][0]*x+m[i][1]*y+m[i][2]*z+m[i][3] for i in range(3)]
    return (300+SCALE*sum(view[0][i]*w[i] for i in range(3)),330-SCALE*sum(view[1][i]*w[i] for i in range(3)))
def offset(c,d):
    result=[]
    for i,p in enumerate(c):
        a=c[i-1];b=c[(i+1)%len(c)]
        u=(p[0]-a[0],p[1]-a[1]);v=(b[0]-p[0],b[1]-p[1])
        lu=math.hypot(*u);lv=math.hypot(*v)
        n=(u[1]/lu,-u[0]/lu);q=(v[1]/lv,-v[0]/lv)
        k=d/max(.05,1+n[0]*q[0]+n[1]*q[1])
        result.append((p[0]+(n[0]+q[0])*k,p[1]+(n[1]+q[1])*k))
    return result

def simplify(points, tolerance=.045):
    # Subpixel path reduction in the 600-unit canvas, preserving silhouette.
    a,b=points[0],points[-1];dx=b[0]-a[0];dy=b[1]-a[1];length=math.hypot(dx,dy)
    distances=[abs(dy*(x-a[0])-dx*(y-a[1]))/length if length else math.hypot(x-a[0],y-a[1]) for x,y in points]
    i=max(range(len(points)),key=distances.__getitem__)
    if distances[i]<=tolerance:return [a,b]
    return simplify(points[:i+1],tolerance)[:-1]+simplify(points[i:],tolerance)

def path(part,d,z):
    return ''.join('M'+'L'.join(f'{x:.2f} {y:.2f}' for x,y in simplify([project(part,p,z) for p in offset(c,d)]+[project(part,offset(c,d)[0],z)])[:-1])+'Z' for c in part['contours'])
def hexcolor(c,f):
    return '#'+''.join(f'{round(max(0,min(255,v*f))):02x}' for v in c)
# Display colors reproduce the approved material-preview appearance on a light page.
palettes={'purple':((100,68,246),(76,49,204)), 'silver':((241,239,238),(195,193,192)), 'orange':((255,139,0),(212,104,0))}
parts=sorted(ref['parts'],key=lambda p:p['matrix'][2][3])
defs=[];groups=[]
# The light center disk in the working Blender scene marks an open center.
# Export it as transparency, so the logo also works on colored backgrounds.
cutout=next((p for p in parts if 'White' in p['material']), None)
if cutout:
    hole=path(cutout, 0, cutout['extrude']+cutout['bevel'])
    defs.append('<mask id="open-center" maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="600"><rect width="600" height="600" fill="white"/><path d="'+hole+'" fill="black"/></mask>')
for part in parts:
    if part is cutout: continue
    key='purple' if 'Purple' in part['material'] else 'orange'
    light,dark=palettes[key];b=part['bevel'];e=part['extrude']
    slices=[]
    # Round lower edge, vertical wall, and round upper edge. Each contour derives
    # from the real Blender profile, extrusion, bevel, and object transform.
    levels=[]
    for i in range(9):
        t=-math.pi/2+(math.pi/2)*i/8
        levels.append((b*math.cos(t),-e+b*math.sin(t),.72+.09*i/8))
    levels.append((b,e,.83))
    for i in range(1,19):
        t=(math.pi/2)*i/18
        levels.append((b*math.cos(t),e+b*math.sin(t),.83+.17*math.sin(t)))
    for i,(d,z,f) in enumerate(levels):
        gid=f'{key}-{i}'
        defs.append(f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="{hexcolor(light,f)}"/><stop offset="1" stop-color="{hexcolor(dark,f)}"/></linearGradient>')
        slices.append(f'<path d="{path(part,d,z)}" fill="url(#{gid})"/>')
    group=f'<g aria-label="{key}" fill-rule="evenodd" filter="url(#contact)">'+''.join(slices)+'</g>'
    groups.append('<g mask="url(#open-center)">'+group+'</g>' if cutout and key=='orange' else group)
svg='''<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600" role="img" aria-labelledby="title desc">
<title id="title">Penni</title><desc id="desc">Blender-mallista piirretty violetti P, oranssi rengas ja avoin keskusta.</desc>
<defs><filter id="shadow" x="-30%" y="-20%" width="170%" height="160%" color-interpolation-filters="sRGB"><feDropShadow dx="5" dy="12" stdDeviation="9" flood-color="#282135" flood-opacity=".16"/></filter>
<filter id="contact" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB"><feDropShadow dx="1" dy="3" stdDeviation="2" flood-color="#231c36" flood-opacity=".2"/></filter>
'''+''.join(defs)+'</defs><g filter="url(#shadow)">'+''.join(groups)+'</g></svg>\n'
(ROOT/'penni-stacked.svg').write_text(svg)
print(f'Projected approved Blender geometry: {len(svg):,} bytes, no raster images.')
