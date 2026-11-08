const account=window.MosaicAccount,$=id=>document.getElementById(id);
let view='overview',page=1,more=false,loading=0;
const titles={overview:'Overview',users:'Users',invitations:'Invitations',generations:'BYOK usage',events:'Activity'};
function element(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e}
function invitationForm(host){
  const form=element('form',undefined,'invite-form');
  for(const [name,title,type,value] of [['label','Label','text',''],['email','Email (optional)','email',''],['days','Expires in days','number','7'],['maxUses','Maximum uses','number','1']]){
    const label=element('label',title),input=element('input');input.name=name;input.type=type;input.value=value;input.maxLength=name==='email'?254:64;
    if(type==='number'){input.min='1';input.max=name==='days'?'30':'100';input.required=true}label.append(input);form.append(label);
  }
  const submit=element('button','Create invitation','btn btn-premium');submit.type='submit';form.append(submit);host.append(form);
  form.onsubmit=async event=>{
    event.preventDefault();submit.disabled=true;
    try{
      const values=Object.fromEntries(new FormData(form)),result=await account.request('/api/admin',{method:'POST',body:{action:'invite',...values}});
      const box=element('div',undefined,'invitation-link'),input=element('input');input.readOnly=true;input.value=location.origin+'/#invite='+result.token;input.setAttribute('aria-label','New invitation link');
      const copy=element('button','Copy link','btn btn-outline');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(input.value);copy.textContent='Copied'}catch{input.select()}};box.append(input,copy);
      await load();$('adminContent').prepend(box,element('p','Copy this link now. It is shown only once.','usage-note'));
    }catch(error){$('adminError').textContent=error.message}finally{submit.disabled=false}
  };
}
function table(host,rows){
  if(!rows.length){host.append(element('p','No records in this environment yet.','admin-empty'));return}
  const fields=Object.keys(rows[0]),wrap=element('div',undefined,'admin-table-wrap'),t=element('table'),head=element('thead'),header=element('tr'),body=element('tbody');
  fields.forEach(key=>header.append(element('th',key.replaceAll('_',' '))));if(view==='invitations')header.append(element('th','Action'));head.append(header);
  for(const row of rows){
    const tr=element('tr');for(const key of fields){let value=row[key];if(value===null||value===undefined)value='—';else if(typeof value==='boolean')value=value?'On':'Off';tr.append(element('td',String(value)))}
    if(view==='invitations'){
      const td=element('td'),button=element('button',row.revoked_at?'Revoked':'Revoke','btn btn-quiet compact');button.disabled=Boolean(row.revoked_at);
      button.onclick=async()=>{try{await account.request('/api/admin',{method:'POST',body:{action:'revoke',id:row.id}});await load()}catch(error){$('adminError').textContent=error.message}};td.append(button);tr.append(td);
    }
    body.append(tr);
  }
  t.append(head,body);wrap.append(t);host.append(wrap);
}
async function load(){
  const version=++loading,content=$('adminContent');content.replaceChildren(element('p','Loading...'));$('adminError').textContent='';$('adminPages').hidden=true;
  try{
    const result=await account.request('/api/admin?view='+view+'&page='+page);if(version!==loading)return;
    content.replaceChildren();$('adminTitle').textContent=titles[view];$('adminEnvironment').textContent='Environment: '+result.environment;
    if(view==='overview'){
      const grid=element('div',undefined,'admin-metrics');
      const labels={users:'Registered users',projects:'Projects',generations:'Generations',exports:'Image downloads',successful_generations:'Successful generations',failed_generations:'Failed generations',total_tokens:'Known total tokens',usage_records:'Records with token usage',average_duration_ms:'Average generation time (ms)'};
      for(const [key,label] of Object.entries(labels)){const card=element('div',undefined,'admin-metric');card.append(element('span',label),element('strong',result.data[key]??'—'));grid.append(card)}
      content.append(grid,element('p','Counts use stored activity in this environment. Image downloads count Save image actions, not successful generations. Unknown token usage is shown as —.','usage-note'));
    }else{
      if(view==='invitations')invitationForm(content);
      if(view==='generations')content.append(element('p','Estimated user-paid OpenAI API cost (BYOK). Costs are not calculated until a verified price is configured for the model. Missing usage stays unknown. API keys, images, and prompts are never stored in analytics.','usage-note'));
      table(content,result.data.rows);more=result.data.hasMore;$('adminPages').hidden=false;$('adminPrevious').disabled=page===1;$('adminNext').disabled=!more;$('adminPage').textContent='Page '+page;
    }
  }catch(error){if(version!==loading)return;content.replaceChildren();$('adminError').textContent=error.message}
}
$('adminNav').onclick=event=>{const button=event.target.closest('[data-view]');if(!button)return;view=button.dataset.view;page=1;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));void load()};
$('adminRefresh').onclick=()=>void load();$('adminPrevious').onclick=()=>{if(page>1){page--;void load()}};$('adminNext').onclick=()=>{if(more){page++;void load()}};
$('resetLocalData').onclick=async()=>{
  if(!confirm('Reset only local development records? Saved .moz files are preserved.'))return;
  try{await account.request('/api/admin',{method:'POST',body:{action:'reset'}});await load()}catch(error){$('adminError').textContent=error.message}
};
async function openAdmin(){
  const user=account.current();if(!user)return;
  if(user.role!=='admin'){$('adminContent').replaceChildren();$('adminError').textContent='Administrator access is required.';return}
  $('localDataControls').hidden=user.auth!=='development';void load();
}
window.addEventListener('mosaic:account',()=>void openAdmin());void account.ready().then(openAdmin);
