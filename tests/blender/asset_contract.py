import json
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector

root, output = [Path(p) for p in sys.argv[sys.argv.index('--') + 1:]]
sys.path.insert(0, str(root / 'blender_addon'))
from chat2blend.asset_pipeline import build_robot

manifest = build_robot(output)
raw = (output / 'robot.glb').read_bytes()
magic, version, length = struct.unpack('<III', raw[:12])
assert magic == 0x46546C67 and version == 2 and length == len(raw)
chunk_length, chunk_type = struct.unpack('<II', raw[12:20])
assert chunk_type == 0x4E4F534A
gltf = json.loads(raw[20:20 + chunk_length])
assert len(gltf['meshes']) == 19
assert gltf['skins'] and len(gltf['skins'][0]['joints']) == 15
assert gltf['animations'] and gltf['animations'][0]['channels']
assert all('TEXCOORD_0' in p['attributes'] and 'JOINTS_0' in p['attributes'] and 'WEIGHTS_0' in p['attributes']
           for mesh in gltf['meshes'] for p in mesh['primitives'])
assert gltf['images'] and all('bufferView' in image for image in gltf['images'])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(output / 'robot.glb'))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith('C2B_')]
rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
assert len(meshes) == 19 and len(rigs) == 1, [(o.name, o.type) for o in bpy.context.scene.objects]
assert len(rigs[0].data.bones) == 15
scene = bpy.context.scene
scene.frame_set(1)
hand = next(o for o in meshes if 'Hand_L' in o.name)

def point():
    obj = hand.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return obj.matrix_world @ obj.data.vertices[0].co

p1 = point()
scene.frame_set(20)
assert (point() - p1).length > 0.05, 'Imported animation must deform real geometry'
manifest['checks'].update({'glb_roundtrip_meshes': True, 'glb_roundtrip_skin': True,
                          'glb_embedded_textures': True, 'glb_roundtrip_animation_deforms': True})
scene.frame_set(20)
bpy.ops.object.camera_add(location=(3.4, -5.2, 2.6))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 1.0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
bpy.ops.object.light_add(type='AREA', location=(2, -4, 5))
bpy.context.object.data.energy = 1000
bpy.context.object.data.size = 5
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x, scene.render.resolution_y = 900, 900
scene.render.resolution_percentage = 100
scene.world.color = (0.25, 0.25, 0.25)
scene.render.filepath = str(output / 'robot.png')
bpy.ops.render.render(write_still=True)
(output / 'asset.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print('C2B_ASSET_CONTRACT_PASS')
