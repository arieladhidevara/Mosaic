/* Admin Object ID Model Lab. Full images stay in this page; only provider usage metadata is archived. */
import './account.js';
const account=window.MosaicAccount;
const MODELS=['gpt-image-1.5','gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.6-sunburst'];
const results=new Map();
let prepared=null,sourceUrl=null,sourceSize=null,working=false;
let compareA='original',compareB=null,split=50,historyRows=[],historyError='';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(cls)n.className=cls;return n};
const money=x=>typeof x==='number'&&Number.isFinite(x)?'$'+x.toFixed(5):'—';
const num=x=>Number.isSafeInteger(x)?x.toLocaleString('en-US'):'—';
async function imagePayload(file){
  if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>12000000)throw Error('Use JPG, PNG or WebP under 12 MB.');
  const url=URL.createObjectURL(file),img=new Image();img.src=url;
  try{await img.decode()}finally{URL.revokeObjectURL(url)}
  const scale=Math.sqrt(1048576/(img.width*img.height));
  const w=Math.ceil(img.width*scale/16)*16,h=Math.ceil(img.height*scale/16)*16;
  if(w/h>3||h/w>3||w*h>2500000)throw Error('Unsupported aspect ratio: use 1:3 to 3:1.');
  const c=document.createElement('canvas');c.width=w;c.height=h;
  c.getContext('2d').drawImage(img,0,0,w,h);
  return {url:c.toDataURL('image/jpeg',.90),width:w,height:h};
}
function render(host){
  host.replaceChildren();
  const heading=el('div',null,'benchmark-heading');
  heading.append(el('h2','Object ID Model Lab'),el('p','Run the same image and instance-segmentation prompt with your own OpenAI API key. Tokens are reported by the provider; USD costs are calculated estimates.'));
  host.append(heading);
  const controls=el('div',null,'benchmark-controls');
  const fileLabel=el('label','Source image · JPG / PNG / WebP');
  const fileInput=el('input');fileInput.type='file';fileInput.accept='image/png,image/jpeg,image/webp';fileLabel.append(fileInput);
  const qualityLabel=el('label','Quality'),quality=el('select');quality.id='benchmarkQuality';
  for(const v of ['low','medium','high']){const o=new Option(v[0].toUpperCase()+v.slice(1),v);quality.append(o)}
  quality.value='high';qualityLabel.append(quality);
  const models=el('fieldset',null,'benchmark-models');models.append(el('legend','Choose models to test'));
  for(const name of MODELS){
    const label=el('label',null,'benchmark-model-option'),check=el('input');
    check.type='checkbox';check.value=name;check.checked=true;label.append(check,document.createTextNode(name));models.append(label);
  }
  const run=el('button','Run selected models','btn btn-primary');run.type='button';
  controls.append(fileLabel,qualityLabel,models,run);
  const progress=el('p','Upload an image to start.','usage-note');
  const note=el('p','Raw provider usage is recorded per model run. Image outputs stay in this browser page, not in benchmark history. Different models may return different pixel dimensions; the comparison slider normalizes both to one frame. GPT Image 1.5 is scheduled for shutdown December 1, 2026.','usage-note');
  const outputs=el('div',null,'benchmark-results'),compared=el('section',null,'benchmark-compare'),history=el('section',null,'benchmark-history');
  host.append(controls,progress,note,outputs,compared,history);
  function choices(){
    const all=[];if(sourceUrl)all.push({id:'original',label:'Original source',url:sourceUrl,width:sourceSize?.width,height:sourceSize?.height});
    for(const name of MODELS){
      const r=results.get(name);
      if(r?.image)all.push({id:name,label:name,url:'data:'+r.mimeType+';base64,'+r.image,width:r.width,height:r.height});
    }
    return all;
  }
  function drawResults(){
    outputs.replaceChildren();
    const ok=[...results.values()].filter(r=>r.image);
    const known=ok.filter(r=>typeof r.estimatedCostUsd==='number');
    const subtotal=known.reduce((n,r)=>n+r.estimatedCostUsd,0);
    outputs.append(el('h3','Run results · '+ok.length+' succeeded'));
    outputs.append(el('p',known.length?'Calculated API subtotal: '+money(subtotal)+' · '+known.length+'/'+ok.length+' cost records':'API cost appears when the provider returns sufficient usage details.','usage-note'));
    const grid=el('div',null,'benchmark-grid');outputs.append(grid);
    for(const name of MODELS){
      const r=results.get(name);if(!r)continue;
      const card=el('article',null,'benchmark-card'),head=el('div',null,'benchmark-card-head');head.append(el('strong',name));
      if(r.image){
        const select=el('label',null,'benchmark-select'),box=el('input');box.type='checkbox';box.checked=r.compare!==false;
        box.onchange=()=>{r.compare=box.checked;drawCompare()};select.append(box,document.createTextNode('Show side-by-side'));head.append(select);
      }
      card.append(head);
      if(r.image){
        const img=el('img');img.src='data:'+r.mimeType+';base64,'+r.image;img.alt=name+' instance map';card.append(img);
        const u=r.usage||{};
        card.append(el('p','Calculated API cost: '+money(r.estimatedCostUsd)));
        card.append(el('p','Time: '+(r.latencyMs/1000).toFixed(1)+'s · '+r.width+' × '+r.height));
        card.append(el('p','Provider tokens · Image input: '+num(u.image_input_tokens)+' · Text input: '+num(u.text_input_tokens)));
        card.append(el('p','Total input: '+num(u.input_tokens)+' · Image output: '+num(u.output_tokens)+' · Total: '+num(u.total_tokens)));
        card.append(el('p','Costs · Image in: '+money(u.image_input_cost_usd)+' · Text in: '+money(u.text_input_cost_usd)+' · Image out: '+money(u.image_output_cost_usd)));
        if(!r.usageRecorded)card.append(el('p','Metadata was not archived. You can still compare or download this result.','benchmark-error'));
        const dl=el('a','Download PNG','btn btn-outline compact');dl.href=img.src;dl.download='mozai-object-map-'+name+'.png';card.append(dl);
      }else card.append(el('p',r.error||'No image received.','benchmark-error'));
      grid.append(card);
    }
    drawCompare();
  }
  function drawCompare(){
    compared.replaceChildren();
    const all=choices();
    compared.append(el('h3','Compare two images · Swipe slider'));
    if(all.length<2){compared.append(el('p','Run at least one model to compare it against the original image.','usage-note'));return}
    if(!all.some(c=>c.id===compareA))compareA='original';
    if(!all.some(c=>c.id===compareB)||compareB===compareA)compareB=all.find(c=>c.id!==compareA)?.id;
    const tools=el('div',null,'benchmark-compare-controls');
    const makeSelect=(title,value,change)=>{
      const label=el('label',title),select=el('select');select.setAttribute('aria-label',title);
      for(const c of all){const option=new Option(c.label,c.id);select.append(option)}
      select.value=value;select.onchange=()=>{change(select.value);drawCompare()};label.append(select);return label;
    };
    tools.append(makeSelect('Image A · left',compareA,v=>{compareA=v;if(compareA===compareB)compareB=all.find(c=>c.id!==v)?.id}));
    tools.append(makeSelect('Image B · right',compareB,v=>{compareB=v;if(compareA===compareB)compareA=all.find(c=>c.id!==v)?.id}));
    const reset=el('button','Center divider','btn btn-outline compact');reset.type='button';reset.onclick=()=>{split=50;drawCompare()};tools.append(reset);compared.append(tools);
    const first=all.find(c=>c.id===compareA),second=all.find(c=>c.id===compareB);
    const viewport=el('div',null,'benchmark-slider-viewport');viewport.style.aspectRatio=String(first.width||16)+' / '+String(first.height||10);
    viewport.style.setProperty('--split',split+'%');
    const left=el('img');left.src=first.url;left.alt=first.label;
    const right=el('img',null,'benchmark-slider-top');right.src=second.url;right.alt=second.label;
    const line=el('div',null,'benchmark-slider-divider');line.setAttribute('aria-hidden','true');
    const range=el('input',null,'benchmark-slider-range');range.type='range';range.min='0';range.max='100';range.step='1';range.value=String(split);
    range.setAttribute('aria-label','Drag to compare '+first.label+' with '+second.label);
    range.oninput=()=>{split=Number(range.value);viewport.style.setProperty('--split',split+'%');position.textContent=split+'%'};
    viewport.append(left,right,line,range);compared.append(viewport);
    const labels=el('div',null,'benchmark-slider-labels'),position=el('span',split+'%');
    labels.append(el('span','A · '+first.label),position,el('span','B · '+second.label));compared.append(labels);
    compared.append(el('p','Drag across the image or use the keyboard arrow keys on the slider. Images with differing resolutions are normalized for visual comparison, not pixel-perfect difference measurement.','usage-note'));
    const chosen=results.size?[...results.values()].filter(r=>r.image&&r.compare!==false):[];
    if(chosen.length){
      const title=el('h4','Side-by-side overview'),grid=el('div',null,'benchmark-compare-grid');compared.append(title,grid);
      for(const r of chosen){
        const card=el('div',null,'benchmark-compare-card');card.append(el('strong',r.model+' · '+money(r.estimatedCostUsd)));
        const image=el('img');image.src='data:'+r.mimeType+';base64,'+r.image;image.alt=r.model+' object map';card.append(image);
        card.append(el('small',r.width+' × '+r.height+' · '+(r.latencyMs/1000).toFixed(1)+'s'));grid.append(card);
      }
    }
  }
  function drawHistory(){
    history.replaceChildren(el('h3','Benchmark history · last 100 runs'));
    history.append(el('p','Saved server-side: model, timestamp, quality, provider token usage and calculated cost. Original and generated images are not saved.','usage-note'));
    if(historyError)history.append(el('p',historyError,'benchmark-error'));
    if(!historyRows.length){history.append(el('p','No archived benchmark records yet.','usage-note'));return}
    const wrap=el('div',null,'benchmark-history-wrap'),table=el('table'),thead=el('thead'),tr=el('tr');
    for(const heading of ['Time','Model','Quality','Image in','Text in','Output','Total','Image in $','Text in $','Output $','Total $','Time (s)'])tr.append(el('th',heading));
    thead.append(tr);table.append(thead);
    const tbody=el('tbody');
    for(const r of historyRows){
      const row=el('tr'),cells=[new Date(r.created_at).toLocaleString(),r.model,r.quality,num(r.image_input_tokens),num(r.text_input_tokens),
        num(r.output_tokens),num(r.total_tokens),money(r.image_input_cost_usd),money(r.text_input_cost_usd),
        money(r.image_output_cost_usd),money(r.estimated_cost_usd),(r.duration_ms/1000).toFixed(1)];
      for(const value of cells)row.append(el('td',value));tbody.append(row);
    }
    table.append(tbody);wrap.append(table);history.append(wrap);
  }
  async function refreshHistory(){
    try{const response=await account.request('/api/ai/benchmark-object-map');historyRows=Array.isArray(response.rows)?response.rows:[];historyError=''}
    catch(error){historyError='Could not load saved benchmark history: '+error.message}
    if(host.isConnected)drawHistory();
  }
  fileInput.onchange=async()=>{
    const file=fileInput.files?.[0];if(!file)return;
    try{
      const source=await imagePayload(file);prepared=source.url;sourceUrl=source.url;sourceSize=source;
      results.clear();compareA='original';compareB=null;split=50;
      progress.textContent='Image prepared for identical comparison. Choose models and run.';drawResults();
    }catch(e){prepared=null;progress.textContent=e.message}
  };
  run.onclick=async()=>{
    if(working)return;
    if(!prepared){progress.textContent='Upload an image before running the benchmark.';return}
    const selected=[...models.querySelectorAll('input:checked')].map(i=>i.value);
    if(!selected.length){progress.textContent='Select at least one model.';return}
    working=true;run.disabled=true;results.clear();compareB=null;drawResults();
    const runId=crypto.randomUUID();
    for(let i=0;i<selected.length;i++){
      const model=selected[i];progress.textContent='Running '+(i+1)+'/'+selected.length+': '+model+'…';
      try{
        const value=await account.request('/api/ai/benchmark-object-map',{method:'POST',body:{model,quality:quality.value,image:prepared,runId}});
        results.set(model,{...value,compare:true});
      }catch(e){results.set(model,{model,error:e.message||'Request failed.'})}
      drawResults();
    }
    progress.textContent='Finished. '+[...results.values()].filter(r=>r.image).length+'/'+selected.length+' models returned an image.';
    working=false;run.disabled=false;void refreshHistory();
  };
  drawResults();drawHistory();void refreshHistory();
}
window.MosaicBenchmark={render};
