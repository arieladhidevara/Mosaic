// Group repeated labels locally, keeping each object's mask and options intact.
const aliases={chairs:'chair',sofas:'sofa',couches:'sofa',couch:'sofa',tables:'table',cabinets:'cabinet',doors:'door',windows:'window',walls:'wall',shelves:'shelf',shelving:'shelf',shelfs:'shelf',lights:'light',lamps:'lamp',plants:'plant',wooden:'wood',grey:'gray'};
const positions=new Set(['the','a','an','left','right','front','back','rear','upper','lower','top','bottom','middle','center','centre','near','far','kiri','kanan','depan','belakang','atas','bawah']);
export function objectNameSignature(value){
  const text=String(value||'').normalize('NFKC').toLowerCase().replace(/([a-z])([0-9])/g,'$1 $2').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  if(!text||/^(?:unnamed(?: object)?|untitled(?: object)?|object|region|selection|area|scene objects?)(?:\s*\d+)?$/.test(text))return null;
  const words=text.split(/\s+/).filter(w=>!/^(?:\d+|[a-z])$/.test(w)&&!positions.has(w)).map(w=>aliases[w]||(w.length>4&&w.endsWith('ies')?w.slice(0,-3)+'y':w.length>4&&w.endsWith('s')&&!/(ss|us|is)$/.test(w)?w.slice(0,-1):w));
  if(!words.length||words.every(w=>['object','region','area','selection'].includes(w)))return null;
  return {key:[...new Set(words)].sort().join(' '),label:words.join(' ').replace(/^./,c=>c.toUpperCase())};
}
export function groupSimilarObjects(objects,collections,makeId,{includeExcluded=false}={}){
  const valid=new Set(collections.map(c=>c.id)),byName=new Map(),buckets=new Map();
  for(const c of collections){const name=objectNameSignature(c.name);if(name&&!byName.has(name.key))byName.set(name.key,c)}
  for(const object of objects){
    if(object.objectMapBatch||object.mergedInto||object.objectRemoved)continue;
    const name=objectNameSignature(object.name||object.objectName);if(!name)continue;
    if(!buckets.has(name.key))buckets.set(name.key,{...name,items:[]});
    buckets.get(name.key).items.push(object);
  }
  let changed=0;
  for(const bucket of buckets.values()){
    const eligible=bucket.items.filter(o=>!valid.has(o.collectionId)&&(includeExcluded||!o.autoGroupExcluded));
    if(!eligible.length)continue;
    let collection=byName.get(bucket.key);
    if(!collection&&eligible.length<2)continue;
    if(!collection){collection={id:makeId(),name:bucket.label,autoGroupKey:bucket.key};collections.push(collection);valid.add(collection.id);byName.set(bucket.key,collection)}
    for(const object of eligible){object.collectionId=collection.id;object.autoGroupExcluded=false;changed++}
  }
  return changed;
}
