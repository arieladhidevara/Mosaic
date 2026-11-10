// Object identity is spatial. Reusing a palette color never joins distant
// objects. Only small fragments near a dominant component can share its ID.
export const MAX_OBJECTS=2048;
export const CLEANUP_VERSION=3;
export function splitColorInstances(colors,width,height,options={}){
  if(colors.length!==width*height||width*height>2500000)throw Error('Invalid object-map dimensions.');
  const total=colors.length,owners=new Uint32Array(total),queue=new Uint32Array(total),components=[];
  for(let start=0;start<total;start++){
    const color=colors[start];if(!color||owners[start])continue;
    if(components.length>=20000)throw Error('Object map is too fragmented. Retry objects.');
    const index=components.length+1;let head=0,tail=1,minX=width,minY=height,maxX=0,maxY=0;
    queue[0]=start;owners[start]=index;
    while(head<tail){
      const pixel=queue[head++],x=pixel%width,y=(pixel-x)/width;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const neighbor of [x?pixel-1:-1,x+1<width?pixel+1:-1,y?pixel-width:-1,y+1<height?pixel+width:-1]){
        if(neighbor>=0&&!owners[neighbor]&&colors[neighbor]===color){owners[neighbor]=index;queue[tail++]=neighbor}
      }
    }
    components.push({index,colorId:color,seed:start,area:tail,pixels:queue.slice(0,tail),minX,minY,maxX,maxY});
  }
  const byColor=new Map();for(const part of components){if(!byColor.has(part.colorId))byColor.set(part.colorId,[]);byColor.get(part.colorId).push(part)}
  const minimum=options.minArea??Math.max(8,Math.round(total*.000015));
  const radius=options.clusterGap??Math.max(2,Math.min(16,Math.round(Math.min(width,height)*.01)));
  const clusters=[],dropped=[];
  const boxDistance=(a,b)=>Math.hypot(Math.max(0,a.minX-b.maxX,b.minX-a.maxX),Math.max(0,a.minY-b.maxY,b.minY-a.maxY));
  function nearby(part,anchor){
    if(boxDistance(part,anchor)>radius)return Infinity;
    let distance=Infinity;
    for(const pixel of part.pixels){
      const px=pixel%width,py=(pixel-px)/width;
      // Search from boundary pixels only. Distances are measured against the
      // original dominant component, preventing chains of specks bridging gaps.
      if(px&&px+1<width&&py&&py+1<height&&owners[pixel-1]===part.index&&owners[pixel+1]===part.index&&owners[pixel-width]===part.index&&owners[pixel+width]===part.index)continue;
      for(let y=Math.max(0,py-radius);y<=Math.min(height-1,py+radius);y++)for(let x=Math.max(0,px-radius);x<=Math.min(width-1,px+radius);x++){
        const squared=(x-px)**2+(y-py)**2;if(squared>radius*radius||squared>=distance)continue;
        if(owners[y*width+x]===anchor.index){distance=squared;if(distance<=1)return distance}
      }
    }
    return distance;
  }
  for(const parts of byColor.values()){
    parts.sort((a,b)=>b.area-a.area||a.seed-b.seed);
    // A large wall must not erase a smaller visible opening of the same color.
    // Cap relative noise filtering by image area rather than dominant size.
    const local=[],threshold=Math.max(minimum,Math.min(parts[0].area*(options.relativeMinArea??.01),options.noiseArea??total*.0001));
    for(const part of parts){
      let nearest=null,distance=Infinity;
      for(const cluster of local){
        if(part.area>cluster.anchor.area*.15)continue;
        const candidate=nearby(part,cluster.anchor);if(candidate<distance){distance=candidate;nearest=cluster}
      }
      if(nearest){nearest.parts.push(part);nearest.area+=part.area}
      else if(part.area>=threshold){const cluster={anchor:part,colorId:part.colorId,seed:part.seed,area:part.area,parts:[part]};local.push(cluster);clusters.push(cluster)}
      else dropped.push(part);
    }
  }
  if(clusters.length>MAX_OBJECTS)throw Error('Object map contains too many independent objects. Retry objects.');
  clusters.sort((a,b)=>a.seed-b.seed);
  const labels=new Uint32Array(total),objects=[];
  clusters.forEach((cluster,index)=>{
    const id=index+1;let minX=width,minY=height,maxX=0,maxY=0;
    for(const part of cluster.parts){for(const pixel of part.pixels)labels[pixel]=id;minX=Math.min(minX,part.minX);minY=Math.min(minY,part.minY);maxX=Math.max(maxX,part.maxX);maxY=Math.max(maxY,part.maxY)}
    objects.push({id,colorId:cluster.colorId,seed:cluster.seed,area:cluster.area,box:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1}});
  });
  // Replace discarded flecks with their surrounding owner instead of leaving
  // pepper-shaped holes. Genuine black/transparent voids are never filled.
  for(const part of dropped){
    const votes=new Map();let count=0;
    for(const pixel of part.pixels){const x=pixel%width,y=(pixel-x)/width;for(const neighbor of [x?pixel-1:-1,x+1<width?pixel+1:-1,y?pixel-width:-1,y+1<height?pixel+width:-1]){const id=neighbor>=0?labels[neighbor]:0;if(id){votes.set(id,(votes.get(id)||0)+1);count++}}}
    const best=[...votes].sort((a,b)=>b[1]-a[1])[0];if(best&&best[1]>=count*.75)for(const pixel of part.pixels)labels[pixel]=best[0];
  }
  return {labels,objects};
}
