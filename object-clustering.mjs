// Local, deterministic spatial + semantic clustering for the Groups panel.
// A cluster is ONLY a UI container. It never unions pixels or object IDs.
export const MAX_SCENE_GROUPS = 15;

function clean(value) {
  return String(value || '').toLowerCase().replace(/\b(?:object|instance|piece|part|number|no)\b/g, ' ')
    .replace(/\d+\b/g, ' ').replace(/[^a-z\p{L}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function family(item) {
  const label = clean(item.label || item.name);
  if (/\b(chair|table|sofa|couch|desk|seat|cabinet|counter|shelf|bed|furniture|stool|bench)\b/.test(label)) return 'furniture';
  if (/\b(door|frame|hinge|handle|knob|window|glass|glazing|mullion|curtainwall)\b/.test(label)) return 'openings';
  if (/\b(light|lamp|pendant|fixture|luminaire|sconce|downlight)\b/.test(label)) return 'lighting';
  const category=String(item.category||'');
  if (['Furniture','Millwork'].includes(category)) return 'furniture';
  if (['Door','Window','Glazing'].includes(category)) return 'openings';
  if (['Wall','Structure'].includes(category)) return 'architecture';
  if (category==='Ceiling')return 'ceiling';
  if (category==='Floor')return 'floor';
  if (category==='Lighting')return 'lighting';
  if (category==='Landscape')return 'landscape';
  if (category==='Stairs')return 'stairs';
  return 'other';
}
function hint(item) {
  const label = clean(item.suggestedGroup || item.group);
  if (!label || ['other','region','scene objects','object','general','furniture','wall','ceiling','floor','door','window','lighting','structure'].includes(label)) return '';
  return label;
}
function rect(item, width, height) {
  const b=item.box || item.spatialBox || {};
  const x=Math.min(1,Math.max(0,(Number(b.x)||0)/width)),y=Math.min(1,Math.max(0,(Number(b.y)||0)/height));
  const w=Math.max(.00001,Math.min(1-x,(Number(b.w)||1)/width)),h=Math.max(.00001,Math.min(1-y,(Number(b.h)||1)/height));
  return {x,y,w,h,cx:x+w/2,cy:y+h/2};
}
function gap(a,b) {
  return Math.hypot(Math.max(0,a.x-b.x-b.w,b.x-a.x-a.w),Math.max(0,a.y-b.y-b.h,b.y-a.y-a.h));
}
function pairScore(a,b) {
  const distance=gap(a.box,b.box),centres=Math.hypot(a.box.cx-b.box.cx,a.box.cy-b.box.cy);
  const matchingHint=a.hint&&a.hint===b.hint;
  const sameFamily=a.family===b.family&&a.family!=='other';
  const labelMatch=clean(a.label)===clean(b.label);
  const compatibility=(
    a.family==='openings'&&b.family==='architecture'||
    b.family==='openings'&&a.family==='architecture'
  );
  // Prevent a huge floor/wall covering the entire image from swallowing furniture.
  let semantic=matchingHint?3.5:sameFamily?2.35:compatibility?1.25:a.family===b.family?1.25:-1.15;
  if(labelMatch)semantic+=.45;
  if(a.family==='other'&&b.family==='other'&&!matchingHint&&!labelMatch)semantic-=.65;
  const spread=Math.min(1,centres)*1.5;
  // Nearby instances/parts of the same semantic unit stick together.
  return semantic-distance*12-spread;
}
function clusterScore(cluster,item) {
  let best=-Infinity;
  for(const representative of cluster.representatives)best=Math.max(best,pairScore(representative,item));
  const dx=item.box.cx-cluster.cx,dy=item.box.cy-cluster.cy;
  const drift=Math.hypot(dx,dy);
  // Avoid bridge-like chains that join physically remote repeated objects.
  return best-Math.max(0,drift-.16)*2.6;
}
function add(cluster,item) {
  const n=cluster.items.length;
  cluster.cx=(cluster.cx*n+item.box.cx)/(n+1);cluster.cy=(cluster.cy*n+item.box.cy)/(n+1);
  cluster.items.push(item);
  if(cluster.representatives.length<7)cluster.representatives.push(item);
  else {
    // Rotate one non-anchor representative so later nearby objects remain visible.
    cluster.representatives[1+(n%6)]=item;
  }
}
function labelFor(cluster) {
  const counts=new Map(),families=new Map();
  for(const item of cluster.items){if(item.hint)counts.set(item.hint,(counts.get(item.hint)||0)+1);families.set(item.family,(families.get(item.family)||0)+1)}
  const bestHint=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
  if(bestHint&&bestHint[1]>=Math.max(1,Math.ceil(cluster.items.length*.45)))return bestHint[0].replace(/\b\w/g,c=>c.toUpperCase());
  const family=[...families].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||'other';
  const names={furniture:'Furniture set',openings:'Door & glazing',architecture:'Wall assembly',ceiling:'Ceiling system',floor:'Floor area',lighting:'Lighting set',landscape:'Landscape',stairs:'Stair assembly',other:'Object assembly'};
  if(cluster.items.length===1) {
    const solo=cluster.items[0].label;
    return solo ? String(solo).replace(/^./,c=>c.toUpperCase()) : names[family];
  }
  return names[family];
}
/**
 * @param {Array<{id:string,box:{x:number,y:number,w:number,h:number},category?:string,label?:string,suggestedGroup?:string}>} objects
 * @param {{width:number,height:number,maxGroups?:number}} options
 * @returns {Array<{name:string, ids:string[]}>}
 */
export function clusterSceneObjects(objects,options={}) {
  if(!Array.isArray(objects)||!objects.length)return [];
  const width=Math.max(1,Number(options.width)||1),height=Math.max(1,Number(options.height)||1);
  const max=Math.min(MAX_SCENE_GROUPS,Math.max(1,Math.floor(Number(options.maxGroups)||MAX_SCENE_GROUPS)));
  const items=objects.filter(item=>item&&item.id&&item.box&&Number(item.box.w)>0&&Number(item.box.h)>0).map(item=>({
    id:String(item.id),label:item.label||item.name||'',family:family(item),hint:hint(item),box:rect(item,width,height)
  }));
  // Larger anchors first; fixed tie breaks keep results stable across re-renders.
  items.sort((a,b)=>b.box.w*b.box.h-a.box.w*a.box.h||a.box.cy-b.box.cy||a.box.cx-b.box.cx||a.id.localeCompare(b.id));
  const groups=[];
  for(const item of items){
    let best=null,score=-Infinity;
    for(const group of groups){const value=clusterScore(group,item);if(value>score){score=value;best=group}}
    // With fewer than max groups, don't force distant objects together.
    if(!best||(score<1.18&&groups.length<max)){
      groups.push({items:[item],representatives:[item],cx:item.box.cx,cy:item.box.cy});
    }else add(best,item);
  }
  // Visual reading order, not priority or raw model palette order.
  groups.sort((a,b)=>a.cy-b.cy||a.cx-b.cx);
  const repeated=new Map();
  return groups.map(group=>{
    const label=labelFor(group),index=(repeated.get(label)||0)+1;repeated.set(label,index);
    return {name:index===1?label:label+' '+index,ids:group.items.map(item=>item.id)};
  });
}
