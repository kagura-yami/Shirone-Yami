export const fields=[
  ['image','Cover','text','posts','main'],['series','Series','text','posts','main'],['seriesOrder','SeriesOrder','number','posts','main'],
  ['pinned','Pinned','checkbox','both','display'],['comment','Comments','checkbox','posts','display'],['lang','Language','text','posts','display'],
  ['encrypted','Encrypted','checkbox','posts','display'],['password','Password','password','posts','display'],['passwordHint','PasswordHint','text','posts','display'],['hideHomeContent','HideHome','checkbox','posts','display'],
  ['publishedAt','PublishedAt','text','posts','links'],['updated','Updated','date','posts','links'],['updatedAt','UpdatedAt','text','posts','links'],['alias','Alias','text','posts','links'],['permalink','Permalink','text','posts','links'],
  ['location','Location','text','moments','main'],['mood','Mood','text','moments','main'],['images','Images','textarea','moments','main'],
];
export function setupMetadata(){
  for(const [name,key,type,kind,group] of fields){
    const label=document.createElement('label');label.dataset.kind=kind;label.dataset.field=name;
    const span=document.createElement('span');span.dataset.copy=key;
    const input=document.createElement(type==='textarea'?'textarea':'input');input.id=`meta-${name}`;input.name=name;
    if(type!=='textarea')input.type=type;else input.rows=4;
    if(type==='checkbox')label.className='check-field';else if(type!=='number'&&type!=='date')input.maxLength=type==='textarea'?15000:2000;
    if(name==='password')input.autocomplete='new-password';
    label.append(span,input);document.getElementById(`metadata-${group}`).append(label);
  }
}
export function fillMetadata(data,kind){
  for(const [name,,type,scope] of fields){
    const input=document.getElementById(`meta-${name}`);input.closest('label').hidden=kind==='diary'||scope!=='both'&&scope!==kind;
    if(type==='checkbox')input.checked=data[name]??['comment','hideHomeContent'].includes(name);
    else input.value=name==='images'?(data.images??[]).map(i=>`${i.src} | ${i.alt}`).join('\n'):data[name]??'';
  }
  for(const group of ['main','display','links'])document.getElementById(`metadata-${group}`).closest('[data-metadata-group]').hidden=kind==='diary'||kind==='moments'&&group==='links';
}
export function metadataValue(kind){
  const values={};for(const [name,,type,scope] of fields){
    if(kind==='diary'||scope!=='both'&&scope!==kind)continue;
    const input=document.getElementById(`meta-${name}`);
    values[name]=type==='checkbox'?input.checked:type==='number'?(input.value===''?null:Number(input.value)):name==='images'?input.value.split('\n').map(x=>x.trim()).filter(Boolean).map(x=>{const [src,...alt]=x.split('|');return {src:src.trim(),alt:alt.join('|').trim()};}):input.value;
  }return values;
}
