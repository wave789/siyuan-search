import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntaxSpans, loadSyntaxEngine } from '../src/search/syntax.ts';

test('syntax scopes preserve Unicode offsets and nested coloring without parsing note HTML',()=>{
  const source='😀 def helper()';
  assert.deepEqual(syntaxSpans(source,'😀 <span class="hljs-keyword">def</span> <span class="hljs-title function_">helper</span>()'),[
    {start:3,end:6,classes:'hljs-keyword'},{start:7,end:13,classes:'hljs-title'},
  ]);
});

test('escaped markup, quotes and literal entity text round-trip as text',()=>{
  const source='<img onerror="x"> &lt; \'x\' 😀';
  const result=syntaxSpans(source,'<span class="hljs-string">&lt;img onerror=&quot;x&quot;&gt; &amp;lt; &#x27;x&#39; &#128512;</span>');
  assert.deepEqual(result,[{start:0,end:source.length,classes:'hljs-string'}]);
});

test('multiline tokens and nested scopes retain source positions across blank lines',()=>{
  assert.deepEqual(syntaxSpans('a\n\nb','<span class="hljs-comment">a\n<span class="hljs-doctag">\n</span>b</span>'),[
    {start:0,end:2,classes:'hljs-comment'},{start:2,end:3,classes:'hljs-comment hljs-doctag'},{start:3,end:4,classes:'hljs-comment'},
  ]);
});

test('unexpected HTML, unbalanced scopes or changed source leave the original preview uncolored',()=>{
  for(const html of ['<script>x</script>','<img src=x>','<span class="hljs-keyword">x','</span>x','<span onclick="x">x</span>','changed']){
    assert.equal(syntaxSpans('x',html),undefined,html);
  }
  assert.deepEqual(syntaxSpans('x','<span class="untrusted syp-button">x</span>'),[]);
});

test('an already available syntax engine needs no editor initialization or asset request',async()=>{
  const original=globalThis.window,engine={getLanguage(){},highlight(){}};globalThis.window={hljs:engine};
  try{assert.equal(await loadSyntaxEngine(()=>{throw new Error('Must not load assets')}),engine)}finally{if(original===undefined)delete globalThis.window;else globalThis.window=original}
});

test('syntax bootstrapping uses a detached plaintext sample and never mounts a native editor',async()=>{
  const originalWindow=globalThis.window,originalDocument=globalThis.document;
  const element=tag=>({tag,className:'',attributes:{},children:[],setAttribute(name,value){this.attributes[name]=value},append(child){this.children.push(child)}});
  globalThis.window={};globalThis.document={createElement:element};const engine={getLanguage(){},highlight(){}};let sample;
  try{
    assert.equal(await loadSyntaxEngine(root=>{sample=root;globalThis.window.hljs=engine}),engine);
    assert.equal(sample.className,'b3-typography');assert.equal(sample.children[0].attributes['data-language'],'plaintext');assert.equal(sample.children[0].children[0].textContent,' ');
  }finally{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument}
});
