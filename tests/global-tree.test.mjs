import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { dom, event } from './helpers/dom.mjs';
import { matchTexts, DEFAULT_OPTIONS } from '../src/search/matcher.ts';

const bundle=await build({entryPoints:['src/ui/global-search.ts'],bundle:true,write:false,format:'esm',target:'es2022',plugins:[{name:'host',setup(build){
  build.onResolve({filter:/(?:^|\/)(document-preview|dialog-window|dialog-split|find-dock|engine|api)\.ts$/},args=>({path:args.path.split('/').at(-1),namespace:'host'}));
  build.onLoad({filter:/.*/,namespace:'host'},({path})=>({loader:'js',contents:{
    'document-preview.ts':'export class DocumentPreview {constructor(){globalThis.__treeHost.preview=this;this.shows=[]}show(...args){this.shows.push(args);return Promise.resolve()}reset(){}updatePath(path){this.path=path}destroy(){this.destroyed=true}}',
    'dialog-window.ts':'export class DialogWindow {destroy(){globalThis.__treeHost.windowDestroyed=true}}',
    'dialog-split.ts':'export class DialogSplit {constructor(body,separator,axis="rows"){globalThis.__treeHost.axis=axis}destroy(){}}',
    'find-dock.ts':'export class FindDock {constructor(){globalThis.__treeHost.docked=true}destroy(){globalThis.__treeHost.dockDestroyed=true}}',
    'engine.ts':'export const searchTexts=(...args)=>globalThis.__treeHost.find(...args);',
    'api.ts':'export const post=(...args)=>globalThis.__treeHost.post(...args);export const blockQuery=(cursor,scope)=>JSON.stringify({cursor,scope});',
  }[path]}));
}}]});
const {GlobalSearch}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function fixture({mode='tree',outside=false,many=false}={}){
  const f=dom(),saved=globalThis.__treeHost;
  const state={scans:0,opened:[],outside,find:async(...args)=>matchTexts(...args),unsubscribed:false};
  const rows=many?Array.from({length:110},(_,n)=>({id:`p${n}`,root_id:'doc',box:'box',hpath:'/项目/设计',type:'p',content:`line ${n} Search`})):[
    {id:'p1',root_id:'doc',box:'box',hpath:'/项目/设计',type:'c',content:'first Search\nsecond Search'},
    {id:'p2',root_id:'other',box:'box',hpath:'/项目/实现',type:'p',content:'Search <script>literal</script>'},
  ];
  state.post=async path=>path.includes('lsNotebooks')?{notebooks:[{id:'box',name:'我的笔记本'}]}:(state.scans++,rows);
  globalThis.__treeHost=state;
  const host={app:{},presentation:mode,closeOnOutside:()=>state.outside,options:{...DEFAULT_OPTIONS},rootId:'doc',notebookId:'box',changed(){},remember(){},open:async(...args)=>state.opened.push(args),replacements:{busy:false,canUndo:false,subscribe:()=>()=>{state.unsubscribed=true}}};
  const search=new GlobalSearch(host,'Search');
  return {...f,state,search,list:search.element.querySelector('.syp-results'),close(){search.close(false);if(saved===undefined)delete globalThis.__treeHost;else globalThis.__treeHost=saved;f.close()}};
}
async function ready(f){const deadline=Date.now()+1200;while(!f.search.element.querySelector('.syp-summary').textContent.includes('处匹配 ·')){if(Date.now()>deadline)throw new Error('Search did not finish');await new Promise(resolve=>setTimeout(resolve,5))}}

test('direct tree search stops expansion at documents even when the first match is automatically previewed',async()=>{
  const f=fixture();try{
    await ready(f);assert.equal(f.search.presentation,'tree');assert.equal(f.state.docked,true);assert.equal(f.state.axis,'columns');assert.equal(f.list.getAttribute('role'),'tree');
    assert.equal(f.search.element.querySelector('.syp-dialog').getAttribute('aria-modal'),'false');assert.equal(f.search.element.querySelector('.syp-open-find-window').hidden,true);
    const names=f.list.querySelectorAll('.syp-tree-label').map(node=>node.textContent);assert.deepEqual(names,['我的笔记本','项目','实现','设计']);
    const documents=f.list.querySelectorAll('[data-kind="document"]');
    assert.equal(documents.length,2);assert.ok(documents.every(node=>node.getAttribute('aria-expanded')==='false'));assert.equal(f.list.querySelectorAll('.syp-result').length,0);
    const selected=f.list.querySelector('[aria-selected="true"]');assert.equal(selected.dataset.kind,'document');assert.equal(selected.querySelector('.syp-tree-label').textContent,'实现');
    assert.equal(f.list.getAttribute('aria-activedescendant'),selected.id);
    assert.equal(f.state.preview.shows.length,1);assert.equal(f.state.preview.shows[0][3],'我的笔记本/项目/实现');
    documents.forEach(node=>node.dispatchEvent(event('click')));
    assert.equal(f.list.querySelectorAll('.syp-result').length,3);assert.ok(f.list.textContent.includes('second Search'));assert.equal(f.list.querySelectorAll('script').length,0);
  }finally{f.close()}
});
test('promoting the popup keeps the query, scope, current occurrence, replacement and mounted preview without another scan',async()=>{
  const f=fixture({mode:'popup'});try{
    await ready(f);f.list.querySelectorAll('.syp-result')[2].dispatchEvent(event('click'));
    f.search.element.querySelector('.syp-replacement-input').value='replacement';f.search.element.querySelector('.syp-select').value='notebook:box';
    const shows=f.state.preview.shows.length,scans=f.state.scans,preview=f.state.preview;
    f.search.element.querySelector('.syp-open-find-window').dispatchEvent(event('click'));
    assert.equal(f.search.presentation,'tree');assert.equal(f.search.input.value,'Search');assert.equal(f.search.element.querySelector('.syp-select').value,'notebook:box');assert.equal(f.search.element.querySelector('.syp-replacement-input').value,'replacement');
    assert.equal(f.state.preview,preview);assert.equal(preview.shows.length,shows);assert.equal(f.state.scans,scans);assert.equal(f.list.querySelector('[aria-selected="true"]').querySelector('.syp-tree-label').textContent,'设计');assert.equal(f.state.windowDestroyed,true);
    assert.equal(f.list.querySelectorAll('.syp-result').length,0);assert.equal(preview.shows.at(-1)[0].ordinal,1);
  }finally{f.close()}
});
test('branches collapse and expand, and choosing a hidden occurrence expands its ancestor path',async()=>{
  const f=fixture();try{
    await ready(f);const root=f.list.querySelector('.syp-tree-branch');root.dispatchEvent(event('click'));assert.equal(f.list.querySelectorAll('.syp-result').length,0);assert.equal(f.list.querySelector('.syp-tree-branch').getAttribute('aria-expanded'),'false');
    f.search.input.dispatchEvent(event('keydown',{key:'ArrowDown'})); // Non-bubbling test DOM: dispatch the owner's navigation event explicitly.
    f.search.element.dispatchEvent(event('keydown',{key:'ArrowDown',target:f.search.input}));
    assert.equal(f.list.querySelectorAll('.syp-result').length,2);assert.equal(f.list.querySelector('[aria-selected="true"]').dataset.index,'1');
    assert.equal(f.list.querySelectorAll('[data-kind="document"][aria-expanded="false"]').length,1);
    assert.equal(f.state.preview.shows.at(-1)[0].ordinal,0);
  }finally{f.close()}
});
test('tree keyboard navigation follows visible rows; Left/Right collapse and expand and Enter opens without destroying',async()=>{
  const f=fixture();try{
    await ready(f);f.list.dispatchEvent(event('keydown',{key:'Home'}));assert.equal(f.list.getAttribute('aria-activedescendant'),f.list.querySelector('.syp-tree-branch').id);
    f.list.dispatchEvent(event('keydown',{key:'ArrowLeft'}));assert.equal(f.list.querySelectorAll('.syp-result').length,0);
    f.list.dispatchEvent(event('keydown',{key:'ArrowRight'}));assert.equal(f.list.querySelectorAll('.syp-result').length,0);
    f.list.dispatchEvent(event('keydown',{key:'End'}));assert.equal(f.list.querySelectorAll('.syp-result').length,0);
    f.list.dispatchEvent(event('keydown',{key:'ArrowRight'}));assert.equal(f.list.querySelectorAll('.syp-result').length,2);
    f.list.dispatchEvent(event('keydown',{key:'End'}));assert.equal(f.list.querySelector('[aria-selected="true"]').dataset.index,'2');
    f.list.dispatchEvent(event('keydown',{key:'Enter'}));await Promise.resolve();assert.equal(f.state.opened.length,1);assert.equal(f.search.isOpen,true);
  }finally{f.close()}
});
test('manual-close policy ignores outside clicks and Escape; enabling auto-close works on the open panel',async()=>{
  const f=fixture();try{
    await ready(f);const outside=f.document.createElement('button');f.document.body.append(outside);
    f.document.dispatchEvent(event('mousedown',{target:outside}));assert.equal(f.search.isOpen,true);assert.equal(f.search.dismissOnEscape,false);
    f.search.element.dispatchEvent(event('keydown',{key:'Escape'}));assert.equal(f.search.isOpen,true);
    f.state.outside=true;assert.equal(f.search.dismissOnEscape,true);
    f.document.dispatchEvent(event('mousedown',{target:f.search.input}));assert.equal(f.search.isOpen,true);
    f.document.dispatchEvent(event('mousedown',{target:outside}));assert.equal(f.search.isOpen,false);assert.equal(f.document.listenerCount,0);assert.equal(f.state.preview.destroyed,true);assert.equal(f.state.dockDestroyed,true);
  }finally{f.close()}
});
test('explicit close returns to the latest editor focus and releases the tree listener and replacement subscription',async()=>{
  const f=fixture();try{
    await ready(f);const editor=f.document.createElement('div');f.document.body.append(editor);
    f.document.dispatchEvent(event('focusin',{target:editor}));f.search.element.querySelector('[aria-label="关闭查找窗口"]').dispatchEvent(event('click'));
    assert.equal(f.search.isOpen,false);assert.equal(f.document.activeElement,editor);assert.deepEqual(editor.focusOptions,{preventScroll:true});
    assert.equal(f.list.listenerCount,0);assert.equal(f.document.listenerCount,0);assert.equal(f.state.unsubscribed,true);
  }finally{f.close()}
});
test('showing more results extends the same document branch and preserves complete match totals',async()=>{
  const f=fixture({many:true});try{
    await ready(f);assert.equal(f.list.querySelectorAll('.syp-result').length,0);assert.ok(f.list.textContent.includes('110 处匹配'));
    f.list.querySelector('[data-kind="document"]').dispatchEvent(event('click'));assert.equal(f.list.querySelectorAll('.syp-result').length,100);
    f.search.element.querySelector('.syp-more').dispatchEvent(event('click'));assert.equal(f.list.querySelectorAll('.syp-result').length,110);assert.equal(f.search.element.querySelector('.syp-more').hidden,true);
  }finally{f.close()}
});

test('manual expansion survives result and path refreshes without expanding other documents or changing preview',async()=>{
  const f=fixture();try{
    await ready(f);f.list.querySelectorAll('[data-kind="document"]')[1].dispatchEvent(event('click'));
    const previews=f.state.preview.shows.length;f.list.scrollTop=125;f.list.scrollLeft=35;f.search.refreshPaths();
    assert.equal(f.list.querySelectorAll('.syp-result').length,2);assert.equal(f.list.querySelectorAll('[data-kind="document"][aria-expanded="false"]').length,1);
    assert.equal(f.list.scrollTop,125);assert.equal(f.list.scrollLeft,35);assert.equal(f.state.preview.shows.length,previews);
    f.list.querySelectorAll('[data-kind="document"]')[1].dispatchEvent(event('click'));f.search.renderList();
    assert.equal(f.list.querySelectorAll('.syp-result').length,0);
  }finally{f.close()}
});

test('a new query resets manually expanded documents to the compact default while retaining the selected preview',async()=>{
  const f=fixture();try{
    await ready(f);f.list.querySelectorAll('[data-kind="document"]')[0].dispatchEvent(event('click'));assert.equal(f.list.querySelectorAll('.syp-result').length,1);
    f.search.setQuery('Search');await ready(f);
    assert.equal(f.list.querySelectorAll('.syp-result').length,0);assert.ok(f.list.querySelectorAll('[data-kind="document"]').every(node=>node.getAttribute('aria-expanded')==='false'));
    assert.equal(f.list.querySelector('[aria-selected="true"]').dataset.kind,'document');assert.equal(f.state.preview.shows.at(-1)[3],'我的笔记本/项目/实现');
  }finally{f.close()}
});
