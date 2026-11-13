const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
function canvas(w,h){
  const data=new Uint8ClampedArray(w*h*4);
  const c={width:w,height:h,data};
  const ctx={
    globalCompositeOperation:'source-over',
    drawImage(source,...args){
      const [sx,sy,sw,sh,dx,dy,dw,dh]=args.length===2?[0,0,source.width,source.height,...args,source.width,source.height]:
        args.length===8?args:[0,0,source.width,source.height,0,0,source.width,source.height];
      for(let yy=0;yy<Math.ceil(dh);yy++)for(let xx=0;xx<Math.ceil(dw);xx++){
        const x=Math.floor(dx+xx),y=Math.floor(dy+yy);
        const u=Math.floor(sx+xx*sw/dw),v=Math.floor(sy+yy*sh/dh);
        if(x<0||y<0||x>=w||y>=h||u<0||v<0||u>=source.width||v>=source.height)continue;
        const a=(v*source.width+u)*4,b=(y*w+x)*4,opacity=source.data[a+3];
        if(ctx.globalCompositeOperation==='destination-in'){
          for(let k=0;k<4;k++)data[b+k]=Math.round(data[b+k]*opacity/255);
        }else if(opacity)data.set(source.data.subarray(a,a+4),b);
      }
    },
    getImageData(x,y,width,height){
      const pixels=new Uint8ClampedArray(width*height*4);
      for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){
        const ax=x+xx,ay=y+yy;if(ax>=0&&ay>=0&&ax<w&&ay<h)
          pixels.set(data.subarray((ay*w+ax)*4,(ay*w+ax)*4+4),(yy*width+xx)*4);
      }
      return {data:pixels,width,height};
    }
  };
  c.getContext=()=>ctx;
  return c;
}
function harness(){
  const core=vm.createContext({makeCanvas:canvas,canvas:{width:15,height:10},patchTextures:new WeakMap(),state:{featherEnabled:false}});
  const a=app.slice(app.indexOf('function compactOptionSource'),app.indexOf('const clamp'));
  vm.runInContext(a,core);
  const b=app.slice(app.indexOf('function patchTexture'),app.indexOf('function bilinear'));
  vm.runInContext(b,core);
  return core;
}
test('completed Option crop keeps exact world coordinates and pixels',()=>{
  const c=harness(),scene=canvas(15,10);
  for(let y=0;y<10;y++)for(let x=0;x<15;x++)scene.data.set([x*9,y*17,35,255],(y*15+x)*4);
  const item=c.compactOptionSource(scene,{x:4,y:2,w:5,h:4});
  assert.equal(item.canvas.width,5);assert.equal(item.canvas.height,4);
  assert.equal(item.crop.x,4);assert.equal(item.crop.y,2);
  const restored=c.expandOptionSource(item);
  for(let y=0;y<10;y++)for(let x=0;x<15;x++){
    const at=(y*15+x)*4;const source=[...restored.data.subarray(at,at+4)];
    if(x>=4&&x<9&&y>=2&&y<6)assert.deepEqual(source,[...scene.data.subarray(at,at+4)]);
    else assert.equal(source[3],0);
  }
});
test('rendered patch texture is pixel-identical for full RGB and cropped RGB',()=>{
  const c=harness(),scene=canvas(15,10),mask=canvas(15,10);
  for(let y=0;y<10;y++)for(let x=0;x<15;x++)scene.data.set([x*9,y*17,35,255],(y*15+x)*4);
  for(let y=3;y<6;y++)for(let x=5;x<9;x++)mask.data.set([255,255,255,255],(y*15+x)*4);
  const patch={bbox:{x:5,y:3,w:4,h:3},mask},full={canvas:scene};
  const crop=c.compactOptionSource(scene,{x:4,y:2,w:6,h:5});
  const fullTexture=c.patchTexture(patch,full);
  const pixels=fullTexture.image.data.slice();
  const croppedTexture=c.patchTexture(patch,crop);
  assert.deepEqual(croppedTexture.image.data,pixels);
  assert.equal(croppedTexture.source,crop.canvas);
});
test('legacy full-size sources remain untouched',()=>{
  const c=harness(),scene=canvas(15,10);
  const compact=c.compactOptionSource(scene,{x:0,y:0,w:15,h:10});
  assert.equal(compact.canvas,scene);
  assert.equal(compact.crop,null);
  assert.equal(c.expandOptionSource({canvas:scene}),scene);
});
