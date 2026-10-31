import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyPreviewTree, previewURL, readingBlocks } from '../src/search/reading-preview.ts';

class Text {constructor(value){this.nodeType=3;this.textContent=value}}
class Element {
  nodeType=1;childNodes=[];dataset={};values=new Map();styles=new Map();
  constructor(tag){this.tagName=tag.toUpperCase();this.style={getPropertyValue:name=>this.styles.get(name)||'',setProperty:(name,value)=>this.styles.set(name,value)}}
  get className(){return this.getAttribute('class')||''}set className(value){this.setAttribute('class',value)}
  get classList(){return {contains:name=>this.className.split(' ').includes(name)}}
  get attributes(){return Array.from(this.values,([name,value])=>({name,value}))}
  setAttribute(name,value){this.values.set(name,value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value}
  getAttribute(name){return this.values.get(name)??null}hasAttribute(name){return this.values.has(name)}
  matches(selector){return selector.split(',').some(selector=>this.classList.contains(selector.trim().slice(1)))}
  querySelectorAll(selector){const result=[];const visit=node=>{for(const child of node.childNodes||[]){if(selector==='[data-syp-block-id]'&&child.dataset?.sypBlockId)result.push(child);visit(child)}};visit(this);return result}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  appendChild(node){this.childNodes.push(node);return node}
  get textContent(){return this.childNodes.map(child=>child.textContent).join('')}set textContent(value){this.childNodes=[new Text(value)]}
  set innerHTML(value){throw new Error('Unsafe HTML insertion')}
}
const document={createElement:tag=>{const element=new Element(tag);element.ownerDocument=document;return element},createTextNode:value=>{const text=new Text(value);text.ownerDocument=document;return text},createDocumentFragment:()=>new Element('fragment')};
document.createTreeWalker=(root,_,filter)=>{
  const nodes=[];const visit=node=>{const accepted=filter.acceptNode(node);if(accepted===2)return;if(accepted===1)nodes.push(node);for(const child of node.childNodes||[])visit(child)};
  for(const child of root.childNodes)visit(child);let index=0;return {nextNode:()=>nodes[index++]||null};
};
function node(tag,attrs={},children=[]){const element=new Element(tag);for(const[name,value]of Object.entries(attrs))element.setAttribute(name,value);for(const child of children)element.appendChild(typeof child==='string'?new Text(child):child);return element}
const copy=(...children)=>copyPreviewTree(node('body',{},children),document,'https://notes.test/stage/build/desktop/');
const root='20260102000000-bbbbbbb',paragraph='20260102000001-bbbbbbb';

test('reading HTML retains headings, paragraphs, bold text and table structure with isolated block identifiers',()=>{
  const result=copy(node('h1',{id:root},['Title']),node('p',{id:paragraph},['before ',node('strong',{},['bold'])]),node('table',{},[node('tr',{},[node('td',{},['one']),node('td',{},['two'])])]));
  assert.deepEqual(result.childNodes.map(node=>node.tagName),['H1','P','TABLE']);
  assert.equal(result.childNodes[1].childNodes[1].tagName,'STRONG');assert.equal(result.childNodes[2].childNodes[0].childNodes.length,2);
  assert.equal(result.childNodes[0].dataset.sypBlockId,root);assert.equal(result.childNodes[1].dataset.sypBlockId,paragraph);
  assert.equal(result.childNodes[0].getAttribute('id'),null);assert.equal(result.childNodes[1].getAttribute('data-node-id'),null);
});

test('scripts, editing attributes, event handlers and application-control classes never enter the reading pane',()=>{
  const result=copy(node('script',{},['bad()']),node('iframe',{src:'https://bad.test'}),node('p',{'data-node-id':paragraph,onclick:'bad()',contenteditable:'true',draggable:'true',class:'syp-modal-backdrop layout__wnd--active hljs-keyword'},['safe']),node('div',{class:'protyle-action'},['toolbar']));
  assert.equal(result.childNodes.length,1);const paragraphNode=result.childNodes[0];
  assert.equal(paragraphNode.textContent,'safe');assert.equal(paragraphNode.className,'hljs-keyword');assert.equal(paragraphNode.getAttribute('onclick'),null);
  assert.equal(paragraphNode.getAttribute('contenteditable'),null);assert.equal(paragraphNode.getAttribute('draggable'),null);assert.equal(paragraphNode.dataset.sypBlockId,paragraph);
});

test('URLs accept note assets and ordinary links while rejecting script and document data URLs',()=>{
  const base='https://notes.test/stage/app/';
  assert.equal(previewURL('assets/picture.png',base,true),'https://notes.test/assets/picture.png');
  assert.equal(previewURL('siyuan://blocks/'+paragraph,base),'siyuan://blocks/'+paragraph);
  for(const value of ['javascript:alert(1)','\nJaVaScRiPt:alert(1)','data:text/html,<script>bad()</script>','data:image/svg+xml,<svg onload="bad()"/>'])assert.equal(previewURL(value,base,true),undefined);
  assert.equal(previewURL('data:image/png;base64,YWJj',base,true),'data:image/png;base64,YWJj');
  const link=copy(node('a',{href:'https://example.test/path',target:'_self'},['site'])).childNodes[0];
  assert.equal(link.getAttribute('target'),'_blank');assert.equal(link.getAttribute('rel'),'noopener noreferrer');
});

test('only presentation styles are copied and URL or executable CSS is discarded',()=>{
  const source=node('span');for(const[name,value]of Object.entries({color:'var(--b3-font-color8)','font-weight':'bold',width:'80%',position:'fixed',height:'expression(bad())','background-color':'url(https://bad.test/x)'}))source.styles.set(name,value);
  const result=copy(source).childNodes[0];
  assert.deepEqual(Object.fromEntries(result.styles),{color:'var(--b3-font-color8)','font-weight':'bold',width:'80%'});
});

test('task checkboxes are disabled and media cannot autoplay or preload the document',()=>{
  const result=copy(node('input',{type:'checkbox',checked:'',onchange:'bad()'}),node('input',{type:'password'}),node('video',{src:'/assets/video.mp4',autoplay:'',onplay:'bad()'}));
  assert.equal(result.childNodes.length,2);assert.equal(result.childNodes[0].hasAttribute('disabled'),true);assert.equal(result.childNodes[0].hasAttribute('checked'),true);
  const video=result.childNodes[1];assert.equal(video.hasAttribute('controls'),true);assert.equal(video.getAttribute('preload'),'none');assert.equal(video.hasAttribute('autoplay'),false);assert.equal(video.getAttribute('onplay'),null);
});

test('dynamic database blocks have a readable placeholder instead of interactive editor controls',()=>{
  const result=copy(node('div',{class:'av','data-type':'NodeAttributeView'},[node('button',{},['edit'])]));
  assert.equal(result.childNodes.length,1);assert.equal(result.childNodes[0].tagName,'P');assert.match(result.textContent,/数据库/);
});

test('literal HTML text stays text and internal anchors are scoped to the preview',()=>{
  const result=copy(node('code',{},['<img onerror="bad()">']),node('a',{href:'#'+paragraph},['jump']));
  assert.equal(result.childNodes[0].childNodes.length,1);assert.equal(result.childNodes[0].childNodes[0].nodeType,3);assert.equal(result.childNodes[0].textContent,'<img onerror="bad()">');
  assert.equal(result.childNodes[1].dataset.sypHash,paragraph);assert.equal(result.childNodes[1].getAttribute('href'),'#');
});

test('search indexing reads isolated block IDs and counts nested paragraph text only once',()=>{
  const saved=new Map(['Node','NodeFilter'].map(key=>[key,globalThis[key]]));globalThis.Node={ELEMENT_NODE:1};globalThis.NodeFilter={SHOW_TEXT:4,SHOW_ELEMENT:1,FILTER_ACCEPT:1,FILTER_REJECT:2,FILTER_SKIP:3};
  try{
    const fragment=copy(node('h1',{id:root},['Title']),node('ul',{id:'20260102000003-bbbbbbb'},[node('li',{},[node('p',{id:paragraph},['Hello ',node('strong',{},['Search'])])])]));
    assert.deepEqual(readingBlocks(fragment).map(({id,text})=>({id,text})),[{id:root,text:'Title'},{id:paragraph,text:'Hello Search'}]);
  }finally{for(const[key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});
