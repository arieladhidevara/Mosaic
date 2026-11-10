import {MAX_OBJECTS} from './object-map-cleanup.mjs';
// Palette IDs are decoded first; spatial cleanup assigns independent object IDs.
export const PALETTE=Array.from({length:64},(_,index)=>{
  const rgb=[48+64*((index>>4)&3),48+64*((index>>2)&3),48+64*(index&3)];
  return {id:index+1,rgb,color:'#'+rgb.map(value=>value.toString(16).padStart(2,'0')).join('')};
});
export const CATEGORIES=['Wall','Ceiling','Floor','Door','Window','Glazing','Furniture','Millwork','Lighting','Structure','Landscape','Stairs','Other'];
export const MIN_MAP_PIXELS=655360;
export function objectMapSize(width,height){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width/height<1/3||width/height>3)throw Error('Object maps need a Base aspect ratio between 1:3 and 3:1.');
  // Aim above the minimum rather than capping the long edge at 1024: a
  // landscape 1024x608 map falls below the Images API pixel budget.
  const scale=Math.sqrt(1048576/(width*height));
  let w=Math.ceil(width*scale/16)*16,h=Math.ceil(height*scale/16)*16;
  if(w>h*3)h=Math.ceil(w/3/16)*16;if(h>w*3)w=Math.ceil(h/3/16)*16;
  return {width:w,height:h};
}
export function decodeColors(rgba,width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>2500000||rgba.length!==width*height*4)throw Error('Invalid object-map dimensions.');
  const labels=new Uint8Array(width*height),counts=new Uint32Array(65);
  let colored=0,flat=0;
  for(let i=0;i<labels.length;i++){
    const p=i*4,r=rgba[p],g=rgba[p+1],b=rgba[p+2];
    if(rgba[p+3]<128||Math.max(r,g,b)<24)continue;
    let best=0,distance=Infinity;
    for(const color of PALETTE){const d=(r-color.rgb[0])**2+(g-color.rgb[1])**2+(b-color.rgb[2])**2;if(d<distance){distance=d;best=color.id}}
    colored++;if(distance<=24**2)flat++;labels[i]=best;counts[best]++;
  }
  if(!colored||flat/colored<.8)throw Error('The object map is not a flat-color map. Retry object preparation.');
  const minimum=1;
  for(let i=0;i<labels.length;i++)if(counts[labels[i]]<minimum)labels[i]=0;
  const ids=Array.from(counts.keys()).filter(id=>id&&counts[id]>=minimum);
  if(ids.length<2)throw Error('The object map did not separate enough objects. Retry object preparation.');
  return {labels,ids};
}
export function idsInShape(labels,width,height,alpha,targetWidth,targetHeight){
  const intersections=new Uint32Array(MAX_OBJECTS+1),totals=new Uint32Array(MAX_OBJECTS+1);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const id=labels[y*width+x];if(!id)continue;totals[id]++;
    const tx=Math.min(targetWidth-1,Math.floor((x+.5)*targetWidth/width)),ty=Math.min(targetHeight-1,Math.floor((y+.5)*targetHeight/height));
    if(alpha[(ty*targetWidth+tx)*4+3]>=128)intersections[id]++;
  }
  // Rectangle, oval and lasso automatically snap to intersecting instance masks.
  // Use meaningful overlap instead of requiring 50% of the object's area;
  // tiny accidental edge contacts must not select an entire wall.
  const selected=alpha.reduce((sum,value,index)=>sum+(index%4===3&&value>=128?1:0),0);
  const normalizedSelected=selected*width*height/Math.max(1,targetWidth*targetHeight);
  return Array.from(totals.keys()).filter(id=>id&&intersections[id]>=Math.max(8,Math.min(totals[id]*.12,normalizedSelected*.16)));
}
export function labelAt(labels,width,height,x,y,targetWidth,targetHeight){
  if(x<0||y<0||x>=targetWidth||y>=targetHeight)return 0;
  return labels[Math.min(height-1,Math.floor(y*height/targetHeight))*width+Math.min(width-1,Math.floor(x*width/targetWidth))]||0;
}
