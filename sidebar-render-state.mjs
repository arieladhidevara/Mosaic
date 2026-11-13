/**
 * Describe which sidebar DOM nodes need work. State-only changes do not
 * replace the list container or disrupt focused inputs and option forms.
 */
export function planSidebarRender(previous,next){
  if(!previous||previous.layout!==next.layout)
    return {full:true,replace:[],update:[]};
  const replace=[],update=[];
  for(const [id,row] of next.groups){
    const old=previous.groups.get(id);
    if(!old||old.structure!==row.structure)replace.push(id);
    else if(old.content!==row.content)update.push(id);
  }
  return {full:false,replace,update};
}
