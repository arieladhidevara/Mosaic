/* Split a visible object mask with a user-drawn open stroke.
   Four-connected flood fill is performed after erasing the stroke.
   Erased seam pixels are returned to the nearest resulting side so no alpha is lost. */
export function splitMaskByStroke(bits,width,height,points,thickness=3){
  if(!(bits instanceof Uint8Array)||bits.length!==width*height||
     !Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('Invalid mask');
  if(!Array.isArray(points)||points.length<2)throw Error('Draw a cut line across the object.');
  const clean=new Uint8Array(bits.length);
  for(let i=0;i<bits.length;i++)clean[i]=bits[i]?1:0;
  let touched=0;
  const r=Math.max(1,Math.round(thickness/2)),paint=(x,y)=>{
    const ix=Math.round(x),iy=Math.round(y);
    for(let yy=Math.max(0,iy-r);yy<=Math.min(height-1,iy+r);yy++)
      for(let xx=Math.max(0,ix-r);xx<=Math.min(width-1,ix+r);xx++){
        if((xx-x)**2+(yy-y)**2>(r+.5)**2)continue;
        const pos=yy*width+xx;if(clean[pos]){clean[pos]=0;touched++;}
      }
  };
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(![a.x,a.y,b.x,b.y].every(Number.isFinite))throw Error('Invalid cut points');
    const length=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(length*2));
    for(let j=0;j<=steps;j++){const t=j/steps;paint(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);}
  }
  if(touched<3)throw Error('Cut line must cross the selected object.');
  const owner=new Int16Array(bits.length),queue=new Int32Array(bits.length);
  let comps=[];
  for(let i=0;i<clean.length;i++)if(clean[i]&&!owner[i]){
    let front=0,back=1,count=0;
    const id=comps.length+1;owner[i]=id;queue[0]=i;
    while(front<back){
      const at=queue[front++],x=at%width,y=(at-x)/width;count++;
      const neighbors=[x>0?at-1:-1,x+1<width?at+1:-1,y>0?at-width:-1,y+1<height?at+width:-1];
      for(const n of neighbors)if(n>=0&&clean[n]&&!owner[n]){owner[n]=id;queue[back++]=n;}
    }
    comps.push({id,count});
    if(comps.length>64)throw Error('Too many disconnected mask parts.');
  }
  comps.sort((a,b)=>b.count-a.count);
  const total=bits.reduce((n,v)=>n+(v?1:0),0);
  if(comps.length!==2||comps[1].count<Math.max(12,total*.025))
    throw Error('Draw one continuous line all the way across the object to split it into two parts.');
  // Flood outward from intact sides, claiming only pixels from the previous object.
  let head=0,tail=0;
  for(let i=0;i<owner.length;i++)if(owner[i])queue[tail++]=i;
  while(head<tail){
    const at=queue[head++],x=at%width,y=(at-x)/width;
    const neighbors=[x>0?at-1:-1,x+1<width?at+1:-1,y>0?at-width:-1,y+1<height?at+width:-1];
    for(const n of neighbors)if(n>=0&&bits[n]&&!owner[n]){owner[n]=owner[at];queue[tail++]=n;}
  }
  const left=new Uint8Array(bits.length),right=new Uint8Array(bits.length),primary=comps[0].id;
  for(let i=0;i<bits.length;i++)if(bits[i]){if(owner[i]===primary)left[i]=1;else right[i]=1;}
  return {parts:[left,right],counts:[left.reduce((n,v)=>n+v,0),right.reduce((n,v)=>n+v,0)]};
}
