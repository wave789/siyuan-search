import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPreviewDocument, preparePreview } from '../src/search/preview-model.ts';
import { matchTexts, DEFAULT_OPTIONS } from '../src/search/matcher.ts';
const directory=await mkdtemp(join(tmpdir(),'siyuan-full-preview-'));after(()=>rm(directory,{recursive:true,force:true}));
const built=await build({entryPoints:['src/ui/text-document-preview.ts'],bundle:true,write:false,format:'esm',target:'es2022',define:{__SEARCH_WORKER_SOURCE__:JSON.stringify('')}});
const file=join(directory,'view.mjs');await writeFile(file,built.outputFiles[0].text);const {TextDocumentPreview:DocumentPreview}=await import(pathToFileURL(file).href);
class Text {constructor(text){this.textContent=text;this.nodeType=3;this.parentElement=null}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null}}
class Element extends EventTarget {
  children=[];parentElement=null;className='';dataset={};attributes=new Map();style={};nodeType=1;raw='';_scrollTop=0;scrollLeft=0;clientHeight=120;clientWidth=400;
  constructor(document,tag){super();this.ownerDocument=document;this.tagName=tag.toUpperCase()}
  get classList(){return {add:name=>{if(!this.className.split(' ').includes(name))this.className+=' '+name},remove:name=>{this.className=this.className.split(' ').filter(item=>item!==name).join(' ')}}}
  get scrollTop(){return this._scrollTop}set scrollTop(value){this._scrollTop=Math.max(0,value)}
  get textContent(){return this.children.length?this.children.map(child=>child.textContent).join(''):this.raw}set textContent(value){this.children=[];this.raw=value}
  set innerHTML(value){throw new Error(`HTML insertion is prohibited in the preview: ${value}`)}
  setAttribute(name,value){this.attributes.set(name,value)}getAttribute(name){return this.attributes.get(name)}
  append(...nodes){for(let node of nodes){if(typeof node==='string')node=new Text(node);if(node.nodeType===11){this.append(...[...node.children]);continue}node.remove();node.parentElement=this;this.children.push(node)}}
  appendChild(node){this.append(node);return node}
  contains(node){for(let current=node;current;current=current.parentElement)if(current===this)return true;return false}
  replaceChildren(...nodes){this.children.forEach(child=>{child.parentElement=null});this.children=[];this.raw='';this.append(...nodes)}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null}
  matches(selector){return selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):this.tagName===selector.toUpperCase()}
  querySelectorAll(selector){const result=[];const visit=parent=>{for(const child of parent.children||[]){if(child.matches?.(selector))result.push(child);visit(child)}};visit(this);return result}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches?.(selector))return node;return null}
  getBoundingClientRect(){
    if(this.matches('.syp-preview-scroll'))return {top:100,left:0,right:400,bottom:220,height:120,width:400};
    const row=this.closest('.syp-preview-line'),scroll=this.closest('.syp-preview-scroll');const top=100+(Number(row?.dataset.line||1)-1)*24-(scroll?.scrollTop||0);
    let column=0;for(const sibling of this.parentElement?.children||[]){if(sibling===this)break;column+=sibling.textContent.length}
    const left=48+column*8-(scroll?.scrollLeft||0);return {top,left,right:left+this.textContent.length*8,bottom:top+24,height:24,width:this.textContent.length*8};
  }
}
function fixture(store,syntax){
  const original=globalThis.document;const tags=[];const document={};document.createElement=tag=>{tags.push(tag);return new Element(document,tag)};document.createElementNS=(_,tag)=>document.createElement(tag);document.createTextNode=value=>new Text(value);document.createDocumentFragment=()=>{const fragment=new Element(document,'fragment');fragment.nodeType=11;return fragment};
  const oldWindow=globalThis.window;globalThis.window={getSelection:()=>null};
  globalThis.document=document;const root=document.createElement('section');let opened=0;const preview=new DocumentPreview(root,()=>opened++,store,undefined,syntax);
  return {root,tags,preview,get opened(){return opened},close(){preview.destroy();if(original===undefined)delete globalThis.document;else globalThis.document=original;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow}};
}
function prepared(root='doc',text='Search Search') {const doc=buildPreviewDocument(root,`title-${root}`,[{id:'p',text}]);return preparePreview(doc,matchTexts(doc.blocks.map(block=>block.text),'Search',DEFAULT_OPTIONS))}
const selection=(root='doc',ordinal=0)=>({block:{id:'p',root_id:root,box:'box',hpath:'/folder/title',content:'Search Search',type:'p'},match:ordinal?{start:7,end:13}:{start:0,end:6},ordinal});

test('the preview renders the complete document as safe text and highlights every occurrence',async()=>{
  const data=prepared('doc','Search Search\n<img src=x onerror=alert(1)>\ncomplete end');
  const f=fixture({get:async()=>data,reset(){}});try{
    await f.preview.show(selection(), 'Search', DEFAULT_OPTIONS, 'folder/title');
    const rows=f.root.querySelectorAll('.syp-preview-line');assert.equal(rows.length,4);assert.ok(rows.at(-1).textContent.includes('complete end'));
    assert.ok(f.root.textContent.includes('<img src=x'));assert.equal(f.tags.includes('img'),false);assert.equal(f.root.querySelectorAll('mark').length,2);
    assert.equal(f.root.querySelectorAll('.syp-mark--active').length,1);assert.equal(f.root.getAttribute('aria-busy'),'false');
  }finally{f.close()}
});

test('selecting another occurrence reuses the full text and moves the active highlight',async()=>{
  const data=prepared(),f=fixture({get:async()=>data,reset(){}});try{
    await f.preview.show(selection(),'Search',DEFAULT_OPTIONS,'folder/title');const content=f.root.querySelector('.syp-preview-content');
    await f.preview.show(selection('doc',1),'Search',DEFAULT_OPTIONS,'folder/title');
    assert.equal(f.root.querySelector('.syp-preview-content'),content);const active=f.root.querySelector('.syp-mark--active');
    assert.equal(active.dataset.matchOffset,String(data.document.blocks[1].offset+7));assert.ok(f.root.querySelector('.syp-preview-info').textContent.includes('第 2 行，第 8 列'));
  }finally{f.close()}
});

test('full-document rendering includes distant lines and only scrolls its own preview',async()=>{
  const text=Array.from({length:1200},(_,index)=>index===1100?'Search target':`line ${index}`).join('\n');const data=prepared('doc',text);
  const f=fixture({get:async()=>data,reset(){}});try{
    await f.preview.show({...selection(),block:{...selection().block,content:text},match:{start:text.indexOf('Search'),end:text.indexOf('Search')+6}},'Search',DEFAULT_OPTIONS,'folder/title');
    assert.equal(f.root.querySelectorAll('.syp-preview-line').length,1201);assert.ok(f.root.querySelector('.syp-preview-scroll').scrollTop>20000);
    assert.equal(f.root.querySelector('.syp-preview-line--active').dataset.line,'1102');assert.ok(f.root.querySelectorAll('.syp-preview-line').at(-1).textContent.includes('line 1199'));
  }finally{f.close()}
});

test('out-of-order preview requests cannot overwrite the currently selected document',async()=>{
  let release;const old=new Promise(resolve=>{release=resolve});const f=fixture({get:async value=>value.block.root_id==='old'?old:prepared('new'),reset(){}});try{
    const first=f.preview.show(selection('old'),'Search',DEFAULT_OPTIONS,'old path');await f.preview.show(selection('new'),'Search',DEFAULT_OPTIONS,'new path');
    release(prepared('old'));await first;assert.equal(f.root.querySelector('.syp-preview-document-title').textContent,'title-new');assert.equal(f.root.querySelector('.syp-preview-path').textContent,'new path');
  }finally{f.close()}
});

test('cancelling at a final render batch cannot leave a stale prepared document behind',async()=>{
  const old=prepared('old',Array.from({length:399},(_,n)=>`Search ${n}`).join('\n')),current=prepared('new');
  const f=fixture({get:async value=>value.block.root_id==='old'?old:current,reset(){}});try{
    const first=f.preview.show(selection('old'),'Search',DEFAULT_OPTIONS,'old path');await Promise.resolve();
    await f.preview.show(selection('new'),'Search',DEFAULT_OPTIONS,'new path');await first;
    await f.preview.show(selection('old'),'Search',DEFAULT_OPTIONS,'old path');
    assert.equal(f.root.querySelector('.syp-preview-document-title').textContent,'title-old');assert.equal(f.root.querySelectorAll('.syp-preview-line').length,400);
  }finally{f.close()}
});

test('load errors can be retried, opening is explicit, and reset clears the previous full text',async()=>{
  let fail=true;const f=fixture({get:async()=>{if(fail)throw new Error('offline');return prepared()},reset(){}});try{
    await f.preview.show(selection(),'Search',DEFAULT_OPTIONS,'folder/title');assert.ok(f.root.textContent.includes('全文加载失败'));assert.equal(f.opened,0);
    fail=false;await f.preview.show(selection(),'Search',DEFAULT_OPTIONS,'folder/title');f.root.querySelector('.syp-open-button').dispatchEvent(new Event('click'));assert.equal(f.opened,1);
    f.preview.reset();assert.equal(f.root.querySelectorAll('.syp-preview-line').length,0);assert.ok(f.root.textContent.includes('选择一条结果'));
  }finally{f.close()}
});

const colored=root=>{const data=prepared(root);data.document.blocks[1].language='python';return data};
async function until(condition){const deadline=Date.now()+1000;while(!condition()){if(Date.now()>deadline)throw new Error('Coloring did not finish');await new Promise(resolve=>setTimeout(resolve,5))}}

test('full content and search marks are visible before syntax assets finish, and coloring retains active marks and scroll',async()=>{
  let release,calls=0;const loading=new Promise(resolve=>{release=resolve}),data=colored('doc');
  const f=fixture({get:async()=>data,reset(){}},()=>loading);try{
    await f.preview.show(selection(),'Search',DEFAULT_OPTIONS,'doc');assert.equal(f.root.getAttribute('aria-busy'),'false');
    assert.equal(f.root.querySelectorAll('.syp-mark').length,2);const active=f.root.querySelector('.syp-mark--active'),scroll=f.root.querySelector('.syp-preview-scroll'),before=scroll.scrollTop;
    release({getLanguage:()=>true,highlight:text=>{calls++;return {value:text.replace('Search','<span class="hljs-keyword">Search</span>')}}});
    await until(()=>f.root.querySelectorAll('.syp-syntax').length===1);
    assert.equal(f.root.querySelector('.syp-mark--active'),active);assert.equal(active.textContent,'Search');assert.equal(scroll.scrollTop,before);
    await f.preview.show(selection('doc',1),'Search',DEFAULT_OPTIONS,'doc');await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(calls,1);assert.equal(f.root.querySelectorAll('.syp-mark').length,2);
  }finally{f.close()}
});

test('a syntax engine failure leaves the full text and selected match usable',async()=>{
  const data=colored('doc'),f=fixture({get:async()=>data,reset(){}},async()=>{throw new Error('No syntax assets')});try{
    await f.preview.show(selection(),'Search',DEFAULT_OPTIONS,'doc');await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(f.root.getAttribute('aria-busy'),'false');assert.equal(f.root.querySelectorAll('.syp-mark').length,2);assert.equal(f.root.querySelector('.syp-mark--active').textContent,'Search');
  }finally{f.close()}
});

test('late syntax loading after a document switch colors only the current document',async()=>{
  let release;const loading=new Promise(resolve=>{release=resolve}),documents={old:colored('old'),new:colored('new')};
  const f=fixture({get:async value=>documents[value.block.root_id],reset(){}},()=>loading);let calls=0;try{
    await f.preview.show(selection('old'),'Search',DEFAULT_OPTIONS,'old');await f.preview.show(selection('new'),'Search',DEFAULT_OPTIONS,'new');
    release({getLanguage:()=>true,highlight:text=>{calls++;return {value:text.replace('Search','<span class="hljs-keyword">Search</span>')}}});
    await until(()=>f.root.querySelectorAll('.syp-syntax').length===1);assert.equal(calls,1);
    assert.equal(f.root.querySelector('.syp-preview-document-title').textContent,'title-new');assert.equal(f.root.querySelector('.syp-preview-path').textContent,'new');
  }finally{f.close()}
});
