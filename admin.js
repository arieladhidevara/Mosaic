const account=window.MosaicAccount,$=id=>document.getElementById(id);
let view='overview',page=1,more=false,loading=0,detailId=null;
const titles={overview:'Overview',users:'Users',invitations:'Invitations',generations:'BYOK usage',events:'Activity',user:'User projects',project:'Project usage'};
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
  fields.forEach(key=>header.append(element('th',key.replaceAll('_',' '))));if(['users','user','invitations'].includes(view))header.append(element('th','Action'));head.append(header);
  for(const row of rows){
    const tr=element('tr');for(const key of fields){let value=row[key];if(value===null||value===undefined)value='—';else if(typeof value==='boolean')value=value?'On':'Off';tr.append(element('td',String(value)))}
    if(view==='users'||view==='user'){
      const td=element('td'),button=element('button',view==='users'?'View projects':'View edits','btn btn-outline compact');
      button.onclick=()=>{view=view==='users'?'user':'project';detailId=view==='user'?(row.user_id||row.id):row.id;page=1;void load()};
      td.append(button);tr.append(td);
    }
    if(view==='invitations'){
      const td=element('td'),button=element('button',row.revoked_at?'Revoked':'Revoke','btn btn-quiet compact');button.disabled=Boolean(row.revoked_at);
      button.onclick=async()=>{try{await account.request('/api/admin',{method:'POST',body:{action:'revoke',id:row.id}});await load()}catch(error){$('adminError').textContent=error.message}};td.append(button);tr.append(td);
    }
    body.append(tr);
  }
  t.append(head,body);wrap.append(t);host.append(wrap);
}

const prettyNumber=value=>value===null||value===undefined?'—':Number(value).toLocaleString('en-US');
const prettyMoney=value=>value===null||value===undefined?'—':'$'+Number(value).toFixed(5);
function metrics(host,values){
  const grid=element('div',undefined,'admin-metrics');
  for(const [title,value] of Object.entries(values)){const card=element('div',undefined,'admin-metric');card.append(element('span',title),element('strong',String(value)));grid.append(card)}
  host.append(grid);
}
function backTo(target,id=null){
  const button=element('button','← Back to '+(target==='users'?'users':'projects'),'btn btn-outline compact');
  button.onclick=()=>{view=target;detailId=id;page=1;void load()};return button;
}
function usageCards(host,summary){
  metrics(host,{'Edit requests':prettyNumber(summary.edits),'Masking':prettyNumber(summary.masking),
    'Master':prettyNumber(summary.master),'Harmonize':prettyNumber(summary.harmonize),
    'Tokens (known)':prettyNumber(summary.total_tokens),
    'Estimated API cost (known)':prettyMoney(summary.estimated_cost_usd)});
  host.append(element('p',summary.token_records+'/'+summary.edits+' edit requests have token records; '+
    summary.cost_records+'/'+summary.edits+' have cost estimates. Missing data is not treated as $0. Counts include pending and failed requests.','usage-note'));
}
function showUser(host,data){
  host.append(backTo('users'),element('h2',data.user.email||data.user.user_id||data.user.id));
  usageCards(host,data.summary);
  host.append(element('h3','Projects ('+data.projects.length+')'));
  const rows=data.projects.map(p=>({id:p.id,created_at:p.created_at,edits:p.edits,masking:p.masking,
    master:p.master,harmonize:p.harmonize,total_tokens:prettyNumber(p.total_tokens),
    estimated_cost_usd:prettyMoney(p.estimated_cost_usd)}));
  table(host,rows);
  if(data.unassigned_edits)host.append(element('p',data.unassigned_edits+' edit requests are not linked to a project.','usage-note'));
  if(data.truncated)host.append(element('p','Large history: first 500 projects / 5,000 edits included in these totals.','usage-note'));
}
function showProject(host,data){
  host.append(backTo('user',data.project.user_id),
    element('h2','Project '+data.project.id.slice(0,8)),
    element('p','Project ID: '+data.project.id+' · '+(data.user?.email||data.project.user_id),'usage-note'));
  usageCards(host,data.summary);
  host.append(element('h3','Generation history'));
  table(host,data.generations.map(g=>({
    created_at:g.created_at,
    edit_type:g.operation==='edit'?'Masking':g.operation==='master'?'Master':'Harmonize',
    status:g.status,quality:g.quality,model:g.model,
    input_tokens:prettyNumber(g.input_tokens),output_tokens:prettyNumber(g.output_tokens),
    total_tokens:prettyNumber(g.total_tokens),estimated_cost_usd:prettyMoney(g.estimated_cost_usd),
    duration_ms:g.duration_ms??'—'
  })));
  if(data.truncated)host.append(element('p','Only the first 1,000 generation records are shown.','usage-note'));
  host.append(element('p','Images and prompts remain in the user browser or saved .moz files, not admin analytics. Only metadata is available.','usage-note'));
}
async function load(){
  const version=++loading,content=$('adminContent');content.replaceChildren(element('p','Loading...'));$('adminError').textContent='';$('adminPages').hidden=true;
  try{
    const url='/api/admin?view='+view+'&page='+page+((view==='user'||view==='project')?'&id='+encodeURIComponent(detailId||''):'');
    const result=await account.request(url);if(version!==loading)return;
    content.replaceChildren();$('adminTitle').textContent=titles[view];$('adminEnvironment').textContent='Environment: '+result.environment;
    if(view==='user'){showUser(content,result.data);more=false;
    }else if(view==='project'){showProject(content,result.data);more=false;
    }else if(view==='overview'){
      const grid=element('div',undefined,'admin-metrics');
      const labels={users:'Registered users',projects:'Projects',generations:'Generations',exports:'Image downloads',successful_generations:'Successful generations',failed_generations:'Failed generations',total_tokens:'Known total tokens',usage_records:'Records with token usage',average_duration_ms:'Average generation time (ms)'};
      for(const [key,label] of Object.entries(labels)){const card=element('div',undefined,'admin-metric');card.append(element('span',label),element('strong',result.data[key]??'—'));grid.append(card)}
      content.append(grid,element('p','Counts use stored activity in this environment. Image downloads count Save image actions, not successful generations. Unknown token usage is shown as —.','usage-note'));
    }else{
      if(view==='invitations')invitationForm(content);
      if(view==='generations')content.append(element('p','Estimated user-paid OpenAI API cost (BYOK). Costs are estimated from reported image and text token usage at current standard rates. Missing usage stays unknown. API keys, images, and prompts are never stored in analytics.','usage-note'));
      table(content,result.data.rows);more=result.data.hasMore;$('adminPages').hidden=false;$('adminPrevious').disabled=page===1;$('adminNext').disabled=!more;$('adminPage').textContent='Page '+page;
    }
  }catch(error){if(version!==loading)return;content.replaceChildren();$('adminError').textContent=error.message}
}
$('adminNav').onclick=event=>{const button=event.target.closest('[data-view]');if(!button)return;view=button.dataset.view;detailId=null;page=1;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));void load()};
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
