"""Articulated hard-surface asset recipe with real UVs, PBR maps, skin and GLB.

Uses rigid weights for robot components. It does not pretend to auto-rig organic meshes.
Call build_robot(output, options) in a NEW Blender scene/process.
"""
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


def build_robot(output, options=None):
    options = options or {}
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    parts = []
    bones = {}
    color = options.get('color', [0.16, 0.55, 0.72])
    if len(color) != 3 or any(not isinstance(v, (int, float)) or not 0 <= v <= 1 for v in color):
        raise ValueError('color must be three numbers in [0,1]')
    scale = float(options.get('scale', 1))
    if not math.isfinite(scale) or not 0.25 <= scale <= 3:
        raise ValueError('scale must be in [0.25,3]')

    def part(name, size, location, bone):
        bpy.ops.mesh.primitive_cube_add(size=1, location=location)
        obj = bpy.context.object
        obj.name = 'C2B_' + name
        obj.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        bevel = obj.modifiers.new('manufactured_edges', 'BEVEL')
        bevel.width = min(size) * 0.12
        bevel.segments = 2
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        parts.append(obj)
        bones[obj.name] = bone
        return obj

    part('Torso', (0.65, 0.36, 0.62), (0, 0, 1.32), 'spine')
    part('Pelvis', (0.51, 0.32, 0.25), (0, 0, 0.93), 'root')
    part('Neck', (0.18, 0.20, 0.12), (0, 0, 1.70), 'head')
    part('Head', (0.50, 0.42, 0.40), (0, 0, 1.94), 'head')
    part('Visor', (0.39, 0.035, 0.13), (0, -0.225, 1.99), 'head')
    for side, sign in [('L', 1), ('R', -1)]:
        part('Shoulder_' + side, (0.20, 0.30, 0.25), (sign * 0.44, 0, 1.55), 'upper_arm.' + side)
        part('UpperArm_' + side, (0.34, 0.21, 0.21), (sign * 0.69, 0, 1.55), 'upper_arm.' + side)
        part('Forearm_' + side, (0.35, 0.22, 0.23), (sign * 1.07, 0, 1.55), 'forearm.' + side)
        part('Hand_' + side, (0.16, 0.21, 0.24), (sign * 1.34, 0, 1.55), 'hand.' + side)
        part('Thigh_' + side, (0.22, 0.26, 0.38), (sign * 0.18, 0, 0.61), 'thigh.' + side)
        part('Shin_' + side, (0.19, 0.23, 0.32), (sign * 0.18, 0, 0.24), 'shin.' + side)
        part('Foot_' + side, (0.26, 0.42, 0.12), (sign * 0.18, -0.075, 0.06), 'foot.' + side)

    # All components participate in one smart-projected atlas. No placeholder UV layer.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.025)
    bpy.ops.object.mode_set(mode='OBJECT')

    textures = {}
    size = 256
    rng = random.Random(42)
    for kind in ['base_color', 'roughness', 'normal']:
        image = bpy.data.images.new('C2B_' + kind, width=size, height=size, alpha=True)
        pixels = []
        for y in range(size):
            for x in range(size):
                if kind == 'base_color':
                    shade = 0.85 + rng.random() * 0.15
                    if x % 32 < 2 or y % 32 < 2:
                        shade *= 0.55
                    rgb = [c * shade for c in color]
                elif kind == 'roughness':
                    rgb = [0.48 + rng.random() * 0.12] * 3
                else:
                    rgb = [0.5, 0.5, 1.0]  # Explicit flat tangent normal map.
                pixels.extend([*rgb, 1.0])
        image.pixels.foreach_set(pixels)
        image.filepath_raw = str(output / f'{kind}.png')
        image.file_format = 'PNG'
        image.save()
        if kind != 'base_color':
            image.colorspace_settings.name = 'Non-Color'
        textures[kind] = image

    material = bpy.data.materials.new('C2B_PaintedMetal_PBR')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Metallic'].default_value = 0.35
    for kind, socket in [('base_color', 'Base Color'), ('roughness', 'Roughness')]:
        node = nodes.new('ShaderNodeTexImage')
        node.image = textures[kind]
        links.new(node.outputs['Color'], shader.inputs[socket])
    normal_tex = nodes.new('ShaderNodeTexImage')
    normal_tex.image = textures['normal']
    normal = nodes.new('ShaderNodeNormalMap')
    links.new(normal_tex.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    for obj in parts:
        obj.data.materials.clear()
        obj.data.materials.append(material)
    visor = bpy.data.materials.new('C2B_Visor')
    visor.use_nodes = True
    visor.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.018, 0.028, 0.05, 1)
    bpy.data.objects['C2B_Visor'].data.materials[0] = visor

    bpy.ops.object.select_all(action='DESELECT')
    armature = bpy.data.armatures.new('C2B_Rig')
    rig = bpy.data.objects.new('C2B_Rig', armature)
    bpy.context.collection.objects.link(rig)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')

    def bone(name, head, tail, parent=None):
        b = armature.edit_bones.new(name)
        b.head = head
        b.tail = tail
        if parent:
            b.parent = armature.edit_bones[parent]
        return b

    bone('root', (0, 0, 0.90), (0, 0, 1.04))
    bone('spine', (0, 0, 1.04), (0, 0, 1.62), 'root')
    bone('head', (0, 0, 1.62), (0, 0, 2.14), 'spine')
    for side, sign in [('L', 1), ('R', -1)]:
        bone('upper_arm.' + side, (sign * 0.35, 0, 1.55), (sign * 0.88, 0, 1.55), 'spine')
        bone('forearm.' + side, (sign * 0.88, 0, 1.55), (sign * 1.26, 0, 1.55), 'upper_arm.' + side)
        bone('hand.' + side, (sign * 1.26, 0, 1.55), (sign * 1.44, 0, 1.55), 'forearm.' + side)
        bone('thigh.' + side, (sign * 0.18, 0, 0.90), (sign * 0.18, 0, 0.40), 'root')
        bone('shin.' + side, (sign * 0.18, 0, 0.40), (sign * 0.18, 0, 0.10), 'thigh.' + side)
        bone('foot.' + side, (sign * 0.18, 0, 0.10), (sign * 0.18, -0.25, 0.10), 'shin.' + side)
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.show_in_front = True
    for obj in parts:
        group = obj.vertex_groups.new(name=bones[obj.name])
        group.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
        modifier = obj.modifiers.new('C2B_Rig', 'ARMATURE')
        modifier.object = rig
        obj.parent = rig
    rig.scale = (scale,) * 3
    pose = rig.pose.bones['forearm.L']
    pose.rotation_mode = 'XYZ'
    for frame, angle in [(1, 0), (20, -0.9), (40, 0)]:
        pose.rotation_euler.z = angle
        pose.keyframe_insert(data_path='rotation_euler', frame=frame)
    rig.animation_data.action.name = 'C2B_Wave'
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, 40
    scene.frame_set(1)

    def evaluated_point(frame):
        scene.frame_set(frame)
        obj = bpy.data.objects['C2B_Hand_L'].evaluated_get(bpy.context.evaluated_depsgraph_get())
        return obj.matrix_world @ obj.data.vertices[0].co

    p1, p2 = evaluated_point(1), evaluated_point(20)
    checks = {
        'separate_parts': len(parts) == 19,
        'uv_nonempty': all(obj.data.uv_layers.active and len(obj.data.uv_layers.active.data) for obj in parts),
        'uv_in_bounds': all(0 <= v <= 1.0001 for obj in parts for uv in obj.data.uv_layers.active.data for v in uv.uv),
        'all_vertices_weighted': all(v.groups and abs(sum(g.weight for g in v.groups) - 1) < 1e-5 for obj in parts for v in obj.data.vertices),
        'rig_moves_geometry': (p2 - p1).length > 0.05 * scale,
        'texture_files': all((output / f'{kind}.png').stat().st_size > 100 for kind in textures),
    }
    scene.frame_set(1)
    if not all(checks.values()):
        raise RuntimeError(f'Asset quality failed: {checks}')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts + [rig]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(output / 'robot.glb'), export_format='GLB', use_selection=True,
                              export_animations=True, export_skins=True)
    # Save a self-contained editable project; GLB also embeds its textures.
    for image in textures.values():
        image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'robot.blend'))
    manifest = {'schemaVersion': 1, 'recipe': 'articulated-hard-surface-robot', 'blender': bpy.app.version_string,
                'parts': [{'name': o.name, 'bone': bones[o.name], 'vertices': len(o.data.vertices),
                           'polygons': len(o.data.polygons)} for o in parts], 'bones': list(armature.bones.keys()),
                'animation': 'C2B_Wave', 'textures': ['base_color.png', 'roughness.png', 'normal.png'],
                'checks': checks, 'limitations': ['Rigid component weights; not an organic character rig.',
                    'Flat normal map and procedural paint; not a high-poly normal bake.']}
    (output / 'asset.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest
