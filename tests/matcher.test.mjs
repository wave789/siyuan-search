import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTexts, compilePattern, DEFAULT_OPTIONS, linePosition } from '../src/search/matcher.ts';
import { blockQuery, sqlString, post } from '../src/api.ts';
const find = (text, query, options = {}, limit) => matchTexts([text], query, { ...DEFAULT_OPTIONS, ...options }, limit);
const ranges = result => result.blocks.flatMap(block => block.matches);

test('plain containment ignores case by default and treats regex syntax literally', () => {
  assert.deepEqual(ranges(find('cat Cat category CAT', 'cat')), [{start:0,end:3},{start:4,end:7},{start:8,end:11},{start:17,end:20}]);
  for (const query of ['.*', '[abc]', 'a+b', 'a\\b', '(x)', '$2', 'x?', '{2}', '^hi']) {
    assert.deepEqual(ranges(find(`before ${query} after`, query)), [{ start:7, end:7+query.length }]);
  }
});

test('case sensitivity and whole-word can be combined', () => {
  const text = 'cat Cat category my_cat cat2 cat-dog (cat)';
  assert.equal(ranges(find(text,'cat',{wholeWord:true})).length, 4);
  assert.equal(ranges(find(text,'cat',{wholeWord:true,caseSensitive:true})).length, 3);
});

test('Unicode word boundaries include CJK, marks and astral letters', () => {
  assert.equal(ranges(find('中文 中文笔记 前中文 中文。', '中文', {wholeWord:true})).length, 2);
  assert.equal(ranges(find('é élan café', 'é', {wholeWord:true})).length, 1);
  assert.equal(ranges(find('𐐀cat cat𐐀 cat', 'cat', {wholeWord:true})).length, 1);
  assert.equal(ranges(find('e\u0301 e', 'e', {wholeWord:true})).length, 1);
});

test('regex supports alternation, anchors, backreferences, multiline and case flags', () => {
  assert.equal(ranges(find('todo\nFIXME\nuntodo', '^todo$|fixme', {regex:true})).length, 2);
  assert.equal(ranges(find('AA aa', '(A)\\1', {regex:true,caseSensitive:true})).length, 1);
  assert.equal(ranges(find('item item2 ITEM', 'item', {regex:true,wholeWord:true})).length, 2);
});

test('invalid regex reports an error; literal invalid regex is valid', () => {
  assert.throws(() => compilePattern('[', {...DEFAULT_OPTIONS,regex:true}), SyntaxError);
  assert.equal(ranges(find('[', '[')).length, 1);
});

test('zero-width results terminate, including lookahead and astral characters', () => {
  assert.deepEqual(ranges(find('😀😀', '(?=.)', {regex:true})), []);
  assert.deepEqual(ranges(find('a\na', '^|a', {regex:true})), []);
  assert.deepEqual(ranges(find('aa', 'a*', {regex:true})), [{start:0,end:2}]);
  assert.deepEqual(find('text', ''), {blocks:[],truncated:false});
});

test('limits span blocks and only report truncation when there is another hit', () => {
  const exact = matchTexts(['aa','a'], 'a', DEFAULT_OPTIONS, 3);
  assert.equal(exact.truncated,false);
  const over = matchTexts(['aa','aa'], 'a', DEFAULT_OPTIONS, 3);
  assert.equal(over.truncated,true);
  assert.equal(ranges(over).length,3);
  assert.deepEqual(over.blocks[1], {index:1,matches:[{start:0,end:1}]});
});

test('match offsets use DOM UTF-16 offsets and UI columns count code points', () => {
  assert.deepEqual(ranges(find('😀 cat','cat')),[{start:3,end:6}]);
  assert.deepEqual(linePosition('one\n😀 cat',7),{line:2,column:3});
});

test('SQL keyset paging escapes input and sets an explicit limit', () => {
  assert.equal(sqlString("x' OR 1=1 --"), "'x'' OR 1=1 --'");
  const query = blockQuery("abc'",{notebook:"box'",root:'root'});
  assert.match(query,/id > 'abc''/);
  assert.match(query,/box = 'box''/);
  assert.match(query,/root_id = 'root'/);
  assert.match(query,/ORDER BY id ASC LIMIT 500$/);
});

test('kernel errors and HTTP errors are surfaced', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({code:-1,msg:'db unavailable',data:null}));
    await assert.rejects(post('/api/query/sql',{}), /db unavailable/);
    globalThis.fetch = async () => new Response('',{status:503});
    await assert.rejects(post('/api/query/sql',{}), /503/);
  } finally { globalThis.fetch=original; }
});
