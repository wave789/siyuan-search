import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { matchTexts, DEFAULT_OPTIONS } from '../src/search/matcher.ts';

const directory=await mkdtemp(join(tmpdir(),'siyuan-reading-preview-'));after(()=>rm(directory,{recursive:true,force:true}));
const bundle=await build({entryPoints:['src/ui/document-preview.ts'],bundle:true,write:false,format:'esm',target:'es2022',plugins:[{name:'reading-host',setup(build){
  build.onResolve({filter:/^(siyuan)$|\/(api|document|engine|highlighter|reading-preview)\.ts$/},args=>({path:args.path.split('/').at(-1),namespace:'host'}));
  build.onLoad({filter:/.*/,namespace:'host'},({path})=>({loader:'js',contents:{
    'siyuan':'export const ProtyleMethod={highlightRender:element=>globalThis.__readingPreview.enhance(element)};export class Protyle {constructor(){throw new Error("Must not construct an editor")}}',
    'api.ts':'export const post=(...args)=>globalThis.__readingPreview.post(...args);',
    'document.ts':'export const matchRange=(block,match)=>globalThis.__readingPreview.range(block,match);',
    'reading-preview.ts':'export const readingBlocks=element=>{const blocks=element.querySelector(".model-root").blocks;const heading=element.children.find(node=>node.tagName==="H1");return heading?[{id:heading.dataset.sypBlockId,text:heading.textContent,element:heading},...blocks]:blocks};export const readingPreviewHTML=(html,document)=>globalThis.__readingPreview.compose(html,document);',
    'engine.ts':'export const searchTexts=(...args)=>globalThis.__readingPreview.find(...args);',
    'highlighter.ts':'export class SearchHighlighter {constructor(namespace,clip){this.namespace=namespace;this.clip=clip;globalThis.__readingPreview.highlighters.push(this)}set(ranges,active){this.ranges=ranges;this.active=active}clear(){this.ranges=[];this.active=undefined;this.cleared=true}}',
  }[path]}));
}}]});
const file=join(directory,'view.mjs');await writeFile(file,bundle.outputFiles[0].text);const {DocumentPreview}=await import(pathToFileURL(file).href);

class Element extends EventTarget {
  children=[];parentElement=null;className='';raw='';attributes=new Map();style={};dataset={};scrollTop=0;scrollLeft=0;clientHeight=120;clientWidth=400;nodeType=1;
  constructor(document,tag){super();this.ownerDocument=document;this.tagName=tag.toUpperCase()}
  set textContent(value){this.raw=value;this.children=[]}get textContent(){return this.raw+this.children.map(child=>child.textContent).join('')}
  set innerHTML(value){throw new Error('Must not insert note HTML directly')}
  setAttribute(name,value){this.attributes.set(name,value)}getAttribute(name){return this.attributes.get(name)}
  append(...nodes){for(const node of nodes){if(node.nodeType===11){this.append(...[...node.children]);continue}node.remove?.();node.parentElement=this;this.children.push(node)}}
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.raw='';this.append(...nodes)}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null}
  prepend(node){node.parentElement=this;this.children.unshift(node)}
  querySelectorAll(selector){const result=[];const visit=node=>{for(const child of node.children){if(selector.startsWith('.')?child.className.split(' ').includes(selector.slice(1)):child.tagName===selector.toUpperCase())result.push(child);visit(child)}};visit(this);return result}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  getBoundingClientRect(){return {left:0,right:400,top:100,bottom:220,width:400,height:120}}
}
const selected=(root='doc',ordinal=0)=>({block:{id:'p',root_id:root,box:'box',hpath:`/folder/${root}`,type:'p',content:'Search Search'},match:ordinal?{start:7,end:13}:{start:0,end:6},ordinal});
function fixture({manual=false,fail=false,empty=false,omitTitle=false}={}){
  const saved=new Map(['document','MutationObserver','__readingPreview'].map(key=>[key,globalThis[key]]));
  const document={};document.createElement=tag=>new Element(document,tag);document.createElementNS=(_,tag)=>document.createElement(tag);document.createDocumentFragment=()=>{const node=new Element(document,'fragment');node.nodeType=11;return node};globalThis.document=document;
  const state={requests:[],highlighters:[],observers:[],models:[],finds:0,opened:0,enhancements:0,fail,empty};
  globalThis.MutationObserver=class {constructor(callback){this.callback=callback;state.observers.push(this)}observe(){}disconnect(){this.disconnected=true}};
  state.post=async(path,body,signal)=>{
    const request={path,body,signal};state.requests.push(request);
    if(state.fail){state.fail=false;throw new Error('kernel refused access')}
    if(state.empty)return {};
    if(manual)return new Promise(resolve=>{request.resolve=()=>resolve({html:body.id})});
    return {html:body.id};
  };
  state.compose=(rootID,document)=>{
    const fragment=document.createDocumentFragment(),root=document.createElement('article');root.className='model-root';
    const title=document.createElement('h1');title.textContent=`title-${rootID}`;if(!omitTitle)root.append(title);
    root.blocks=omitTitle?[]:[{id:rootID,text:title.textContent,element:title}];
    for(const [id,text]of [['p','Search Search'],['tail','complete final paragraph']]){
      const node=document.createElement('p');node.textContent=text;root.append(node);root.blocks.push({id,text,element:node});
    }
    for(const tag of ['strong','table','img'])root.append(document.createElement(tag));
    state.models.push(root);fragment.append(root);return fragment;
  };
  state.enhance=()=>{state.enhancements++};
  state.find=async(texts,query,options,signal,limit)=>{state.finds++;if(signal.aborted)throw new DOMException('Aborted','AbortError');return matchTexts(texts,query,options,limit)};
  state.range=(block,match)=>({block,startOffset:match.start,endOffset:match.end,getBoundingClientRect(){const scroller=block.element.parentElement.parentElement.parentElement;return {top:700+match.start*10-scroller.scrollTop,left:60,right:100,width:40,height:24,bottom:724+match.start*10-scroller.scrollTop}}});
  globalThis.__readingPreview=state;
  const root=document.createElement('section');
  const view=new DocumentPreview(root,()=>state.opened++,{});
  return {root,view,state,show:(value=selected())=>view.show(value,'Search',DEFAULT_OPTIONS,`folder/${value.block.root_id}`),close(){view.destroy();for(const[key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}};
}
async function until(condition){const deadline=Date.now()+1000;while(!condition()){if(Date.now()>deadline)throw new Error('Condition timed out');await new Promise(resolve=>setTimeout(resolve,5))}}

test('reading preview requests exactly the selected document and displays rich nodes without an editor callback',async()=>{
  const f=fixture();try{
    await f.show(selected('only-selected-document'));
    assert.equal(f.state.requests.length,1);assert.equal(f.state.requests[0].path,'/api/export/preview');assert.deepEqual(f.state.requests[0].body,{id:'only-selected-document'});
    assert.ok(f.root.querySelector('.syp-preview-reading').querySelector('strong'));assert.ok(f.root.querySelector('table'));assert.ok(f.root.querySelector('img'));
    assert.ok(f.root.textContent.includes('complete final paragraph'));assert.equal(f.root.getAttribute('aria-busy'),'false');assert.equal(f.state.enhancements,1);
    assert.equal(f.root.querySelector('.syp-preview-mode'),null);assert.equal(f.root.querySelector('.syp-preview-content'),null);
    assert.equal(f.state.highlighters[0].namespace,'syp-preview');assert.equal(f.state.highlighters[0].ranges.length,2);
    const paste=new Event('paste',{cancelable:true});f.root.querySelector('.syp-preview-rich-scroll').dispatchEvent(paste);assert.equal(paste.defaultPrevented,true);
  }finally{f.close()}
});

test('switching duplicate occurrences reuses both the HTML request and mounted document',async()=>{
  const f=fixture();try{
    await f.show();const content=f.root.querySelector('.syp-preview-reading');await f.show(selected('doc',1));
    assert.equal(f.state.requests.length,1);assert.equal(f.root.querySelector('.syp-preview-reading'),content);
    assert.equal(f.state.highlighters[0].active.startOffset,7);assert.equal(f.root.querySelector('.syp-preview-rich-scroll').scrollTop,622);
    f.root.querySelector('.syp-open-button').dispatchEvent(new Event('click'));assert.equal(f.state.opened,1);
  }finally{f.close()}
});

test('two selections in the same loading document share one request and use the newest occurrence',async()=>{
  const f=fixture({manual:true});try{
    const first=f.show(),second=f.show(selected('doc',1));assert.equal(f.state.requests.length,1);
    assert.equal(f.state.requests[0].signal.aborted,false);f.state.requests[0].resolve();await Promise.all([first,second]);
    assert.equal(f.state.models.length,1);assert.equal(f.state.highlighters[0].active.startOffset,7);
  }finally{f.close()}
});

test('switching documents aborts the old request and its late response cannot replace the new document',async()=>{
  const f=fixture({manual:true});try{
    const old=f.show(selected('old')),current=f.show(selected('new'));assert.equal(f.state.requests[0].signal.aborted,true);
    f.state.requests[1].resolve();await current;f.state.requests[0].resolve();await old;
    assert.equal(f.root.querySelector('.syp-preview-document-title').textContent,'new');assert.equal(f.state.models.length,1);
  }finally{f.close()}
});

test('closing during a read aborts it and a late response cannot mount any content',async()=>{
  const f=fixture({manual:true});try{
    const showing=f.show();f.view.destroy();assert.equal(f.state.requests[0].signal.aborted,true);f.state.requests[0].resolve();await showing;
    assert.equal(f.state.models.length,0);assert.equal(f.state.highlighters.length,0);
  }finally{f.close()}
});

test('API failures identify the endpoint and retry loads the same selected document',async()=>{
  const f=fixture({fail:true});try{
    await f.show();assert.ok(f.root.textContent.includes('/api/export/preview'));assert.ok(f.root.textContent.includes('kernel refused access'));assert.equal(f.root.querySelector('.syp-preview-mode'),null);
    f.root.querySelector('.syp-action').dispatchEvent(new Event('click'));await until(()=>f.root.getAttribute('aria-busy')==='false');
    assert.equal(f.state.requests.length,2);assert.deepEqual(f.state.requests.map(request=>request.body.id),['doc','doc']);
    assert.ok(f.root.textContent.includes('渲染预览 · 2 处匹配'));
  }finally{f.close()}
});

test('async enhancements refresh highlights while preserving manual scrolling, and reset clears observers',async()=>{
  const f=fixture();try{
    await f.show();const scroller=f.root.querySelector('.syp-preview-rich-scroll');scroller.scrollTop=900;
    f.state.models[0].blocks.find(block=>block.id==='p').text='Search';f.state.observers[0].callback();
    await until(()=>f.state.finds===2);await until(()=>f.root.getAttribute('aria-busy')==='false');
    assert.equal(f.state.highlighters[0].ranges.length,1);assert.equal(scroller.scrollTop,900);f.view.reset();
    assert.equal(f.state.observers[0].disconnected,true);assert.equal(f.state.highlighters[0].cleared,true);assert.ok(f.root.textContent.includes('选择一条结果'));
  }finally{f.close()}
});

test('revisiting an already selected document uses its HTML cache without prefetching other results',async()=>{
  const f=fixture();try{
    await f.show(selected('one'));await f.show(selected('two'));await f.show(selected('one'));
    assert.deepEqual(f.state.requests.map(request=>request.body.id),['one','two']);assert.equal(f.state.models.length,3);
    assert.equal(f.root.querySelectorAll('.model-root').length,1);assert.equal(f.state.highlighters[0].cleared,true);assert.equal(f.state.highlighters[1].cleared,true);
    assert.equal(f.root.querySelector('.syp-preview-document-title').textContent,'one');
  }finally{f.close()}
});

test('header shows the filename followed by its directory, and late path updates keep the same preview and scroll',async()=>{
  const f=fixture();try{
    await f.view.show(selected(),'Search',DEFAULT_OPTIONS,'我的笔记本/项目/设计说明');
    const content=f.root.querySelector('.syp-preview-reading'),scroller=f.root.querySelector('.syp-preview-rich-scroll');scroller.scrollTop=950;
    const title=f.root.querySelector('.syp-preview-document-title'),path=f.root.querySelector('.syp-preview-path');
    assert.equal(title.textContent,'设计说明');assert.equal(title.title,'设计说明');assert.equal(path.textContent,'我的笔记本/项目');
    f.view.updatePath('新笔记本/归档/设计说明');
    assert.equal(title.textContent,'设计说明');assert.equal(path.textContent,'新笔记本/归档');assert.equal(path.title,'新笔记本/归档');
    assert.equal(f.root.querySelector('.syp-preview-reading'),content);assert.equal(scroller.scrollTop,950);assert.equal(f.state.requests.length,1);
  }finally{f.close()}
});

test('a document title is still displayed when the host export configuration omits it',async()=>{
  const f=fixture({omitTitle:true});try{
    await f.show();assert.equal(f.root.querySelector('.syp-preview-reading').querySelector('h1').textContent,'doc');
    assert.equal(f.root.querySelector('.syp-preview-document-title').textContent,'doc');assert.equal(f.state.requests.length,1);
  }finally{f.close()}
});

test('a matching worker failure cannot hide a successfully rendered document',async()=>{
  const f=fixture();try{
    const find=f.state.find;f.state.find=async()=>{throw new Error('worker unavailable')};await f.show();
    assert.ok(f.root.querySelector('.syp-preview-reading'));assert.ok(f.root.textContent.includes('文档已显示'));assert.ok(f.root.textContent.includes('worker unavailable'));
    assert.equal(f.root.getAttribute('aria-busy'),'false');f.state.find=find;await f.show(selected('doc',1));
    assert.equal(f.state.requests.length,1);assert.equal(f.state.highlighters[0].active.startOffset,7);
  }finally{f.close()}
});
