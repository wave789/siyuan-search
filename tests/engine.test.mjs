import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Worker as Thread } from 'node:worker_threads';
import { resolveObjectURL } from 'node:buffer';
import { build } from 'esbuild';
import { DEFAULT_OPTIONS } from '../src/search/matcher.ts';

const worker = await build({entryPoints:['src/search/worker.ts'],bundle:true,write:false,format:'iife',target:'es2022'});
const engine = await build({entryPoints:['src/search/engine.ts'],bundle:true,write:false,format:'esm',target:'es2022',define:{__SEARCH_WORKER_SOURCE__:JSON.stringify(worker.outputFiles[0].text)}});
const {searchTexts}=await import(`data:text/javascript;base64,${Buffer.from(engine.outputFiles[0].text).toString('base64')}`);
const originalWorker=globalThis.Worker;
const threads=new Set();
// Adapt the browser messaging protocol to real Node workers, without replacing the matching code.
class BrowserWorker {
  constructor(url){this.source=resolveObjectURL(url).text();this.closed=false}
  async postMessage(value){
    const source=await this.source;
    if(this.closed)return;
    this.thread=new Thread(`const { parentPort } = require('node:worker_threads'); globalThis.postMessage = data => parentPort.postMessage(data); ${source}; parentPort.on('message', data => globalThis.onmessage({data}));`,{eval:true});
    threads.add(this.thread);
    this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',error=>this.onerror?.(error));this.thread.postMessage(value);
  }
  terminate(){this.closed=true;if(this.thread){threads.delete(this.thread);void this.thread.terminate()}}
}
globalThis.Worker=BrowserWorker;
after(()=>{globalThis.Worker=originalWorker;for(const thread of threads)void thread.terminate()});

test('actual worker returns UTF-16 ranges for formatted text and Unicode',async()=>{
  const result=await searchTexts(['😀 Search SEARCH','searchable'],'Search',{...DEFAULT_OPTIONS,wholeWord:true},new AbortController().signal);
  assert.deepEqual(result.blocks,[{index:0,matches:[{start:3,end:9},{start:10,end:16}]}]);
});

test('worker syntax errors are actionable',async()=>{
  await assert.rejects(searchTexts(['text'],'[',{...DEFAULT_OPTIONS,regex:true},new AbortController().signal),/正则表达式无效/);
});

test('aborted requests stop workers and stale work cannot complete',async()=>{
  const controller=new AbortController();
  const result=searchTexts(['a'.repeat(100000)+'!'],'(a+)+$',{...DEFAULT_OPTIONS,regex:true},controller.signal);
  controller.abort();
  await assert.rejects(result,{name:'AbortError'});
  assert.equal(threads.size,0);
  await assert.rejects(searchTexts(['a'],'a',DEFAULT_OPTIONS,controller.signal),{name:'AbortError'});
});

test('catastrophic regex times out and a subsequent search still succeeds',async()=>{
  const started=performance.now();
  await assert.rejects(searchTexts(['a'.repeat(40000)+'!'],'(a+)+$',{...DEFAULT_OPTIONS,regex:true},new AbortController().signal),/耗时过长/);
  assert.ok(performance.now()-started<4000);
  assert.equal(threads.size,0);
  const result=await searchTexts(['Search'],'Search',DEFAULT_OPTIONS,new AbortController().signal);
  assert.equal(result.blocks[0].matches.length,1);
});

test('replacement templates are expanded by the actual worker for each match',async()=>{
  const result=await searchTexts(['id:42 id:7'],'(?<=id:)(\\d+)',{...DEFAULT_OPTIONS,regex:true},new AbortController().signal,100000,'value-$1');
  assert.deepEqual(result.blocks[0].matches,[{start:3,end:5,replacement:'value-42'},{start:9,end:10,replacement:'value-7'}]);
});
