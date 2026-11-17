import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SearchHighlighter } from '../src/search/highlighter.ts';

test('preview highlighting has separate names and cleanup cannot erase main-document highlights',()=>{
  const saved=new Map(['window','cancelAnimationFrame'].map(key=>[key,globalThis[key]]));
  const highlights=new Map();globalThis.window={CSS:{highlights},Highlight:class{constructor(...ranges){this.ranges=ranges}},removeEventListener(){}};globalThis.cancelAnimationFrame=()=>{};
  try{
    const main=new SearchHighlighter(),preview=new SearchHighlighter('syp-preview'),mainRange={},previewRange={};
    main.set([mainRange],mainRange);preview.set([previewRange],previewRange);
    assert.deepEqual(highlights.get('syp-search-active').ranges,[mainRange]);assert.deepEqual(highlights.get('syp-preview-active').ranges,[previewRange]);
    preview.clear();assert.equal(highlights.has('syp-preview-active'),false);assert.deepEqual(highlights.get('syp-search-active').ranges,[mainRange]);main.clear();
  }finally{for(const [key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});

test('fallback preview overlays are above the dialog and clipped to the visible preview region',()=>{
  const saved=new Map(['window','document','requestAnimationFrame','cancelAnimationFrame','innerWidth','innerHeight'].map(key=>[key,globalThis[key]]));
  let frame;const overlays=[];const node=()=>({style:{},children:[],setAttribute(){},append(child){this.children.push(child)},replaceChildren(){this.children=[]},remove(){}});
  globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.document={createElement:node,body:{append:item=>overlays.push(item)}};
  globalThis.requestAnimationFrame=callback=>{frame=callback;return 1};globalThis.cancelAnimationFrame=()=>{};globalThis.innerWidth=1000;globalThis.innerHeight=800;
  try{
    const clip={getBoundingClientRect:()=>({left:100,top:200,right:500,bottom:400})};
    const range={getClientRects:()=>[{left:50,top:180,right:150,bottom:220,width:100,height:40},{left:0,top:0,right:30,bottom:20,width:30,height:20}]};
    const highlighter=new SearchHighlighter('syp-preview',clip);highlighter.set([range],range);frame();
    assert.equal(overlays[0].style.zIndex,'10001');assert.equal(overlays[0].children.length,1);
    assert.deepEqual(overlays[0].children[0].style,{left:'100px',top:'200px',width:'50px',height:'20px'});highlighter.clear();
  }finally{for(const [key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});

test('local overlays paint with native Highlight available, keep the active hit past the limit, and follow scrolling and layout changes',()=>{
  const saved=new Map(['window','document','requestAnimationFrame','cancelAnimationFrame','ResizeObserver','innerWidth','innerHeight'].map(key=>[key,globalThis[key]]));
  const highlights=new Map(),listeners=new Map(),overlays=[];let frame,resize,disconnected=0;
  const node=()=>({style:{},children:[],setAttribute(){},append(child){this.children.push(child)},replaceChildren(){this.children=[]},remove(){this.removed=true}});
  globalThis.window={CSS:{highlights},Highlight:class{constructor(...ranges){this.ranges=ranges}},addEventListener(type,callback){listeners.set(type,callback)},removeEventListener(type){listeners.delete(type)}};
  globalThis.document={createElement:node,body:{append:item=>overlays.push(item)}};
  globalThis.requestAnimationFrame=callback=>{frame=callback;return 1};globalThis.cancelAnimationFrame=()=>{};
  globalThis.ResizeObserver=class{constructor(callback){resize=callback}observe(){}disconnect(){disconnected++}};
  globalThis.innerWidth=1000;globalThis.innerHeight=800;
  let bounds={left:100,top:200,right:500,bottom:400};const clip={getBoundingClientRect:()=>bounds};
  const offscreen={getClientRects:()=>[{left:0,top:900,right:30,bottom:920,width:30,height:20}]};
  const rect={left:110,top:210,right:150,bottom:230,width:40,height:20},active={getClientRects:()=>[rect,rect]};
  try{
    const highlighter=new SearchHighlighter('syp-search',()=>clip,{overlay:true,overlayZIndex:3});
    highlighter.set([...Array(2001).fill(offscreen),active],active);frame();
    assert.equal(highlights.get('syp-search-active').ranges[0],active);
    assert.equal(overlays[0].style.zIndex,'3');assert.equal(overlays[0].children.length,1);
    assert.equal(overlays[0].children[0].className,'syp-highlight syp-highlight--active');
    rect.top-=5;rect.bottom-=5;listeners.get('scroll')();frame();assert.equal(overlays[0].children[0].style.top,'205px');
    bounds={...bounds,right:130};resize();frame();assert.equal(overlays[0].children[0].style.width,'20px');
    highlighter.clear();assert.equal(overlays[0].removed,true);assert.equal(listeners.size,0);assert.equal(highlights.size,0);assert.ok(disconnected>0);
  }finally{for(const [key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});
