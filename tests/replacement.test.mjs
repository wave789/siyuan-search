import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTexts, DEFAULT_OPTIONS } from '../src/search/matcher.ts';
import { applyTextEdits } from '../src/replace/edits.ts';
import { build } from 'esbuild';

// Bundle the service to exercise its actual TypeScript, including class parameter properties.
const bundled=await build({entryPoints:['src/replace/service.ts'],bundle:true,write:false,format:'esm',target:'es2022'});
const {ReplacementService,ReplacementFailure}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const find=async(texts,query,options,signal,limit,replacement)=>{if(signal.aborted)throw new DOMException('aborted','AbortError');return matchTexts(texts,query,options,limit,replacement)};
const signal=()=>new AbortController().signal;
function memoryBackend(items){
  const records=new Map(items.map(item=>[item.id,{box:'box-a',root:'doc-a',...item}]));
  const state={writes:[],records,prepareCount:0,refreshes:0,beforeWrite:null,afterWrite:null};
  const backend={
    find,
    async prepare(){state.prepareCount++},
    async *candidates(scope){
      const blocks=[...records.values()].filter(item=>(!scope.root||item.root===scope.root)&&(!scope.notebook||item.box===scope.notebook)).map(item=>({id:item.id,root_id:item.root,box:item.box,type:item.title?'d':'p',content:item.text}));
      for(let index=0;index<blocks.length;index+=500)yield blocks.slice(index,index+500);
    },
    async read(target){
      const item=records.get(target.id);if(!item)throw new Error('deleted block');
      const raw=JSON.stringify({text:item.text,format:item.format||'paragraph'});
      return {target,raw,text:item.text,apply:edits=>JSON.stringify({text:applyTextEdits(item.text,edits),format:item.format||'paragraph'})};
    },
    async write(change,raw){
      await state.beforeWrite?.(change,raw);
      const item=records.get(change.target.id),next=JSON.parse(raw);item.text=next.text;item.format=next.format;
      state.writes.push({id:item.id,text:item.text});await state.afterWrite?.(change,raw);
      return raw;
    },
    changed(){state.refreshes++},
  };
  return {service:new ReplacementService(backend),backend,state};
}
const request=(extra={})=>({query:'cat',options:{...DEFAULT_OPTIONS},replacement:'dog',scope:{},...extra});

test('replacement templates expand IDE capture groups, named groups, dollars and newlines',()=>{
  const result=matchTexts(['cat-42'], '(?<name>cat)-(\\d+)', {...DEFAULT_OPTIONS,regex:true},10,'${name}:$2:$<name>:$&:$0:$$:\\n');
  assert.equal(result.blocks[0].matches[0].replacement,'cat:42:cat:cat-42:cat-42:$:\n');
  assert.equal(matchTexts(['cat'],'cat',DEFAULT_OPTIONS,10,'$1\\n').blocks[0].matches[0].replacement,'$1\\n');
  assert.equal(matchTexts(['b'],'(a)?b',{...DEFAULT_OPTIONS,regex:true},10,'$1-$2-$10').blocks[0].matches[0].replacement,'-$2-0');
});

test('text edits run backwards, support deletion and reject stale/overlapping ranges',()=>{
  assert.equal(applyTextEdits('😀 cat cat',[{start:3,end:6,replacement:'kitten'},{start:7,end:10,replacement:''}]),'😀 kitten ');
  assert.throws(()=>applyTextEdits('abcdef',[{start:1,end:4,replacement:'x'},{start:3,end:5,replacement:'y'}]),/失效/);
});

test('single replacement changes exactly the selected occurrence and undo restores it',async()=>{
  const {service,state}=memoryBackend([{id:'p1',text:'cat cat',format:'bold-link'}]);
  const result=await service.replace(request({target:{id:'p1',root:'doc-a',selected:{text:'cat cat',start:4,end:7}}}),signal());
  assert.equal(state.records.get('p1').text,'cat dog');assert.equal(state.records.get('p1').format,'bold-link');
  assert.deepEqual(result,{count:1,blocks:1,documents:1});assert.equal(service.canUndo,true);
  assert.equal(await service.undo(signal()),1);assert.equal(state.records.get('p1').text,'cat cat');assert.equal(service.canUndo,false);
});

test('whole-word/case rules and scope are preserved during replace all',async()=>{
  const {service,state}=memoryBackend([{id:'p1',text:'cat Cat category my_cat cat2'},{id:'p2',text:'cat',root:'doc-b'},{id:'p3',text:'cat',box:'box-b'}]);
  const result=await service.replace(request({scope:{root:'doc-a',notebook:'box-a'},options:{...DEFAULT_OPTIONS,wholeWord:true,caseSensitive:true}}),signal());
  assert.equal(result.count,1);assert.equal(state.records.get('p1').text,'dog Cat category my_cat cat2');
  assert.equal(state.records.get('p2').text,'cat');assert.equal(state.records.get('p3').text,'cat');
});

test('global replace all is not capped at the UI preview limit of 1,000',async()=>{
  const items=Array.from({length:1007},(_,n)=>({id:`p${n}`,root:`doc-${n%3}`,text:'cat'}));
  const {service,state}=memoryBackend(items);
  const result=await service.replace(request(),signal());
  assert.deepEqual(result,{count:1007,blocks:1007,documents:3});
  assert.equal([...state.records.values()].filter(row=>row.text==='dog').length,1007);
});

test('replacement containing the query is applied once, including Unicode and deletion',async()=>{
  const {service,state}=memoryBackend([{id:'p1',text:'cat cat'}]);
  assert.equal((await service.replace(request({replacement:'catcat'}),signal())).count,2);
  assert.equal(state.records.get('p1').text,'catcat catcat');
  assert.equal((await service.replace(request({replacement:''}),signal())).count,4);
  assert.equal(state.records.get('p1').text,' ');
});

test('regex replacement keeps full match context for lookbehind and captures',async()=>{
  const {service,state}=memoryBackend([{id:'p1',text:'id:42 id:7'}]);
  await service.replace(request({query:'(?<=id:)(\\d+)',replacement:'[$1]',options:{...DEFAULT_OPTIONS,regex:true}}),signal());
  assert.equal(state.records.get('p1').text,'id:[42] id:[7]');
});

test('stale selected text is rejected before any mutation',async()=>{
  const {service,state}=memoryBackend([{id:'p1',text:'cat changed'}]);
  await assert.rejects(service.replace(request({target:{id:'p1',root:'doc-a',selected:{text:'cat',start:0,end:3}}}),signal()),/原文已变化/);
  assert.equal(state.writes.length,0);assert.equal(service.canUndo,false);
});

test('concurrent edits between planning and commit stop the batch before overwrite',async()=>{
  const {service,state,backend}=memoryBackend([{id:'p1',text:'cat'}]);
  const read=backend.read;let reads=0;
  backend.read=async target=>{if(++reads===2)state.records.get('p1').text='concurrent note';return read(target)};
  await assert.rejects(service.replace(request(),signal()),/原文在搜索后/);
  assert.equal(state.records.get('p1').text,'concurrent note');assert.equal(state.writes.length,0);
});

test('partial failures retain undo data and report the exact confirmed count',async()=>{
  const {service,state}=memoryBackend([{id:'p1',text:'cat'},{id:'p2',text:'cat'}]);
  state.beforeWrite=async change=>{if(change.target.id==='p2')throw new Error('kernel write failed')};
  await assert.rejects(service.replace(request(),signal()),error=>error instanceof ReplacementFailure&&error.result.count===1&&/可使用撤销/.test(error.message));
  state.beforeWrite=null;
  assert.equal(await service.undo(signal()),1);assert.equal(state.records.get('p1').text,'cat');assert.equal(state.records.get('p2').text,'cat');
});

test('undo refuses to overwrite edits made after replacement',async()=>{
  const {service,state}=memoryBackend([{id:'p1',text:'cat'}]);
  await service.replace(request(),signal());state.records.get('p1').text='later edit';
  await assert.rejects(service.undo(signal()),/又被编辑/);assert.equal(state.records.get('p1').text,'later edit');assert.equal(service.canUndo,true);
});

test('cancel waits for the in-flight write and never starts the next block',async()=>{
  const {service,state}=memoryBackend([{id:'p1',text:'cat'},{id:'p2',text:'cat'}]);
  const controller=new AbortController();state.afterWrite=async()=>controller.abort();
  await assert.rejects(service.replace(request(),controller.signal),error=>error.result.count===1&&/已停止/.test(error.message));
  assert.equal(state.records.get('p1').text,'dog');assert.equal(state.records.get('p2').text,'cat');
  state.afterWrite=null;assert.equal(await service.undo(signal()),1);
});

test('invalid document title aborts the entire plan before any writes',async()=>{
  const {service,state}=memoryBackend([{id:'p1',text:'cat'},{id:'doc-a',text:'cat',title:true}]);
  await assert.rejects(service.replace(request({replacement:''}),signal()),/文档标题不能为空/);
  assert.equal(state.writes.length,0);
});

test('a truncated candidate scan never silently performs a partial replace all',async()=>{
  const {service,state,backend}=memoryBackend([{id:'p1',text:'cat'}]);
  backend.find=async()=>({blocks:[{index:0,matches:[{start:0,end:3}]}],truncated:true});
  await assert.rejects(service.replace(request(),signal()),/100,000/);assert.equal(state.writes.length,0);
});

test('replacement remains busy until the index refresh finishes',async()=>{
  const {service,backend}=memoryBackend([{id:'p1',text:'cat'}]);
  let release,started;
  const refreshing=new Promise(resolve=>{started=resolve});
  backend.changed=()=>{started();return new Promise(resolve=>{release=resolve})};
  const operation=service.replace(request(),signal());await refreshing;
  assert.equal(service.busy,true);assert.equal(service.canUndo,false);
  await assert.rejects(service.replace(request(),signal()),/尚未完成/);
  release();await operation;assert.equal(service.busy,false);assert.equal(service.canUndo,true);
});

test('a failed index refresh reports committed writes and keeps undo available',async()=>{
  const {service,state,backend}=memoryBackend([{id:'p1',text:'cat'}]);
  backend.changed=async()=>{throw new Error('index offline')};
  await assert.rejects(service.replace(request(),signal()),error=>error.result.count===1&&/刷新搜索索引失败/.test(error.message));
  assert.equal(state.records.get('p1').text,'dog');assert.equal(service.canUndo,true);
  backend.changed=()=>{};assert.equal(await service.undo(signal()),1);
});

test('a lost write acknowledgement still retains the snapshot for guarded undo',async()=>{
  const {service,state}=memoryBackend([{id:'p1',text:'cat'}]);
  state.afterWrite=async()=>{throw new Error('connection lost after commit')};
  await assert.rejects(service.replace(request(),signal()),error=>error.result.count===0&&/可使用撤销/.test(error.message));
  assert.equal(state.records.get('p1').text,'dog');assert.equal(service.canUndo,true);
  state.afterWrite=null;assert.equal(await service.undo(signal()),1);assert.equal(state.records.get('p1').text,'cat');
});

test('successive replacements can both be undone when the kernel updates revision metadata',async()=>{
  const {service,state,backend}=memoryBackend([{id:'p1',text:'cat'}]);
  const read=backend.read,write=backend.write;let revision=0;
  const normalize=raw=>{const value=JSON.parse(raw);delete value.revision;return JSON.stringify(value)};
  backend.equivalent=(target,first,second)=>normalize(first)===normalize(second);
  backend.read=async target=>{
    const source=await read(target),apply=source.apply;
    return {...source,raw:JSON.stringify({...JSON.parse(source.raw),revision}),apply:edits=>JSON.stringify({...JSON.parse(apply(edits)),revision})};
  };
  backend.write=async(change,raw)=>{await write(change,raw);return JSON.stringify({...JSON.parse(raw),revision:++revision})};
  await service.replace(request(),signal());await service.replace(request({query:'dog',replacement:'fox'}),signal());
  assert.equal(state.records.get('p1').text,'fox');
  assert.equal(await service.undo(signal()),1);assert.equal(state.records.get('p1').text,'dog');
  assert.equal(await service.undo(signal()),1);assert.equal(state.records.get('p1').text,'cat');
});
