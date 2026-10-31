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
