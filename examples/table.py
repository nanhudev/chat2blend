# Stage 2: a table with a top, four legs and a material.
import bpy
import mathutils

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

W, D, H, T = 1.8, 0.9, 0.75, 0.05


def mat(name, color, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = rough
    return m


wood = mat("C2B_Wood", (0.45, 0.28, 0.15), 0.6)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, H))
top = bpy.context.active_object
top.name = "C2B_TableTop"
top.scale = (W, D, T)
bpy.ops.object.transform_apply(scale=True)
top.data.materials.append(wood)

leg_positions = [(-W / 2 + 0.08, -D / 2 + 0.08), (W / 2 - 0.08, -D / 2 + 0.08), (-W / 2 + 0.08, D / 2 - 0.08), (W / 2 - 0.08, D / 2 - 0.08)]
for i, (x, y) in enumerate(leg_positions):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=H, location=(x, y, H / 2))
    leg = bpy.context.active_object
    leg.name = f"C2B_Leg_{i + 1}"
    leg.data.materials.append(wood)

print("C2B: table created", len(bpy.data.objects), "objects")
