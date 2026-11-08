// Fast shape-preserving denoising for SAM 3 label masks.
// Removes isolated specks and one-pixel jagged artifacts without blending
// nearby objects or softening the saved binary selection geometry.
export function cleanAutoMask(input,width,height){
  if(!(width>0&&height>0)||input.length!==width*height)throw Error('Invalid mask dimensions');
  const total=input.length;
  const smoothed=new Uint8Array(total);
  let area=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,inside=Boolean(input[i]);
    let neighbors=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const nx=x+dx,ny=y+dy;
      if(nx>=0&&ny>=0&&nx<width&&ny<height&&input[ny*width+nx])neighbors++;
    }
    // Suppress isolated hairs, and fill only very narrow holes in the region.
    const keep=inside?neighbors>=2:neighbors>=7;
    if(keep){smoothed[i]=1;area++}
  }
  if(!area)return smoothed;
  const visited=new Uint8Array(total);
  const queue=new Int32Array(area);
  const minimum=Math.max(9,Math.floor(area*.004));
  for(let seed=0;seed<total;seed++){
    if(!smoothed[seed]||visited[seed])continue;
    visited[seed]=1;let begin=0,end=1;queue[0]=seed;
    while(begin<end){
      const i=queue[begin++],x=i%width,y=(i-x)/width;
      const tryAdd=j=>{if(!smoothed[j]||visited[j])return;visited[j]=1;queue[end++]=j};
      if(x)tryAdd(i-1);
      if(x+1<width)tryAdd(i+1);
      if(y)tryAdd(i-width);
      if(y+1<height)tryAdd(i+width);
    }
    if(end<minimum)for(let k=0;k<end;k++)smoothed[queue[k]]=0;
  }
  return smoothed;
}
