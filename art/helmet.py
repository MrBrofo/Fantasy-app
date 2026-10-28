# Procedural football helmet, rendered on transparent background. Run: blender -b -P helmet.py -- out.png size samples
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'helmet.png'
SIZE = int(argv[1]) if len(argv) > 1 else 512
SAMPLES = int(argv[2]) if len(argv) > 2 else 32
LOOK = argv[3] if len(argv) > 3 else 'white'  # white: white shell, blue stripe; blue: bright blue shell, white stripe

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

def mat(name, color, rough=0.25, metal=0.0, coat=0.0, emit=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if 'Coat Weight' in b.inputs: b.inputs['Coat Weight'].default_value = coat
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = 1.5
    return m

def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

SHELL = mat('shell', srgb('#eef3fa'), rough=0.2, metal=0.05, coat=1.0) if LOOK == 'white' else mat('shell', srgb('#3d95ff'), rough=0.2, metal=0.3, coat=1.0)
WHITE = mat('white', srgb('#f4f7fb'), rough=0.3, coat=0.6)
MASK = mat('mask', srgb('#2a2f38'), rough=0.3, metal=0.6)
DARK = mat('dark', srgb('#06101e'), rough=0.6)
NAVY = mat('navy', srgb('#0a1a3a'), rough=0.25, coat=1.0)

def boolean(obj, cutter, op='DIFFERENCE'):
    m = obj.modifiers.new('b', 'BOOLEAN'); m.operation = op; m.object = cutter; m.solver = 'EXACT'
    bpy.context.view_layer.objects.active = obj; bpy.ops.object.modifier_apply(modifier=m.name)

def box(loc, scale, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=[math.radians(r) for r in rot])
    o = bpy.context.object; o.scale = scale; return o

def shell(r=1.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=64, radius=r)
    o = bpy.context.object; o.scale = (1.12, 0.92, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.shade_smooth()
    return o

# cutters: the face opening (front, below the brow) and the bottom (sloping lower at the back)
cuts = [box((1.15, 0, -0.5), (0.62, 0.62, 0.62), (0, 15, 0)), box((0, 0, -1.42), (2, 2, 0.6), (0, -16, 0))]
h = shell()
for c in cuts: boolean(h, c)
# rubber trim: a rounded tube along every open edge of the shell (face opening and bottom), like a real helmet's edging
import bmesh
bm = bmesh.new(); bm.from_mesh(h.data)
nb = {}
for e in bm.edges:
    if e.is_boundary:
        i, j = (v.index for v in e.verts); nb.setdefault(i, []).append(j); nb.setdefault(j, []).append(i)
co = {v.index: v.co.copy() for v in bm.verts}; bm.free()
cu = bpy.data.curves.new('trim', 'CURVE'); cu.dimensions = '3D'
seen = set()
for start in nb:
    if start in seen: continue
    loop, prev, cur = [], None, start
    while cur is not None and cur not in seen:
        seen.add(cur); loop.append(co[cur])
        nxt = [n for n in nb[cur] if n != prev and n not in seen]; prev, cur = cur, (nxt[0] if nxt else None)
    sp = cu.splines.new('POLY'); sp.points.add(len(loop) - 1); sp.use_cyclic_u = True
    for p, c in zip(sp.points, loop): p.co = (*c, 1)
trim = bpy.data.objects.new('trim', cu); sc.collection.objects.link(trim)
trim.data.bevel_depth = 0.04; trim.data.bevel_resolution = 6; trim.data.materials.append(DARK)
sol = h.modifiers.new('s', 'SOLIDIFY'); sol.thickness = 0.06; sol.offset = -1; sol.material_offset = 1; sol.material_offset_rim = 1
h.data.materials.clear(); h.data.materials.append(SHELL); h.data.materials.append(DARK)

# center stripe: white with a navy pinstripe each side, thin slices of slightly bigger shells
def stripe(r, w, m):
    o = shell(r)
    for c in cuts: boolean(o, c)
    st = box((0, 0, 0), (2, w, 2)); boolean(o, st, 'INTERSECT'); st.hide_render = st.hide_viewport = True
    o.data.materials.clear(); o.data.materials.append(m)
BLUE = mat('blue', srgb('#0a6cff'), rough=0.2, metal=0.3, coat=1.0)
stripe(1.008, 0.15, NAVY)
stripe(1.014, 0.095, BLUE if LOOK == 'white' else WHITE)

# dark padding inside, so the face opening shows shadow, not the shell's inside
pad = shell(0.9); boolean(pad, cuts[1]); pad.data.materials.clear(); pad.data.materials.append(DARK)
# ear hole
bpy.ops.mesh.primitive_cylinder_add(radius=0.1, depth=0.05, location=(-0.05, -0.905, -0.18), rotation=(math.radians(90), 0, 0))
bpy.context.object.data.materials.append(DARK); bpy.ops.object.shade_smooth()

# my team's picture as a sticker on the side: a fine grid wrapped onto the shell, under the same clear coat
import os
LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logo.png')
if os.path.exists(LOGO):
    tgt = shell(1.0); tgt.hide_render = tgt.hide_viewport = True
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=60, y_subdivisions=60, size=1.05, location=(0.05, -1.3, 0.45), rotation=(math.radians(90), 0, 0))
    dec = bpy.context.object
    sw = dec.modifiers.new('w', 'SHRINKWRAP'); sw.target = tgt; sw.wrap_method = 'NEAREST_SURFACEPOINT'; sw.offset = 0.004
    bpy.ops.object.shade_smooth()
    dm = bpy.data.materials.new('logo'); dm.use_nodes = True; nt = dm.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(LOGO); tex.extension = 'CLIP'
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color']); nt.links.new(tex.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.2
    if 'Coat Weight' in b.inputs: b.inputs['Coat Weight'].default_value = 1.0
    dec.data.materials.append(dm)

# facemask: tubes along bezier curves
def bar(points, r=0.045):
    cu = bpy.data.curves.new('bar', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = r; cu.bevel_resolution = 6
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = Vector(p); bp.handle_left_type = bp.handle_right_type = 'AUTO'
    o = bpy.data.objects.new('bar', cu); sc.collection.objects.link(o); o.data.materials.append(MASK)
for z, out in ((-0.05, 1.18), (-0.33, 1.2), (-0.6, 1.1)):
    bar([(0.55, -0.84, z + 0.08), (1.0, -0.6, z), (out, 0, z), (1.0, 0.6, z), (0.55, 0.84, z + 0.08)])
bar([(1.13, 0, 0.12), (1.2, 0, -0.33), (1.1, 0, -0.6)])
for y in (-0.42, 0.42):
    bar([(1.08, y, 0.06), (1.12, y * 1.05, -0.33), (1.0, y * 0.95, -0.6)], 0.04)
# side mounts up to the shell
for y in (-0.84, 0.84):
    bar([(0.55, y, 0.03), (0.6, y * 1.02, -0.3), (0.5, y * 0.97, -0.52)], 0.05)

for c in cuts: c.hide_render = True; c.hide_viewport = True
# camera: three-quarter view, helmet facing right
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (3.4, -5.0, 1.9); cam.data.lens = 70
cam.rotation_euler = (Vector((0.08, 0, -0.02)) - cam.location).to_track_quat('-Z', 'Y').to_euler()

def light(loc, energy, size, color=(1, 1, 1)):
    l = bpy.data.objects.new('l', bpy.data.lights.new('l', 'AREA')); sc.collection.objects.link(l)
    l.location = loc; l.data.energy = energy; l.data.size = size; l.data.color = color
    l.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
light((-3, -4, 5), 220 if LOOK == 'white' else 330, 4)                    # big soft key, top left
light((4, 3, 2), 260, 2, (0.55, 0.75, 1))     # cool rim from behind right
light((-4, 3, -1), 160, 2, (1, 1, 1))          # rim on the back edge
light((3, -3, -3), 30, 3)                     # fill from below
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.03, 0.05, 1)

sc.render.engine = 'CYCLES'; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = SIZE
sc.render.filepath = OUT; sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
try: sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
except TypeError: pass
bpy.ops.render.render(write_still=True)
print('RENDERED', OUT)
