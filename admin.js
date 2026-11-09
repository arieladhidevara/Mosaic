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
  const fields=Object.keys(rows[0]).filter(key=>!key.startsWith('_')),wrap=element('div',undefined,'admin-table-wrap'),t=element('table'),head=element('thead'),header=element('tr'),body=element('tbody');
  fields.forEach(key=>header.append(element('th',key.replaceAll('_',' '))));if(['users','user','invitations'].includes(view))header.append(element('th','Action'));head.append(header);
  for(const row of rows){
    const tr=element('tr');for(const key of fields){let value=row[key];if(value===null||value===undefined)value='—';else if(typeof value==='boolean')value=value?'On':'Off';tr.append(element('td',String(value)))}
    if(view==='users'||view==='user'){
      const td=element('td'),button=element('button',view==='users'?'View projects':'View edits','btn btn-outline compact');
      button.onclick=()=>{view=view==='users'?'user':'project';detailId=view==='user'?(row._id||row.user_id||row.id):row.id;page=1;void load()};
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
  metrics(host,{'AI mask edits':prettyNumber(summary.masking),'Harmonize':prettyNumber(summary.harmonize),
    'Master':prettyNumber(summary.master),'Wand selections':prettyNumber(summary.wand),
    'Auto Create runs':prettyNumber(summary.auto_create),'Mask adjustments':prettyNumber(summary.mask_edits),
    'Selections created':prettyNumber(summary.selections),
    'Estimated API cost (known)':prettyMoney(summary.estimated_cost_usd)});
  host.append(element('p',prettyNumber(summary.success)+' successful · '+prettyNumber(summary.failed)+' failed · '+prettyNumber(summary.pending)+' pending. '+
    summary.cost_records+'/'+summary.edits+' requests have cost estimates; '+prettyNumber(summary.total_tokens)+' known tokens. Missing costs remain unknown. Wand runs locally; its selections are not OpenAI image-generation charges.','usage-note'));
  const note=element('p',undefined,'usage-note'),link=element('a','OpenAI standard token rates');link.href='https://developers.openai.com/api/docs/pricing';link.target='_blank';link.rel='noopener noreferrer';
  note.append('API costs are approximate user-paid BYOK costs, calculated from provider-reported usage and ',link,'. Tool tracking starts with this release; earlier Wand and manual edits cannot be reconstructed.');host.append(note);
}
const operationLabels={masking:'AI mask edits',master:'Master',harmonize:'Harmonize',wand:'Wand',auto_create:'Auto Create',mask_edits:'Mask adjustments'};
const chartColors={masking:'#a28bf1',master:'#72b7ef',harmonize:'#69d2b2',wand:'#c3a7ff',auto_create:'#e3bd80',mask_edits:'#ea91b3',estimated_cost_usd:'#69d2b2'};
function usageCharts(host,summary,daily=[]){
  const grid=element('div',undefined,'admin-chart-grid'),breakdown=element('section',undefined,'admin-chart'),trend=element('section',undefined,'admin-chart');
  breakdown.append(element('h3','Activity by action'),element('p','All recorded actions in this scope','chart-subtitle'));
  const max=Math.max(1,...Object.keys(operationLabels).map(key=>Number(summary[key]||0)));
  for(const [key,label] of Object.entries(operationLabels)){
    const row=element('div',undefined,'admin-bar-row'),name=element('span',label),track=element('div',undefined,'admin-bar-track'),bar=element('span'),value=Number(summary[key]||0);
    bar.style.width=value/max*100+'%';bar.style.background=chartColors[key];track.append(bar);row.append(name,track,element('strong',prettyNumber(value)));breakdown.append(row);
  }
  const heading=element('div',undefined,'chart-heading'),select=element('select');select.setAttribute('aria-label','Daily chart metric');
  for(const [value,label] of [['generations','Generations'],['tools','Tool activity'],['cost','Estimated cost']]){const option=element('option',label);option.value=value;select.append(option)}
  heading.append(element('h3','Last 30 days'),select);trend.append(heading,element('p','Daily totals · UTC','chart-subtitle'));
  const plot=element('div',undefined,'admin-chart-plot'),legend=element('div',undefined,'chart-legend');trend.append(plot,legend);
  const ns='http://www.w3.org/2000/svg',svgNode=(name,attrs)=>{const node=document.createElementNS(ns,name);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node};
  function draw(){
    const keys=select.value==='tools'?['wand','auto_create','mask_edits']:select.value==='cost'?['estimated_cost_usd']:['masking','master','harmonize'];
    const series=daily.slice(-30),values=series.map(day=>keys.reduce((sum,key)=>sum+Number(day[key]||0),0));
    const ceiling=Math.max(select.value==='cost'?.01:1,...values),svg=svgNode('svg',{viewBox:'0 0 640 245',role:'img','aria-label':'Daily '+select.options[select.selectedIndex].text+' for the last 30 days'});
    const title=svgNode('title',{});title.textContent=svg.getAttribute('aria-label');svg.append(title);
    for(let i=0;i<=3;i++){const y=185-i*52,line=svgNode('line',{x1:56,y1:y,x2:626,y2:y,stroke:'#383746'}),label=svgNode('text',{x:48,y:y+4,'text-anchor':'end',fill:'#b9b2cb','font-size':11});label.textContent=select.value==='cost'?'$'+(ceiling*i/3).toFixed(3):String(Math.round(ceiling*i/3));svg.append(line,label)}
    const step=570/Math.max(1,series.length);
    series.forEach((day,index)=>{
      let y=185;
      for(const key of keys){const value=Number(day[key]||0),height=value/ceiling*156;if(!height)continue;
        y-=height;const bar=svgNode('rect',{x:57+index*step,y,width:Math.max(3,step-4),height,rx:2,fill:chartColors[key],tabindex:0});
        const description=day.date+' · '+(operationLabels[key]||'Known estimated cost')+': '+(key==='estimated_cost_usd'?prettyMoney(value):value);
        const tooltip=svgNode('title',{});tooltip.textContent=description;bar.setAttribute('aria-label',description);bar.append(tooltip);svg.append(bar);
      }
      if(index===0||index===series.length-1||(index%7===0&&index<series.length-4)){const label=svgNode('text',{x:57+index*step,y:211,fill:'#b9b2cb','font-size':11});label.textContent=day.date.slice(5);svg.append(label)}
    });
    if(!values.some(Boolean)){const empty=svgNode('text',{x:340,y:110,'text-anchor':'middle',fill:'#b9b2cb','font-size':13});empty.textContent=select.value==='cost'?'No known cost data in this period':'No recorded activity in this period';svg.append(empty)}
    plot.replaceChildren(svg);legend.replaceChildren();
    keys.forEach(key=>{const item=element('span'),dot=element('i');dot.style.background=chartColors[key];item.append(dot,operationLabels[key]||'Known estimated cost');legend.append(item)});
  }
  select.onchange=draw;draw();grid.append(breakdown,trend);host.append(grid);
}
function showUser(host,data){
  host.append(backTo('users'),element('h2',data.user.email||data.user.user_id||data.user.id));
  usageCards(host,data.summary);
  usageCharts(host,data.summary,data.daily);
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
  usageCharts(host,data.summary,data.daily);
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
    const url='/api/admin?view='+(['overview','users'].includes(view)?'analytics':view)+'&page='+page+((view==='user'||view==='project')?'&id='+encodeURIComponent(detailId||''):'');
    const result=await account.request(url);if(version!==loading)return;
    content.replaceChildren();$('adminTitle').textContent=titles[view];$('adminEnvironment').textContent='Environment: '+result.environment;
    if(result.data.migration_required)content.append(element('p','Tool tracking is not enabled on this deployment yet. Existing generation history and costs remain available; tool counts include only stored events.','usage-note admin-tracking-note'));
    if(result.data.truncated)content.append(element('p','This view includes a limited history. Totals may be incomplete.','usage-note'));
    if(view==='user'){showUser(content,result.data);more=false;
    }else if(view==='project'){showProject(content,result.data);more=false;
    }else if(view==='overview'){
      const s=result.data.summary;
      metrics(content,{'Registered users':prettyNumber(s.users),'Projects':prettyNumber(s.projects),'Generation requests':prettyNumber(s.edits),'Image downloads':prettyNumber(s.exports)});
      usageCards(content,s);usageCharts(content,s,result.data.daily);
      content.append(element('h3','Usage per user'));
      const rows=[...result.data.users].sort((a,b)=>b.edits-a.edits).slice(0,10);
      const list=element('div',undefined,'admin-user-summary');
      for(const user of rows){const item=element('button',undefined,'admin-user-row');item.type='button';item.append(element('strong',user.email),element('span',user.masking+' AI edits · '+user.harmonize+' Harmonize · '+user.wand+' Wand · '+user.auto_create+' Auto Create'),element('b',prettyMoney(user.estimated_cost_usd)));item.onclick=()=>{view='user';detailId=user.id;page=1;void load()};list.append(item)}content.append(list);
    }else if(view==='users'){
      const rows=result.data.users.slice((page-1)*50,page*50).map(user=>({_id:user.id,email:user.email,projects:user.projects,AI_mask_edits:user.masking,Harmonize:user.harmonize,Master:user.master,Wand:user.wand,Auto_Create:user.auto_create,mask_adjustments:user.mask_edits,estimated_USD:prettyMoney(user.estimated_cost_usd),cost_records:user.cost_records+'/'+user.edits}));
      table(content,rows);more=result.data.users.length>page*50;$('adminPages').hidden=false;$('adminPrevious').disabled=page===1;$('adminNext').disabled=!more;$('adminPage').textContent='Page '+page;
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
