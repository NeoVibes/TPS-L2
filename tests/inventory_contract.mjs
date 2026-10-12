import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function assertInventoryCoverage(model) {
 const bytes=readFileSync('build/exports/inventory.json'),inventory=JSON.parse(bytes);
 assert.equal(inventory.native_sha256,model.source_sha256,'Inventory/native binding');
 assert.equal(model.inventory.sha256,createHash('sha256').update(bytes).digest('hex'),'Inventory/export binding');
 const ownerIds=inventory.owners.map(o=>o.part_id).sort();
 assert.equal(new Set(ownerIds).size,ownerIds.length);
 assert.deepEqual(model.parts.map(p=>p.id).sort(),ownerIds);
 assert.deepEqual(model.inventory.ownerIds,ownerIds);
 return {inventory,ownerIds};
}
