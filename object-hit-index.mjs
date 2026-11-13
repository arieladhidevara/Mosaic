/**
 * Sparse spatial index for created/edited objects. Base Color IDs use the
 * flat raster directly; only overrides need bounding-box buckets.
 * No DOM/canvas allocations happen during lookup.
 */
// Single-pixel hit testing in crop-local coordinates. No full-size mask scan.
export function cropContainsPoint(crop,point){
  if(!crop?.mask||!point)return false;
  const x=Math.floor(point.x)-crop.x,y=Math.floor(point.y)-crop.y;
  return x>=0&&y>=0&&x<crop.mask.width&&y<crop.mask.height&&
    crop.mask.getContext('2d',{willReadFrequently:true}).getImageData(x,y,1,1).data[3]>0;
}
export function buildObjectHitGrid(objects,width,height,tile=128){
  const size=Math.max(16,Math.floor(tile)||128),cols=Math.ceil(width/size);
  const cells=new Map();
  for(const object of objects||[]){
    const b=object.bounds;
    if(!b||!Number.isFinite(b.x)||!Number.isFinite(b.y)||!(b.w>0)||!(b.h>0))continue;
    const x0=Math.max(0,Math.floor(b.x/size)),y0=Math.max(0,Math.floor(b.y/size));
    const x1=Math.min(cols-1,Math.floor((b.x+b.w-1)/size));
    const y1=Math.min(Math.ceil(height/size)-1,Math.floor((b.y+b.h-1)/size));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const key=y*cols+x;
      if(!cells.has(key))cells.set(key,[]);
      cells.get(key).push(object);
    }
  }
  return {
    candidates(point){
      if(point.x<0||point.y<0||point.x>=width||point.y>=height)return [];
      return cells.get(Math.floor(point.y/size)*cols+Math.floor(point.x/size))?.slice().reverse()||[];
    },
    // Bounding box search for rectangle / Line / oval; each edited object
    // is visited at most once, not once per overlapping grid cell.
    candidatesInBox(bounds){
      const found=new Set(),items=[];
      if(!bounds?.w||!bounds?.h)return items;
      const x0=Math.max(0,Math.floor(bounds.x/size)),y0=Math.max(0,Math.floor(bounds.y/size));
      const x1=Math.min(cols-1,Math.floor((bounds.x+bounds.w-1)/size));
      const y1=Math.min(Math.ceil(height/size)-1,Math.floor((bounds.y+bounds.h-1)/size));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        for(const item of cells.get(y*cols+x)||[]){
          if(found.has(item))continue;
          found.add(item);
          const b=item.bounds;
          if(b&&b.x<bounds.x+bounds.w&&b.x+b.w>bounds.x&&b.y<bounds.y+bounds.h&&b.y+b.h>bounds.y)items.push(item);
        }
      }
      return items.sort((a,b)=>a.order-b.order);
    },
    tileCount:cells.size
  };
}
