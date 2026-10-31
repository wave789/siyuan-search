import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { matchTexts, DEFAULT_OPTIONS } from '../src/search/matcher.ts';

const bundled=await build({stdin:{contents:'export { createReplacementBackend } from "./src/replace/backend.ts"; export { ReplacementService } from "./src/replace/service.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',target:'es2022',define:{__SEARCH_WORKER_SOURCE__:JSON.stringify('')}});
const {createReplacementBackend,ReplacementService}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('actual kernel backend renames titles and flushes asynchronous SQL indexing before completion and undo',async()=>{
  const original=globalThis.fetch;
  const note={title:'cat memo',indexed:'cat memo'};
  const calls=[];
  globalThis.fetch=async(path,request)=>{
    const body=JSON.parse(request.body);calls.push({path,body});let data;
    if(path==='/api/sqlite/flushTransaction'){note.indexed=note.title;data=null}
    else if(path==='/api/query/sql')data=[{id:'doc',root_id:'doc',box:'notebook',type:'d',content:note.indexed}];
    else if(path==='/api/attr/getBlockAttrs')data={title:note.title};
    else if(path==='/api/filetree/renameDocByID'){assert.equal(body.id,'doc');note.title=body.title;data=null}
    else throw new Error(`Unexpected kernel endpoint ${path}`);
    return new Response(JSON.stringify({code:0,msg:'',data}),{headers:{'Content-Type':'application/json'}});
  };
  try {
    const backend=createReplacementBackend(()=>[]);
    backend.find=async(texts,query,options,signal,limit,replacement)=>matchTexts(texts,query,options,limit,replacement);
    const service=new ReplacementService(backend);
    const result=await service.replace({query:'cat',replacement:'dog',options:DEFAULT_OPTIONS,scope:{}},new AbortController().signal);
    assert.equal(result.count,1);assert.equal(note.title,'dog memo');assert.equal(note.indexed,'dog memo');
    assert.equal(calls.at(-1).path,'/api/sqlite/flushTransaction');
    assert.equal(await service.undo(new AbortController().signal),1);
    assert.equal(note.title,'cat memo');assert.equal(note.indexed,'cat memo');
  }finally{globalThis.fetch=original}
});
