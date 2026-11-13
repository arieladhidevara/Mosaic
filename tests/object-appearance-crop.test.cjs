const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('object-aware.js','utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));

function canvas(width,height){
  const pixels=new Uint8ClampedArray(width*height*4);
  const ctx={
    globalCompositeOperation:'source-over',
    drawImage(src,dx=0,dy=0){
      for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){
        const tx=x+dx,ty=y+dy;
        if(tx<0||ty<0||tx>=width||ty>=height)continue;
        const a=(y*src.width+x)*4,b=(ty*width+tx)*4;
        if(this.globalCompositeOperation==='destination-in'){
          const opacity=src.pixels[a+3]/255;
          for(let channel=0;channel<4;channel++)pixels[b+channel]*=opacity;
        }else if(src.pixels[a+3]){
          pixels.set(src.pixels.subarray(a,a+4),b);
        }
      }
    },
    getImageData(x,y,w,h){
      const data=new Uint8ClampedArray(w*h*4);
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
        const sx=x+xx,sy=y+yy;
        if(sx>=0&&sy>=0&&sx<width&&sy<height){
          const p=(sy*width+sx)*4;
          data.set(pixels.subarray(p,p+4),(yy*w+xx)*4);
        }
      }
      return {data,width:w,height:h};
    }
  };
  return {width,height,pixels,getContext:()=>ctx};
}
function fixture(){
  const makeCanvas=canvas;
  const copy=input=>{const result=makeCanvas(input.width,input.height);result.getContext('2d').drawImage(input,0,0);return result};
  const data=mask=>Uint8Array.from({length:mask.width*mask.height},(_,i)=>+(mask.pixels[i*4+3]>=128));
  const bounds=(bits,w,h)=>{
    let left=w,top=h,right=-1,bottom=-1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(bits[y*w+x]){
      left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
    }
    return right<0?null:{x:left,y:top,w:right-left+1,h:bottom-top+1};
  };
  const scene=canvas(12,8);
  for(let y=0;y<8;y++)for(let x=0;x<12;x++)
    scene.pixels.set([x*13,y*23,80,255],(y*12+x)*4);
  const mask=canvas(12,8);
  for(let y=2;y<5;y++)for(let x=5;x<8;x++)
    if(x!==6||y!==3)mask.pixels.set([255,255,255,255],(y*12+x)*4);
  const context=vm.createContext({
    core:{composeApprovedCanvas:()=>scene},makeCanvas,copy,data,bounds,signature:()=> 'sig',
    originalDrawCache:new WeakMap()
  });
  vm.runInContext(section('function setIdentity','function foreground'),context);
  vm.runInContext(section('function drawOriginal','function drawOptionRepairs'),context);
  return {context,scene,mask};
}
function expected(scene,mask){
  const pixels=new Uint8ClampedArray(scene.pixels.length);
  for(let i=0;i<scene.width*scene.height;i++)if(mask.pixels[i*4+3])
    pixels.set(scene.pixels.subarray(i*4,i*4+4),i*4);
  return pixels;
}
test('new original appearances are cropped but render pixel-exact with holes and offsets',()=>{
  const {context,scene,mask}=fixture();
  const group={id:'chair',active:null};
  context.setIdentity(group,mask,'chair');
  assert.deepEqual({x:group.objectOriginal.appearanceOffset.x,y:group.objectOriginal.appearanceOffset.y},
    {x:5,y:2});
  assert.equal(group.objectOriginal.appearance.width,3);
  assert.equal(group.objectOriginal.appearance.height,3);
  assert.ok(group.objectOriginal.appearance.width*group.objectOriginal.appearance.height<scene.width*scene.height);
  const out=canvas(12,8);
  context.drawOriginal(out,group);
  assert.deepEqual(out.pixels,expected(scene,mask));
});
test('legacy full-image original appearances remain compatible',()=>{
  const {context,scene,mask}=fixture();
  const group={active:null,objectOriginal:{mask,appearance:scene,repairs:[]}};
  const out=canvas(12,8);
  context.drawOriginal(out,group);
  assert.deepEqual(out.pixels,expected(scene,mask));
});
