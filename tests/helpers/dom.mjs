export class Target extends EventTarget {
  listeners=new Map();
  addEventListener(type,fn,options){super.addEventListener(type,fn,options);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn)}
  removeEventListener(type,fn,options){super.removeEventListener(type,fn,options);this.listeners.get(type)?.delete(fn)}
  get listenerCount(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0)}
}
class Style {
  values=new Map();setProperty(key,value){this.values.set(key,value)}removeProperty(key){this.values.delete(key)}getPropertyValue(key){return this.values.get(key)||''}
}
export class Element extends Target {
  children=[];parentElement=null;className='';style=new Style();dataset={};attributes=new Map();raw='';scrollTop=0;scrollLeft=0;clientHeight=500;clientWidth=1000;nodeType=1;hidden=false;captures=new Set();value='';
  constructor(document,tag='div'){super();this.ownerDocument=document;this.tagName=tag.toUpperCase()}
  classList={contains:name=>this.className.split(' ').includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ')},remove:(...names)=>{this.className=this.className.split(' ').filter(name=>!names.includes(name)).join(' ')},toggle:(name,on)=>{if(on===undefined)on=!this.classList.contains(name);if(on)this.classList.add(name);else this.classList.remove(name);return on}};
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='id')this.id=value;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=value}
  getAttribute(name){if(name==='id')return this.id||null;if(name.startsWith('data-'))return this.dataset[name.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]??null;return this.attributes.get(name)??null}
  removeAttribute(name){this.attributes.delete(name)}hasAttribute(name){return this.getAttribute(name)!==null}
  append(...children){for(const child of children){if(child.nodeType===11){this.append(...[...child.children]);continue}child.remove?.();child.parentElement=this;this.children.push(child)}}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.raw='';this.append(...children)}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null}
  get isConnected(){return this===this.ownerDocument.body||!!this.parentElement?.isConnected}
  set textContent(value){this.replaceChildren();this.raw=value}get textContent(){return this.raw+this.children.map(child=>child.textContent).join('')}
  matches(selector){return selector.split(',').some(part=>{const query=part.trim();const tag=query.match(/^[a-z][\w-]*/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;for(const name of query.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(name[1]))return false;for(const attr of query.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)){const value=this.getAttribute(attr[1]);if(value===null||(attr[2]!==undefined&&value!==attr[2]))return false}return true})}
  querySelectorAll(selector){const found=[];const visit=node=>{for(const child of node.children){if(child.nodeType===1&&child.matches(selector))found.push(child);visit(child)}};visit(this);return found}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null}
  contains(target){for(let node=target;node;node=node.parentElement)if(node===this)return true;return false}
  focus(options){this.ownerDocument.activeElement=this;this.focusOptions=options}select(){}
  getClientRects(){return [this.getBoundingClientRect()]}
  getBoundingClientRect(){const {left=0,top=0,width=1000,height=700}=this.rect||{};return {left,top,width,height,right:left+width,bottom:top+height}}
  setPointerCapture(id){this.captures.add(id)}hasPointerCapture(id){return this.captures.has(id)}releasePointerCapture(id){this.captures.delete(id)}
}
export function dom(){
  const document=new Target(),win=new Target();win.innerWidth=1500;win.innerHeight=1000;win.getComputedStyle=node=>({paddingBottom:node.basePadding||'0px'});win.getSelection=()=>null;
  document.defaultView=win;document.createElement=tag=>new Element(document,tag);document.createElementNS=(_,tag)=>document.createElement(tag);
  document.createDocumentFragment=()=>{const node=new Element(document);node.nodeType=11;return node};
  document.createTextNode=text=>{const node=new Element(document,'text');node.nodeType=3;node.raw=text;return node};
  document.body=document.createElement('body');document.activeElement=document.body;document.querySelector=selector=>document.body.querySelector(selector);
  const saved=new Map(['document','window','Node'].map(key=>[key,globalThis[key]]));Object.assign(globalThis,{document,window:win,Node:Element});
  return {document,win,close(){for(const[key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}};
}
export function event(type,properties={}){const event=new Event(type,{cancelable:true,bubbles:true});for(const[key,value]of Object.entries({pointerId:1,button:0,isPrimary:true,clientX:300,clientY:500,...properties}))Object.defineProperty(event,key,{value});return event}
