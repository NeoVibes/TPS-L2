"""Loss-bounded browser packing; original source meshes remain unchanged."""
from pathlib import Path
import json,gzip,array,sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_io import OUT as O,check_space,write_bytes_guarded
meta=json.loads((O/'model.json').read_text())
# Prepare in memory, then reserve the exact combined output sizes before writes.
check_space(O,projected_bytes=0)
raw=gzip.decompress((O/'model.bin.gz').read_bytes());buf=bytearray();err=0.
def add(a):
 while len(buf)%4:buf.append(0)
 start=len(buf);buf.extend(a.tobytes());return [start,a.size]
for part in meta['parts']:
 for m in part['meshes']:
  p=np.frombuffer(raw,dtype='<f4',count=m['p'][1],offset=m['p'][0]).reshape(-1,3);n=np.frombuffer(raw,dtype='<f4',count=m['n'][1],offset=m['n'][0]);i=np.frombuffer(raw,dtype='<u4',count=m['i'][1],offset=m['i'][0]);lo=p.min(axis=0).astype(np.float64);span=p.max(axis=0).astype(np.float64)-lo;scale=np.where(span>0,span/65535,1);q=np.round((p-lo)/scale).astype('<u2');err=max(err,float(np.abs(q*scale+lo-p).max()));m['pmin']=lo.tolist();m['pscale']=scale.tolist();m['p']=add(q);m['n']=add(np.round(np.clip(n,-1,1)*32767).astype('<i2'));itype='<u2' if i.max()<65536 else '<u4';m['indexType']='u16' if itype=='<u2' else 'u32';m['i']=add(i.astype(itype))
  if 'beltS' in m:m['beltS']=add(np.frombuffer(raw,dtype='<f4',count=m['beltS'][1],offset=m['beltS'][0]))
assert err<.002,err
meta['packed']=True;meta['geometry_bytes']=len(buf);meta['geometry_quantization_tolerance_mm']=.002;meta['geometry_max_quantization_error_mm']=err
meta_bytes=json.dumps(meta,separators=(',',':')).encode();geometry_bytes=gzip.compress(buf,6,mtime=0)
check_space(O,projected_bytes=len(meta_bytes)+len(geometry_bytes)+1024**2)
write_bytes_guarded(O/'model-packed.json',meta_bytes);write_bytes_guarded(O/'model-packed.bin.gz',geometry_bytes);write_bytes_guarded(O/'packing-test.json',json.dumps({'passed':True,'native_sha256':meta['source_sha256'],'inventory_sha256':meta['inventory']['sha256'],'max_error_mm':err,'tolerance_mm':.002,'raw_bytes':len(buf),'compressed_bytes':(O/'model-packed.bin.gz').stat().st_size},indent=2).encode());print('PACKED',len(buf),(O/'model-packed.bin.gz').stat().st_size,'error',err)
