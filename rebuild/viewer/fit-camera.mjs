import {Vector3} from 'three';

/** Fit every box corner inside the usable width and height of a perspective view. */
export function fitBoxDistance(box, direction, cameraUp, aspect, verticalFov=32, margin=.82) {
 const forward=direction.clone().normalize();
 const right=new Vector3().crossVectors(cameraUp,forward).normalize();
 const up=new Vector3().crossVectors(forward,right);
 const center=box.getCenter(new Vector3()),tan=Math.tan(verticalFov*Math.PI/360);
 let distance=0;
 for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
  const v=new Vector3(x,y,z).sub(center),depth=v.dot(forward);
  distance=Math.max(distance,depth+Math.abs(v.dot(right))/(tan*aspect*margin),depth+Math.abs(v.dot(up))/(tan*margin));
 }
 return distance;
}
