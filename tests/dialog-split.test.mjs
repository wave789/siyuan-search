import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle=await build({entryPoints:['src/ui/dialog-split.ts'],bundle:true,write:false,format:'esm',target:'es2022'});
const {DialogSplit}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

class Target extends EventTarget {
  listeners=new Map();
  addEventListener(type,fn,options){super.addEventListener(type,fn,options);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn)}
  removeEventListener(type,fn,options){super.removeEventListener(type,fn,options);this.listeners.get(type)?.delete(fn)}
  get listenerCount(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0)}
}
function fixture(height=507,axis='rows'){
  const saved=globalThis.ResizeObserver,win=new Target(),classes=new Set(),captures=new Set(),attributes=new Map();let observer;
  globalThis.ResizeObserver=class {constructor(callback){this.callback=callback;observer=this}observe(target){this.target=target}disconnect(){this.disconnected=true}};
  const body={ownerDocument:{defaultView:win},clientHeight:height,clientWidth:1007,style:{},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}};
  const separator=new Target();Object.assign(separator,{setAttribute:(name,value)=>attributes.set(name,value),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)});
  const split=new DialogSplit(body,separator,axis);
  return {win,body,separator,split,classes,captures,attributes,observer,ratio:()=>Number.parseFloat(body.style[axis==='columns'?'gridTemplateColumns':'gridTemplateRows'].match(/minmax\(0, ([\d.]+)fr/)[1]),close(){split.destroy();if(saved===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=saved}};
}
function event(type,properties={}){
  const event=new Event(type,{bubbles:true,cancelable:true});
  for(const[key,value]of Object.entries({pointerId:1,button:0,isPrimary:true,clientX:200,clientY:200,...properties}))Object.defineProperty(event,key,{value});
  return event;
}

test('divider exposes its orientation and initial proportion to keyboard and screen reader users',()=>{
  const f=fixture();try{
    assert.equal(f.ratio(),.44);assert.equal(f.separator.tabIndex,0);assert.equal(f.attributes.get('role'),'separator');assert.equal(f.attributes.get('aria-orientation'),'horizontal');
    assert.equal(f.attributes.get('aria-valuenow'),'44');assert.match(f.attributes.get('aria-valuetext'),/文档预览 56%/);assert.equal(f.observer.target,f.body);
  }finally{f.close()}
});

test('dragging changes only the pane proportion and prevents the focus-changing default action',()=>{
  const f=fixture();try{
    const down=event('pointerdown');f.separator.dispatchEvent(down);assert.equal(down.defaultPrevented,true);assert.equal(f.classes.size,1);assert.equal(f.captures.has(1),true);
    f.win.dispatchEvent(event('pointermove',{clientY:300}));assert.equal(f.ratio(),.64);assert.equal(f.attributes.get('aria-valuenow'),'64');
    f.win.dispatchEvent(event('pointerup'));assert.equal(f.win.listenerCount,0);assert.equal(f.captures.size,0);assert.equal(f.classes.size,0);
    f.win.dispatchEvent(event('pointermove',{clientY:400}));assert.equal(f.ratio(),.64);
  }finally{f.close()}
});

test('extreme dragging leaves both panes visible and adapts the limits to a short dialog',()=>{
  const f=fixture();try{
    f.separator.dispatchEvent(event('pointerdown'));f.win.dispatchEvent(event('pointermove',{clientY:-5000}));assert.equal(f.ratio(),80/500);
    f.win.dispatchEvent(event('pointermove',{clientY:5000}));assert.equal(f.ratio(),400/500);f.win.dispatchEvent(event('pointerup'));
    f.body.clientHeight=97;f.observer.callback();assert.ok(Math.abs(f.ratio()-80/180)<1e-10);
    assert.ok(Number(f.attributes.get('aria-valuemin'))<=Number(f.attributes.get('aria-valuenow')));assert.ok(Number(f.attributes.get('aria-valuenow'))<=Number(f.attributes.get('aria-valuemax')));
  }finally{f.close()}
});

test('arrow keys adjust pane heights without bubbling into search-result navigation; Home and End obey limits',()=>{
  const f=fixture();try{
    const down=event('keydown',{key:'ArrowDown'});f.separator.dispatchEvent(down);assert.equal(down.defaultPrevented,true);assert.equal(down.cancelBubble,true);assert.equal(f.ratio(),236/500);
    f.separator.dispatchEvent(event('keydown',{key:'ArrowUp',shiftKey:true}));assert.equal(f.ratio(),186/500);
    f.separator.dispatchEvent(event('keydown',{key:'Home'}));assert.equal(f.ratio(),80/500);
    f.separator.dispatchEvent(event('keydown',{key:'End'}));assert.equal(f.ratio(),400/500);
    f.separator.dispatchEvent(event('keydown',{key:'ArrowDown',isComposing:true}));assert.equal(f.ratio(),400/500);
    const escape=event('keydown',{key:'Escape'});f.separator.dispatchEvent(escape);assert.equal(escape.defaultPrevented,false);
  }finally{f.close()}
});

test('unrelated buttons and pointers cannot start or change an active divider gesture',()=>{
  const f=fixture();try{
    f.separator.dispatchEvent(event('pointerdown',{button:2}));f.separator.dispatchEvent(event('pointerdown',{isPrimary:false}));assert.equal(f.win.listenerCount,0);
    f.separator.dispatchEvent(event('pointerdown'));f.win.dispatchEvent(event('pointermove',{pointerId:2,clientY:400}));f.win.dispatchEvent(event('pointerup',{pointerId:2}));assert.equal(f.ratio(),.44);assert.equal(f.captures.size,1);
    f.win.dispatchEvent(event('pointercancel'));assert.equal(f.captures.size,0);assert.equal(f.win.listenerCount,0);
  }finally{f.close()}
});

test('proportion survives window resizing, and double click restores the default split',()=>{
  const f=fixture();try{
    f.separator.dispatchEvent(event('keydown',{key:'ArrowDown'}));const ratio=f.ratio();f.body.clientHeight=807;f.observer.callback();assert.equal(f.ratio(),ratio);
    f.separator.dispatchEvent(event('dblclick'));assert.equal(f.ratio(),.44);
    f.body.clientHeight=0;f.observer.callback();assert.ok(!f.body.style.gridTemplateRows.includes('NaN'));
  }finally{f.close()}
});

test('blur or lost capture stops dragging and removes global listeners',()=>{
  const f=fixture();try{
    for(const type of ['blur','lostpointercapture']){
      f.separator.dispatchEvent(event('pointerdown'));
      (type==='blur'?f.win:f.separator).dispatchEvent(event(type));assert.equal(f.win.listenerCount,0);assert.equal(f.captures.size,0);
      f.win.dispatchEvent(event('pointermove',{clientY:500}));assert.equal(f.ratio(),.44);
    }
  }finally{f.close()}
});

test('closing while dragging disconnects observation and capture, with no late resize or keyboard updates',()=>{
  const f=fixture();try{
    f.separator.dispatchEvent(event('pointerdown'));const rows=f.body.style.gridTemplateRows;f.split.destroy();
    assert.equal(f.win.listenerCount,0);assert.equal(f.separator.listenerCount,0);assert.equal(f.captures.size,0);assert.equal(f.observer.disconnected,true);
    f.body.clientHeight=200;f.observer.callback();f.separator.dispatchEvent(event('keydown',{key:'End'}));assert.equal(f.body.style.gridTemplateRows,rows);
  }finally{f.close()}
});

test('vertical divider changes column widths using horizontal movement and reserves both panes',()=>{
  const f=fixture(507,'columns');try{
    assert.equal(f.attributes.get('aria-orientation'),'vertical');assert.equal(f.ratio(),.45);assert.equal(f.body.style.gridTemplateRows,'minmax(0, 1fr)');
    f.separator.dispatchEvent(event('pointerdown'));f.win.dispatchEvent(event('pointermove',{clientX:300,clientY:900}));assert.equal(f.ratio(),.55);
    f.win.dispatchEvent(event('pointermove',{clientX:9000}));assert.equal(f.ratio(),.78);
    f.win.dispatchEvent(event('pointermove',{clientX:-9000}));assert.equal(f.ratio(),.18);f.win.dispatchEvent(event('pointerup'));
    f.body.clientWidth=207;f.observer.callback();assert.equal(f.ratio(),.45);
  }finally{f.close()}
});

test('vertical divider uses Left/Right and double-click restores the default column ratio',()=>{
  const f=fixture(507,'columns');try{
    f.separator.dispatchEvent(event('keydown',{key:'ArrowRight'}));assert.equal(f.ratio(),.466);
    f.separator.dispatchEvent(event('keydown',{key:'ArrowLeft',shiftKey:true}));assert.equal(f.ratio(),.416);
    f.separator.dispatchEvent(event('keydown',{key:'ArrowUp'}));assert.equal(f.ratio(),.416);
    f.separator.dispatchEvent(event('dblclick'));assert.equal(f.ratio(),.45);
  }finally{f.close()}
});
