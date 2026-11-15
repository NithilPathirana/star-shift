"""Quick look at the cleaned NASA suit model with one flat colour per part, to see which part is which before it goes on the rocket.
AI-written (Claude). Run: blender -b --factory-startup -P emu_test.py"""
import bpy, os, sys, math
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import emu_prep
OUT = os.path.join(HERE, '..', 'inspect')
bpy.ops.wm.read_factory_settings(use_empty=True)
def flat(name, c, metal=0.0, rough=0.6):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough; return m
MATS = {'suit': flat('suit', (0.85, 0.86, 0.88)), 'metal': flat('metal', (0.35, 0.36, 0.4), 0.8, 0.4), 'stripe': flat('stripe', (0.9, 0.95, 0.05)),
        'gold': flat('gold', (0.9, 0.6, 0.1), 1.0, 0.15), 'gold2': flat('gold2', (0.1, 0.9, 0.2)), 'trim': flat('trim', (0.9, 0.3, 0.9)),
        'visor': flat('visor', (0.9, 0.1, 0.1)), 'skin': flat('skin', (0, 0, 0)), 'ring': flat('ring', (0.1, 0.3, 0.95)),
        'patch': flat('patch', (0.1, 0.9, 0.9)), 'label': flat('label', (0.02, 0.04, 0.2)), 'panel': flat('panel', (0.55, 0.75, 0.55))}
ob = emu_prep.load_emu(MATS, face_x=False, where=emu_prep.ANCHOR)
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
sc.cycles.samples = 24; sc.cycles.use_denoising = True; sc.render.resolution_x, sc.render.resolution_y = 700, 900
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.09, 0.1, 0.13, 1)
cd = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam; cd.lens = 70; cd.clip_end = 1e5
for nm, e in (('key', (55, 0, 150)), ('fill', (60, 0, -60)), ('back', (60, 0, 20))):
    sd = bpy.data.lights.new(nm, 'SUN'); sd.energy = 3 if nm == 'key' else 1.5; s_ = bpy.data.objects.new(nm, sd); sc.collection.objects.link(s_); s_.rotation_euler = tuple(math.radians(x) for x in e)
ctr = Vector((0.0, -0.2, 1.05))
for nm, pos, tgt in (('front', ctr + Vector((0.4, 5.2, 0.4)), ctr), ('q34', ctr + Vector((3.6, 3.8, 0.8)), ctr), ('side', ctr + Vector((5.2, 0.3, 0.3)), ctr),
                     ('helmet', Vector((0.55, 1.35, 2.0)), Vector((0.02, -0.1, 1.86)))):
    cam.location = pos; cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, f'cat_{nm}.png'); bpy.ops.render.render(write_still=True)
print('DONE emu_test')
