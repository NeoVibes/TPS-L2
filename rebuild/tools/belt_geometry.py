"""Read the current swept meshes, not historical path files. Units: housing mm.

The section ordering is a property of these native meshes, checked against every
quad/edge before it is used. Fail closed if a later model changes the topology.
"""
import hashlib
import math
import numpy as np



def recover_belt(obj, housing_matrix, section):
    mesh = obj.data
    assert obj.type == 'MESH' and not mesh.shape_keys
    assert all(m.type == 'WEIGHTED_NORMAL' for m in obj.modifiers), [(m.name,m.type) for m in obj.modifiers]
    assert len(mesh.vertices) % section == 0
    rings = len(mesh.vertices) // section
    expected = {tuple(sorted((i*section+k, i*section+(k+1)%section,
                             ((i+1)%rings)*section+(k+1)%section,
                             ((i+1)%rings)*section+k)))
                for i in range(rings) for k in range(section)}
    actual = {tuple(sorted(p.vertices)) for p in mesh.polygons}
    assert actual == expected and len(mesh.polygons) == len(expected), 'Belt sweep topology changed'
    assert all(len(e.vertices) == 2 for e in mesh.edges)
    coordinates = np.array([tuple(v.co) for v in mesh.vertices], dtype=np.float64)
    local = coordinates.reshape(rings, section, 3).mean(axis=1)
    matrix = np.array(housing_matrix, dtype=np.float64)
    centers = (np.c_[local, np.ones(rings)] @ matrix.T)[:, :3]
    steps = np.linalg.norm(np.roll(centers, -1, axis=0)-centers, axis=1)
    assert np.all(steps > 1e-5) and max(steps) < 1., 'Non-continuous native ring order'
    distance = np.r_[0., np.cumsum(steps[:-1])]
    return {'section_vertices': section, 'rings': rings, 'centers': centers,
            'distance': distance, 'loop_length_mm': float(sum(steps)),
            'closing_step_mm': float(steps[-1]),
            'mesh_coordinates_sha256': hashlib.sha256(coordinates.tobytes()).hexdigest()}


def wrap_samples(belt_id, path, drivers, parts):
    from mathutils import Matrix,Vector,Quaternion
    points=path['centers'];tangent=np.roll(points,-1,axis=0)-np.roll(points,1,axis=0)
    tangent/=np.linalg.norm(tangent,axis=1)[:,None];result=[]
    for binding in drivers:
        owner=binding['owner'];axis=binding['axis'];wheel=parts[owner]
        pos,q,scale=wheel['poses']['stop'];world=Matrix.LocRotScale(Vector(pos),Quaternion((q[3],q[0],q[1],q[2])),Vector(scale))
        spin=wheel['spin']['play'];center=np.array(world@Vector(spin['center']))
        radial=points-center;radial[:,axis]=0;radius=np.linalg.norm(radial,axis=1)
        # Find circular native-path runs about the evaluated driving axis.
        stable=(abs(np.roll(radius,1)-radius)<.0001)&(abs(np.roll(radius,-1)-radius)<.0001)
        planar=(abs(np.roll(points[:,axis],1)-points[:,axis])<.0001)&(abs(np.roll(points[:,axis],-1)-points[:,axis])<.0001)
        candidates=stable&planar
        if sum(candidates)<12:raise ValueError(f'{belt_id}/{owner}: native path has no supported circular contact; inspect belt geometry and driving axis.')
        pitch=float(np.median(radius[candidates]));plane=float(np.median(points[candidates,axis]))
        match=(abs(radius-pitch)<.0001)&(abs(points[:,axis]-plane)<.0001)
        interior=match&np.roll(match,1)&np.roll(match,-1)
        if sum(interior)<12:raise ValueError(f'{belt_id}/{owner}: ambiguous native contact; explicit adaptation required.')
        # Fit the circle in its actual plane, avoiding float32 spin-pivot roundoff.
        dims=[i for i in range(3) if i!=axis];xy=points[interior][:,dims]
        coefficients=np.linalg.lstsq(np.c_[2*xy,np.ones(len(xy))],(xy*xy).sum(axis=1),rcond=None)[0]
        center[dims]=coefficients[:2];center[axis]=plane
        radial=points-center;radial[:,axis]=0;radius=np.linalg.norm(radial,axis=1)
        pitch=float(np.median(radius[interior]));match=(abs(radius-pitch)<.0001)&(abs(points[:,axis]-plane)<.0001);interior=match&np.roll(match,1)&np.roll(match,-1)
        coefficients=(np.cross(np.eye(3)[axis],radial)*tangent).sum(axis=1)[interior]
        direction=1 if np.median(coefficients)>0 else -1
        assert len(coefficients)>=12 and max(abs(coefficients-direction*pitch))<.0001,(belt_id,owner,'Noncircular contact')
        result.append({'owner':owner,'axis_index':axis,'center_mm':center.tolist(),'pitch_radius_mm':pitch,'orientation':direction,'signed_mm_per_radian_positive_axis':direction*pitch,'ring_indices':np.flatnonzero(interior).tolist(),'sample_coefficients':coefficients.tolist()})
    return result


def seam_distance(path, source_vertex, triangle_vertices):
    """Only the closing triangles receive L at ring zero; never change a position."""
    ring = source_vertex // path['section_vertices']
    closing = any(v // path['section_vertices'] == path['rings']-1 for v in triangle_vertices)
    return path['loop_length_mm'] if ring == 0 and closing else float(path['distance'][ring])
