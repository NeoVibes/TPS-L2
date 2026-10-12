import * as T from 'three';

// Labels are original artwork. Source photographs guide construction, never textures.
function labelTexture(which, back=false) {
 const side=back?'B':'A';
 const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=256;
 const c=canvas.getContext('2d');c.fillStyle='#e6dfc7';c.fillRect(0,0,2048,256);
 c.fillStyle='#8b2429';c.fillRect(0,0,2048,18);c.fillRect(0,238,2048,18);
 c.textBaseline='middle';c.fillStyle='#282925';
 if(which==='upper') {
  c.fillStyle='#8b2429';c.fillRect(38,40,162,174);c.fillStyle='#f1ead2';c.font='700 125px Arial';c.fillText(side,71,132);
  c.fillStyle='#282925';c.font='700 67px Arial';c.fillText('STEREO',242,95);c.font='400 35px Arial';c.fillText('COMPACT CASSETTE',246,176);
  c.textAlign='right';c.font='600 32px Arial';c.fillText('SIDE '+side,1980,88);c.font='400 26px Arial';c.fillText('NORMAL POSITION',1980,153);
 } else {
  c.fillStyle='#8b2429';c.font='700 36px Arial';c.fillText(side,35,64);
  c.strokeStyle='#777668';c.lineWidth=2;for(const y of [109,189]){c.beginPath();c.moveTo(116,y);c.lineTo(1978,y);c.stroke();}
  c.fillStyle='#55564d';c.font='400 20px Arial';c.fillText('STEREO CASSETTE',37,211);
 }
 // Very restrained deterministic paper grain; never substitutes for modeled detail.
 for(let i=0;i<7000;i++){const x=(i*619)%2048,y=(i*137)%256;c.fillStyle=i%2?'rgba(255,255,255,.04)':'rgba(40,35,25,.025)';c.fillRect(x,y,1,1);}
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
 return texture;
}
export function makeCassetteMaterial(spec) {
 const isGlass=(spec.transmission||0)>0;
 const material=new T.MeshPhysicalMaterial({color:new T.Color().setRGB(...spec.color),metalness:spec.metalness??0,roughness:spec.roughness??.4,
  opacity:isGlass?1:(spec.alpha??1),transparent:!isGlass&&(spec.alpha??1)<.99,depthWrite:isGlass||(spec.alpha??1)>=.99,
  side:T.DoubleSide,transmission:spec.transmission??0,thickness:spec.thickness??.7,ior:spec.ior??1.47,
  clearcoat:spec.clearcoat??(isGlass?.85:0),clearcoatRoughness:spec.clearcoatRoughness??.12,
  attenuationColor:new T.Color().setRGB(...(spec.attenuationColor||[.85,.91,.92])),attenuationDistance:spec.attenuationDistance??35,
  envMapIntensity:spec.envMapIntensity??1});
 const label=spec.label;
 // Layered molded halves use restrained alpha so their nested interiors remain inspectable.
 // This is a display approximation, not a measured optical material.
 if(isGlass){material.transmission=0;material.opacity=spec.semantic==='shell'?.16:spec.semantic==='slip'?.12:spec.semantic==='seam'?.55:.32;material.transparent=true;material.depthWrite=false;material.roughness=.23;material.envMapIntensity=.28;material.clearcoat=.12;}
 if(spec.semantic==='hub'){material.color.setRGB(.30,.285,.23);material.roughness=.48;material.envMapIntensity=.5;}
 if(spec.semantic==='shell'){material.color.setRGB(.30,.35,.38);material.opacity=.12;}
 if(spec.semantic==='edge'){material.color.setRGB(.10,.14,.18);material.opacity=.48;}
 if(spec.semantic==='roller'){material.color.setRGB(.085,.095,.10);material.roughness=.62;}
 if(spec.semantic==='felt')material.color.setRGB(.22,.085,.02);
 if(spec.semantic==='tape'){material.color.setRGB(.024,.009,.003);material.roughness=.78;material.envMapIntensity=.35;}
 if(label){material.map=labelTexture(label.region,label.back);material.color.setRGB(.78,.78,.78);material.roughness=.72;}
 return material;
}
export function applyCassetteUV(geometry,spec,ownerPose) {
 if(!spec.label)return;
 // Cassette axes are X=height, Y=width. Map both faces in assembly axes so
 // component-local authoring and disconnected detail chunks cannot stretch text.
 const positions=geometry.getAttribute('position'),points=[],matrix=new T.Matrix4().compose(new T.Vector3().fromArray(ownerPose[0]),new T.Quaternion().fromArray(ownerPose[1]),new T.Vector3().fromArray(ownerPose[2]));
 const min=new T.Vector3(Infinity,Infinity,Infinity),max=new T.Vector3(-Infinity,-Infinity,-Infinity);
 for(let i=0;i<positions.count;i++){const p=new T.Vector3().fromBufferAttribute(positions,i).applyMatrix4(matrix);points.push(p);min.min(p);max.max(p);}
 const rect=spec.uvBounds||[min.x,min.y,max.x,max.y],uv=new Float32Array(positions.count*2);
 points.forEach((p,i)=>{uv[i*2]=spec.label.back?1-(p.y-rect[1])/(rect[3]-rect[1]):(p.y-rect[1])/(rect[3]-rect[1]);uv[i*2+1]=1-(p.x-rect[0])/(rect[2]-rect[0]);});
 // Paper stock has unprinted inward faces; do not show reversed side-B ink through the shell.
 const normals=geometry.getAttribute('normal'),normalMatrix=new T.Matrix3().getNormalMatrix(matrix),back=spec.label.back;
 for(let i=0;i<positions.count;i++){const n=new T.Vector3().fromBufferAttribute(normals,i).applyMatrix3(normalMatrix);if(back?n.z>-.7:n.z<.7){uv[i*2]=.001;uv[i*2+1]=.5;}}
 geometry.setAttribute('uv',new T.BufferAttribute(uv,2));
}
