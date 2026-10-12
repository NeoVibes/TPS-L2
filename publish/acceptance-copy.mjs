import {cp,mkdir,writeFile,realpath,access} from 'node:fs/promises';
import path from 'node:path';
import {KIT as ROOT,fileHash,verifyExports} from '../rebuild/tools/integrity.mjs';   // ROOT here is the kit folder
const requested=process.argv[2];if(!requested)throw Error('Usage: node publish/acceptance-copy.mjs "/path/to/new scenario copy"');
await verifyExports();
const destination=path.resolve(requested);if(destination===ROOT||destination.startsWith(ROOT+path.sep))throw Error('Put disposable scenarios outside the baseline kit.');
try{await access(destination);throw Error('Destination already exists; choose a fresh scenario folder.');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(destination,{recursive:true});
if((await realpath(destination))!==destination)throw Error('Use a physical directory, not a symlink.');
const excluded=new Set(['.git','test-results','DISPOSABLE-COPY.json','acceptance-results','view.staging','view.previous','exports.staging','exports.previous']);
await cp(ROOT,destination,{recursive:true,dereference:true,filter:source=>{const relative=path.relative(ROOT,source);return !relative.split(path.sep).some(p=>excluded.has(p));}});
await writeFile(path.join(destination,'DISPOSABLE-COPY.json'),JSON.stringify({schema_version:1,disposable:true,baselineNativeSHA256:await fileHash('../edit/Portable Tape Player.blend'),baselineExportReceiptSHA256:await fileHash('build/exports/receipt.json'),applied:[]},null,2)+'\n');
console.log('Created disposable scenario copy: '+destination);
