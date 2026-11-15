"""Loads NASA's EMU spacesuit model for the Star Shift loader (scene v7) and makes it safe to show:
every original material and every texture image is thrown away (so the flag, the patch and the chest lettering cannot render),
the head inside the helmet is deleted (the rider stays faceless), and the model's parts are given the scene's own materials.
Source: NASA 3D Resources, "Extravehicular Mobility Unit" (public domain). See ../SOURCE.md. AI-written (Claude)."""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'Extravehicular Mobility Unit.glb')
# what each of the model's 25 materials is, by its name's ending
CAT = {
    'lambert2SG': 'suit', 'emusuit5_lambert2SG': 'suit', 'emusuit4_justbody_lambert2SG': 'suit', 'body_lambert2SG': 'suit',
    'blinn2SG': 'metal', 'emusuit5_blinn2SG': 'metal',
    'lambert4SG': 'stripe',
    'blinn3SG': 'gold', 'emusuit5_blinn3SG': 'gold', 'blinn1SG': 'gold2', 'emusuit5_blinn1SG': 'gold2', 'emusuit4_justbody_blinn3SG': 'trim',
    'emusuit5_lambert3SG': 'visor', 'lambert3SG': 'skin',
    'blinn12SG': 'ring',
    'lambert8SG': 'patch', 'lambert9SG': 'patch', 'lambert7SG': 'label',
    'jetpack2SG': 'panel', 'emusuit5_jetpack2SG': 'panel', 'lambert5SG': 'panel', 'emusuit5_lambert5SG': 'panel', 'initialShadingGroup': 'panel',
    'lambert10SG': 'label', 'lambert11SG': 'label',
}
def category(name):
    n = name.split(':')[-1].replace('emusuit21_', '')
    return CAT.get(n.split('.')[0], 'suit')
ANCHOR = Vector((0.0, -0.1, 0.477))        # the point under the body, at the bottom of the manoeuvring unit; the model faces +Y, Z is up
def load_emu(mats, scale=1.0, where=(0, 0, 0), face_x=True, delete=('skin',)):
    """mats: category -> material (missing ones fall back to mats['suit']). Returns the mesh object, placed with ANCHOR at `where`."""
    old_obs, old_mats, old_imgs = set(bpy.data.objects), set(bpy.data.materials), set(bpy.data.images)
    bpy.ops.import_scene.gltf(filepath=SRC)
    new = [o for o in bpy.data.objects if o not in old_obs]
    ob = [o for o in new if o.type == 'MESH'][0]; me = ob.data
    me.transform(ob.matrix_world); ob.parent = None; ob.matrix_world = Matrix.Identity(4)
    for o in new:
        if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
    cats = [category(s.material.name) for s in ob.material_slots]
    bm = bmesh.new(); bm.from_mesh(me)
    kill = [f for f in bm.faces if cats[f.material_index] in delete]
    if kill: bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me); bm.free()
    for o in bpy.context.selected_objects: o.select_set(False)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    try: bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception as e: print('EMU normals clear failed', e)
    for p in me.polygons: p.use_smooth = True
    try: me.set_sharp_from_angle(angle=math.radians(38)); print('EMU sharp-from-angle ok')
    except Exception as e: print('EMU set_sharp_from_angle failed', e)
    for i, s in enumerate(ob.material_slots): s.material = mats.get(cats[i], mats['suit'])
    for m in [m for m in bpy.data.materials if m not in old_mats]: bpy.data.materials.remove(m)      # the originals, with their textures
    for im in [im for im in bpy.data.images if im not in old_imgs]: bpy.data.images.remove(im)       # flag, patch and chest lettering images
    rot = Matrix.Rotation(math.radians(-90), 4, 'Z') if face_x else Matrix.Identity(4)
    me.transform(Matrix.Translation(Vector(where)) @ Matrix.Scale(scale, 4) @ rot @ Matrix.Translation(-ANCHOR))
    me.update(); ob.name = 'emu_suit'
    print('EMU loaded: faces', len(me.polygons), 'deleted', len(kill), 'images left', len([im for im in bpy.data.images if im not in old_imgs]))
    return ob
# ---------------- putting the suit on the Star Shift rocket (scene v7) ----------------
SCALE = 0.85            # the model is 2.05 m tall; on the rocket it stands 0.85 as large
HULL_Z = 0.75           # the model height (just above the knee) that sits at the hull's top line: the rider stands in a hatch
def scene_mats():
    """The scene's own materials, by name, for each part of the suit. Nothing of the original model's look is kept."""
    D = bpy.data.materials
    suit = D.get('emu_fabric')
    if suit is None:
        suit = D['suit_fabric'].copy(); suit.name = 'emu_fabric'       # same fabric, but finer: the suit is one big mesh, not many small parts
        for n in suit.node_tree.nodes:
            if n.type == 'TEX_WAVE': n.inputs['Scale'].default_value = 90.0
            if n.type == 'TEX_NOISE': n.inputs['Scale'].default_value = 16.0
            if n.type == 'BUMP': n.inputs['Strength'].default_value = min(n.inputs['Strength'].default_value, 0.22)
    dark = D.get('hatch_dark')
    if dark is None:
        dark = D.new('hatch_dark'); dark.use_nodes = True; b = dark.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (0.004, 0.006, 0.012, 1); b.inputs['Roughness'].default_value = 0.9
    return {'suit': suit, 'panel': D['suit_shell'], 'metal': D['blued_steel'], 'stripe': D['volt_paint'], 'gold': D['rivet'], 'gold2': D['lamp'],
            'trim': D['visor'], 'visor': D['navy_trim'], 'ring': D['blue_band'], 'patch': D['blue_band'], 'label': D['navy_trim'], 'dark': dark,
            'navy': D['navy_trim'], 'volt': D['volt_paint']}
def torso_rot(a):
    """The rider's lean, from the loop angle a (whole cycles per loop): a slow sway, 4 degrees forward into the motion."""
    return (math.radians(1.5 * math.sin(a + 1.0)), math.radians(4.0 + 1.5 * math.sin(a + 2.6)), 0.0)
def mount(rig, torso, R, SEAT_X, torso_rest, rig_rest):
    """Stands the cleaned suit in a hatch on top of the hull at SEAT_X. The suit hangs from `torso`; the hatch belongs to `rig`."""
    M = scene_mats()
    where = Vector((SEAT_X, 0.0, R - (HULL_Z - ANCHOR.z) * SCALE))
    ob = load_emu(M, scale=SCALE, where=where)
    ob.parent = torso; ob.matrix_parent_inverse = Matrix.Translation(-Vector(torso_rest))
    cx = SEAT_X + 0.05
    def own(name, m):
        o = bpy.context.active_object; o.name = name; o.data.materials.append(m)
        for p in o.data.polygons: p.use_smooth = True
        o.parent = rig; o.matrix_parent_inverse = Matrix.Translation(-Vector(rig_rest)); return o
    bpy.ops.mesh.primitive_cylinder_add(vertices=72, radius=0.335, depth=0.21, location=(cx, 0, R - 0.05)); c = own('hatch_coaming', M['navy'])
    try: c.data.set_sharp_from_angle(angle=math.radians(40))
    except Exception: pass
    bpy.ops.mesh.primitive_cylinder_add(vertices=72, radius=0.305, depth=0.012, location=(cx, 0, R + 0.056)); own('hatch_well', M['dark'])
    bpy.ops.mesh.primitive_torus_add(major_radius=0.335, minor_radius=0.02, major_segments=72, minor_segments=14, location=(cx, 0, R + 0.055)); own('hatch_rim', M['volt'])
    bpy.ops.mesh.primitive_torus_add(major_radius=0.335, minor_radius=0.009, major_segments=72, minor_segments=10, location=(cx, 0, R + 0.005)); own('hatch_band', M['ring'])
    print('EMU mounted at', [round(v, 3) for v in where], 'top', round(where.z + (2.051 - ANCHOR.z) * SCALE, 3))
    return ob
def emu_point(p, scale=1.0, where=(0, 0, 0), face_x=True):
    """Where a point of the original model ends up after load_emu's placement."""
    rot = Matrix.Rotation(math.radians(-90), 4, 'Z') if face_x else Matrix.Identity(4)
    return (Matrix.Translation(Vector(where)) @ Matrix.Scale(scale, 4) @ rot @ Matrix.Translation(-ANCHOR)) @ Vector(p)
