/**
 * Scans a prepared instance-id map exactly once for a drawn selection.
 * Uses no per-object full-frame canvas and never calls AI.
 */
export function intersectObjectIds(labels,width,height,rgba,selectionWidth,selectionHeight,minPixels=3){
  if(!labels||!rgba||width<=0||height<=0||selectionWidth<=0||selectionHeight<=0)return [];
  const hit=new Map();let selected=0;
  for(let y=0;y<height;y++){
    const sy=Math.min(selectionHeight-1,Math.floor((y+.5)*selectionHeight/height));
    for(let x=0;x<width;x++){
      const sx=Math.min(selectionWidth-1,Math.floor((x+.5)*selectionWidth/width));
      if(rgba[(sy*selectionWidth+sx)*4+3]<128)continue;
      selected++;
      const id=labels[y*width+x];
      if(id)hit.set(id,(hit.get(id)||0)+1);
    }
  }
  const cutoff=Math.max(minPixels,Math.min(6,Math.round(selected*.002)));
  return [...hit].filter(([,count])=>count>=cutoff).map(([id])=>id);
}
