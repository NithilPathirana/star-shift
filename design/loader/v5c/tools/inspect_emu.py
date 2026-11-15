"""Opens NASA's EMU spacesuit model and reports what is in it: objects, meshes, materials, images, any armature, and sizes; then
writes two quick look renders and every embedded texture as PNG (to find logos, flags and patches). Read-only on the source file.
AI-written (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
Run: blender -b --factory-startup -P inspect_emu.py"""
import bpy, os, json, math
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'src', 'Extravehicular Mobility Unit.glb')
OUT = os.path.join(HERE, '..', 'inspect'); os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
rep = {'objects': [], 'materials': [], 'images': [], 'armatures': []}
lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
for ob in bpy.data.objects:
    d = {'name': ob.name, 'type': ob.type, 'parent': ob.parent.name if ob.parent else None, 'loc': [round(v, 3) for v in ob.location], 'scale': [round(v, 3) for v in ob.scale]}
    if ob.type == 'MESH':
        me = ob.data
        d.update(verts=len(me.vertices), faces=len(me.polygons), mats=[s.material.name if s.material else None for s in ob.material_slots], vgroups=len(ob.vertex_groups),
                 modifiers=[m.type for m in ob.modifiers], uv=len(me.uv_layers))
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3))); hi = Vector((max(hi[i], w[i]) for i in range(3)))
        d['bbox_world'] = [[round(v, 3) for v in (ob.matrix_world @ Vector(ob.bound_box[0]))], [round(v, 3) for v in (ob.matrix_world @ Vector(ob.bound_box[6]))]]
    if ob.type == 'ARMATURE':
        rep['armatures'].append({'name': ob.name, 'bones': [b.name for b in ob.data.bones]})
    rep['objects'].append(d)
for m in bpy.data.materials:
    tex = []
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image: tex.append(n.image.name)
    rep['materials'].append({'name': m.name, 'textures': tex})
for im in bpy.data.images:
    if im.size[0] == 0: continue
    safe = ''.join(c if c.isalnum() else '_' for c in im.name)[:60]
    p = os.path.join(OUT, 'tex_' + safe + '.png')
    try:
        im.save_render(p) if False else None
        im2 = im.copy(); im2.filepath_raw = p; im2.file_format = 'PNG'; im2.save()
    except Exception as e:
        p = 'could not save: ' + str(e)
    rep['images'].append({'name': im.name, 'size': list(im.size), 'saved': p})
rep['bbox'] = {'min': [round(v, 3) for v in lo], 'max': [round(v, 3) for v in hi], 'size': [round(hi[i] - lo[i], 3) for i in range(3)]}
rep['actions'] = [a.name for a in bpy.data.actions]
json.dump(rep, open(os.path.join(OUT, 'report.json'), 'w', encoding='utf8'), indent=1)
print('REPORT objects', len(rep['objects']), 'meshes', sum(1 for o in rep['objects'] if o['type'] == 'MESH'), 'materials', len(rep['materials']), 'images', len(rep['images']),
      'armatures', len(rep['armatures']), 'bbox', rep['bbox'])

# two quick looks: front-left and back-right
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
sc.cycles.samples = 24; sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 900, 1100
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.37, 0.4, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.2
ctr = (lo + hi) / 2; size = max(hi[i] - lo[i] for i in range(3))
cd = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam; cd.lens = 60; cd.clip_end = 100000
sd = bpy.data.lights.new('s', 'SUN'); sd.energy = 3; sun = bpy.data.objects.new('s', sd); sc.collection.objects.link(sun); sun.rotation_euler = (math.radians(50), 0, math.radians(30))
for nm, dirv in (('front', Vector((0.55, -1.0, 0.25))), ('back', Vector((-0.55, 1.0, 0.25))), ('side', Vector((1.0, 0.05, 0.1)))):
    cam.location = ctr + dirv.normalized() * size * 2.3
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, 'look_' + nm + '.png'); bpy.ops.render.render(write_still=True)
print('DONE inspect')
