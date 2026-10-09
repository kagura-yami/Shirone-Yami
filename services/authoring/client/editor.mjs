import {EditorState,StateField,Compartment,StateEffect} from '@codemirror/state';
import {EditorView,Decoration,WidgetType,keymap,lineNumbers} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,undo,redo} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {syntaxTree,syntaxHighlighting,HighlightStyle} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {imageNodes} from './image-nodes.mjs';

export function createEditor({parent,value='',onChange,resolveImage,t,onUpload,nonce=''}){
  let source=false,readOnly=false,key=null,silent=false;
  const mode=new Compartment(),access=new Compartment(),labels=new Compartment(),refresh=StateEffect.define(),anchors=new Set();
  const highlight=syntaxHighlighting(HighlightStyle.define([
    {tag:tags.strong,fontWeight:'700'},{tag:tags.emphasis,fontStyle:'italic'},
    {tag:tags.heading,color:'var(--on-surface)',fontWeight:'700'},
    {tag:tags.link,color:'var(--primary)'},{tag:tags.monospace,fontFamily:'var(--font-code)'},
    {tag:tags.processingInstruction,color:'var(--on-surface-variant)'}
  ]));
  class Picture extends WidgetType{
    constructor(item,block){super();this.item=item;this.block=block;this.src=resolveImage(item.src);this.label=t('EditImage');}
    eq(other){return this.src===other.src&&this.item.alt===other.item.alt&&this.item.to-this.item.from===other.item.to-other.item.from&&this.label===other.label&&this.block===other.block;}
    toDOM(view){
      const wrap=document.createElement(this.block?'figure':'span');wrap.className='inline-picture';wrap.contentEditable='false';
      const image=document.createElement('img');image.alt=this.item.alt;image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';if(this.src)image.src=this.src;
      const caption=document.createElement('figcaption');caption.textContent=this.item.alt;
      const edit=document.createElement('button');edit.type='button';edit.className='image-edit';edit.textContent=this.label;edit.disabled=readOnly;
      edit.addEventListener('click',()=>{const from=view.posAtDOM(wrap),line=view.state.doc.lineAt(from);view.dispatch({selection:{anchor:this.block?line.from:from,head:this.block?line.to:Math.min(view.state.doc.length,from+this.item.to-this.item.from)},scrollIntoView:true});view.focus();});
      const failure=document.createElement('span');failure.className='image-failure';failure.textContent=t('ImageUnavailable');failure.hidden=true;
      image.addEventListener('load',()=>view.requestMeasure());image.addEventListener('error',()=>{image.hidden=true;failure.hidden=false;view.requestMeasure();});
      wrap.append(image,failure,caption,edit);return wrap;
    }
    get estimatedHeight(){return this.block?300:180;}
    ignoreEvent(){return true;}
  }
  function decorations(state){
    if(source)return Decoration.none;
    const ranges=[],tree=syntaxTree(state),selection=state.selection;
    for(const item of imageNodes(tree,state.doc)){
      const line=state.doc.lineAt(item.from),block=state.doc.sliceString(line.from,line.to).trim()===state.doc.sliceString(item.from,item.to);
      const active=selection.ranges.some(r=>r.from<=item.to&&r.to>=item.from);
      const picture=new Picture(item,block);if(!picture.src)continue;
      if(!active)ranges.push(Decoration.replace({widget:picture,block}).range(block?line.from:item.from,block?line.to:item.to));
      else ranges.push(Decoration.widget({widget:picture,block,side:1}).range(block?line.to:item.to));
    }
    tree.iterate({enter(n){if(/^ATXHeading[1-6]$/.test(n.name))ranges.push(Decoration.line({class:'live-heading live-h'+n.name.slice(-1)}).range(state.doc.lineAt(n.from).from));}});
    return Decoration.set(ranges,true);
  }
  const pictures=StateField.define({
    create:decorations,
    update(value,tr){return tr.docChanged||tr.selection||tr.effects.some(e=>e.is(refresh))||syntaxTree(tr.startState)!==syntaxTree(tr.state)?decorations(tr.state):value;},
    provide:f=>EditorView.decorations.from(f)
  });
  function extensions(){return[
    markdown(),history(),keymap.of([...defaultKeymap,...historyKeymap]),EditorView.lineWrapping,highlight,
    EditorView.cspNonce.of(nonce),labels.of(EditorView.contentAttributes.of({'aria-label':t('Body'),'spellcheck':'true'})),
    access.of([EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly)]),
    mode.of(source?[lineNumbers()]:[pictures]),
    EditorState.transactionFilter.of(tr=>tr.newDoc.length>100000?[]:tr),
    EditorView.updateListener.of(update=>{if(update.docChanged){for(const a of anchors)a.pos=update.changes.mapPos(a.pos,1);if(!silent)onChange(update.state.doc.toString());}}),
    EditorView.domEventHandlers({
      paste(event){const files=[...(event.clipboardData?.files??[])].filter(f=>f.type.startsWith('image/'));if(readOnly||!files.length||!onUpload)return false;event.preventDefault();onUpload(files);return true;},
      drop(event,view){const files=[...(event.dataTransfer?.files??[])].filter(f=>f.type.startsWith('image/'));if(readOnly||!files.length||!onUpload)return false;event.preventDefault();const pos=view.posAtCoords({x:event.clientX,y:event.clientY});if(pos!==null)view.dispatch({selection:{anchor:pos}});onUpload(files);return true;},
      dragover(event){if(!readOnly&&onUpload&&event.dataTransfer?.types.includes('Files')){event.preventDefault();return true;}return false;}
    })
  ];}
  const view=new EditorView({parent,state:EditorState.create({doc:value,extensions:extensions()})});
  return {
    setDocument(value,locked,documentKey){
      readOnly=locked;silent=true;
      try{if(key!==documentKey){key=documentKey;anchors.clear();view.setState(EditorState.create({doc:value,extensions:extensions()}));}
      else{const effects=[access.reconfigure([EditorState.readOnly.of(locked),EditorView.editable.of(!locked)]),refresh.of(null)];view.dispatch({...(value!==view.state.doc.toString()?{changes:{from:0,to:view.state.doc.length,insert:value}}:{}),effects});}}
      finally{silent=false;}
    },
    setReadOnly(locked){readOnly=locked;view.dispatch({effects:access.reconfigure([EditorState.readOnly.of(locked),EditorView.editable.of(!locked)])});},
    setSource(enabled){source=enabled;parent.classList.toggle('source-mode',source);view.dispatch({effects:mode.reconfigure(source?[lineNumbers()]:[pictures])});},
    refreshLabels(){view.dispatch({effects:[labels.reconfigure(EditorView.contentAttributes.of({'aria-label':t('Body'),'spellcheck':'true'})),refresh.of(null)]});},
    insert(text,anchor){if(readOnly)return;const range=anchor?{from:anchor.pos,to:anchor.pos}:view.state.selection.main;view.dispatch({changes:{from:range.from,to:range.to,insert:text},selection:{anchor:range.from+text.length},scrollIntoView:true});view.focus();},
    wrap(before,after,fallback){if(readOnly)return;const {from,to}=view.state.selection.main,text=view.state.sliceDoc(from,to)||fallback;view.dispatch({changes:{from,to,insert:before+text+after},selection:{anchor:from+before.length,head:from+before.length+text.length},scrollIntoView:true});view.focus();},
    anchor(){const a={pos:view.state.selection.main.from};anchors.add(a);return a;},release(a){anchors.delete(a);},
    undo(){undo(view);view.focus();},redo(){redo(view);view.focus();},destroy(){anchors.clear();view.destroy();}
  };
}
