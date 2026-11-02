import { test, after } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { matchTexts, DEFAULT_OPTIONS } from '../src/search/matcher.ts';

const bundle=await build({stdin:{contents:'export { LocalSearch } from "./src/ui/local-search.ts"; export { captureSearchOrigin } from "./src/search/origin.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',target:'es2022',plugins:[{name:'model-browser-adapters',setup(build){
  build.onResolve({filter:/(?:^|\/)(document|engine|highlighter|api)\.ts$/},args=>({path:args.path.split('/').at(-1),namespace:'model'}));
  build.onLoad({filter:/.*/,namespace:'model'},({path})=>({loader:'js',contents:path==='document.ts'?`
    export const liveBlocks=()=>globalThis.__originFixture.blocks;
    export const readBlocks=()=>globalThis.__originFixture.blocks;
    export const mergeBlocks=(saved,live)=>live;
    export const matchRange=(block,match)=>globalThis.__originFixture.range(block.parts[0].node,match.start,match.end);
  `:path==='engine.ts'?`export const searchTexts=(...args)=>globalThis.__originFixture.find(...args);`:path==='highlighter.ts'?`
    export class SearchHighlighter { set(ranges,active){globalThis.__originFixture.highlight=active} clear(){} }
  `:`export const post=async()=>({dom:'model document'});`}));
}}]});
const directory=await mkdtemp(join(tmpdir(),'siyuan-origin-test-'));
const modulePath=join(directory,'local-search.mjs');await writeFile(modulePath,bundle.outputFiles[0].text);
after(()=>rm(directory,{recursive:true,force:true}));
const {LocalSearch,captureSearchOrigin}=await import(pathToFileURL(modulePath).href);

class Element extends EventTarget {
  children=[];parentElement=null;className='';textContent='';value='';style={};dataset={};attributes=new Map();scrollTop=0;scrollLeft=0;hidden=false;nodeType=1;
  constructor(document,tag){super();this.ownerDocument=document;this.tagName=tag.toUpperCase()}
  get isConnected(){return this.tagName==='BODY'||!!this.parentElement?.isConnected}
  setAttribute(name,value){this.attributes.set(name,value)}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node)}}
  prepend(node){const added=!this.children.includes(node);node.remove();node.parentElement=this;this.children.unshift(node);if(added&&this===this.ownerDocument.fixture?.root)this.ownerDocument.fixture.scroller.scrollTop+=43}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null}
  contains(node){for(let item=node;item;item=item.parentElement)if(item===this)return true;return false}
  querySelectorAll(selector){const found=[];const visit=node=>{for(const child of node.children||[]){if(child.className?.split(' ').includes(selector.slice(1)))found.push(child);visit(child)}};visit(this);return found}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  focus(options){this.ownerDocument.activeElement=this;this.ownerDocument.focusOptions=options;if(!options?.preventScroll)this.ownerDocument.fixture.scroller.scrollTop=0}
  select(){}
}
function range(node,start,end,endNode=node){return {startContainer:node,startOffset:start,endContainer:endNode,endOffset:end,cloneRange(){return range(node,start,end,endNode)}}}
function fixture(){
  const saved=new Map(['document','window','MutationObserver','DOMParser','__originFixture'].map(key=>[key,globalThis[key]]));
  const document={};document.createElement=tag=>new Element(document,tag);document.createElementNS=(_,tag)=>document.createElement(tag);document.body=document.createElement('body');
  const root=document.createElement('section'),scroller=document.createElement('div'),wysiwyg=document.createElement('div');
  scroller.className='protyle-content';wysiwyg.className='protyle-wysiwyg';document.body.append(root);root.append(scroller);scroller.append(wysiwyg);
  const blocks=['cat','cat cat'].map((text,index)=>{
    const element=document.createElement('div'),node={data:text,nodeType:3,parentElement:element,isConnected:true,ownerDocument:document};wysiwyg.append(element);element.children.push(node);
    return {id:`p${index+1}`,text,element,parts:[{node,start:0,end:text.length}],breaks:[]};
  });
  const state={root,scroller,blocks,range,highlight:null,scrollCalls:[],reveals:[],selectionRanges:[],defer:null,findStarted:null};
  document.fixture=state;scroller.scrollTop=500;scroller.scrollLeft=80;
  state.find=async(texts,query,options,signal,limit)=>{state.findStarted?.();if(state.defer)await state.defer;if(signal.aborted)throw new DOMException('Aborted','AbortError');return matchTexts(texts,query,options,limit)};
  globalThis.__originFixture=state;globalThis.document=document;
  globalThis.window={getSelection:()=>({get rangeCount(){return state.selectionRanges.length},getRangeAt(index){return state.selectionRanges[index]},removeAllRanges(){state.selectionRanges=[]},addRange(value){state.selectionRanges.push(value)}})};
  globalThis.MutationObserver=class{constructor(callback){state.observer=this;this.callback=callback}observe(){}disconnect(){}};globalThis.DOMParser=class{parseFromString(){return {body:root}}};
  const editor={element:root,block:{rootID:'doc'},wysiwyg:{element:wysiwyg}};
  const host={options:{...DEFAULT_OPTIONS},changed(){},remember(){},openGlobal(){},replacements:{canUndo:false,busy:false,subscribe:()=>()=>{}},reveal:async id=>{state.reveals.push(id);return editor}};
  let search;
  return {state,document,blocks,root,editor,
    origin:(block=1,start=4,end=7)=>captureSearchOrigin(root,'doc',range(blocks[block].parts[0].node,start,end)),
    edit(blockIndex,text,offset){
      const block=blocks[blockIndex];block.text=text;block.parts[0].node.data=text;block.parts[0].end=text.length;
      const caret=range(block.parts[0].node,offset,offset);state.selectionRanges=[caret];document.activeElement=wysiwyg;
      state.observer.callback();return caret;
    },
    open(origin,query='cat'){search=new LocalSearch(editor,host,query,origin);search.scrollToActive=force=>{state.scrollCalls.push(force);return true};return search},
    close(){search?.close();for(const [key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value}},
  };
}
async function ready(search){const deadline=Date.now()+1000;while(!search.searchReady){if(Date.now()>deadline)throw new Error('Search did not finish');await new Promise(resolve=>setTimeout(resolve,1))}}

test('opening find keeps the selected occurrence and the pre-open vertical/horizontal viewport',async()=>{
  const f=fixture();try{
    const origin=f.origin(),search=f.open(origin);await ready(search);
    assert.equal(search.active,2);assert.equal(search.counter.textContent,'3 / 3');
    assert.equal(f.state.scroller.scrollTop,500);assert.equal(f.state.scroller.scrollLeft,80);assert.deepEqual(f.state.scrollCalls,[]);assert.deepEqual(f.state.reveals,[]);
    assert.equal(f.state.highlight.startOffset,4);assert.equal(f.document.focusOptions.preventScroll,true);
    search.close(true);assert.equal(f.state.selectionRanges[0],origin.selection);
  }finally{f.close()}
});

test('reopening the existing bar honors a newly selected occurrence instead of its previous hit',async()=>{
  const f=fixture();try{
    const search=f.open(f.origin(0,0,3));await ready(search);assert.equal(search.active,0);
    f.state.scroller.scrollTop=700;search.setQuery('cat',f.origin());await ready(search);
    assert.equal(search.active,2);assert.equal(f.state.scroller.scrollTop,700);assert.deepEqual(f.state.scrollCalls,[]);
  }finally{f.close()}
});

test('next/previous navigation starts from the selected occurrence and then scrolls normally',async()=>{
  const f=fixture();try{
    const origin=f.origin(),search=f.open(origin);await ready(search);
    await search.move(-1);assert.equal(search.active,1);assert.deepEqual(f.state.scrollCalls,[true]);
    await search.move(1);assert.equal(search.active,2);assert.deepEqual(f.state.scrollCalls,[true,true]);
    search.close(true);assert.notEqual(f.state.selectionRanges[0],origin.selection);
  }finally{f.close()}
});

test('an unmatched opening selection still preserves the viewport and Escape return range',async()=>{
  const f=fixture();try{
    const origin=f.origin(),search=f.open(origin,'missing');await ready(search);
    assert.equal(search.active,-1);assert.deepEqual(f.state.scrollCalls,[]);assert.equal(f.state.scroller.scrollTop,500);
    search.close(true);assert.equal(f.state.selectionRanges[0],origin.selection);
  }finally{f.close()}
});

test('manual scrolling during an asynchronous initial search is not overwritten when it completes',async()=>{
  const f=fixture();try{
    let release,started;f.state.defer=new Promise(resolve=>{release=resolve});const finding=new Promise(resolve=>{started=resolve});f.state.findStarted=started;
    const search=f.open(f.origin());await finding;f.state.scroller.scrollTop=900;release();await ready(search);
    assert.equal(search.active,2);assert.equal(f.state.scroller.scrollTop,900);assert.deepEqual(f.state.scrollCalls,[]);
  }finally{f.close()}
});

test('explicit global-result focus still selects its requested hit and reveals it',async()=>{
  const f=fixture();try{
    const search=f.open();search.focusMatch('p2',{start:0,end:3});await ready(search);
    assert.equal(search.active,1);assert.deepEqual(f.state.scrollCalls,[false]);
  }finally{f.close()}
});

test('typing a new query leaves opening preservation and uses normal live search navigation',async()=>{
  const f=fixture();try{
    const search=f.open(f.origin());await ready(search);search.input.value='ca';search.input.dispatchEvent(new Event('input'));await ready(search);
    assert.equal(f.state.scrollCalls.length,1);assert.equal(search.returnSelection,undefined);
  }finally{f.close()}
});

test('deleting the second occurrence refreshes matches without scrolling or moving the caret, including Escape',async()=>{
  const f=fixture();try{
    const origin=f.origin(1,0,3),search=f.open(origin);await ready(search);assert.equal(search.active,1);
    const caret=f.edit(1,' cat',0);await ready(search);
    assert.equal(search.hits.length,2);assert.deepEqual(f.state.scrollCalls,[]);assert.deepEqual(f.state.reveals,[]);
    assert.equal(f.state.selectionRanges[0],caret);assert.equal(f.document.activeElement,f.editor.wysiwyg.element);
    assert.equal(f.state.scroller.scrollTop,500);assert.equal(f.state.scroller.scrollLeft,80);
    search.close(true);const returned=f.state.selectionRanges[0];
    assert.equal(returned.startContainer,caret.startContainer);assert.equal(returned.startOffset,0);assert.equal(returned.endOffset,0);assert.notEqual(returned,origin.selection);
    assert.equal(f.state.scroller.scrollTop,500);assert.equal(f.state.scroller.scrollLeft,80);
  }finally{f.close()}
});

test('removing every match from the edited block does not reveal a remaining match in an earlier unloaded block',async()=>{
  const f=fixture();try{
    const search=f.open(f.origin());await ready(search);
    search.scrollToActive=force=>{f.state.scrollCalls.push(force);return false};
    const caret=f.edit(1,'',0);await ready(search);await Promise.resolve();
    assert.equal(search.hits.length,1);assert.equal(search.hits[0].blockId,'p1');assert.deepEqual(f.state.scrollCalls,[]);assert.deepEqual(f.state.reveals,[]);
    assert.equal(f.document.activeElement,f.editor.wysiwyg.element);assert.equal(f.state.selectionRanges[0],caret);
    assert.equal(f.state.scroller.scrollTop,500);assert.equal(f.state.scroller.scrollLeft,80);
  }finally{f.close()}
});

test('an asynchronous edit refresh preserves later manual scrolling and subsequent explicit navigation still works',async()=>{
  const f=fixture();try{
    const search=f.open(f.origin());await ready(search);
    let release,started;f.state.defer=new Promise(resolve=>{release=resolve});const finding=new Promise(resolve=>{started=resolve});f.state.findStarted=started;
    const caret=f.edit(1,'cat ',4);await finding;f.state.scroller.scrollTop=950;f.state.scroller.scrollLeft=160;
    release();await ready(search);assert.deepEqual(f.state.scrollCalls,[]);assert.equal(f.state.scroller.scrollTop,950);assert.equal(f.state.scroller.scrollLeft,160);assert.equal(f.state.selectionRanges[0],caret);
    await search.move(1);assert.deepEqual(f.state.scrollCalls,[true]);
    search.input.value='ca';search.input.dispatchEvent(new Event('input'));await ready(search);assert.deepEqual(f.state.scrollCalls,[true,false]);
  }finally{f.close()}
});

test('an explicit global-result target still reveals its match when background document mutations refresh the pending search',async()=>{
  const f=fixture();try{
    const search=f.open();search.focusMatch('p2',{start:4,end:7});f.state.observer.callback();await ready(search);
    assert.equal(search.active,2);assert.deepEqual(f.state.scrollCalls,[false]);assert.equal(f.state.highlight.startOffset,4);
  }finally{f.close()}
});
