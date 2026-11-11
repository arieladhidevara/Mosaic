/* Admin-only on-demand Object ID model comparisons. Results are browser-session-only. */
import './account.js';
const account=window.MosaicAccount;
const MODELS=['gpt-image-1.5','gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.6-sunburst'];
const results=new Map();
let original=null,prepared=null,sourceUrl=null,working=false;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(cls)n.className=cls;return n};
function money(x){return typeof x==='number'&&Number.isFinite(x)?'$'+x.toFixed(5):'Not reported'}
async function imagePayload(file){
  if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>12000000)throw Error('Use JPG, PNG or WebP under 12 MB.');
  const url=URL.createObjectURL(file),img=new Image();img.src=url;
  try{await img.decode()}finally{URL.revokeObjectURL(url)}
  const scale=Math.sqrt(1048576/(img.width*img.height));
  const w=Math.ceil(img.width*scale/16)*16,h=Math.ceil(img.height*scale/16)*16;
  if(w/h>3||h/w>3||w*h>2500000)throw Error('Unsupported aspect ratio: use 1:3 to 3:1.');
  const c=document.createElement('canvas');c.width=w;c.height=h;
  c.getContext('2d').drawImage(img,0,0,w,h);
  return c.toDataURL('image/jpeg',.90);
}
function render(host){
  host.replaceChildren();
  const heading=el('div',null,'benchmark-heading');
  heading.append(el('h2','Object ID Model Lab'),el('p','Run the same source image and instance-segmentation prompt on different OpenAI image models. Each test calls your own API key.'));
  host.append(heading);
  const controls=el('div',null,'benchmark-controls');
  const fileLabel=el('label','Source image · JPG / PNG / WebP');
  const fileInput=el('input');fileInput.type='file';fileInput.accept='image/png,image/jpeg,image/webp';fileLabel.append(fileInput);
  const qualityLabel=el('label','Quality');
  const quality=el('select');quality.id='benchmarkQuality';
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
  const note=el('p','Images and results remain in this browser session. Models may return different dimensions; compare geometry against the same source. GPT Image 1.5 is deprecated and scheduled for shutdown December 1, 2026.','usage-note');
  const outputs=el('div',null,'benchmark-results');
  const compared=el('section',null,'benchmark-compare');
  host.append(controls,progress,note,outputs,compared);
  function drawResults(){
    outputs.replaceChildren();compared.replaceChildren();
    const ok=[...results.values()].filter(r=>r.image);
    const known=ok.filter(r=>typeof r.estimatedCostUsd==='number');
    const subtotal=known.reduce((n,r)=>n+r.estimatedCostUsd,0);
    const title=el('h3','Run results · '+ok.length+' succeeded');outputs.append(title);
    outputs.append(el('p',known.length?'Known estimated image API subtotal: '+money(subtotal)+' · '+known.length+'/'+ok.length+' cost records':'API token costs appear when returned by the provider.','usage-note'));
    const grid=el('div',null,'benchmark-grid');outputs.append(grid);
    for(const name of MODELS){
      const r=results.get(name);if(!r)continue;
      const card=el('article',null,'benchmark-card'),head=el('div',null,'benchmark-card-head');
      head.append(el('strong',name));
      if(r.image){
        const select=el('label',null,'benchmark-select'),box=el('input');box.type='checkbox';box.checked=r.compare!==false;
        box.onchange=()=>{r.compare=box.checked;drawCompare()};
        select.append(box,document.createTextNode('Compare'));head.append(select);
      }
      card.append(head);
      if(r.image){
        const img=el('img');img.src='data:'+r.mimeType+';base64,'+r.image;img.alt=name+' generated Object ID instance map';card.append(img);
        card.append(el('p','Estimated API cost: '+money(r.estimatedCostUsd)));
        card.append(el('p','Time: '+(r.latencyMs/1000).toFixed(1)+'s · '+r.width+' × '+r.height));
        card.append(el('p','Input: '+(r.usage?.input_tokens??'—')+' · Output: '+(r.usage?.output_tokens??'—')+' tokens'));
        const dl=el('a','Download PNG','btn btn-outline compact');
        dl.href=img.src;dl.download='mozai-object-map-'+name+'.png';card.append(dl);
      }else{
        card.append(el('p',r.error||'No image received.','benchmark-error'));
      }
      grid.append(card);
    }
    drawCompare();
  }
  function drawCompare(){
    compared.replaceChildren();const chosen=[...results.values()].filter(r=>r.image&&r.compare!==false);
    compared.append(el('h3','Side-by-side comparison · '+chosen.length+' selected'));
    compared.append(el('p','Toggle Compare on each result card to choose which images appear here.','usage-note'));
    const grid=el('div',null,'benchmark-compare-grid');
    if(sourceUrl){
      const origin=el('div',null,'benchmark-compare-card');origin.append(el('strong','Original source'));
      const image=el('img');image.src=sourceUrl;image.alt='Original image';origin.append(image);grid.append(origin);
    }
    for(const r of chosen){
      const card=el('div',null,'benchmark-compare-card');card.append(el('strong',r.model+' · '+money(r.estimatedCostUsd)));
      const image=el('img');image.src='data:'+r.mimeType+';base64,'+r.image;image.alt=r.model+' object map';card.append(image);
      card.append(el('small',r.width+' × '+r.height+' · '+(r.latencyMs/1000).toFixed(1)+'s'));grid.append(card);
    }
    compared.append(grid);
  }
  fileInput.onchange=async()=>{
    const file=fileInput.files?.[0];if(!file)return;
    try{
      prepared=await imagePayload(file);sourceUrl=prepared;results.clear();
      progress.textContent='Image prepared for identical comparison. Choose models and run.';
      drawResults();
    }catch(e){prepared=null;progress.textContent=e.message}
  };
  run.onclick=async()=>{
    if(working)return;
    if(!prepared){progress.textContent='Upload an image before running the benchmark.';return}
    const selected=[...models.querySelectorAll('input:checked')].map(i=>i.value);
    if(!selected.length){progress.textContent='Select at least one model.';return}
    working=true;run.disabled=true;results.clear();drawResults();
    for(let i=0;i<selected.length;i++){
      const model=selected[i];progress.textContent='Running '+(i+1)+'/'+selected.length+': '+model+'…';
      try{
        const value=await account.request('/api/ai/benchmark-object-map',{method:'POST',body:{model,quality:quality.value,image:prepared}});
        results.set(model,{...value,compare:true});
      }catch(e){results.set(model,{model,error:e.message||'Request failed.'})}
      drawResults();
    }
    progress.textContent='Finished. '+[...results.values()].filter(r=>r.image).length+'/'+selected.length+' models returned an image.';
    working=false;run.disabled=false;
  };
  drawResults();
}
window.MosaicBenchmark={render};
