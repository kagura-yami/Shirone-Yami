// Read-only projection of Markdown syntax. Never serialize DOM back into authored text.
export function imageNodes(tree,doc){
  const refs=new Map(),images=[];
  const text=(a,b)=>doc.sliceString(a,b);
  const normalize=s=>s.trim().replace(/\s+/g,' ').toLowerCase();
  tree.iterate({enter(n){if(n.name==='LinkReference'){const label=n.node.getChild('LinkLabel'),url=n.node.getChild('URL');if(label&&url)refs.set(normalize(text(label.from+1,label.to-1)),text(url.from,url.to));}}});
  tree.iterate({enter(n){
    if(n.name!=='Image')return;
    const marks=n.node.getChildren('LinkMark'),url=n.node.getChild('URL'),label=n.node.getChild('LinkLabel');
    const alt=marks[1]?text(n.from+2,marks[1].from):'';
    const src=url?text(url.from,url.to):refs.get(normalize(label?text(label.from+1,label.to-1)||alt:alt));
    if(!src)return;
    images.push({from:n.from,to:n.to,src:src.replace(/^<|>$/g,'').replace(/\\([\\()[\] ])/g,'$1'),alt:alt.replace(/\\([\\[\]])/g,'$1')});
  }});
  return images;
}
