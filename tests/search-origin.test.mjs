import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionAnchor, anchoredHitIndex, pointOffset, restoreOriginScroll } from '../src/search/origin.ts';
import { matchTexts, DEFAULT_OPTIONS } from '../src/search/matcher.ts';

function block(id,texts,{lineBreak=false}={}) {
  const nodes=texts.map(data=>({data,nodeType:3,isConnected:true}));
  const units=[];let offset=0;
  nodes.forEach((node,index)=>{
    if(index&&lineBreak){units.push({node:{nodeType:1,isConnected:true},start:offset,end:offset+1,br:true});offset++}
    units.push({node,start:offset,end:offset+node.data.length});offset+=node.data.length;
  });
  const element={contains:node=>node===element||units.some(unit=>unit.node===node)};
  units.forEach((unit,index)=>{unit.node.domIndex=index*2+1});
  element.ownerDocument={createRange:()=>({setStart(container,offset){this.point=container===element?offset*2:container.domIndex},collapse(){},comparePoint(node){return Math.sign(node.domIndex-this.point)}})};
  return {id,text:units.map(unit=>unit.br?'\n':unit.node.data).join(''),element,parts:units.filter(unit=>!unit.br),breaks:units.filter(unit=>unit.br),nodes};
}
const selection=(startNode,startOffset,endNode=startNode,endOffset=startOffset)=>({startContainer:startNode,startOffset,endContainer:endNode,endOffset});
const hitsFor=(blocks,query)=>matchTexts(blocks.map(block=>block.text),query,DEFAULT_OPTIONS).blocks.flatMap(group=>group.matches.map(match=>({...match,blockId:blocks[group.index].id})));

test('selected duplicate inside a paragraph becomes the current match, including later occurrences',()=>{
  const paragraph=block('p',['a a a']),hits=hitsFor([paragraph],'a');
  const anchor=selectionAnchor([paragraph],selection(paragraph.nodes[0],2,paragraph.nodes[0],3));
  assert.deepEqual(anchor,{blockId:'p',start:2,end:3});assert.equal(anchoredHitIndex(hits,anchor),1);
});

test('selection in a later block wins over the document first match',()=>{
  const first=block('first',['Search']),later=block('later',['Search Search']);
  const anchor=selectionAnchor([first,later],selection(later.nodes[0],7,later.nodes[0],13));
  assert.equal(anchoredHitIndex(hitsFor([first,later],'Search'),anchor),2);
});

test('selection crossing rich text nodes uses normalized offsets shared with matching',()=>{
  const formatted=block('p',['before ','Sea','rch',' after']);
  const anchor=selectionAnchor([formatted],selection(formatted.nodes[1],0,formatted.nodes[2],3));
  assert.deepEqual(anchor,{blockId:'p',start:7,end:13});assert.equal(anchoredHitIndex(hitsFor([formatted],'Search'),anchor),0);
});

test('BR offsets, Unicode surrogate pairs and title offsets stay aligned',()=>{
  const code=block('p',['😀 Search','Search'],{lineBreak:true});
  assert.deepEqual(selectionAnchor([code],selection(code.nodes[1],0,code.nodes[1],6)),{blockId:'p',start:10,end:16});
  const title=block('doc',['Search Search']);
  const anchor=selectionAnchor([title],selection(title.nodes[0],7,title.nodes[0],13));
  assert.deepEqual(anchor,{blockId:'doc',start:7,end:13});assert.equal(anchoredHitIndex(hitsFor([title],'Search'),anchor),1);
});

test('element-boundary selections account for BRs without counting markup',()=>{
  const paragraph=block('p',['cat','dog'],{lineBreak:true});
  assert.equal(pointOffset(paragraph,paragraph.element,0),0);
  assert.equal(pointOffset(paragraph,paragraph.element,1),3);
  assert.equal(pointOffset(paragraph,paragraph.element,2),4);
  assert.equal(pointOffset(paragraph,paragraph.element,3),7);
});

test('out-of-scope selections and selections spanning blocks have no false anchor',()=>{
  const first=block('first',['Search']),second=block('second',['Search']);
  assert.equal(selectionAnchor([first,second],selection(first.nodes[0],0,second.nodes[0],6)),undefined);
  assert.equal(selectionAnchor([first],selection({nodeType:3},0)),undefined);
  assert.equal(pointOffset(first,first.nodes[0],100),undefined);
});

test('caret chooses the containing or nearest same-block hit; empty results remain empty',()=>{
  const hits=[{blockId:'a',start:0,end:6},{blockId:'b',start:5,end:11},{blockId:'b',start:15,end:21}];
  assert.equal(anchoredHitIndex(hits,{blockId:'b',start:8,end:8}),1);
  assert.equal(anchoredHitIndex(hits,{blockId:'b',start:12,end:12}),2);
  assert.equal(anchoredHitIndex(hits,{blockId:'b',start:50,end:50}),2);
  assert.equal(anchoredHitIndex(hits),0);assert.equal(anchoredHitIndex([],{blockId:'a',start:0,end:1}),-1);
});

test('initial viewport restore covers horizontal and vertical scroll and ignores detached nodes',()=>{
  const scroller={scrollTop:0,scrollLeft:0,isConnected:true},detached={scrollTop:0,scrollLeft:0,isConnected:false};
  const editor={contains:element=>element===scroller||element===detached};
  restoreOriginScroll({editor,scroll:[{element:scroller,top:500,left:140},{element:detached,top:100,left:40}]});
  assert.deepEqual(scroller,{scrollTop:500,scrollLeft:140,isConnected:true});assert.equal(detached.scrollTop,0);
});
