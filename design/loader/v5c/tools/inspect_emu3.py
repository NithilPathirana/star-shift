"""Third look at NASA's EMU model: which of the 25 materials covers what. Reports, for each material, how many faces it has and
the box it occupies, and renders the model with only the "jetpack" materials hidden, to see the suit without the manoeuvring unit.
Read-only on the source. AI-written (Claude). Run: blender -b --factory-startup -P inspect_emu3.py"""
import bpy, bmesh, os, json, math
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
stats = {}
for p in me.polygons:
    nm = ob.material_slots[p.material_index].material.name
    s = stats.setdefault(nm, {'faces': 0, 'min': [1e9] * 3, 'max': [-1e9] * 3, 'base': None})
    s['faces'] += 1
    for vi in p.vertices:
        c = me.vertices[vi].co
        for j in range(3): s['min'][j] = min(s['min'][j], c[j]); s['max'][j] = max(s['max'][j], c[j])
for nm, s in stats.items():
    m = bpy.data.materials[nm]; b = m.node_tree.nodes.get('Principled BSDF') if m.use_nodes else None
    if b: s['base'] = [round(v, 3) for v in b.inputs['Base Color'].default_value]; s['alpha'] = round(b.inputs['Alpha'].default_value, 3)
    s['min'] = [round(v, 3) for v in s['min']]; s['max'] = [round(v, 3) for v in s['max']]
json.dump(stats, open(os.path.join(OUT, 'materials.json'), 'w'), indent=1)
for nm, s in sorted(stats.items(), key=lambda kv: -kv[1]['faces']): print('MAT', nm.replace('EMU:emusuit21_', '').ljust(34), str(s['faces']).rjust(7), s['min'], s['max'], 'base', s.get('base'), 'a', s.get('alpha'))
# hide the manoeuvring unit: delete faces whose material name has 'jetpack'
bm = bmesh.new(); bm.from_mesh(me)
kill = [f for f in bm.faces if 'jetpack' in ob.material_slots[f.material_index].material.name]
print('JETPACK faces', len(kill), 'of', len(bm.faces))
bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(me); bm.free()
PAL = [(0.9, 0.2, 0.2), (0.2, 0.6, 0.9), (0.2, 0.8, 0.3), (0.95, 0.8, 0.1), (0.7, 0.3, 0.9), (0.1, 0.8, 0.8), (0.95, 0.5, 0.1), (0.5, 0.5, 0.5), (0.9, 0.9, 0.9), (0.3, 0.3, 0.7), (0.6, 0.9, 0.4), (0.9, 0.4, 0.7)]
legend = {}
for i, slot in enumerate(ob.material_slots):
    m = slot.material; m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled'); c = PAL[i % len(PAL)]
    b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Roughness'].default_value = 0.7; nt.links.new(b.outputs[0], o.inputs['Surface'])
    try: m.blend_method = 'OPAQUE'
    except Exception: pass
    legend[m.name] = c
json.dump(legend, open(os.path.join(OUT, 'material_legend.json'), 'w'), indent=1)
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
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.06, 0.08, 1)
lo = Vector((min(v.co[j] for v in me.vertices) for j in range(3))); hi = Vector((max(v.co[j] for v in me.vertices) for j in range(3)))
ctr = (lo + hi) / 2; size = max(hi[i] - lo[i] for i in range(3))
cd = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam; cd.lens = 70; cd.clip_end = 1e5
for nm, e in (('key', (50, 0, 30)), ('fill', (60, 0, 200))):
    sd = bpy.data.lights.new(nm, 'SUN'); sd.energy = 3 if nm == 'key' else 1.5; s_ = bpy.data.objects.new(nm, sd); sc.collection.objects.link(s_); s_.rotation_euler = tuple(math.radians(x) for x in e)
for nm, dirv in (('front', Vector((0.3, -1, 0.1))), ('side', Vector((1, 0, 0.1))), ('back', Vector((-0.3, 1, 0.1)))):
    cam.location = ctr + dirv.normalized() * size * 2.6; cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, f'nojet_{nm}.png'); bpy.ops.render.render(write_still=True)
print('DONE inspect3 bbox without jetpack', [round(x, 3) for x in lo], [round(x, 3) for x in hi])
