# C2B:CHUNK setup
import bpy
import math

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

def c2b_material(name, color, roughness=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
    return m

def c2b_rounded_box(name, size, location, radius=0.06, seg=4):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    bevel = obj.modifiers.new("Bevel", "BEVEL")
    bevel.width = radius
    bevel.segments = seg
    return obj

FABRIC = c2b_material("C2B_Fabric", (0.42, 0.45, 0.52), 0.85)
FRAME_MAT = c2b_material("C2B_Frame", (0.25, 0.18, 0.12), 0.6)
# C2B:END

# C2B:CHUNK frame
W, D = 2.2, 0.95
seat_h = 0.42
c2b_rounded_box("C2B_Frame_Base", (W, D, 0.25), (0, 0, seat_h - 0.12)).data.materials.append(FABRIC)
c2b_rounded_box("C2B_Frame_Back", (W, 0.18, 0.75), (0, -D / 2 + 0.09, seat_h + 0.25)).data.materials.append(FRAME_MAT)
# C2B:END

# C2B:CHUNK cushions
for i in range(3):
    x = -W / 2 + 0.38 + i * (W - 0.76) / 2
    c2b_rounded_box(f"C2B_Seat_{i + 1}", ((W - 0.2) / 3, D - 0.16, 0.16), (x, 0.02, seat_h + 0.08), 0.05).data.materials.append(FABRIC)
for i in range(3):
    x = -W / 2 + 0.38 + i * (W - 0.76) / 2
    c2b_rounded_box(f"C2B_Back_{i + 1}", ((W - 0.2) / 3, 0.16, 0.42), (x, -D / 2 + 0.22, seat_h + 0.42), 0.05).data.materials.append(FABRIC)
# C2B:END

# C2B:CHUNK arms
for side in (-1, 1):
    arm = c2b_rounded_box(f"C2B_Arm_{'L' if side < 0 else 'R'}", (0.22, D, 0.55), (side * (W / 2 - 0.11), 0, seat_h + 0.1), 0.07)
    arm.data.materials.append(FABRIC)
# C2B:END

# C2B:CHUNK legs
leg_positions = [(-W / 2 + 0.15, -D / 2 + 0.15), (W / 2 - 0.15, -D / 2 + 0.15), (-W / 2 + 0.15, D / 2 - 0.15), (W / 2 - 0.15, D / 2 - 0.15)]
for i, (x, y) in enumerate(leg_positions):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=0.18, location=(x, y, 0.09))
    leg = bpy.context.active_object
    leg.name = f"C2B_Leg_{i + 1}"
    leg.data.materials.append(FRAME_MAT)
# C2B:END

# C2B:CHUNK details
bpy.ops.object.select_all(action="DESELECT")
for obj in bpy.data.objects:
    if obj.name.startswith("C2B_"):
        obj.select_set(True)
bpy.context.view_layer.objects.active = bpy.data.objects.get("C2B_Frame_Base")
bpy.ops.object.shade_smooth()
print("C2B: sofa complete -", len(bpy.data.objects), "objects")
# C2B:END
