import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

const worker=await build({entryPoints:['src/search/worker.ts'],bundle:true,write:false,format:'iife',target:'es2022'});
const bundle=await build({entryPoints:['src/index.ts'],bundle:true,write:false,format:'cjs',external:['siyuan'],loader:{'.css':'empty'},define:{__SEARCH_WORKER_SOURCE__:JSON.stringify(worker.outputFiles[0].text)}});

function host(load=async()=>undefined,{editors=[],openTab=async()=>undefined}={}){
  const messages=[];
  const observers=new Set();
  class Target extends EventTarget {
    listeners=new Map();
    addEventListener(type,fn,options){super.addEventListener(type,fn,options);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn)}
    removeEventListener(type,fn,options){super.removeEventListener(type,fn,options);this.listeners.get(type)?.delete(fn)}
    closest(){return null}
    get count(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0)}
  }
  const win=new Target();win.getSelection=()=>null;
  const doc=new Target();doc.body=new Target();doc.createElement=()=>new Target();
  class MutationObserver {constructor(callback){this.callback=callback}observe(){observers.add(this)}disconnect(){observers.delete(this)}}
  class EventBus {handlers=new Set();on(type,fn){this.handlers.add(fn)}off(type,fn){this.handlers.delete(fn)}}
  class Plugin {commands=[];name='siyuan-search';eventBus=new EventBus();loadData=load;saveData=async()=>{};addIcons(){}addCommand(command){this.commands.push(command)}addTopBar(){}}
  class Setting {items=[];addItem(item){this.items.push(item)}}
  const module={exports:{}};
  vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:()=>({Plugin,Setting,getAllEditor:()=>editors,openTab,showMessage:message=>messages.push(message)}),window:win,document:doc,Element:Target,Node:Target,MutationObserver,CSS:{escape:value=>value},console,setTimeout,clearTimeout});
  return {plugin:new module.exports.default(),win,doc,messages,mutate:()=>{for(const observer of [...observers])observer.callback()},get observerCount(){return observers.size}};
}

test('plugin startup restores shortcut preference, registers commands, and unloads listeners',async()=>{
  const {plugin,win,doc,messages}=host(async()=>({takeOverShortcuts:false,options:{regex:true}}));
  await plugin.onload();
  assert.equal(plugin.setting.items[0].actionElement.checked,false);
  assert.equal(plugin.commands.length,2);
  assert.equal(win.count,1);assert.equal(doc.count,1);
  plugin.commands[0].callback();
  assert.match(messages[0],/请先打开/);
  plugin.onunload();
  assert.equal(win.count,0);assert.equal(doc.count,0);assert.equal(plugin.eventBus.handlers.size,0);
});

test('unloading while preferences load cannot register late listeners',async()=>{
  let resolve;
  const {plugin,win,doc}=host(()=>new Promise(done=>{resolve=done}));
  const loading=plugin.onload();plugin.onunload();resolve(undefined);await loading;
  assert.equal(plugin.commands.length,0);assert.equal(win.count,0);assert.equal(doc.count,0);
});

test('global search defaults to the persistent bottom panel and settings accept only saved booleans',async()=>{
  for(const [saved,popup,outside] of [[undefined,false,false],[{popupFirst:true,closeTreeOnOutside:true},true,true],[{popupFirst:'true',closeTreeOnOutside:1},false,false]]){
    const {plugin}=host(async()=>saved);await plugin.onload();
    assert.equal(plugin.setting.items.find(item=>item.title==='全局搜索先打开快速弹出框').actionElement.checked,popup);
    assert.equal(plugin.setting.items.find(item=>item.title==='查找窗口在点击外部时关闭').actionElement.checked,outside);
    plugin.onunload();
  }
});

test('the two new switches update independent preferences while leaving search options intact',async()=>{
  const {plugin}=host(async()=>({options:{regex:true}}));await plugin.onload();
  const popup=plugin.setting.items.find(item=>item.title==='全局搜索先打开快速弹出框').actionElement;
  const outside=plugin.setting.items.find(item=>item.title==='查找窗口在点击外部时关闭').actionElement;
  popup.checked=true;popup.dispatchEvent(new Event('change'));assert.equal(plugin.preferences.popupFirst,true);assert.equal(plugin.preferences.closeTreeOnOutside,false);
  outside.checked=true;outside.dispatchEvent(new Event('change'));assert.equal(plugin.preferences.closeTreeOnOutside,true);assert.equal(plugin.preferences.options.regex,true);plugin.onunload();
});

function keyEvent(properties={}) {
  const event=new Event('keydown',{bubbles:true,cancelable:true});
  for(const [key,value] of Object.entries({key:'Escape',isComposing:false,altKey:false,ctrlKey:false,metaKey:false,...properties}))Object.defineProperty(event,key,{value});
  return event;
}
function searchStub(){
  return {isOpen:true,closed:[],close(restore){if(this.isOpen){this.isOpen=false;this.closed.push(restore)}}};
}

test('window capture closes local find and consumes Escape before host handling',async()=>{
  const {plugin,win}=host();await plugin.onload();const search=searchStub();plugin.local=search;
  let hostEscape=0;win.addEventListener('keydown',()=>{hostEscape++});
  const escape=keyEvent();win.dispatchEvent(escape);
  assert.deepEqual(search.closed,[true]);assert.equal(escape.defaultPrevented,true);assert.equal(hostEscape,0);
  win.dispatchEvent(keyEvent());assert.equal(hostEscape,1);
  plugin.onunload();
});

test('Escape still closes a search opened from the menu when shortcut takeover is disabled',async()=>{
  const {plugin,win}=host(async()=>({takeOverShortcuts:false}));await plugin.onload();const search=searchStub();plugin.local=search;
  win.dispatchEvent(keyEvent());assert.equal(search.isOpen,false);assert.deepEqual(search.closed,[true]);plugin.onunload();
});

test('Escape prioritizes the global dialog over a local search',async()=>{
  const {plugin,win}=host();await plugin.onload();plugin.local=searchStub();plugin.global=searchStub();
  win.dispatchEvent(keyEvent());assert.equal(plugin.global.isOpen,false);assert.equal(plugin.local.isOpen,true);
  assert.deepEqual(plugin.global.closed,[undefined]);plugin.onunload();
});

test('manual-close tree mode consumes Escape without destroying either search',async()=>{
  const {plugin,win}=host();await plugin.onload();plugin.local=searchStub();plugin.global={...searchStub(),dismissOnEscape:false};
  const escape=keyEvent();win.dispatchEvent(escape);assert.equal(escape.defaultPrevented,true);assert.equal(plugin.global.isOpen,true);assert.equal(plugin.local.isOpen,true);plugin.onunload();
});

test('IME Escape and modified Escape leave the search open',async()=>{
  const {plugin,win}=host();await plugin.onload();plugin.local=searchStub();
  for(const properties of [{isComposing:true},{ctrlKey:true},{altKey:true},{metaKey:true}]){
    const escape=keyEvent(properties);win.dispatchEvent(escape);assert.equal(plugin.local.isOpen,true);assert.equal(escape.defaultPrevented,false);
  }
  plugin.onunload();
});

test('Escape in an unrelated host dialog is left to that dialog',async()=>{
  const {plugin,win}=host();await plugin.onload();plugin.local=searchStub();
  win.closest=selector=>selector.includes('.b3-dialog')?{}:null;
  const escape=keyEvent();win.dispatchEvent(escape);
  assert.equal(plugin.local.isOpen,true);assert.equal(escape.defaultPrevented,false);plugin.onunload();
});

test('Escape with no open search, and Escape after unload, retain native behavior',async()=>{
  const {plugin,win}=host();await plugin.onload();
  const first=keyEvent();win.dispatchEvent(first);assert.equal(first.defaultPrevented,false);
  plugin.local=searchStub();plugin.onunload();const second=keyEvent();win.dispatchEvent(second);assert.equal(second.defaultPrevented,false);assert.equal(win.count,0);
});

function documentHost({focused=false,fragment=false,contextActive=false,withoutControl=false}={}){
  const root='20260102000000-bbbbbbb',hit='20260102000001-bbbbbbb',sibling='20260102000002-bbbbbbb';
  const blocks=new Set([hit]);
  const calls=[];
  const state={restores:0,restore:null};
  const control={classList:{contains:()=>contextActive},click(){
    state.restores++;
    state.restore=()=>{
      Object.assign(editor.block,{id:root,showAll:false,mode:focused?0:3,action:[]});
      blocks.add(sibling);contextActive=true;focused=false;fragment=false;fixture.mutate();
    };
  }};
  const editor={
    block:{rootID:root,id:focused?hit:root,showAll:focused,mode:0,action:[]},options:{blockId:focused||fragment?hit:root},
    element:{isConnected:true,getClientRects:()=>[{}],closest:()=>null,querySelector(selector){
      if(selector==='[data-type="exit-focus"]'||selector==='[data-type="context"]')return withoutControl?null:control;
      const id=selector.match(/data-node-id="([^"]+)"/)?.[1];
      return blocks.has(id)?{getClientRects:()=>[{}]}:null;
    }},
  };
  const fixture=host(undefined,{editors:[{protyle:editor}],openTab:async options=>{
    calls.push({id:options.doc.id,action:Array.from(options.doc.action),zoomIn:options.doc.zoomIn,keepCursor:options.keepCursor});
    // Model the native reuse path: an already visible block does not reload its editor.
    if(!focused&&!fragment&&options.doc.action.includes('cb-get-context')){
      blocks.add(sibling);Object.assign(editor.block,{id:root,showAll:false,mode:3,action:options.doc.action});
    }
    return {model:{editor:{protyle:editor}}};
  }});
  return {...fixture,root,hit,sibling,editor,blocks,calls,state,get observerCount(){return fixture.observerCount}};
}
async function restoring(fixture){
  const deadline=Date.now()+1000;
  while(!fixture.state.restore){if(Date.now()>deadline)throw new Error('Native context restoration was not requested');await new Promise(resolve=>setTimeout(resolve,1))}
}

test('opening a global hit retains the complete document around the exact target block',async()=>{
  const f=documentHost();
  const opened=await f.plugin.openBlock(f.hit,f.root);
  assert.equal(opened,f.editor);assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0],{id:f.hit,action:['cb-get-context','cb-get-focus'],zoomIn:false,keepCursor:false});
  assert.equal(f.blocks.has(f.sibling),true);assert.equal(f.state.restores,0);assert.equal(f.plugin.revealing,0);
});

test('opening a document title uses document context without entering block focus',async()=>{
  const f=documentHost();
  assert.equal(await f.plugin.openBlock(f.root,f.root),f.editor);
  assert.equal(f.calls[0].id,f.root);assert.equal(f.calls[0].zoomIn,false);assert.equal(f.blocks.has(f.sibling),true);
  assert.equal(f.state.restores,0);
});

test('page-find navigation to an unloaded hit requests the same document context',async()=>{
  const f=documentHost();
  assert.equal(await f.plugin.localHost().reveal(f.hit,f.editor),f.editor);
  assert.ok(f.calls[0].action.includes('cb-get-context'));assert.equal(f.calls[0].zoomIn,false);
  assert.equal(f.calls[0].action.includes('cb-get-hl'),false);
  assert.equal(f.blocks.has(f.sibling),true);
});

test('reusing a focused editor waits for native exit-focus before locating the hit again',async()=>{
  const f=documentHost({focused:true});let finished=false;
  const opening=f.plugin.openBlock(f.hit,f.root).then(editor=>{finished=true;return editor});
  await restoring(f);assert.equal(finished,false);assert.equal(f.plugin.revealing,1);assert.equal(f.observerCount,1);
  assert.equal(f.calls.length,1);f.state.restore();
  assert.equal(await opening,f.editor);assert.equal(f.editor.block.id,f.root);assert.equal(f.editor.block.showAll,false);
  assert.equal(f.blocks.has(f.sibling),true);assert.equal(f.calls.length,2);assert.equal(f.calls[1].id,f.hit);
  assert.ok(f.calls.every(call=>!call.action.includes('cb-get-hl')));
  assert.equal(f.observerCount,0);assert.equal(f.plugin.revealing,0);
});

test('a fragment opened by an earlier plugin version regains its document context',async()=>{
  const f=documentHost({fragment:true});
  const opening=f.plugin.openBlock(f.hit,f.root);await restoring(f);f.state.restore();
  assert.equal(await opening,f.editor);assert.equal(f.state.restores,1);assert.equal(f.calls.length,2);
  assert.equal(f.editor.block.mode,3);assert.equal(f.blocks.has(f.sibling),true);assert.equal(f.observerCount,0);
});

test('an already restored context is not toggled back to a fragment',async()=>{
  const f=documentHost({fragment:true,contextActive:true});f.blocks.add(f.sibling);
  assert.equal(await f.plugin.openBlock(f.hit,f.root),f.editor);
  assert.equal(f.state.restores,0);assert.equal(f.calls.length,1);assert.equal(f.blocks.has(f.sibling),true);
});

test('a missing native exit-focus control reports failure and clears navigation state',async()=>{
  const f=documentHost({focused:true,withoutControl:true});
  await assert.rejects(f.plugin.openBlock(f.hit,f.root),/退出块聚焦/);
  assert.equal(f.plugin.revealing,0);assert.equal(f.observerCount,0);
});
