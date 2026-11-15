"""Second look at NASA's EMU model: makes every material opaque, counts the loose parts the single mesh is made of (to see whether
limbs can be turned at the joints without a rig), and renders it plain white from four sides plus once with each loose part in its
own colour. Read-only on the source. AI-written (Claude). Run: blender -b --factory-startup -P inspect_emu2.py"""
import bpy, bmesh, os, json, math, random
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'src', 'Extravehicular Mobility Unit.glb')
OUT = os.path.join(HERE, '..', 'inspect'); os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
ob = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = ob.data
# islands
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
seen = [False] * len(bm.verts); islands = []
for v in bm.verts:
    if seen[v.index]: continue
    stack = [v]; seen[v.index] = True; idx = []
    while stack:
        u = stack.pop(); idx.append(u.index)
        for e in u.link_edges:
            w = e.other_vert(u)
            if not seen[w.index]: seen[w.index] = True; stack.append(w)
    islands.append(idx)
info = []
for k, idx in enumerate(islands):
    cs = [bm.verts[i].co for i in idx]
    lo = Vector((min(c[j] for c in cs) for j in range(3))); hi = Vector((max(c[j] for c in cs) for j in range(3)))
    info.append({'i': k, 'verts': len(idx), 'min': [round(x, 3) for x in lo], 'max': [round(x, 3) for x in hi]})
info.sort(key=lambda d: -d['verts'])
json.dump({'islands': len(islands), 'top': info[:120], 'mat_faces': {}}, open(os.path.join(OUT, 'islands.json'), 'w'), indent=0)
print('ISLANDS', len(islands), 'largest', [d['verts'] for d in info[:12]])
# per-island colour attribute
col = bm.loops.layers.color.new('isl'); random.seed(3)
cmap = {}
for k, idx in enumerate(islands):
    c = (random.random(), random.random(), random.random(), 1)
    for i in idx: cmap[i] = c
for f in bm.faces:
    for l in f.loops: l[col] = cmap[l.vert.index]
bm.to_mesh(me); bm.free()
def flat(name, vertex_colour):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = 0.7
    if vertex_colour:
        a = m.node_tree.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'isl'; m.node_tree.links.new(a.outputs['Color'], b.inputs['Base Color'])
    else: b.inputs['Base Color'].default_value = (0.8, 0.82, 0.86, 1)
    return m
WHITE, ISL = flat('white', False), flat('isl', True)
sc = bpy.context.scene; sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dt in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = dt; prefs.get_devices()
            for d_ in prefs.devices: d_.use = True
            sc.cycles.device = 'GPU'; break
        except Exception: pass
except Exception: pass
sc.cycles.samples = 24; sc.cycles.use_denoising = True; sc.render.resolution_x, sc.render.resolution_y = 760, 960
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.06, 0.08, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
lo = Vector((min((ob.matrix_world @ Vector(c))[j] for c in ob.bound_box) for j in range(3))); hi = Vector((max((ob.matrix_world @ Vector(c))[j] for c in ob.bound_box) for j in range(3)))
ctr = (lo + hi) / 2; size = max(hi[i] - lo[i] for i in range(3))
cd = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam; cd.lens = 70; cd.clip_end = 1e5
for nm, e in (('key', (50, 0, 30)), ('fill', (60, 0, 200))):
    sd = bpy.data.lights.new(nm, 'SUN'); sd.energy = 3 if nm == 'key' else 1.2; s_ = bpy.data.objects.new(nm, sd); sc.collection.objects.link(s_); s_.rotation_euler = tuple(math.radians(x) for x in e)
def shoot(tag, mat):
    for i in range(len(ob.material_slots)): ob.material_slots[i].material = mat
    for nm, dirv in (('front', Vector((0, -1, 0.1))), ('side', Vector((1, 0, 0.1))), ('back', Vector((0, 1, 0.1))), ('top', Vector((0, -0.2, 1)))):
        cam.location = ctr + dirv.normalized() * size * 2.6; cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(OUT, f'{tag}_{nm}.png'); bpy.ops.render.render(write_still=True)
shoot('white', WHITE); shoot('isl', ISL)
print('DONE inspect2 bbox', [round(x, 3) for x in lo], [round(x, 3) for x in hi])
