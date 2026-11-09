/* Feather composited alpha inward. Selection geometry and source RGB stay intact. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MozMaskFeather=api;
})(globalThis,function(){
  function featherAlpha(rgba,width,height,radius){
    const output=new Uint8ClampedArray(width*height),distance=new Float32Array(width*height);
    const limit=Math.max(0,Number(radius)||0),diagonal=Math.SQRT2;
    for(let i=0;i<output.length;i++){output[i]=rgba[i*4+3];distance[i]=output[i]?limit:0}
    if(!limit)return output;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x;
      if(x)distance[i]=Math.min(distance[i],distance[i-1]+1);
      if(y){distance[i]=Math.min(distance[i],distance[i-width]+1);if(x)distance[i]=Math.min(distance[i],distance[i-width-1]+diagonal);if(x+1<width)distance[i]=Math.min(distance[i],distance[i-width+1]+diagonal)}
    }
    for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){
      const i=y*width+x;
      if(x+1<width)distance[i]=Math.min(distance[i],distance[i+1]+1);
      if(y+1<height){distance[i]=Math.min(distance[i],distance[i+width]+1);if(x)distance[i]=Math.min(distance[i],distance[i+width-1]+diagonal);if(x+1<width)distance[i]=Math.min(distance[i],distance[i+width+1]+diagonal)}
      const t=Math.min(1,Math.max(0,(distance[i]-.5)/Math.max(.5,limit-.5)));
      output[i]=Math.round(output[i]*t*t*(3-2*t));
    }
    return output;
  }
  return {featherAlpha};
});
