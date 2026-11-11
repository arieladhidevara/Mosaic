// A generated flat-color map can contain noisy antialiasing or gradients,
// especially for complex interiors. Never reject the whole map simply because
// there are too many connected components: recover stable object identities.
export const MAX_OBJECTS=2048;
export const CLEANUP_VERSION=4;
const NEIGHBORS=[[0,-1],[-1,0],[1,0],[0,1]];

// Estimate fragmentation cheaply before spending memory on components.
function unstableRatio(colors,w,h){
  let differences=0,checks=0;
  const step=Math.max(1,Math.floor(Math.sqrt(w*h/65000)));
  for(let y=1;y<h-1;y+=step)for(let x=1;x<w-1;x+=step){
    const p=y*w+x,c=colors[p];if(!c)continue;
    checks+=2;differences+=+(colors[p-1]!==c)+ +(colors[p-w]!==c);
  }
  return differences/Math.max(1,checks);
}

// Suppress only color-index speckles. Flat coherent areas and genuine black
// voids are kept intact. Adaptive: no smoothing on already-clean instance maps.
function cleanSpeckles(input,w,h,passes){
  let source=input;
  for(let pass=0;pass<passes;pass++){
    const result=source.slice();
    let changes=0;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const p=y*w+x,current=source[p];
      if(!current)continue;
      const around=[
        source[p-w-1],source[p-w],source[p-w+1],
        source[p-1],current,source[p+1],
        source[p+w-1],source[p+w],source[p+w+1]
      ];
      let existing=0,best=current,votes=0;
      for(const color of around)if(color===current)existing++;
      if(existing>=3)continue;
      for(let j=0;j<around.length;j++){
        const color=around[j];if(!color||color===current)continue;
        let n=0;
        for(let k=0;k<around.length;k++)if(around[k]===color)n++;
        if(n>votes){votes=n;best=color}
      }
      if(votes>=4&&(votes>existing+1||existing===1)){
        result[p]=best;changes++;
      }
    }
    source=result;
    if(!changes)break;
  }
  return source;
}

// Last-resort spatial quantization for image-model outputs that are visibly
// textured instead of flat indexed colors. This is deliberately disabled on
// normal maps so thin real objects and architectural openings stay intact.
function stabilizeTiles(source,w,h,size){
  const out=source.slice(),count=new Uint16Array(65);
  for(let yy=0;yy<h;yy+=size)for(let xx=0;xx<w;xx+=size){
    count.fill(0);let best=0,votes=0;
    const ymax=Math.min(h,yy+size),xmax=Math.min(w,xx+size);
    for(let y=yy;y<ymax;y++)for(let x=xx;x<xmax;x++){
      const id=source[y*w+x];
      if(!id)continue;
      const n=++count[id];
      if(n>votes){best=id;votes=n;}
    }
    if(!best)continue;
    for(let y=yy;y<ymax;y++)for(let x=xx;x<xmax;x++)
      if(source[y*w+x])out[y*w+x]=best;
  }
  return out;
}

export function splitColorInstances(colors,width,height,options={}){
  if(colors.length!==width*height||width*height>2500000||width<1||height<1)
    throw Error('Invalid object-map dimensions.');
  const total=colors.length;
  const instability=unstableRatio(colors,width,height);
  let cleaned=instability>.19?cleanSpeckles(colors,width,height,instability>.32?3:2):colors;
  // An image-generation failure can look like millions of unique tiny
  // connected colors. Fall back to spatially stable IDs, not a retry error.
  const afterDenoise=unstableRatio(cleaned,width,height);
  if(afterDenoise>.45)
    cleaned=stabilizeTiles(cleaned,width,height,afterDenoise>.65?6:4);
  const owners=new Uint32Array(total),queue=new Uint32Array(total),components=[];
  // Raster flood fill uses one shared queue. Only small parts store their
  // pixels; even hundreds of thousands of specks cannot exhaust heap memory.
  for(let start=0;start<total;start++){
    const color=cleaned[start];if(!color||owners[start])continue;
    const index=components.length+1;
    let head=0,tail=1,minX=width,minY=height,maxX=0,maxY=0;
    queue[0]=start;owners[start]=index;
    while(head<tail){
      const pixel=queue[head++],x=pixel%width,y=(pixel-x)/width;
      if(x<minX)minX=x;if(x>maxX)maxX=x;
      if(y<minY)minY=y;if(y>maxY)maxY=y;
      const adjacent=[x?pixel-1:-1,x+1<width?pixel+1:-1,
        y?pixel-width:-1,y+1<height?pixel+width:-1];
      for(const neighbor of adjacent){
        if(neighbor>=0&&!owners[neighbor]&&cleaned[neighbor]===color){
          owners[neighbor]=index;queue[tail++]=neighbor;
        }
      }
    }
    components.push({index,colorId:color,seed:start,area:tail,
      pixels:tail>1&&tail<=4096?queue.slice(0,tail):null,minX,minY,maxX,maxY});
  }
  if(!components.length)return {labels:new Uint32Array(total),objects:[]};
  const minimum=options.minArea??Math.max(8,Math.round(total*.000015));
  const radius=options.clusterGap??Math.max(2,Math.min(16,Math.round(Math.min(width,height)*.01)));
  const boxDistance=(a,b)=>Math.hypot(
    Math.max(0,a.minX-b.maxX,b.minX-a.maxX),
    Math.max(0,a.minY-b.maxY,b.minY-a.maxY)
  );
  function nearby(part,anchor){
    if(boxDistance(part,anchor)>radius||part.area>4096)return Infinity;
    const pixels=part.pixels||[part.seed],step=Math.max(1,Math.floor(pixels.length/96));
    let closest=Infinity;
    for(let i=0;i<pixels.length;i+=step){
      const p=pixels[i],x=p%width,y=(p-x)/width;
      // Search directly around a small fragment rather than across the
      // anchor's entire bounding box.
      for(let yy=Math.max(0,y-radius);yy<=Math.min(height-1,y+radius);yy++){
        for(let xx=Math.max(0,x-radius);xx<=Math.min(width-1,x+radius);xx++){
          const d=(xx-x)**2+(yy-y)**2;
          if(d>=closest||d>radius*radius)continue;
          if(owners[yy*width+xx]===anchor.index){closest=d;if(d<=1)return d;}
        }
      }
    }
    return closest;
  }
  const byColor=new Map();
  for(const component of components){
    if(!byColor.has(component.colorId))byColor.set(component.colorId,[]);
    byColor.get(component.colorId).push(component);
  }
  const clusters=[];
  for(const parts of byColor.values()){
    parts.sort((a,b)=>b.area-a.area||a.seed-b.seed);
    const local=[];
    const threshold=Math.max(minimum,Math.min(parts[0].area*(options.relativeMinArea??.01),
      options.noiseArea??total*.0001));
    for(const part of parts){
      let nearest=null,distance=Infinity;
      // Test only spatially plausible anchors; never merge two major
      // instances merely because they share a palette color.
      if(part.area<=4096&&local.length){
        let tested=0;
        for(const cluster of local){
          if(part.area>cluster.anchor.area*.15)continue;
          if(boxDistance(part,cluster.anchor)>radius)continue;
          const candidate=nearby(part,cluster.anchor);
          if(candidate<distance){distance=candidate;nearest=cluster}
          if(++tested>=16)break;
        }
      }
      if(nearest){nearest.parts.push(part);nearest.area+=part.area;}
      else if(part.area>=threshold){
        const cluster={anchor:part,colorId:part.colorId,seed:part.seed,area:part.area,parts:[part]};
        clusters.push(cluster);local.push(cluster);
      }
    }
  }
  // Extremely noisy maps can still have thousands of eligible components.
  // Keep the largest meaningful pieces and absorb the smaller ones instead
  // of throwing "too fragmented" / "too many independent objects".
  const maxObjects=Math.max(1,Math.min(MAX_OBJECTS,options.maxObjects??512));
  if(!clusters.length){
    const biggest=components.reduce((a,b)=>b.area>a.area?b:a);
    clusters.push({anchor:biggest,colorId:biggest.colorId,seed:biggest.seed,area:biggest.area,parts:[biggest]});
  }
  if(clusters.length>maxObjects){
    clusters.sort((a,b)=>b.area-a.area||a.seed-b.seed);
    clusters.length=maxObjects;
  }
  clusters.sort((a,b)=>a.seed-b.seed);
  const componentIds=new Uint32Array(components.length+1);
  clusters.forEach((cluster,index)=>{for(const part of cluster.parts)componentIds[part.index]=index+1;});
  const labels=new Uint32Array(total);
  let tail=0;
  // Surviving components seed an ownership flood. Reassign only pixels that
  // were valid object colors; original zero/black holes never get filled.
  for(let p=0;p<total;p++){
    const id=componentIds[owners[p]];
    if(id){labels[p]=id;queue[tail++]=p;}
  }
  let head=0;
  while(head<tail){
    const p=queue[head++],x=p%width,y=(p-x)/width,id=labels[p];
    for(const neighbor of [x?p-1:-1,x+1<width?p+1:-1,y?p-width:-1,y+1<height?p+width:-1]){
      if(neighbor>=0&&cleaned[neighbor]&&!labels[neighbor]){
        labels[neighbor]=id;queue[tail++]=neighbor;
      }
    }
  }
  // A color island separated by black from every survivor gets a stable
  // independent ID only when space remains; otherwise keep a local fallback.
  if(tail<components.reduce((sum,c)=>sum+c.area,0)){
    for(const part of components){
      if(componentIds[part.index])continue;
      const p=part.seed;if(labels[p]||part.area<minimum)continue;
      const id=clusters.length<maxObjects?clusters.length+1:0;
      if(!id)continue;
      clusters.push({anchor:part,colorId:part.colorId,seed:part.seed,area:part.area,parts:[part]});
      let first=0,last=1;queue[0]=p;labels[p]=id;
      while(first<last){
        const q=queue[first++],x=q%width,y=(q-x)/width;
        for(const neighbor of [x?q-1:-1,x+1<width?q+1:-1,y?q-width:-1,y+1<height?q+width:-1]){
          if(neighbor>=0&&cleaned[neighbor]&&!labels[neighbor]){
            labels[neighbor]=id;queue[last++]=neighbor;
          }
        }
      }
    }
  }
  const stats=Array.from({length:clusters.length},()=>({area:0,minX:width,minY:height,maxX:-1,maxY:-1}));
  for(let p=0;p<total;p++){
    const id=labels[p];if(!id)continue;
    const b=stats[id-1],x=p%width,y=(p-x)/width;
    b.area++;if(x<b.minX)b.minX=x;if(x>b.maxX)b.maxX=x;
    if(y<b.minY)b.minY=y;if(y>b.maxY)b.maxY=y;
  }
  const objects=clusters.map((c,i)=>({
    id:i+1,colorId:c.colorId,seed:c.seed,area:stats[i].area,
    box:{x:stats[i].minX,y:stats[i].minY,w:stats[i].maxX-stats[i].minX+1,
      h:stats[i].maxY-stats[i].minY+1}
  })).filter(o=>o.area>0);
  return {labels,objects,stats:{initialComponents:components.length,
    retainedObjects:objects.length,noiseRecovered:instability>.45||components.length>objects.length,instability}};
}
