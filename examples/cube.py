# Stage 1: the smallest possible proof that the loop works.
import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1))
cube = bpy.context.active_object
cube.name = "C2B_Cube"

mat = bpy.data.materials.new("C2B_Cube_Mat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs["Base Color"].default_value = (0.85, 0.35, 0.2, 1.0)
cube.data.materials.append(mat)

print("C2B: cube created")
