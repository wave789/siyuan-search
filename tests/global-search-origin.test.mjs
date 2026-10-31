import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_OPTIONS } from '../src/search/matcher.ts';

const directory=await mkdtemp(join(tmpdir(),'siyuan-global-origin-'));
after(()=>rm(directory,{recursive:true,force:true}));
const bundled=await build({
  stdin:{contents:'export { GlobalSearch } from "./src/ui/global-search.ts"; export { captureSearchOrigin } from "./src/search/origin.ts";',resolveDir:process.cwd(),loader:'ts'},
  bundle:true,write:false,format:'esm',target:'es2022',plugins:[{name:'simulated-host',setup(build){
    build.onResolve({filter:/(?:^|\/)(document-preview|dialog-window|dialog-split|document|engine|api)\.ts$/},args=>({path:args.path.split('/').at(-1),namespace:'host'}));
    build.onLoad({filter:/.*/,namespace:'host'},({path})=>({loader:'js',contents:{
      'document-preview.ts':'export class DocumentPreview { reset(){} destroy(){} }',
      'dialog-window.ts':'export class DialogWindow { destroy(){} }',
      'dialog-split.ts':'export class DialogSplit { destroy(){} }',
      'document.ts':'export const liveBlocks=()=>globalThis.__globalOrigin.blocks;',
      'engine.ts':'export const searchTexts=async()=>({blocks:[],truncated:false});',
      'api.ts':'export const post=async()=>({notebooks:[]}); export const blockQuery=()=>"";',
    }[path]}));
  }}],
});
const file=join(directory,'search.mjs');await writeFile(file,bundled.outputFiles[0].text);
const {GlobalSearch,captureSearchOrigin}=await import(pathToFileURL(file).href);

class Element extends EventTarget {
  children=[];parentElement=null;className='';style={};dataset={};attributes=new Map();scrollTop=0;scrollLeft=0;raw='';value='';nodeType=1;
  constructor(document,tag){super();this.ownerDocument=document;this.tagName=tag.toUpperCase()}
  get isConnected(){return this.tagName==='BODY'||!!this.parentElement?.isConnected}
  get textContent(){return this.raw+this.children.map(child=>child.textContent||'').join('')}
  set textContent(value){this.raw=value;this.replaceChildren()}
  append(...children){for(const child of children){child.remove?.();child.parentElement=this;this.children.push(child)}}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children)}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null}
  contains(node){for(let current=node;current;current=current.parentElement)if(current===this)return true;return false}
  setAttribute(name,value){this.attributes.set(name,value)}
  removeAttribute(name){this.attributes.delete(name)}
  querySelectorAll(selector){const found=[];const visit=parent=>{for(const child of parent.children){if(child.className?.split(' ').includes(selector.slice(1)))found.push(child);if(child.children)visit(child)}};visit(this);return found}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  focus(options){
    const document=this.ownerDocument;document.activeElement=this;document.fixture.focusCalls.push({element:this,options});
    if(!options?.preventScroll){document.fixture.scroller.scrollTop=0;document.fixture.scroller.scrollLeft=0}
    document.fixture.onFocus?.(this);
  }
  select(){this.ownerDocument.fixture.ranges=[]}
}
function range(node,start,end){return {startContainer:node,endContainer:node,startOffset:start,endOffset:end,cloneRange(){return range(node,start,end)}}}
function fixture({caret=false,selection=true,origin=true}={}){
  const saved=new Map(['document','window','__globalOrigin'].map(key=>[key,globalThis[key]]));
  const document={};document.createElement=tag=>new Element(document,tag);document.createElementNS=(_,tag)=>document.createElement(tag);document.body=document.createElement('body');
  const root=document.createElement('section'),scroller=document.createElement('div'),editable=document.createElement('div'),paragraph=document.createElement('div');
  scroller.className='protyle-content';editable.className='protyle-wysiwyg';
  document.body.append(root);root.append(scroller);scroller.append(editable);editable.append(paragraph);
  const node={data:'before Search after',nodeType:3,parentElement:paragraph,get isConnected(){return paragraph.isConnected}};
  paragraph.children.push(node);
  const state={root,scroller,editable,paragraph,node,ranges:selection?[range(node,7,caret?7:13)]:[],focusCalls:[],remembered:[],onFocus:null};
  document.fixture=state;document.activeElement=editable;
  root.scrollTop=20;root.scrollLeft=3;scroller.scrollTop=750;scroller.scrollLeft=85;paragraph.scrollLeft=40;
  const selectionAPI={get rangeCount(){return state.ranges.length},getRangeAt:index=>state.ranges[index],removeAllRanges(){state.ranges=[]},addRange(value){state.ranges.push(value)}};
  globalThis.document=document;globalThis.window={getSelection:()=>selectionAPI};
  globalThis.__globalOrigin={blocks:[{id:'p',text:node.data,element:paragraph,parts:[{node,start:0,end:node.data.length}],breaks:[]}]};
  const host={options:{...DEFAULT_OPTIONS},rootId:'doc',changed(){},remember:query=>state.remembered.push(query),open:async()=>{},replacements:{canUndo:false,busy:false,subscribe:()=>()=>{}}};
  if(origin)host.origin=captureSearchOrigin(root,'doc',state.ranges[0]);
  let search;
  return {state,document,host,open(){search=new GlobalSearch(host,'');return search},close(){search?.close(false);for(const [key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}};
}

test('opening global search and pressing Escape preserves note selection and every captured scroll offset',()=>{
  const f=fixture();try{
    const search=f.open();
    assert.equal(f.state.scroller.scrollTop,750);assert.equal(f.state.scroller.scrollLeft,85);
    const escape=new Event('keydown',{cancelable:true});Object.defineProperty(escape,'key',{value:'Escape'});search.element.dispatchEvent(escape);
    assert.equal(search.isOpen,false);assert.equal(escape.defaultPrevented,true);assert.equal(f.document.activeElement,f.state.editable);
    assert.deepEqual(f.state.ranges,[f.host.origin.selection]);assert.equal(f.state.ranges[0].startOffset,7);assert.equal(f.state.ranges[0].endOffset,13);
    assert.equal(f.state.root.scrollTop,20);assert.equal(f.state.root.scrollLeft,3);assert.equal(f.state.paragraph.scrollLeft,40);
    assert.equal(f.state.scroller.scrollTop,750);assert.equal(f.state.scroller.scrollLeft,85);
    assert.ok(f.state.focusCalls.every(call=>call.options?.preventScroll===true));
  }finally{f.close()}
});

test('host focus handlers that reset the viewport are corrected after both opening and closing',()=>{
  const f=fixture({caret:true});try{
    f.state.onFocus=()=>{f.state.scroller.scrollTop=0;f.state.scroller.scrollLeft=0;f.state.paragraph.scrollLeft=0;f.state.ranges=[]};
    const search=f.open();assert.equal(f.state.scroller.scrollTop,750);assert.equal(f.state.paragraph.scrollLeft,40);
    search.close();assert.equal(f.state.scroller.scrollTop,750);assert.equal(f.state.scroller.scrollLeft,85);assert.equal(f.state.paragraph.scrollLeft,40);
    assert.equal(f.state.ranges[0].startOffset,7);assert.equal(f.state.ranges[0].endOffset,7);
  }finally{f.close()}
});

test('refocusing an existing global dialog retains the original return selection and viewport',()=>{
  const f=fixture();try{
    const search=f.open();search.setQuery('another query');search.setQuery('');search.close();
    assert.deepEqual(f.state.ranges,[f.host.origin.selection]);assert.equal(f.state.scroller.scrollTop,750);assert.equal(f.state.scroller.scrollLeft,85);
    assert.ok(f.state.focusCalls.every(call=>call.options?.preventScroll===true));assert.deepEqual(f.state.remembered,['']);
  }finally{f.close()}
});

test('an explicit result jump closes without restoring the old document selection or viewport',()=>{
  const f=fixture();try{
    const search=f.open();const target=f.document.createElement('div');f.document.body.append(target);f.document.activeElement=target;
    const targetRange=range(f.state.node,0,6);f.state.ranges=[targetRange];f.state.scroller.scrollTop=1200;f.state.scroller.scrollLeft=160;
    const calls=f.state.focusCalls.length;search.close(false);search.close();
    assert.equal(f.document.activeElement,target);assert.deepEqual(f.state.ranges,[targetRange]);assert.equal(f.state.focusCalls.length,calls);
    assert.equal(f.state.scroller.scrollTop,1200);assert.equal(f.state.scroller.scrollLeft,160);assert.equal(f.state.remembered.length,1);
  }finally{f.close()}
});

test('detached focus and selection nodes are ignored when the modal closes',()=>{
  const f=fixture();try{
    const search=f.open();f.state.editable.remove();const calls=f.state.focusCalls.length;
    search.close();assert.equal(f.state.focusCalls.length,calls);assert.deepEqual(f.state.ranges,[]);assert.equal(f.state.scroller.scrollTop,750);
  }finally{f.close()}
});

test('backdrop dismissal without an initial range still keeps the current note at its original position',()=>{
  const f=fixture({selection:false});try{
    const search=f.open();search.element.dispatchEvent(new Event('mousedown'));
    assert.equal(search.isOpen,false);assert.equal(f.document.activeElement,f.state.editable);assert.deepEqual(f.state.ranges,[]);
    assert.equal(f.state.scroller.scrollTop,750);assert.equal(f.state.scroller.scrollLeft,85);
  }finally{f.close()}
});

test('a global dialog without an editor origin returns focus without browser scrolling',()=>{
  const f=fixture({origin:false});try{
    const search=f.open();search.close();assert.equal(f.document.activeElement,f.state.editable);
    assert.equal(f.state.scroller.scrollTop,750);assert.equal(f.state.scroller.scrollLeft,85);
  }finally{f.close()}
});
