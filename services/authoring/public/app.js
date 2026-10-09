import {setupMetadata,fillMetadata,metadataValue} from './metadata.mjs';
const $=id=>document.getElementById(id);
let theme='light';try{theme=localStorage.getItem('workspace-theme')==='dark'?'dark':'light';}catch{}
document.documentElement.dataset.theme=theme;
setupMetadata();
const dictionaries=await fetch('/copy.json').then(r=>r.json());
let locale='zh_CN',copy=dictionaries[locale],mode=location.hostname.startsWith('vault.')?'vault':'admin';
let csrf='',documents=[],current=null,dirty=false,busy=false,uploading=0,statusKey='',contentFilter='all',pendingJob=null,statusTimer;
let editor=null,editorLoading=null,documentKey='',newDocument=0,sourceMode=false,syntaxes=[];
const t=k=>copy[k]??dictionaries.en[k]??k;
function themeLabel(){ $('theme-toggle').textContent=t(theme==='light'?'DarkMode':'LightMode'); }
function translate(){
  copy=dictionaries[locale];document.documentElement.lang=locale.replace('_','-');
  document.querySelectorAll('[data-copy]').forEach(e=>e.textContent=t(e.dataset.copy));
  document.querySelectorAll('[data-placeholder]').forEach(e=>e.placeholder=t(e.dataset.placeholder));
  $('heading').textContent=t(mode==='vault'?'Vault':'Admin');$('space-name').textContent=t(mode==='vault'?'Vault':'Admin');
  $('notice').textContent=t(mode==='vault'?'PrivateNotice':'PublicNotice');$('preview-frame').title=t('Preview');$('other-space').textContent=t(mode==='vault'?'Admin':'Vault');
  if(current)$('save-state').textContent=t(busy?'Saving':dirty||!current.id?'Unsaved':'Saved');
  if(statusKey)$('status').textContent=t(statusKey);
  themeLabel();editor?.refreshLabels();renderSyntaxes();renderList();
}
$('locale').addEventListener('change',e=>{locale=e.target.value;translate();});
$('theme-toggle').addEventListener('click',()=>{theme=theme==='light'?'dark':'light';document.documentElement.dataset.theme=theme;themeLabel();try{localStorage.setItem('workspace-theme',theme);}catch{}});
function status(key,error=false){
  clearTimeout(statusTimer);if(!error&&!['Queued','Building','Uploading'].includes(key))statusTimer=setTimeout(()=>{statusKey='';$('status').textContent='';},5000);
  statusKey=key;$('status').textContent=t(key);$('status').classList.toggle('error',error);
}
const errorKeys={conflict:'Conflict',unsafeMarkdown:'UnsafeMarkdown',busy:'Busy',signIn:'SignIn',invalid:'Invalid',forbidden:'Error',rateLimit:'Busy',quota:'Quota'};
function clearPrivate(){
  current=null;documentKey='';documents=[];dirty=false;editor?.destroy();editor=null;
  $('list').replaceChildren();$('form').reset();$('preview-frame').srcdoc='';$('preview-dialog').close();
}
async function api(url,method='GET',body,background=false){
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'X-Background':background?'1':'0'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();if(!r.ok){
    if(r.status===401){$('login').hidden=false;$('logout').hidden=true;$('workspace').hidden=true;clearPrivate();}
    $('save-state').textContent=dirty?t('Unsaved'):'';throw new Error(errorKeys[data.error]??'Error');
  }return data;
}
function run(fn){return async e=>{e?.preventDefault();try{await fn(e);}catch(error){status(error.message in copy?error.message:'Error',true);}};}
function changed(){dirty=true;$('save-state').textContent=t('Unsaved');}
function payload(){return{kind:$('kind').value,title:$('title').value,date:$('date').value,description:$('description').value,category:$('category').value,tags:$('tags').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean),body:$('body').value,metadata:metadataValue($('kind').value)};}
function allowSwitch(){if(busy||uploading){status('Busy');return false;}return !dirty||confirm(t('Discard'));}
function setInspector(open){$('inspector').hidden=!open;$('properties').setAttribute('aria-expanded',String(open));$('editor').classList.toggle('has-inspector',open);}
$('properties').addEventListener('click',()=>setInspector($('inspector').hidden));
$('close-properties').addEventListener('click',()=>{setInspector(false);$('properties').focus();});
$('change-cover').addEventListener('click',()=>{setInspector(true);$('meta-image').closest('details').open=true;$('meta-image').focus();});
async function ensureEditor(){
  if(editor||!current)return;
  editorLoading??=import('./editor.bundle.mjs');
  try{
    const {createEditor}=await editorLoading;if(!current||editor)return;
    editor=createEditor({parent:$('live-editor'),value:$('body').value,onChange:value=>{$('body').value=value;changed();},resolveImage:previewSource,t,
      onUpload:mode==='admin'?files=>run(()=>uploadIntoBody(files))():null,nonce:document.querySelector('meta[name=editor-nonce]').content});
    editor.setDocument($('body').value,!!current.protectedBody||!!current.deleted,documentKey);editor.setSource(sourceMode);
    $('source-fallback').hidden=true;
  }catch{editorLoading=null;$('source-fallback').hidden=false;status('EditorFallback',true);}
}
function fill(d){
  const previous=current?.id;current=d;documentKey=d.id??`new-${++newDocument}`;
  fillMetadata(d.metadata??{},d.kind);dirty=false;
  for(const k of ['title','date','body','description','category'])$(k).value=d[k]??'';
  $('tags').value=(d.tags??[]).join(', ');$('kind').value=d.kind;$('kind').disabled=!!d.source;
  $('body').readOnly=!!d.protectedBody||!!d.deleted;$('protected-notice').hidden=!d.protectedBody;
  $('source-path').hidden=!d.source;$('source-path').textContent=d.source?`src/content/${d.source}`:'';
  $('preview').disabled=!!d.protectedBody;$('library').hidden=true;$('editor').hidden=false;
  $('preview-frame').hidden=true;$('preview-frame').srcdoc='';$('preview-dialog').close();$('writing-tools').hidden=!!d.protectedBody;
  $('media-panel').hidden=mode==='vault';$('insert-image').hidden=mode==='vault';$('syntax-tools').hidden=true;$('syntax-toggle').setAttribute('aria-expanded','false');
  $('editor-help').textContent=t(mode==='vault'?'MarkdownHelp':'LiveHelp');
  $('save-state').textContent=t(d.id?'Saved':'Unsaved');$('restore').hidden=!d.deleted;$('trash').hidden=!d.id||d.deleted||d.publishedRevision>0;
  $('publish').hidden=mode==='vault'||d.deleted;$('withdraw').hidden=mode==='vault'||!d.publishedRevision;$('save').disabled=!!d.deleted;
  if(editor){editor.setDocument(d.body??'',!!d.protectedBody||!!d.deleted,documentKey);$('source-fallback').hidden=true;}else{$('source-fallback').hidden=false;void ensureEditor();}
  refreshCover();if(previous!==d.id||!d.id){setInspector(false);window.scrollTo({top:0,behavior:'instant'});}
}
function renderList(){
  const fragment=document.createDocumentFragment(),term=$('search').value.toLowerCase(),trash=$('filter').value==='trash';
  const shown=documents.filter(d=>d.deleted===trash&&(`${d.title} ${d.tags.join(' ')}`).toLowerCase().includes(term)&&(contentFilter==='all'||contentFilter===d.kind||contentFilter==='draft'&&d.revision!==d.publishedRevision||contentFilter==='published'&&d.publishedRevision>0));
  for(const d of shown){
    const b=document.createElement('button');b.className='entry';const title=document.createElement('strong');title.textContent=d.title;
    const detail=document.createElement('small'),date=document.createElement('span'),kind=document.createElement('span'),badge=document.createElement('span');
    date.textContent=d.date;kind.textContent=t(d.kind==='diary'?'Diary':d.kind==='posts'?'Posts':'Moments');badge.className='badge';badge.textContent=t(mode==='vault'?'Saved':d.publishedRevision===d.revision?'Published':d.publishedRevision?'Revised':'Draft');
    detail.append(date,kind,badge);b.append(title,detail);b.addEventListener('click',run(async()=>{if(allowSwitch())fill(await api(`/api/documents/${d.id}`));}));fragment.append(b);
  }
  $('list').replaceChildren(fragment);$('empty').hidden=shown.length>0;$('result-count').textContent=String(shown.length);
}
async function loadList(background=false){
  const next=await api('/api/documents','GET',undefined,background),different=JSON.stringify(next)!==JSON.stringify(documents);documents=next;
  if(current?.id&&!dirty&&!busy){const latest=documents.find(d=>d.id===current.id);if(latest&&latest.revision===current.revision){current.publishedRevision=latest.publishedRevision;$('withdraw').hidden=mode==='vault'||!latest.publishedRevision;$('trash').hidden=current.deleted||latest.publishedRevision>0;}}
  if(different)renderList();
}
async function save(){
  if(!$('form').checkValidity()){setInspector(true);$('form').reportValidity();throw new Error('Invalid');}if(busy||uploading)throw new Error('Busy');
  busy=true;const fields=[...$('form').querySelectorAll('input,textarea,select,button')];fields.forEach(e=>e.disabled=true);editor?.setReadOnly(true);$('save-state').textContent=t('Saving');
  try{const data=payload();const result=current?.id?await api(`/api/documents/${current.id}`,'PUT',{revision:current.revision,document:data}):await api('/api/documents','POST',data);fill(result);await loadList();status('Saved');}
  finally{busy=false;fields.forEach(e=>e.disabled=false);editor?.setReadOnly(!!current?.protectedBody||!!current?.deleted);$('save').disabled=!!current?.deleted;$('kind').disabled=!!current?.source;$('preview').disabled=!!current?.protectedBody;}
}
$('form').addEventListener('submit',run(save));$('form').addEventListener('input',e=>{if(e.target.type!=='file'&&!e.target.closest('.cm-editor'))changed();});
$('new').addEventListener('click',()=>{if(allowSwitch()){const date=new Date();fill({kind:mode==='vault'?'diary':'posts',title:'',date:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,body:'',tags:[]});$('title').focus();}});
$('search').addEventListener('input',renderList);$('filter').addEventListener('change',renderList);
$('filters').addEventListener('click',e=>{const button=e.target.closest('[data-filter]');if(!button)return;contentFilter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderList();});
$('back').addEventListener('click',()=>{if(!allowSwitch())return;dirty=false;current=null;documentKey='';editor?.destroy();editor=null;$('source-fallback').hidden=false;$('editor').hidden=true;$('library').hidden=false;$('form').reset();$('preview-frame').srcdoc='';statusKey='';$('status').textContent='';window.scrollTo({top:0,behavior:'instant'});});
$('writing-tools').addEventListener('click',e=>{
  const button=e.target.closest('[data-insert]'),area=$('body');if(!button||busy||area.readOnly)return;
  const wrappers={heading:['## ',''],bold:['**','**'],list:['- ',''],quote:['> ',''],link:['[','](https://)'],code:['```\n','\n```']},[before,after]=wrappers[button.dataset.insert];
  if(editor){editor.wrap(before,after,t('Body'));return;}
  const start=area.selectionStart,end=area.selectionEnd,text=area.value.slice(start,end)||t('Body');area.setRangeText(before+text+after,start,end,'select');area.focus();changed();
});
$('source-toggle').addEventListener('click',()=>{sourceMode=!sourceMode;editor?.setSource(sourceMode);$('source-toggle').setAttribute('aria-pressed',String(sourceMode));});
$('undo').addEventListener('click',()=>editor?.undo());$('redo').addEventListener('click',()=>editor?.redo());
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&!$('editor').hidden){e.preventDefault();run(save)();}});
function previewSource(src){
  if(!src||/[\u0000-\u001f\\]/.test(src)||src.startsWith('//'))return '';
  if(src.startsWith('/blog-media/'))return '/api/media/'+src.slice('/blog-media/'.length);
  if(/^https:\/\//i.test(src))return src;
  if(/^[a-z][a-z0-9+.-]*:/i.test(src))return '';
  if(current?.id)return `/api/source-asset/${current.id}?src=${encodeURIComponent(src)}`;return '';
}
function refreshCover(){const img=$('cover-preview'),src=previewSource($('meta-image').value),visible=!!src&&$('kind').value==='posts';img.hidden=!visible;$('cover-area').hidden=!visible;if(src&&img.getAttribute('src')!==src)img.src=src;else if(!src)img.removeAttribute('src');}
$('meta-image').addEventListener('input',refreshCover);
$('kind').addEventListener('change',()=>{fillMetadata(metadataValue(current?.kind??$('kind').value),$('kind').value);refreshCover();if($('media-panel').open)run(loadMedia)();});
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
$('close-preview').addEventListener('click',()=>$('preview-dialog').close());
$('preview-dialog').addEventListener('close',()=>{$('preview-frame').srcdoc='';$('preview-frame').hidden=true;});
$('preview').addEventListener('click',run(async()=>{
  const data=payload(),key=documentKey;if(!data.title)data.title=t('Title');$('preview').disabled=true;$('preview').setAttribute('aria-busy','true');
  try{
    const [{html},{previewStyle}]=await Promise.all([api('/api/theme-preview','POST',{...(current?.id?{id:current.id}:{}),document:data}),import('./preview-style.mjs')]);
    if(!current||documentKey!==key)return;
    const content=new DOMParser().parseFromString(html,'text/html');for(const img of content.querySelectorAll('img[src]')){const src=previewSource(img.getAttribute('src'));if(src)img.src=src;else img.removeAttribute('src');}
    const cover=previewSource(data.metadata.image),pictures=(data.metadata.images??[]).map(i=>`<figure><img src="${escapeHtml(previewSource(i.src))}" alt="${escapeHtml(i.alt)}" referrerpolicy="no-referrer"><figcaption>${escapeHtml(i.alt)}</figcaption></figure>`).join('');
    $('preview-frame').srcdoc=`<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; font-src 'self'; form-action 'none'; base-uri 'none'"><style>${previewStyle}</style></head><body><article class="custom-md"><h1>${escapeHtml(data.title)}</h1><p class="preview-meta">${escapeHtml(data.date)} · ${escapeHtml(data.category)} · ${escapeHtml(data.tags.join(' / '))}</p>${cover?`<img class="preview-cover" src="${escapeHtml(cover)}" alt="" referrerpolicy="no-referrer">`:''}${content.body.innerHTML}${pictures}</article></body></html>`;
    $('preview-frame').hidden=false;$('preview-dialog').showModal();
  }finally{$('preview').disabled=!!current?.protectedBody;$('preview').removeAttribute('aria-busy');}
}));
const syntaxLabels={admonition:'TipBlock','collapse-panels':'CollapseBlock','option-groups':'TabsBlock',steps:'StepsBlock',math:'MathBlock',mermaid:'DiagramBlock','image-grid':'ImageGrid','file-tree':'FileTree'};
function renderSyntaxes(){const selected=$('syntax').value||'admonition';$('syntax').replaceChildren();for(const item of syntaxes){const o=document.createElement('option');o.value=item.id;o.textContent=syntaxLabels[item.id]?t(syntaxLabels[item.id]):item.name;$('syntax').append(o);}$('syntax').value=selected;}
$('syntax-toggle').addEventListener('click',run(async()=>{const open=$('syntax-tools').hidden;$('syntax-tools').hidden=!open;$('syntax-toggle').setAttribute('aria-expanded',String(open));if(open&&!syntaxes.length){syntaxes=await fetch('/syntaxes.json').then(r=>r.json());renderSyntaxes();}}));
function insertBody(text,anchor){if($('body').readOnly)return;if(editor){editor.insert(text,anchor);return;}const area=$('body');area.setRangeText(text,area.selectionStart,area.selectionEnd,'end');area.focus();changed();}
$('insert-syntax').addEventListener('click',()=>{const item=syntaxes.find(i=>i.id===$('syntax').value);if(item)insertBody('\n\n'+item.example.replace(/\\n/g,'\n')+'\n\n');});
async function uploadImage(file){
  if(!['image/png','image/jpeg','image/webp','image/avif','image/gif'].includes(file.type))throw new Error('Invalid');if(file.size>10*1024*1024)throw new Error('Quota');
  const r=await fetch('/api/media',{method:'POST',headers:{'Content-Type':file.type,'X-CSRF-Token':csrf},body:file});
  if(r.status===401){$('workspace').hidden=true;$('login').hidden=false;clearPrivate();throw new Error('SignIn');}
  if(!r.ok)throw new Error('Error');return r.json();
}
async function uploadIntoBody(files){
  if(mode!=='admin'||busy||current?.protectedBody||current?.deleted)throw new Error('Busy');
  const key=documentKey,anchor=editor?.anchor();uploading++;status('Uploading');
  try{for(const file of files){const item=await uploadImage(file);if(key!==documentKey||!current)return;const alt=file.name.replace(/\.[^.]+$/,'').replace(/[\[\]\\\r\n]/g,' ').slice(0,150);insertBody(`\n\n![${alt}](${item.url})\n\n`,anchor);}status('ImagesInserted');}
  finally{uploading--;if(anchor)editor?.release(anchor);}
}
$('insert-image').addEventListener('click',()=>$('editor-upload').click());
$('editor-upload').addEventListener('change',run(async()=>{try{await uploadIntoBody([...$('editor-upload').files]);}finally{$('editor-upload').value='';}}));
async function loadMedia(){
  const items=await api('/api/media'),fragment=document.createDocumentFragment();for(const item of items){
    const card=document.createElement('div');card.className='media-card';const img=document.createElement('img');img.src=item.preview;img.alt='';img.loading='lazy';card.append(img);
    for(const [key,action] of [['InsertImage',()=>insertBody(`\n\n![${t('Image')}](${item.url})\n\n`)],['UseCover',()=>{$('meta-image').value=item.url;refreshCover();}],['UseGallery',()=>{$('meta-images').value+=($('meta-images').value?'\n':'')+item.url+' | ';}]]){
      if(key==='UseCover'&&$('kind').value!=='posts'||key==='UseGallery'&&$('kind').value!=='moments')continue;
      const b=document.createElement('button');b.type='button';b.textContent=t(key);b.addEventListener('click',()=>{action();changed();});card.append(b);
    }fragment.append(card);
  }$('media-list').replaceChildren(fragment);
}
$('media-panel').addEventListener('toggle',()=>{if($('media-panel').open&&current)run(loadMedia)();});
$('upload').addEventListener('change',run(async()=>{const file=$('upload').files[0];if(!file)return;uploading++;status('Uploading');try{await uploadImage(file);$('upload').value='';await loadMedia();status('Uploaded');}finally{uploading--;}}));
async function publish(withdraw){if(uploading)throw new Error('Busy');if(dirty||!current?.id)await save();if(!current?.id||!confirm(`${t(withdraw?'WithdrawConfirm':'PublishConfirm')}\n\n${current.title}`))return;const job=await api('/api/publish','POST',{id:current.id,revision:current.revision,withdraw});if(job.unchanged){status('Published');return;}pendingJob=job.id;status('Queued');await loadJobs();}
$('publish').addEventListener('click',run(()=>publish(false)));$('withdraw').addEventListener('click',run(()=>publish(true)));
for(const [id,deleted] of [['trash',true],['restore',false]])$(id).addEventListener('click',run(async()=>{if(uploading||busy)throw new Error('Busy');if(!current?.id||!confirm(t(deleted?'DeleteConfirm':'RestoreConfirm')))return;fill(await api(`/api/documents/${current.id}/trash`,'POST',{revision:current.revision,deleted}));await loadList();}));
async function logout(all){if(!allowSwitch())return;await api(all?'/api/logout-all':'/api/logout','POST',{});clearPrivate();location.replace('/?signedOut=1');}
$('logout').addEventListener('click',run(()=>logout(false)));$('logout-all').addEventListener('click',run(()=>logout(true)));
async function loadJobs(background=false){
  if(mode==='vault')return;const jobs=await api('/api/jobs','GET',undefined,background),watched=jobs.find(j=>j.id===pendingJob);
  if(watched){status({queued:'Queued',building:'Building',succeeded:'Succeeded',failed:'Failed'}[watched.state],watched.state==='failed');if(['succeeded','failed'].includes(watched.state))pendingJob=null;}
  const f=document.createDocumentFragment();for(const j of jobs){const e=document.createElement('li');e.textContent=`${new Date(j.created).toLocaleString()} · ${t({queued:'Queued',building:'Building',succeeded:'Succeeded',failed:'Failed'}[j.state])}`;f.append(e);}$('jobs').replaceChildren(f);await loadList(background);
}
window.addEventListener('beforeunload',e=>{if(dirty||uploading){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',clearPrivate);
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
translate();
try{
  const session=await api('/api/session');csrf=session.csrf;mode=session.mode;translate();$('workspace').hidden=false;$('logout').hidden=false;$('login').hidden=true;
  if(mode==='vault'){for(const id of ['kind-label','category-label','description-label','jobs-section','filters'])$(id).hidden=true;$('other-space').href=document.body.dataset.adminUrl;$('other-space').textContent=t('Admin');await loadList();}
  else{$('kind').querySelector('[value=diary]').remove();await loadJobs();}
  setInterval(()=>{if(document.visibilityState==='visible'&&!busy&&!uploading)loadJobs(true).catch(()=>{});},15000);
}catch(e){$('login').hidden=false;if(e.message!=='SignIn')status(e.message,true);}
