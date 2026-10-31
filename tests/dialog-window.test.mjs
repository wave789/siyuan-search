import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { defaultDialog, fitDialog, moveDialog, resizeDialog } from '../src/ui/dialog-geometry.ts';

const bundle=await build({entryPoints:['src/ui/dialog-window.ts'],bundle:true,write:false,format:'esm',target:'es2022'});
const {DialogWindow}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const viewport={width:1280,height:900};
const original={left:100,top:80,width:800,height:500};

test('dragging moves the dialog and clamps every edge inside the viewport',()=>{
  assert.deepEqual(moveDialog(original,50,60,viewport),{...original,left:150,top:140});
  assert.deepEqual(moveDialog(original,5000,5000,viewport),{...original,left:472,top:392});
  assert.deepEqual(moveDialog(original,-5000,-5000,viewport),{...original,left:8,top:8});
});

test('all eight resize handles preserve their opposite edge and enforce minimum sizes',()=>{
  for(const edge of ['n','s','e','w','ne','nw','se','sw']) {
    const rect=resizeDialog(original,edge,25,35,viewport);
    if(edge.includes('w'))assert.equal(rect.left+rect.width,original.left+original.width);
    else assert.equal(rect.left,original.left);
    if(edge.includes('n'))assert.equal(rect.top+rect.height,original.top+original.height);
    else assert.equal(rect.top,original.top);
  }
  assert.equal(resizeDialog(original,'e',-5000,0,viewport).width,480);
  assert.equal(resizeDialog(original,'s',0,-5000,viewport).height,320);
  assert.deepEqual(resizeDialog(original,'nw',5000,5000,viewport),{left:420,top:260,width:480,height:320});
  assert.deepEqual(resizeDialog(original,'se',5000,5000,viewport),{left:100,top:80,width:1172,height:812});
});

test('shrinking the host window keeps the title and resize handles reachable',()=>{
  assert.deepEqual(fitDialog({left:1000,top:700,width:1080,height:690},{width:600,height:420}),{left:8,top:8,width:584,height:404});
  const tiny=defaultDialog({width:320,height:240});
  assert.equal(tiny.width,304);assert.equal(tiny.height,224);assert.equal(tiny.left,8);assert.equal(tiny.top,8);
});

class Target extends EventTarget {
  listeners=new Map();
  addEventListener(type,fn,options){super.addEventListener(type,fn,options);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn)}
  removeEventListener(type,fn,options){super.removeEventListener(type,fn,options);this.listeners.get(type)?.delete(fn)}
  get listenerCount(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0)}
}
class Element extends Target {
  style={};dataset={};attributes=new Map();children=[];captures=new Set();classes=new Set();control=false;
  classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),toggle:(name,enabled)=>enabled?this.classes.add(name):this.classes.delete(name)};
  constructor(document){super();this.ownerDocument=document}
  closest(){return this.control?this:null}
  setAttribute(name,value){this.attributes.set(name,value)}
  append(child){child.parentNode=this;this.children.push(child)}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this)}
  setPointerCapture(id){this.captures.add(id)}
  hasPointerCapture(id){return this.captures.has(id)}
  releasePointerCapture(id){this.captures.delete(id)}
}
function fixture(){
  const win=new Target();win.innerWidth=1400;win.innerHeight=1000;
  const document={defaultView:win};document.createElement=()=>new Element(document);
  const dialog=new Element(document),header=new Element(document);dialog.append(header);
  const controller=new DialogWindow(dialog,header);
  const rect=()=>Object.fromEntries(['left','top','width','height'].map(key=>[key,Number.parseFloat(dialog.style[key])]));
  return {win,document,dialog,header,controller,rect};
}
function pointer(type,properties={},target){
  const event=new Event(type,{bubbles:true,cancelable:true});
  for(const [key,value] of Object.entries({pointerId:1,button:0,isPrimary:true,clientX:200,clientY:130,...properties,...(target?{target}:{})}))Object.defineProperty(event,key,{value});
  return event;
}

test('header dragging preserves focus by preventing the default pointer action',()=>{
  const {win,header,dialog,controller,rect}=fixture();
  const initial=rect(),down=pointer('pointerdown');header.dispatchEvent(down);
  assert.equal(down.defaultPrevented,true);assert.equal(dialog.style.cursor,'move');
  win.dispatchEvent(pointer('pointermove',{clientX:280,clientY:180}));
  assert.deepEqual(rect(),{...initial,left:initial.left+80,top:initial.top+50});
  win.dispatchEvent(pointer('pointerup'));
  assert.equal(dialog.style.cursor,'');assert.equal(header.captures.size,0);assert.equal(win.listenerCount,1);
  const settled=rect();win.dispatchEvent(pointer('pointermove',{clientX:600,clientY:600}));assert.deepEqual(rect(),settled);
  controller.destroy();assert.equal(win.listenerCount,0);
});

test('corner resizing adjusts both dimensions and switches to the compact layout',()=>{
  const {win,dialog,controller,rect}=fixture();
  const handle=dialog.children.find(node=>node.dataset.resize==='se'),initial=rect();
  handle.dispatchEvent(pointer('pointerdown',{clientX:1000,clientY:700}));
  win.dispatchEvent(pointer('pointermove',{clientX:600,clientY:500}));
  assert.deepEqual(rect(),{...initial,width:680,height:490});assert.equal(dialog.classes.has('syp-dialog--compact'),true);
  win.dispatchEvent(pointer('pointercancel'));assert.equal(handle.captures.size,0);
  controller.destroy();assert.equal(dialog.children.length,1);
});

test('interactive title buttons, secondary buttons and secondary pointers do not start dragging',()=>{
  const {win,header,document,controller,rect}=fixture();const initial=rect();
  const close=document.createElement('button');close.control=true;
  header.dispatchEvent(pointer('pointerdown',{},close));
  header.dispatchEvent(pointer('pointerdown',{button:2}));
  header.dispatchEvent(pointer('pointerdown',{isPrimary:false}));
  win.dispatchEvent(pointer('pointermove',{clientX:500,clientY:500}));assert.deepEqual(rect(),initial);assert.equal(win.listenerCount,1);
  controller.destroy();
});

test('wrong-pointer events are ignored; losing focus ends the current gesture',()=>{
  const {win,header,controller,rect}=fixture();const initial=rect();header.dispatchEvent(pointer('pointerdown'));
  win.dispatchEvent(pointer('pointermove',{pointerId:2,clientX:300,clientY:300}));
  win.dispatchEvent(pointer('pointerup',{pointerId:2}));assert.deepEqual(rect(),initial);
  win.dispatchEvent(new Event('blur'));
  win.dispatchEvent(pointer('pointermove',{clientX:300,clientY:300}));assert.deepEqual(rect(),initial);assert.equal(win.listenerCount,1);
  controller.destroy();
});

test('viewport resize clamps existing geometry and double-click resets position and size',()=>{
  const {win,header,controller,rect}=fixture();header.dispatchEvent(pointer('pointerdown'));
  win.dispatchEvent(pointer('pointermove',{clientX:350,clientY:180}));win.dispatchEvent(pointer('pointerup'));
  header.dispatchEvent(new Event('dblclick',{cancelable:true}));assert.deepEqual(rect(),defaultDialog({width:1400,height:1000}));
  win.innerWidth=500;win.innerHeight=400;win.dispatchEvent(new Event('resize'));
  const small=rect();assert.ok(small.left>=8&&small.top>=8);assert.ok(small.left+small.width<=492);assert.ok(small.top+small.height<=392);
  controller.destroy();
});

test('closing a dialog during a drag releases pointer capture and removes its listeners',()=>{
  const {win,header,dialog,controller,rect}=fixture();header.dispatchEvent(pointer('pointerdown'));
  const initial=rect();controller.destroy();
  assert.equal(win.listenerCount,0);assert.equal(header.listenerCount,0);assert.equal(header.captures.size,0);assert.equal(dialog.classes.has('syp-dialog--manipulating'),false);
  win.dispatchEvent(pointer('pointermove',{clientX:500,clientY:500}));assert.deepEqual(rect(),initial);
});
