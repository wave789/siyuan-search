import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { dom, event } from './helpers/dom.mjs';
const bundle=await build({entryPoints:['src/ui/find-dock.ts'],bundle:true,write:false,format:'esm',target:'es2022'});
const {FindDock,fitFindDock}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function fixture(){
  const f=dom(),saved=new Map(['ResizeObserver','MutationObserver'].map(key=>[key,globalThis[key]])),observers=[];
  class Observer {constructor(callback){this.callback=callback;observers.push(this)}observe(target){this.target=target;this.disconnected=false}disconnect(){this.disconnected=true}}
  Object.assign(globalThis,{ResizeObserver:Observer,MutationObserver:Observer});
  const anchor=f.document.createElement('div');anchor.className='layout__center';anchor.rect={left:250,top:50,width:1000,height:800};anchor.basePadding='12px';anchor.style.paddingBottom='12px';f.document.body.append(anchor);
  const editor=f.document.createElement('section');anchor.append(editor);
  const dialog=f.document.createElement('section');f.document.body.append(dialog);const dock=new FindDock(dialog,editor);
  const rect=()=>Object.fromEntries(['left','top','width','height'].map(key=>[key,Number.parseFloat(dialog.style[key])]));
  return {...f,anchor,editor,dialog,dock,observers,rect,handle:dialog.querySelector('.syp-find-dock-resize'),close(){dock.destroy();for(const[key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value}f.close()}};
}
test('bottom panel fits the document center and leaves room above even in a short viewport',()=>{
  assert.deepEqual(fitFindDock({left:250,top:50,width:1000,height:800},350),{left:250,top:500,width:1000,height:350});
  assert.equal(fitFindDock({left:250,top:50,width:1000,height:800},9999).height,680);
  const tiny=fitFindDock({left:0,top:0,width:300,height:200},500);assert.ok(tiny.height<200);assert.ok(tiny.top>0);
});
test('mounting aligns beside the sidebar, reserves editor height and keeps existing padding intact',()=>{
  const f=fixture();try{
    assert.deepEqual(f.rect(),{left:250,top:466,width:1000,height:384});assert.equal(f.anchor.style.getPropertyValue('--syp-find-height'),'384px');
    assert.equal(f.anchor.style.getPropertyValue('--syp-find-base-padding'),'12px');assert.equal(f.anchor.style.paddingBottom,'12px');assert.equal(f.anchor.classList.contains('syp-find-host'),true);
  }finally{f.close()}
});
test('dragging the top edge changes panel height and reserved space while keeping its bottom fixed',()=>{
  const f=fixture();try{
    const down=event('pointerdown');f.handle.dispatchEvent(down);assert.equal(down.defaultPrevented,true);
    f.win.dispatchEvent(event('pointermove',{clientY:400}));assert.equal(f.rect().height,484);assert.equal(f.rect().top+f.rect().height,850);
    assert.equal(f.anchor.style.getPropertyValue('--syp-find-height'),'484px');f.win.dispatchEvent(event('pointerup'));assert.equal(f.handle.captures.size,0);assert.equal(f.win.listenerCount,1);
  }finally{f.close()}
});
test('sidebar and viewport changes reposition the panel; keyboard adjustment and double click obey limits',()=>{
  const f=fixture();try{
    f.anchor.rect.left=350;f.anchor.rect.width=900;f.observers[0].callback();assert.equal(f.rect().left,350);assert.equal(f.rect().width,900);
    f.handle.dispatchEvent(event('keydown',{key:'End'}));assert.equal(f.rect().height,680);
    f.handle.dispatchEvent(event('keydown',{key:'Home'}));assert.equal(f.rect().height,240);
    f.handle.dispatchEvent(event('dblclick'));assert.equal(f.rect().height,384);
    f.win.innerHeight=500;f.win.dispatchEvent(new Event('resize'));assert.ok(f.rect().top+f.rect().height<=500);
  }finally{f.close()}
});
test('replacing the editor layout transfers reserved space to the new center',()=>{
  const f=fixture();try{
    f.anchor.remove();const replacement=f.document.createElement('div');replacement.className='layout__center';replacement.rect={left:200,top:50,width:1100,height:800};f.document.body.append(replacement);
    f.observers[1].callback();assert.equal(f.anchor.classList.contains('syp-find-host'),false);assert.equal(replacement.classList.contains('syp-find-host'),true);assert.equal(f.rect().left,200);
    f.dock.destroy();assert.equal(replacement.classList.contains('syp-find-host'),false);
  }finally{f.close()}
});
test('closing during a drag releases capture, all listeners, observers and reserved editor space',()=>{
  const f=fixture();try{
    f.handle.dispatchEvent(event('pointerdown'));const rect=f.rect();f.dock.destroy();
    assert.equal(f.handle.captures.size,0);assert.equal(f.win.listenerCount,0);assert.equal(f.handle.listenerCount,0);assert.ok(f.observers.every(observer=>observer.disconnected));
    assert.equal(f.anchor.classList.contains('syp-find-host'),false);assert.equal(f.anchor.style.getPropertyValue('--syp-find-height'),'');assert.equal(f.anchor.style.paddingBottom,'12px');
    f.observers[0].callback();f.win.dispatchEvent(event('pointermove',{clientY:0}));assert.deepEqual(f.rect(),rect);
  }finally{f.close()}
});
