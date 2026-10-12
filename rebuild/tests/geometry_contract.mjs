import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Counts what a full-detail export holds. (Whether the model has changed is no longer decided here:
// "npm test" compares part fingerprints with the accepted state and reports the difference.)
export function countGeometry(model,raw){
 let triangles=0,scalars=0,arrays=0;
 for(const p of model.parts)for(const m of p.meshes)for(const key of ['p','n','i']){const [offset,count]=m[key];if(offset+count*4>raw.length)throw Error(p.id+': geometry range runs past the end of the export');arrays++;if(key==='i')triangles+=count/3;else scalars+=count;}
 return {triangles,scalars,arrays,parts:model.parts.length};
}
