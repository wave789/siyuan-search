import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingLine, relativeResultPath, previewFileLocation } from '../src/search/result-presentation.ts';
import { buildPreviewDocument, preparePreview, locatePreviewTarget, previewLineAt } from '../src/search/preview-model.ts';
import { matchTexts, DEFAULT_OPTIONS } from '../src/search/matcher.ts';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after } from 'node:test';
const notebooks=new Map([['box','笔记本']]);
const indexed=(id='p',content='Search Search')=>({id,root_id:'doc',box:'box',hpath:'/目录/文档',type:'p',content});
const prepare=(document,query,options=DEFAULT_OPTIONS)=>preparePreview(document,matchTexts(document.blocks.map(block=>block.text),query,options,100000));

test('preview header separates a Unicode filename from its notebook and directory without duplication',()=>{
  assert.deepEqual(previewFileLocation('我的笔记本/项目/设计说明'),{name:'设计说明',directory:'我的笔记本/项目'});
  assert.deepEqual(previewFileLocation('/笔记本//😀 文档/'),{name:'😀 文档',directory:'笔记本'});
});

test('root-level documents and missing display paths have explicit header fallbacks',()=>{
  assert.deepEqual(previewFileLocation('笔记本/文档'),{name:'文档',directory:'笔记本'});
  assert.deepEqual(previewFileLocation('文档'),{name:'文档',directory:'/'});
  assert.deepEqual(previewFileLocation(''),{name:'未命名文档',directory:'/'});
});

test('result paths are relative to all notebooks, the selected notebook, or the document',()=>{
  const block=indexed();
  assert.equal(relativeResultPath(block,{},notebooks),'笔记本/目录/文档');
  assert.equal(relativeResultPath(block,{notebook:'box'},notebooks),'目录/文档');
  assert.equal(relativeResultPath(block,{root:'doc'},notebooks),'文档');
  assert.equal(relativeResultPath({...block,hpath:'',type:'d',content:'标题'},{root:'doc'},notebooks),'标题');
});

test('the result snippet is the whole matching line with the correct local highlight offsets',()=>{
  const prefix='x'.repeat(200);const text=`previous\n${prefix}Search ending\nnext`;
  const result=matchingLine(text,{start:9+prefix.length,end:15+prefix.length});
  assert.equal(result.text,`${prefix}Search ending`);assert.deepEqual(result.match,{start:200,end:206});assert.equal(result.line,2);assert.equal(result.column,201);
});

test('multiline, newline and Unicode matches retain their first matching line',()=>{
  const text='😀 Search\nsecond Search';
  assert.equal(matchingLine(text,{start:3,end:15}).text,'😀 Search');
  assert.equal(matchingLine(text,{start:3,end:9}).column,3);
  assert.equal(matchingLine(text,{start:9,end:10}).newline,true);
  assert.equal(matchingLine('\ncat',{start:0,end:1}).text,'');
});

test('the full document contains the title and every block, including long code and the last line',()=>{
  const code=Array.from({length:2500},(_,n)=>`line ${n}`).join('\n');
  const document=buildPreviewDocument('doc','标题',[{id:'p',text:'first'},{id:'c',text:code,language:'python'},{id:'tail',text:'THE END'}]);
  assert.equal(document.blocks[2].language,'python');
  assert.equal(document.lines.length,2503);assert.equal(document.lines.at(-1).text,'THE END');
  assert.ok(document.text.includes('line 2400'));assert.ok(document.text.endsWith('THE END'));
  assert.equal(document.blocks.at(-1).offset,document.text.indexOf('THE END'));
});

test('container/root duplication does not duplicate the title or paragraph text',()=>{
  const document=buildPreviewDocument('doc','title',[{id:'doc',text:'wrong duplicate'},{id:'p',text:'body'},{id:'p',text:'wrong duplicate'}]);
  assert.equal(document.text,'title\nbody');assert.equal(document.blocks.length,2);
});

test('the selected second occurrence is focused, while every document occurrence is highlighted',()=>{
  const document=buildPreviewDocument('doc','Search title',[{id:'before',text:'Search'},{id:'p',text:'Search Search'},{id:'after',text:'Search'}]);
  const preview=prepare(document,'Search');
  assert.equal(preview.matches.length,5);
  const target=locatePreviewTarget(preview,{block:indexed(),match:{start:7,end:13},ordinal:1});
  assert.equal(target.line,2);assert.equal(target.column,8);assert.equal(target.match.start,7);
  assert.equal(target.offset,document.blocks[2].offset+7);
  assert.equal(preview.lines[2].spans.length,2);
});

test('normalized block text uses the occurrence ordinal instead of jumping to the document first hit',()=>{
  const document=buildPreviewDocument('doc','Search title',[{id:'p',text:'Search Search'}]);
  const target=locatePreviewTarget(prepare(document,'Search'),{block:indexed('p','**Search** Search'),match:{start:11,end:17},ordinal:1});
  assert.equal(target.line,1);assert.equal(target.column,8);assert.equal(target.match.start,7);
});

test('stale matches focus their original block and report a refresh notice',()=>{
  const document=buildPreviewDocument('doc','title',[{id:'before',text:'Search'},{id:'p',text:'edited text'}]);
  const target=locatePreviewTarget(prepare(document,'Search'),{block:indexed(),match:{start:0,end:6},ordinal:0});
  assert.equal(target.line,2);assert.equal(target.match,undefined);assert.match(target.warning,/内容已变化/);
});

test('regex matches crossing lines and empty lines produce safe, clipped line highlights',()=>{
  const document=buildPreviewDocument('doc','title',[{id:'p',text:'abc\n\ndef'}]);
  const preview=prepare(document,'bc[\\s\\S]*de',{...DEFAULT_OPTIONS,regex:true});
  assert.equal(preview.matches.length,1);assert.equal(preview.lines[1].spans[0].start,1);
  assert.equal(preview.lines[2].spans[0].newline,true);assert.equal(preview.lines[3].spans[0].end,2);
  assert.equal(previewLineAt(document,document.text.length),3);
});

test('match highlighting caps never truncate the document itself',()=>{
  const document=buildPreviewDocument('doc','title',[{id:'p',text:'cat '.repeat(1005)},{id:'end',text:'complete tail'}]);
  const preview=preparePreview(document,matchTexts(document.blocks.map(block=>block.text),'cat',DEFAULT_OPTIONS,1000));
  assert.equal(preview.truncated,true);assert.equal(preview.matches.length,1000);assert.ok(preview.document.text.endsWith('complete tail'));
});

const directory=await mkdtemp(join(tmpdir(),'siyuan-preview-store-'));after(()=>rm(directory,{recursive:true,force:true}));
const bundled=await build({entryPoints:['src/search/preview-store.ts'],bundle:true,write:false,format:'esm',target:'es2022',define:{__SEARCH_WORKER_SOURCE__:JSON.stringify('')}});
const file=join(directory,'store.mjs');await writeFile(file,bundled.outputFiles[0].text);const {PreviewStore}=await import(pathToFileURL(file).href);
const finder=async(texts,query,options,signal,limit)=>{if(signal.aborted)throw new DOMException('Aborted','AbortError');return matchTexts(texts,query,options,limit)};
const selected=(root='doc')=>({block:{...indexed(),root_id:root},match:{start:0,end:6},ordinal:0});
const documentFor=root=>buildPreviewDocument(root,'title',[{id:'p',text:'Search Search'}]);

test('preview caches the full document and highlights when switching matches in the same file',async()=>{
  let loads=0,finds=0;
  const store=new PreviewStore({load:async value=>{loads++;return documentFor(value.block.root_id)},find:async(...args)=>{finds++;return finder(...args)}});
  const first=await store.get(selected(),'Search',DEFAULT_OPTIONS,new AbortController().signal);
  const second=await store.get({...selected(),match:{start:7,end:13},ordinal:1},'Search',DEFAULT_OPTIONS,new AbortController().signal);
  assert.equal(first,second);assert.equal(loads,1);assert.equal(finds,1);store.reset();
});

test('rapid selection in the same file shares its in-flight full-document request',async()=>{
  let release,loads=0;const loaded=new Promise(resolve=>{release=resolve});
  const store=new PreviewStore({load:async()=>{loads++;return loaded},find:finder});
  const controller=new AbortController();const first=store.get(selected(),'Search',DEFAULT_OPTIONS,controller.signal).catch(error=>error.name);
  controller.abort();const second=store.get(selected(),'Search',DEFAULT_OPTIONS,new AbortController().signal);
  release(documentFor('doc'));assert.equal(await first,'AbortError');assert.equal((await second).document.rootId,'doc');assert.equal(loads,1);store.reset();
});

test('switching documents cancels the previous request and cannot return stale content',async()=>{
  const signals=new Map();
  const store=new PreviewStore({load:(value,signal)=>{signals.set(value.block.root_id,signal);return value.block.root_id==='old'?new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))):Promise.resolve(documentFor('new'))},find:finder});
  const old=store.get(selected('old'),'Search',DEFAULT_OPTIONS,new AbortController().signal).catch(error=>error.name);
  const current=await store.get(selected('new'),'Search',DEFAULT_OPTIONS,new AbortController().signal);
  assert.equal(signals.get('old').aborted,true);assert.equal(await old,'AbortError');assert.equal(current.document.rootId,'new');store.reset();
});

test('query/options changes recompute highlights and resetting after replacement reloads the document',async()=>{
  let loads=0,finds=0;const store=new PreviewStore({load:async()=>{loads++;return documentFor('doc')},find:async(...args)=>{finds++;return finder(...args)}});
  await store.get(selected(),'Search',DEFAULT_OPTIONS,new AbortController().signal);
  const changed=await store.get(selected(),'search',{...DEFAULT_OPTIONS,caseSensitive:true},new AbortController().signal);
  assert.equal(changed.matches.length,0);assert.equal(loads,1);assert.equal(finds,2);
  store.reset();await store.get(selected(),'Search',DEFAULT_OPTIONS,new AbortController().signal);assert.equal(loads,2);store.reset();
});

test('failed full-document requests can be retried and reset cancels pending reads',async()=>{
  let attempt=0;const store=new PreviewStore({load:async()=>{if(!attempt++)throw new Error('offline');return documentFor('doc')},find:finder});
  await assert.rejects(store.get(selected(),'Search',DEFAULT_OPTIONS,new AbortController().signal),/offline/);
  assert.equal((await store.get(selected(),'Search',DEFAULT_OPTIONS,new AbortController().signal)).matches.length,2);store.reset();
  let signal;const pending=new PreviewStore({load:(value,inner)=>{signal=inner;return new Promise((resolve,reject)=>inner.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))},find:finder});
  const result=pending.get(selected(),'Search',DEFAULT_OPTIONS,new AbortController().signal).catch(error=>error.name);pending.reset();assert.equal(signal.aborted,true);assert.equal(await result,'AbortError');
});
