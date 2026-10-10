/* PixiJS 8.22.0 WebGL: GPU-only procedural light and Gaussian union mask.
 * No moving CSS/SVG mask, Canvas2D raster upload, quality/FPS/DPR caps. */
(() => {
  'use strict';
  const VERT = `attribute vec2 aPosition; varying vec2 vUV;
void main(){vUV=vec2((aPosition.x+1.0)*.5,(1.0-aPosition.y)*.5);gl_Position=vec4(aPosition,0.,1.);}`;
  const MAX_HOLES = 64;
  const COMMON = `precision highp float; varying vec2 vUV;
uniform vec2 uSize; uniform float uUnit; uniform int uHoleCount; uniform vec4 uHoles[64]; uniform float uRadii[64];
float roundedDistance(vec2 p,vec4 b,float r){vec2 c=(b.xy+b.zw)*.5;vec2 h=(b.zw-b.xy)*.5; r=min(r,min(h.x,h.y));vec2 q=abs(p-c)-h+vec2(r);return length(max(q,vec2(0.)))+min(max(q.x,q.y),0.)-r;}
float holeDistance(vec2 p,float pad){float d=1.e10;for(int i=0;i<64;i++){if(i>=uHoleCount)break;vec4 b=uHoles[i]+vec4(-pad,-pad,pad,pad);d=min(d,roundedDistance(p,b,uRadii[i]+pad));}return d;}`;
  const MASK = COMMON+`void main(){float a=holeDistance(vUV*uSize,18./uUnit)<=0.?1.:0.;gl_FragColor=vec4(a,a,a,1.);}`;
  const LIGHT = COMMON+`
uniform int uCount; uniform float uTime; uniform vec4 uPaths[12]; uniform vec4 uSizes[12]; uniform vec4 uColors[12]; uniform sampler2D uMask;
float falloff(float d){if(d<.10)return mix(1.,.90,d/.10);if(d<.25)return mix(.90,.69,(d-.10)/.15);if(d<.43)return mix(.69,.43,(d-.25)/.18);if(d<.62)return mix(.43,.20,(d-.43)/.19);if(d<.78)return mix(.20,.055,(d-.62)/.16);if(d<.90)return mix(.055,0.,(d-.78)/.12);return 0.;}
void main(){vec2 p=vUV*uSize;if(holeDistance(p,1.5/uUnit)<=0.){gl_FragColor=vec4(0.);return;}
vec4 result=vec4(0.);
for(int i=0;i<12;i++){if(i>=uCount)break;
vec4 path=uPaths[i];vec4 size=uSizes[i];
float xt=(uTime-size.z)/size.w*6.28318530718*path.y+path.x;
float yt=(uTime-size.z*.731)/(size.w*2.2360679775)*6.28318530718*-path.y+path.x*1.31;
vec2 center=vec2(.5+.40*cos(xt)+path.z*sin(2.*xt+path.x),.5+.38*sin(yt)+path.z*cos(3.*yt-path.x))*uSize;
float angle=13.*sin(yt+path.x)*.01745329252;vec2 q=p-center; q=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*q;
q.x-=tan(9.*sin(2.*yt-path.x)*.01745329252)*q.y;
q/=vec2(.90+.10*sin(2.*yt),1.+.16*cos(yt)); q/=size.xy*uSize*.005;
// Same asymmetric elliptical corners and radial stops as the saved Canvas2D renderer.
float contour=1.;
if(q.x>.12&&q.y<.20)contour=min(contour,1.-step(1.,length((q-vec2(.12,.20))/vec2(.88,1.20))));
if(q.x>-.24&&q.y>.20)contour=min(contour,1.-step(1.,length((q-vec2(-.24,.20))/vec2(1.24,.80))));
if(q.x<-.24&&q.y>-.12)contour=min(contour,1.-step(1.,length((q-vec2(-.24,-.12))/vec2(.76,1.12))));
if(q.x<.12&&q.y<-.12)contour=min(contour,1.-step(1.,length((q-vec2(.12,-.12))/vec2(1.12,.88))));
float alpha=falloff(length(q))*uColors[i].a*contour;
vec4 color=vec4(uColors[i].rgb*alpha,alpha);result=color+result*(1.-alpha);
}
float mask=1.-texture2D(uMask,vec2(vUV.x,1.-vUV.y)).r;
float edge=clamp((min(p.x,uSize.x-p.x)*uUnit-8.)/40.,0.,1.)*clamp((min(p.y,uSize.y-p.y)*uUnit-8.)/40.,0.,1.);
gl_FragColor=result*mask*edge;}`;
  window.createMeshPixiRenderer = (node, gates) => {
    const P=window.PIXI;
    if(!P) return;
    const canvas=document.createElement('canvas');canvas.className='mesh-full-canvas';
    let renderer, geometry, stage, maskMesh, blurX, blurY, lightMesh, targetA, targetB, targetC;
    let width=0,height=0,ratio=1,unit=1,holes=[],paths=[],raf=0,last,elapsed=0,requested=false,disposed=false,state='pending',token=0,maskDirty=true,signature='';
    const ownedShaders=[];let maskGroup,lightGroup;
    const api={canvas,frames:0,maskLoads:0,backend:null,
      get state(){return state;},get ready(){return state==='ready';},get active(){return !!raf;},get time(){return elapsed;},get paths(){return paths;},get sprites(){return [];},get cacheSize(){return 0;},
      resize(w,h,u){if(disposed||state==='failed')return;const d=(window.devicePixelRatio||1)*u;if(width===w&&height===h&&ratio===d)return;width=w;height=h;unit=u;ratio=d;maskDirty=true;if(renderer)allocate();},
      setPaths(items){if(disposed||state==='failed')return;paths=items;syncPaths();},
      updateGeometry(rects){if(disposed||state==='failed')return;const next=JSON.stringify(rects);if(next===signature)return;signature=next;holes=rects;maskDirty=true;},
      start(){if(disposed||state==='failed')return;requested=true;resume();},stop(){requested=false;cancel();},
      paint(t){api.stop();elapsed=t;if(api.ready)draw();},
      dispose(){if(disposed)return;disposed=true;token++;state='retired';requested=false;cancel();cleanup();canvas.width=canvas.height=0;}
    };
    function cancel(){if(raf)cancelAnimationFrame(raf);raf=0;last=undefined;}
    function usable(){return !disposed&&requested&&api.ready&&node.isConnected&&!document.hidden&&!gates.blocked();}
    function resume(){if(usable()&&!raf)raf=requestAnimationFrame(tick);}
    function fail(error){if(disposed||state==='failed')return;state='failed';token++;requested=false;cancel();node.style.visibility='hidden';node.dataset.gpuError=String(error?.message||error).slice(0,250);cleanup();gates.status('PixiJS GPU 资源不可用：安全关闭；可选择 Canvas2D 对照。');}
    function cleanup(){canvas.removeEventListener('webglcontextlost',lost);for(const t of [targetA,targetB,targetC])t?.destroy(true);targetA=targetB=targetC=undefined;for(const s of ownedShaders.splice(0))s.destroy(true);for(const m of [maskMesh,blurX,blurY])m?.destroy();maskMesh=blurX=blurY=undefined;stage?.destroy({children:true});stage=undefined;geometry?.destroy();geometry=undefined;renderer?.destroy();renderer=undefined;}
    function lost(event){event.preventDefault();fail(new Error('WebGL context lost'));}
    canvas.addEventListener('webglcontextlost',lost);
    function group(){return new P.UniformGroup({uSize:{value:new Float32Array([1,1]),type:'vec2<f32>'},uUnit:{value:1,type:'f32'},uHoleCount:{value:0,type:'i32'},uHoles:{value:new Float32Array(MAX_HOLES*4),type:'vec4<f32>',size:MAX_HOLES},uRadii:{value:new Float32Array(MAX_HOLES),type:'f32',size:MAX_HOLES}});}
    function mesh(fragment,uniforms,extra={}){const shader=P.Shader.from({gl:{vertex:VERT,fragment},resources:{settings:uniforms,...extra}});ownedShaders.push(shader);return new P.Mesh({geometry,shader});}
    function gaussian(axis){const sigma=12*ratio/unit;const radius=Math.ceil(4*sigma);let sum=0;const weights=[];for(let i=-radius;i<=radius;i++){const weight=Math.exp(-.5*(i/sigma)**2);weights.push(weight);sum+=weight;}const samples=weights.map((v,index)=>`a+=texture2D(uInput,vec2(vUV.x,1.-vUV.y)+uStep*${(index-radius).toFixed(1)}).r*${(v/sum).toPrecision(10)};`).join('\n');
      const g=new P.UniformGroup({uStep:{value:new Float32Array(axis==='x'?[1/Math.ceil(width*ratio),0]:[0,1/Math.ceil(height*ratio)]),type:'vec2<f32>'}});
      return mesh(`precision highp float;varying vec2 vUV;uniform sampler2D uInput;uniform vec2 uStep;void main(){float a=0.;${samples}gl_FragColor=vec4(a,a,a,1.);}`,g,{uInput:targetA.source});}
    function allocate(){try{if(!width||!height)return;node.style.visibility='hidden';renderer.resize(width,height,ratio);canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;for(const t of [targetA,targetB,targetC])t?.destroy(true);targetA=P.RenderTexture.create({width,height,resolution:ratio});targetB=P.RenderTexture.create({width,height,resolution:ratio});targetC=P.RenderTexture.create({width,height,resolution:ratio});
      for(const m of [blurX,blurY])if(m){const shader=m.shader;const index=ownedShaders.indexOf(shader);if(index>=0)ownedShaders.splice(index,1);shader.destroy(true);m.destroy();}blurX=gaussian('x');blurY=gaussian('y');lightMesh.shader.resources.uMask=targetC.source;syncPaths();maskDirty=true;resume();}catch(e){fail(e);}}
    function syncPaths(){if(!lightGroup)return;const v=lightGroup.uniforms;v.uSize.set([width,height]);v.uUnit=unit;v.uCount=paths.length;
      if(paths.length>12){fail(new Error('Unexpected blob capacity'));return;}
      paths.forEach((p,i)=>{v.uPaths.set([p.phase,p.direction,p.warp,p.palette],i*4);v.uSizes.set([p.width,p.height,parseFloat(p.props['--lava-delay'])*1000,parseFloat(p.props['--lava-duration'])*1000],i*4);const color=[[126/255,38/255,46/255,.38],[83/255,76/255,74/255,.25],[80/255,91/255,103/255,.19],[109/255,32/255,41/255,.27]][p.palette];v.uColors.set(color,i*4);});}
    function draw(){try{if(!renderer||!targetC||!width)return;if(holes.length>MAX_HOLES){fail(new Error('Too many protected regions'));return;}
      const validate=maskDirty||api.frames===0;
      if(maskDirty){const g=maskGroup.uniforms;g.uSize.set([width,height]);g.uUnit=unit;g.uHoleCount=holes.length;g.uHoles.fill(0);g.uRadii.fill(0);holes.forEach((r,i)=>{g.uHoles.set([r.left/unit,r.top/unit,r.right/unit,r.bottom/unit],i*4);g.uRadii[i]=r.radius/unit;});renderer.render({container:maskMesh,target:targetA,clear:true});blurX.shader.resources.uInput=targetA.source;renderer.render({container:blurX,target:targetB,clear:true});blurY.shader.resources.uInput=targetB.source;renderer.render({container:blurY,target:targetC,clear:true});lightGroup.uniforms.uHoleCount=g.uHoleCount;lightGroup.uniforms.uHoles.set(g.uHoles);lightGroup.uniforms.uRadii.set(g.uRadii);maskDirty=false;api.maskLoads++;}
      lightGroup.uniforms.uTime=elapsed;renderer.render({container:stage,clear:true});if(validate&&renderer.gl.getError()!==renderer.gl.NO_ERROR)throw new Error('WebGL draw failed');api.frames++;node.style.visibility='visible';
    }catch(e){fail(e);}}
    function tick(t){raf=0;if(!usable()){last=undefined;return;}if((window.devicePixelRatio||1)*unit!==ratio){gates.geometry();return;}if(last!==undefined)elapsed+=t-last;last=t;draw();if(usable())raf=requestAnimationFrame(tick);}
    const initToken=++token;
    (async()=>{let initializingRenderer;try{initializingRenderer=new P.WebGLRenderer();await initializingRenderer.init({canvas,width:1,height:1,resolution:1,backgroundAlpha:0,antialias:false,powerPreference:'high-performance',clearBeforeRender:true});if(disposed||state==='failed'||initToken!==token){initializingRenderer.destroy();return;}renderer=initializingRenderer;
      geometry=new P.MeshGeometry({positions:new Float32Array([-1,-1,1,-1,1,1,-1,1]),uvs:new Float32Array([0,1,1,1,1,0,0,0]),indices:new Uint32Array([0,1,2,0,2,3])});
      maskGroup=group();maskMesh=mesh(MASK,maskGroup);
      lightGroup=group();Object.assign(lightGroup.uniformStructures,{uCount:{name:'uCount',value:0,type:'i32',size:1},uTime:{name:'uTime',value:0,type:'f32',size:1},uPaths:{name:'uPaths',value:new Float32Array(48),type:'vec4<f32>',size:12},uSizes:{name:'uSizes',value:new Float32Array(48),type:'vec4<f32>',size:12},uColors:{name:'uColors',value:new Float32Array(48),type:'vec4<f32>',size:12}});
      lightGroup=new P.UniformGroup(lightGroup.uniformStructures);lightMesh=mesh(LIGHT,lightGroup,{uMask:P.Texture.WHITE.source});stage=new P.Container();stage.addChild(lightMesh);
      const gl=renderer.gl;const debug=gl.getExtension('WEBGL_debug_renderer_info');api.backend={type:'webgl',pixi:P.VERSION,driver:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unavailable',hardwareVerified:false};node.dataset.renderer='pixi-webgl';state='ready';allocate();gates.geometry();resume();
    }catch(e){if(initializingRenderer&&!renderer){try{initializingRenderer.destroy();}catch{}}fail(e);}})();
    return api;
  };
})();
