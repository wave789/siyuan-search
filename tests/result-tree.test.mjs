import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResultTree, resultAncestors } from '../src/search/result-tree.ts';
const hit=(root,path='/项目/设计',box='a')=>({block:{id:root+'p',root_id:root,box,hpath:path,content:'Search',type:'p'},match:{start:0,end:6},ordinal:0});
test('matches group by notebook, each directory, document and individual occurrence with totals',()=>{
  const tree=buildResultTree([hit('one'),hit('one'),hit('two','/项目/实现'),hit('three','/项目/设计','b')],new Map([['a','笔记本'],['b','笔记本']]));
  assert.equal(tree.length,2);assert.equal(tree[0].count,3);assert.equal(tree[1].count,1);
  const folder=tree[0].children[0];assert.equal(folder.label,'项目');assert.equal(folder.count,3);
  assert.deepEqual(folder.children.map(node=>[node.label,node.count,node.hits]),[['设计',2,[0,1]],['实现',1,[2]]]);
  assert.equal(folder.children[0].path,'笔记本/项目/设计');assert.notEqual(tree[0].key,tree[1].key);
});
test('same-named documents retain independent root identities and nested directories retain their parent',()=>{
  const tree=buildResultTree([hit('one','/A/文档'),hit('two','/A/文档'),hit('three','/B/A/文档')],new Map());
  assert.equal(tree[0].children[0].children.length,2);assert.equal(tree[0].children[1].children[0].label,'A');
  assert.notEqual(tree[0].children[0].children[0].key,tree[0].children[0].children[1].key);
  assert.notEqual(tree[0].children[0].key,tree[0].children[1].children[0].key);
});
test('ancestor lookup expands only the path to a selected occurrence; root files and missing titles are supported',()=>{
  const tree=buildResultTree([hit('one'),hit('two','/根文件'),hit('three','')],new Map());
  assert.equal(resultAncestors(tree,0).length,3);assert.equal(resultAncestors(tree,1).length,2);assert.deepEqual(resultAncestors(tree,10),[]);
  assert.equal(tree[0].children[2].label,'未命名文档');assert.deepEqual(buildResultTree([],new Map()),[]);
});
