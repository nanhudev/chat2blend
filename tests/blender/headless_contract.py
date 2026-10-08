"""Runs against Blender's real bpy and the production Executor, in a fresh process."""
import json
import math
import sys
from pathlib import Path

import bpy

root, output = [Path(p) for p in sys.argv[sys.argv.index('--') + 1:]]
sys.path.insert(0, str(root / 'blender_addon'))
from chat2blend.executor import Executor

checks = []


def check(name, ok):
    checks.append({'name': name, 'ok': bool(ok)})
    if not ok:
        raise AssertionError(name)


executor = Executor()
executor.job_begin('sofa', 'contract sofa', 'synthetic')
chunks = json.loads((output / 'chunks.json').read_text(encoding='utf-8'))
results = [executor.execute('sofa', str(i), c['name'], i, c['code']) for i, c in enumerate(chunks)]
check('six chunks executed successfully with shared helpers', len(results) == 6 and all(r['status'] == 'completed' for r in results))
expected = {'C2B_Frame_Base', 'C2B_Frame_Back', 'C2B_Arm_L', 'C2B_Arm_R'}
expected.update(f'C2B_{kind}_{i}' for kind, count in [('Seat', 3), ('Back', 3), ('Leg', 4)] for i in range(1, count + 1))
objects = list(bpy.data.objects)
check('exact expected 14 mesh objects; default cube cannot fake success', {o.name for o in objects} == expected and all(o.type == 'MESH' for o in objects))
bpy.context.view_layer.update()
check('all geometry has finite positive dimensions', all(all(math.isfinite(v) and v > 0 for v in o.dimensions) for o in objects))
check('all meshes have assigned materials', all(len(o.data.materials) > 0 for o in objects))

# Deliver the actual geometry, plus an inspection render, before testing failure isolation.
bpy.ops.wm.save_as_mainfile(filepath=str(output / 'sofa.blend'))
bpy.ops.object.camera_add(location=(3.6, 4.2, 2.8))
camera = bpy.context.object
from mathutils import Vector
camera.rotation_euler = (Vector((0, 0, 0.65)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = camera
bpy.ops.object.light_add(type='AREA', location=(1, 2, 4))
bpy.context.object.data.energy = 900
bpy.context.object.data.size = 5
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.use_denoising = False
for layer in scene.view_layers:
    layer.cycles.use_denoising = False
scene.cycles.samples = 16
scene.render.resolution_x = 900
scene.render.resolution_y = 600
scene.render.resolution_percentage = 100
scene.world.color = (0.25, 0.25, 0.25)
scene.render.filepath = str(output / 'sofa.png')
bpy.ops.render.render(write_still=True)
check('real render and editable blend artifacts exist', (output / 'sofa.png').stat().st_size > 1000 and (output / 'sofa.blend').stat().st_size > 1000)

failed = executor.execute('sofa', 'failure', 'failure', 6, "raise RuntimeError('contract failure')")
check('runtime error is reported as failed', failed['status'] == 'failed' and 'contract failure' in failed['error'])
executor.job_end('sofa', 'failed')
check('ending a job releases its namespace', not executor.has_namespace('sofa'))
executor.job_begin('recovery')
recovery = executor.execute('recovery', 'recovery', 'recovery', 0, "assert 'c2b_rounded_box' not in globals()\nimport bpy\nbpy.ops.mesh.primitive_cube_add()\nbpy.context.object.name = 'C2B_Recovery'")
check('next job starts clean and creates real geometry', recovery['status'] == 'completed' and bpy.data.objects.get('C2B_Recovery') is not None)
executor.job_end('recovery', 'completed')
report = {'ok': True, 'scope': 'synthetic-parser-real-blender-executor', 'providerVerified': False, 'guiVerified': False,
          'blender': bpy.app.version_string, 'chunks': len(chunks), 'sofaObjects': len(objects), 'checks': checks}
(output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('C2B_CONTRACT_PASS')
