"""Measures one part's mesh: size, longest length, volume, and whether it is one closed solid.

Shared by measure_parts.py (the parts in the Blender file) and export_cassette.py (the generated
cassette), so both are measured the same way.
"""
import math
import bmesh
import numpy as np

# Directions spread evenly over a sphere, used to find the two points of a part that are farthest apart.
_i = np.arange(512) + 0.5
_phi = np.arccos(1 - 2 * _i / 512); _theta = math.pi * (1 + 5 ** 0.5) * _i
DIRECTIONS = np.stack([np.cos(_theta) * np.sin(_phi), np.sin(_theta) * np.sin(_phi), np.cos(_phi)], axis=1)

def longest_length(points):
    """Greatest distance between any two points, found among the points that are extreme in some direction."""
    reach = points @ DIRECTIONS.T
    extreme = points[np.unique(np.concatenate([reach.argmax(axis=0), reach.argmin(axis=0)]))]
    gaps = extreme[:, None, :] - extreme[None, :, :]
    return float(np.sqrt((gaps ** 2).sum(axis=2)).max())

def measure_solid(bm, to_mm, weld):
    """bm holds the whole part in assembled position. to_mm converts its units to mm; weld (in its units)
    joins vertices that were split only for shading."""
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld)
    bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
    points = np.array([v.co[:] for v in bm.verts], dtype=np.float64) * to_mm
    low, high = points.min(axis=0), points.max(axis=0)
    open_edges = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    shared_edges = sum(1 for e in bm.edges if len(e.link_faces) > 2)
    loose_edges = sum(1 for e in bm.edges if not e.link_faces)
    # separate shells: groups of vertices joined by edges
    parent = list(range(len(bm.verts)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for e in bm.edges:
        a, b = find(e.verts[0].index), find(e.verts[1].index)
        if a != b: parent[a] = b
    shells = len({find(v.index) for v in bm.verts if v.link_edges})
    watertight = open_edges == 0 and shared_edges == 0 and loose_edges == 0 and len(bm.faces) > 0
    why = []
    if shells > 1: why.append(f'{shells} separate shells')
    if open_edges: why.append(f'{open_edges} open edges')
    if shared_edges: why.append(f'{shared_edges} edges shared by more than two faces')
    if loose_edges: why.append(f'{loose_edges} loose edges')
    return dict(size_mm=[round(float(v), 3) for v in (high - low)], longest_length_mm=round(longest_length(points), 3),
                volume_mm3=round(abs(bm.calc_volume(signed=True)) * to_mm ** 3, 3) if watertight and shells == 1 else None,
                closed_solid=watertight and shells == 1, why_not_closed='; '.join(why), shells=shells, vertices=len(bm.verts), faces=len(bm.faces))
