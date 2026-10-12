import * as T from 'three';

/** Material-only annotations. No added owners, triangles, or native edits. */
export function makeDriveMaterial(base,part,{highlight=false,enabled,travel}={}) {
 const belt=part.belt,witness=part.motorWitness;
 if(!belt&&!witness)return null;
 const material=base.clone();
 if(highlight)material.emissive.setRGB(.045,.03,.006);
 const uniforms={cueEnabled:enabled||{value:1}};
 let vertexHeader,vertexBody,fragmentHeader,mask;
 if(belt) {
  material.color.setRGB(.006,.007,.009);material.roughness=.88;material.metalness=0;
  Object.assign(uniforms,{beltTravel:travel||{value:0},beltLength:{value:belt.loopLengthMm},stripeWidth:{value:belt.stripeWidthMm}});
  vertexHeader='attribute float beltS; varying float vBeltS;';
  vertexBody='vBeltS = beltS;';
  fragmentHeader='varying float vBeltS; uniform float beltTravel; uniform float beltLength; uniform float stripeWidth;';
  mask=`float cueDistance = abs(mod(vBeltS-beltTravel+0.5*beltLength,beltLength)-0.5*beltLength);
   float cueAA = clamp(fwidth(vBeltS),0.01,stripeWidth*0.5);
   float cueMask = 1.0-smoothstep(stripeWidth*0.5-cueAA,stripeWidth*0.5+cueAA,cueDistance);`;
 } else {
  const axis=new T.Vector3().fromArray(witness.axis).normalize();
  const u=new T.Vector3(1,0,0).addScaledVector(axis,-axis.x).normalize(),v=new T.Vector3().crossVectors(axis,u).normalize();
  Object.assign(uniforms,{cueCenter:{value:new T.Vector3().fromArray(witness.center)},cueAxis:{value:axis},cueU:{value:u},cueV:{value:v},cueEnd:{value:witness.endProjection},cueRadius:{value:witness.radiusMm}});
  const backMark=witness.kind==='pulley'&&Number.isFinite(witness.backProjection);
  if(backMark)uniforms.cueBack={value:witness.backProjection};
  vertexHeader='varying vec3 vCuePosition; varying vec3 vCueNormal;';
  // Owner-local coordinates: these masks have no time/phase uniform.
  vertexBody='vCuePosition=position; vCueNormal=normal;';
  fragmentHeader='varying vec3 vCuePosition; varying vec3 vCueNormal; uniform vec3 cueCenter; uniform vec3 cueAxis; uniform vec3 cueU; uniform vec3 cueV; uniform float cueEnd; uniform float cueRadius;';
  const shape=witness.kind==='shaft'
   ? 'float cueShape=length(vec2(cueX-cueRadius*0.48,cueY))-cueRadius*0.21;'
   : 'float cueShape=max(abs(cueY)-0.16,max(cueRadius*0.28-cueX,cueX-cueRadius*1.02));';
  mask=`vec3 cueP=vCuePosition-cueCenter;
   float cueX=dot(cueP,cueU),cueY=dot(cueP,cueV);
   ${shape}
   float cueAA=max(fwidth(cueShape),0.015);
   float cueMask=(1.0-smoothstep(-cueAA,cueAA,cueShape))*step(0.7,dot(normalize(vCueNormal),cueAxis))*step(abs(dot(cueP,cueAxis)-cueEnd),0.12);`;
  if(backMark){
   fragmentHeader+=' uniform float cueBack;';
   // A small dot on the opposite/lower face remains fixed to the brass surface.
   mask+=`float cueBackShape=length(vec2(cueX-cueRadius*0.72,cueY))-0.22;
    float cueBackAA=max(fwidth(cueBackShape),0.015);
    float cueBackMask=(1.0-smoothstep(-cueBackAA,cueBackAA,cueBackShape))*step(0.7,-dot(normalize(vCueNormal),cueAxis))*step(abs(dot(cueP,cueAxis)-cueBack),0.12);
    cueMask=max(cueMask,cueBackMask);`;
   // The lower flange is seen edge-on in Belt drive: mark its outer rim too.
   mask+=`float cueRimShape=length(vec2(cueY,dot(cueP,cueAxis)-(cueEnd-0.375)))-0.17;
    float cueRimAA=max(fwidth(cueRimShape),0.015);
    float cueRimMask=(1.0-smoothstep(-cueRimAA,cueRimAA,cueRimShape))*step(cueRadius*0.8,cueX)*step(0.7,dot(normalize(vCueNormal),cueU));
    cueMask=max(cueMask,cueRimMask);`;
  }
 }
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=vertexHeader+'\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+vertexBody);
  shader.fragmentShader='uniform float cueEnabled;\n'+fragmentHeader+'\n'+shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+mask+'\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.98),cueMask*cueEnabled);');
 };
 material.customProgramCacheKey=()=>`drive-cue-v3-${belt?'belt':witness.kind}-${Number.isFinite(witness?.backProjection)}`;
 material.userData.driveCueUniforms=uniforms;
 return material;
}
