import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const rootA='20260101000000-aaaaaaa', rootB='20260102000000-bbbbbbb';
const id = n => `20260101${String(n).padStart(6,'0')}-aaaaaaa`;
const paragraph=(n,html)=>`<div data-node-id="${id(n)}" data-type="NodeParagraph"><div contenteditable="true">${html}</div></div>`;
const bodies = {
  [rootA]: [paragraph(1,'Search search searchable'),paragraph(2,'Formatted <strong>Sea</strong>rch'),paragraph(3,'Next Search'),
    `<div data-node-id="${id(4)}" data-type="NodeCodeBlock"><div class="protyle-action">Search should be ignored</div><div contenteditable="true"><span>Search</span>()</div></div>`,
    paragraph(5,'Symbols .* plus [tag]'), `<div data-node-id="${id(6)}" data-type="NodeList"><div data-node-id="${id(7)}" data-type="NodeListItem">${paragraph(8,'Search in list')}</div></div>`].join(''),
  [rootB]: `<div data-node-id="20260102000001-bbbbbbb" data-type="NodeParagraph"><div contenteditable="true">Quasar Search Search</div></div><div data-node-id="20260102000002-bbbbbbb" data-type="NodeParagraph"><div contenteditable="true">Search &lt;img src=x onerror="window.pwned=true"&gt;</div></div>`,
};
let browser;
const source=await readFile('dist/index.js','utf8'), css=await readFile('dist/index.css','utf8');
const documentBundle=await build({entryPoints:['src/search/document.ts'],bundle:true,write:false,format:'iife',globalName:'DocumentSearch',target:'es2022'});
const rows = Array.from({length:505},(_,n)=>({id:id(n+20),root_id:rootA,box:'notebook-a',hpath:'/Search handbook',type:'p',content:`Unrelated filler ${n}`}));
rows.push({id:'20260102000001-bbbbbbb',root_id:rootB,box:'notebook-b',hpath:'/Quasar',type:'p',content:'Quasar Search Search'});
rows.push({id:'20260102000002-bbbbbbb',root_id:rootB,box:'notebook-b',hpath:'/Quasar',type:'p',content:'Search <img src=x onerror="window.pwned=true">'});
rows.sort((a,b)=>a.id.localeCompare(b.id));

before(async()=>{
  const executablePath=process.env.CHROME_PATH || (existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : undefined);
  browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close()});

async function setup({catastrophic=false,longPreview=false,popupFirst=true,closeTreeOnOutside=false,sidebar=false,nestedPaths=false}={}) {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const fixtureBodies = { ...bodies };
  const fixtureRows = rows.map(item => ({ ...item }));
  if(nestedPaths)fixtureRows.filter(row=>row.root_id===rootB).forEach(row=>{row.hpath='/Projects/Attention/Quasar'});
  if(longPreview){
    const text=Array.from({length:300},(_,n)=>`${n===0?'def ':''}preview prefix ${n}`).join('\n')+'\nfirst Search line\nsecond Search line\n'+Array.from({length:300},(_,n)=>`preview tail ${n}`).join('\n');
    const escaped=text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    fixtureBodies[rootB]=`<div data-node-id="20260102000001-bbbbbbb" data-type="NodeCodeBlock" data-subtype="python"><div contenteditable="true">${escaped}</div></div>`+bodies[rootB].slice(bodies[rootB].indexOf('<div data-node-id="20260102000002'));
    const block=fixtureRows.find(row=>row.id==='20260102000001-bbbbbbb');block.content=text;block.type='c';
  }
  const fixtureTitles = { [rootA]: "Search handbook", [rootB]: "Quasar" };
  const rootFor = value => value.startsWith("20260102") ? rootB : rootA;
  let sqlRequests=0;const previewRequests=[];
  await page.route('http://siyuan.test/**',async route=>{
    const url=new URL(route.request().url());
    if (url.pathname==='/') {
      await route.fulfill({contentType:'text/html',body:`<!doctype html><html><meta charset="utf-8"><title>SiYuan plugin test</title><style>body{margin:0;font:16px system-ui;color:#303440;background:#f6f7fa}.layout-tab-container{margin:24px auto;width:1000px;height:780px;background:white;border:1px solid #e4e7ec;border-radius:9px}.protyle{height:100%;display:flex;flex-direction:column}.protyle-content{overflow:auto;flex:1;padding:30px 70px}.protyle-title__input{font-size:30px;font-weight:600;margin:16px 0 26px}.protyle-wysiwyg [data-node-id]{padding:8px 0}.protyle-action{display:none}.fn__none{display:none}</style><body><div class="layout-tab-container"><section id="editor-a" class="protyle"><div class="protyle-content"><div class="protyle-title__input" contenteditable="true">Search handbook</div><div class="protyle-wysiwyg" contenteditable="true">${paragraph(1,'Search search searchable')}${paragraph(2,'Formatted <strong>Sea</strong>rch')}${bodies[rootA].match(/<div data-node-id="20260101000004[\s\S]*?(?=<div data-node-id="20260101000005)/)?.[0] || ''}</div></div></section><section id="editor-b" class="protyle fn__none"><div class="protyle-content"><div class="protyle-title__input" contenteditable="true">Quasar</div><div class="protyle-wysiwyg" contenteditable="true">${fixtureBodies[rootB]}</div></div></section></div></body></html>`});return;
    }
    const data=route.request().postDataJSON() || {};
    let result;
    if(url.pathname==='/api/block/getBlockDOM') {
      const root = rootFor(data.id);
      result = {dom: fixtureBodies[data.id] || await page.evaluate(({html,id}) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return doc.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.outerHTML || '';
      }, {html:fixtureBodies[root],id:data.id})};
    }
    else if(url.pathname==='/api/export/preview'){
      previewRequests.push(data.id);
      result={html:await page.evaluate(({id})=>{
        const doc=new DOMParser().parseFromString(window.noteBodies[id],'text/html');
        doc.body.querySelectorAll('[data-node-id]').forEach(node=>{
          node.id=node.dataset.nodeId;node.removeAttribute('data-node-id');
          if(node.dataset.type==='NodeCodeBlock'){
            const pre=doc.createElement('pre'),code=doc.createElement('code');pre.className='code-block';pre.setAttribute('data-language',node.dataset.subtype||'plaintext');
            code.textContent=node.querySelector('[contenteditable]')?.textContent||'';pre.append(code);node.replaceChildren(pre);
          }
        });
        const title=doc.createElement('h1');title.id=id;title.textContent=window.noteTitles[id];doc.body.prepend(title);return doc.body.innerHTML;
      },{id:data.id})};
    }
    else if(url.pathname==='/api/sqlite/flushTransaction') result=null;
    else if(url.pathname==='/api/attr/getBlockAttrs') result={title:fixtureTitles[data.id] || ''};
    else if(url.pathname==='/api/filetree/renameDocByID') {
      fixtureTitles[data.id]=data.title;
      await page.evaluate(({id,title})=>{window.noteTitles[id]=title},{id:data.id,title:data.title});
      result=null;
    }
    else if(url.pathname==='/api/block/updateBlock') {
      const root=rootFor(data.id);
      const saved=await page.evaluate(({root,id,raw})=>{
        const doc=new DOMParser().parseFromString(window.noteBodies[root],'text/html');
        const old=doc.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
        const next=new DOMParser().parseFromString(raw,'text/html').body.firstElementChild;
        if(!old||!next)throw new Error('Unknown block update');
        old.replaceWith(next);window.noteBodies[root]=doc.body.innerHTML;
        return {body:doc.body.innerHTML,dom:next.outerHTML,text:window.DocumentSearch.readBlock(next,id).text};
      },{root,id:data.id,raw:data.data});
      fixtureBodies[root]=saved.body;
      const indexed=fixtureRows.find(row=>row.id===data.id);
      if(indexed)indexed.content=saved.text;
      result=[{doOperations:[{id:data.id,action:'update',data:saved.dom}]}];
    }
    else if(url.pathname==='/api/notebook/lsNotebooks') result={notebooks:[{id:'notebook-a',name:'测试笔记本',closed:false},{id:'notebook-b',name:'第二笔记本',closed:false}]};
    else if(url.pathname==='/api/query/sql') {
      sqlRequests++;
      const cursor=data.stmt.match(/id > '([^']*)'/)?.[1] || '';
      let filtered=fixtureRows.filter(row=>row.id>cursor);
      const notebook=data.stmt.match(/box = '([^']*)'/)?.[1];
      const root=data.stmt.match(/root_id = '([^']*)'/)?.[1];
      if(notebook)filtered=filtered.filter(row=>row.box===notebook);
      if(root)filtered=filtered.filter(row=>row.root_id===root);
      result=filtered.slice(0,500);
    } else throw new Error(`Unexpected API ${url.pathname}`);
    if(catastrophic && url.pathname==='/api/block/getBlockDOM') result={dom:paragraph(99,'a'.repeat(40000)+'!')};
    await route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,msg:'',data:result})});
  });
  await page.goto('http://siyuan.test/');
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:documentBundle.outputFiles[0].text});
  await page.evaluate(({rootA,rootB,bodies,popupFirst,closeTreeOnOutside})=>{
    window.noteBodies={...bodies};window.noteTitles={[rootA]:"Search handbook",[rootB]:"Quasar"};
    const makeEditor=(rootID,selector)=>{
      const element=document.querySelector(selector);
      const protyle={element,block:{id:rootID,rootID,showAll:false,mode:0,action:[]},options:{blockId:rootID},notebookId:rootID===rootA?'notebook-a':'notebook-b',wysiwyg:{element:element.querySelector('.protyle-wysiwyg')}};
      protyle.getInstance=()=>({protyle,flushPendingTransactions:async()=>{},reload:()=>{
        protyle.wysiwyg.element.innerHTML=window.noteBodies[rootID];
        protyle.element.querySelector('.protyle-title__input').textContent=window.noteTitles[rootID];
      }});
      return {protyle};
    };
    window.editors=[makeEditor(rootA,'#editor-a'),makeEditor(rootB,'#editor-b')];
    window.nativeSearchCount=0;
    window.hostEscapeCount=0;
    // Reproduce a host capture handler that blocks Escape before the search bar can bubble it.
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'){window.hostEscapeCount++;event.preventDefault();event.stopImmediatePropagation()}
    },true);
    document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f')window.nativeSearchCount++});
    class EventBus { handlers=new Map();on(type,fn){if(!this.handlers.has(type))this.handlers.set(type,new Set());this.handlers.get(type).add(fn)}off(type,fn){this.handlers.get(type)?.delete(fn)}emit(type,detail){for(const fn of this.handlers.get(type)||[])fn(new CustomEvent(type,{detail}))} }
    class Plugin {name='siyuan-search';app={};commands=[];eventBus=new EventBus();data={};i18n={};loadData(){return Promise.resolve(popupFirst===null?undefined:{popupFirst,closeTreeOnOutside})}saveData(key,value){window.savedPreferences=JSON.parse(JSON.stringify(value));return Promise.resolve()}addIcons(svg){window.pluginIcons=svg}addCommand(command){this.commands.push(command)}addTopBar(item){window.topBar=item;return document.createElement('button')} }
    class Setting {items=[];addItem(item){this.items.push(item)}}
    class Menu {addItem(){}open(){}}
    window.previewReaders=[];
    // This host adapter exercises plugin integration; it does not replace real SiYuan rendering tests.
    class Protyle {constructor(){window.previewReaders.push({destroyed:false});throw new Error('Search preview must not create a native editor')}}
    const ProtyleMethod={highlightRender(){window.hljs={getLanguage:language=>language==='python',highlight:text=>({value:text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/\bdef\b/g,'<span class="hljs-keyword">def</span>')})}}};
    window.siyuanStub={Plugin,Setting,Menu,Protyle,ProtyleMethod,getAllEditor:()=>window.editors,showMessage:message=>{window.lastMessage=message},openTab:async({doc})=>{
      const root=doc.id.startsWith('20260102')?rootB:rootA;
      const editor=window.editors.find(item=>item.protyle.block.rootID===root);
      window.editors.forEach(item=>item.protyle.element.classList.toggle('fn__none',item!==editor));
      if(!editor.protyle.block.showAll){
        editor.protyle.wysiwyg.element.innerHTML=window.noteBodies[root];
        if(doc.id!==root&&!doc.action?.includes('cb-get-context')){
          const block=editor.protyle.wysiwyg.element.querySelector(`[data-node-id="${doc.id}"]`);
          editor.protyle.wysiwyg.element.innerHTML=block?.outerHTML||'';
        }
        Object.assign(editor.protyle.block,{mode:doc.action?.includes('cb-get-context')?3:0,action:doc.action});
      }
      window.lastOpened=doc.id;
      window.lastOpenOptions=JSON.parse(JSON.stringify(doc));
      window.plugin.eventBus.emit('switch-protyle',{protyle:editor.protyle});
      return {model:{editor}};
    }};
    window.module={exports:{}};window.exports=window.module.exports;
    window.require=name=>{if(name==='siyuan')return window.siyuanStub;throw new Error(name)};
  },{rootA,rootB,bodies:fixtureBodies,popupFirst,closeTreeOnOutside});
  if(sidebar)await page.evaluate(()=>{
    const center=document.createElement('div');center.className='layout__center';center.style.cssText='position:fixed;left:240px;right:160px;top:32px;bottom:24px;display:flex;flex-direction:column;min-height:0;overflow:hidden';
    const tabs=document.querySelector('.layout-tab-container');tabs.style.cssText='width:100%;height:auto;min-height:0;flex:1;margin:0';center.append(tabs);document.body.append(center);
    const left=document.createElement('aside');left.id='test-sidebar';left.style.cssText='position:fixed;left:0;width:240px;top:32px;bottom:24px';document.body.append(left);
  });
  await page.addScriptTag({content:source});
  await page.evaluate(async()=>{window.plugin=new window.module.exports.default();await window.plugin.onload();window.plugin.onLayoutReady()});
  return {page,errors,get sqlRequests(){return sqlRequests},previewRequests};
}
async function openLocal(page,query='Search') {
  // Seed the first title occurrence explicitly; opening find now follows the real note selection.
  await page.evaluate(()=>{
    const title=document.querySelector('#editor-a .protyle-title__input');title.focus({preventScroll:true});
    const range=document.createRange();range.setStart(title.firstChild,0);range.setEnd(title.firstChild,6);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  });
  await page.keyboard.press('Control+f');
  await page.locator('.syp-searchbar .syp-query-input').fill(query);
}
async function counter(page,text) {await page.waitForFunction(text=>document.querySelector('.syp-counter')?.textContent===text,text)}

test('selection seeds Ctrl+F; options, lazy hits, native conflict and cleanup work',async()=>{
  const {page,errors}=await setup();
  try {
    await page.evaluate(()=>{const text=document.querySelector('#editor-a .protyle-wysiwyg [data-node-id] [contenteditable]').firstChild;const range=document.createRange();range.setStart(text,0);range.setEnd(text,6);const s=getSelection();s.removeAllRanges();s.addRange(range)});
    await page.keyboard.press('Control+f');
    assert.equal(await page.locator('.syp-searchbar .syp-query-input').inputValue(),'Search');
    await counter(page,'2 / 8');
    assert.equal(await page.evaluate(()=>window.nativeSearchCount),0);
    assert.equal(await page.locator('#editor-a .protyle-wysiwyg mark').count(),0);
    assert.ok(await page.evaluate(()=>CSS.highlights.get('syp-search-all').size>=5));
    await page.locator('[data-option="wholeWord"]').click();await counter(page,'2 / 7');
    await page.keyboard.press('Alt+c');await counter(page,'2 / 6');
    await page.locator('.syp-searchbar .syp-query-input').focus();
    await page.keyboard.press('Shift+Enter');await counter(page,'1 / 6');
    await page.keyboard.press('Shift+Enter');await counter(page,'6 / 6');
    assert.equal(await page.evaluate(()=>window.lastOpened),id(8));
    await page.keyboard.press('F3');await counter(page,'1 / 6');
    await page.locator('[data-option="regex"]').click();
    await page.locator('.syp-searchbar .syp-query-input').fill('[');
    await page.waitForFunction(()=>document.querySelector('.syp-counter')?.textContent==='搜索失败');
    assert.match(await page.locator('.syp-local-status').textContent(),/Invalid|regular|expression/i);
    await page.locator('.syp-searchbar .syp-query-input').fill('^');await counter(page,'无匹配');
    await page.keyboard.press('Escape');assert.equal(await page.locator('.syp-searchbar').count(),0);
    assert.equal(await page.evaluate(()=>CSS.highlights.has('syp-search-all')),false);
    await page.evaluate(()=>window.plugin.onunload());
    await page.keyboard.press('Control+f');
    assert.equal(await page.locator('.syp-searchbar').count(),0);
    assert.equal(await page.evaluate(()=>window.nativeSearchCount),1);
    assert.deepEqual(errors,[]);
  } finally {await page.close()}
});

test('global search pages past 500 blocks, previews safe text and opens exact occurrence',async()=>{
  const fixture=await setup();const {page,errors}=fixture;
  try {
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    const input=page.locator('.syp-dialog .syp-query-input');await input.fill('Search');
    await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='3 处匹配 · 1 篇文档');
    assert.ok(fixture.sqlRequests>=2);
    assert.equal(await page.locator('.syp-result').count(),3);
    assert.equal(await page.locator('.syp-result-group').count(),0);
    assert.equal(await page.locator('.syp-result').first().locator('.syp-result-text').textContent(),'Quasar Search Search');
    await page.locator('.syp-result').nth(2).click();
    await page.waitForFunction(()=>document.querySelector('.syp-preview-reading')?.textContent.includes('<img'));
    assert.match(await page.locator('.syp-preview-reading').textContent(),/<img/);
    assert.equal(await page.locator('.syp-preview img').count(),0);
    assert.equal(await page.evaluate(()=>window.pwned),undefined);
    await page.locator('.syp-result').nth(1).click();
    await input.press('Enter');
    await page.waitForFunction(()=>!document.querySelector('.syp-dialog'));
    assert.equal(await page.evaluate(()=>window.lastOpened),'20260102000001-bbbbbbb');
    assert.equal(await page.evaluate(()=>window.lastOpenOptions.zoomIn),false);
    assert.ok(await page.evaluate(()=>window.lastOpenOptions.action.includes('cb-get-context')));
    assert.equal(await page.locator('#editor-b [data-node-id="20260102000002-bbbbbbb"]').count(),1);
    await counter(page,'2 / 3');
    assert.equal(await page.evaluate(()=>Array.from(CSS.highlights.get('syp-search-active'))[0].startOffset),14);
    assert.equal(await page.evaluate(()=>window.nativeSearchCount),0);
    assert.deepEqual(errors,[]);
  } finally {await page.close()}
});

test('scope, stale searches, keyboard focus trap and shortcut preference',async()=>{
  const {page,errors}=await setup();
  try {
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    await page.locator('.syp-dialog .syp-query-input').fill('Search');
    await page.locator('.syp-select').selectOption('document');
    await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='0 处匹配 · 0 篇文档');
    await page.locator('.syp-select').selectOption('notebook:notebook-b');
    await page.locator('.syp-dialog .syp-query-input').fill('Quasar');
    await page.locator('.syp-dialog .syp-query-input').fill('NO_RESULT_EXPECTED');
    await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='0 处匹配 · 0 篇文档');
    assert.equal(await page.locator('.syp-result').count(),0);
    const first=page.locator('.syp-dialog-header button');await first.focus();await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.syp-results')),true);
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{const input=window.plugin.setting.items[0].actionElement;input.checked=false;input.dispatchEvent(new Event('change'))});
    await page.keyboard.press('Control+f');assert.equal(await page.locator('.syp-searchbar').count(),0);
    await page.evaluate(()=>window.plugin.commands[0].callback());
    assert.equal(await page.locator('.syp-searchbar').count(),1);
    assert.deepEqual(errors,[]);
  } finally {await page.close()}
});

test('regex timeout terminates the worker without blocking the editor',async()=>{
  const {page,errors}=await setup({catastrophic:true});
  try {
    await openLocal(page,'(a+)+$');await page.locator('[data-option="regex"]').click();
    const started=Date.now();
    await page.waitForFunction(()=>document.querySelector('.syp-local-status')?.textContent.includes('耗时过长'),{},{timeout:7000});
    assert.ok(Date.now()-started<6500);
    await page.locator('.syp-searchbar .syp-query-input').fill('Search');await page.locator('[data-option="regex"]').click();
    await page.waitForFunction(()=>document.querySelector('.syp-counter')?.textContent?.includes('/'));
    assert.deepEqual(errors,[]);
  } finally {await page.close()}
});

test('DOM extraction preserves formatted matches and excludes containers and actions',async()=>{
  const {page}=await setup();
  try {
    await page.addScriptTag({content:documentBundle.outputFiles[0].text});
    const result=await page.evaluate(()=>{
      const root=document.createElement('div');root.innerHTML='<div data-node-id="list"><div data-node-id="p">ab<strong>cd</strong><br>ef<span class="protyle-action">ignored</span></div></div>';
      document.body.append(root);
      const blocks=window.DocumentSearch.readBlocks(root);
      const range=window.DocumentSearch.matchRange(blocks[0],{start:1,end:4});
      const merged=window.DocumentSearch.mergeBlocks([{id:'a',text:'saved',parts:[]},{id:'b',text:'b',parts:[]}],[{id:'a',text:'live',parts:[]},{id:'new',text:'new',parts:[]}]);
      return {count:blocks.length,text:blocks[0].text,selected:range.toString(),merged:merged.map(b=>b.id+':'+b.text)};
    });
    assert.deepEqual(result,{count:1,text:'abcd\nef',selected:'bcd',merged:['a:live','new:new','b:b']});
  }finally{await page.close()}
});

test('capture a review screenshot',async()=>{
  const {page}=await setup();
  try {
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    await page.locator('.syp-dialog .syp-query-input').fill('Search');
    await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='3 处匹配 · 1 篇文档');
    await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/global-search.png'});
  }finally{await page.close()}
});

test('DOM replacements preserve inline formatting, link attributes, line breaks and plain text',async()=>{
  const {page}=await setup();
  try {
    const bundle=await build({entryPoints:['src/replace/dom.ts'],bundle:true,write:false,format:'iife',globalName:'ReplacementDOM',target:'es2022'});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const result=await page.evaluate(()=>{
      const make=html=>new DOMParser().parseFromString(html,'text/html').body.firstElementChild;
      const element=make('<div data-node-id="p" class="p">prefix <a href="https://example.com" title="keep"><strong style="color:red">Sea</strong>rch</a> suffix</div>');
      const replaced=make(window.ReplacementDOM.replaceBlockDOM(element,[{start:7,end:13,replacement:'Find <tag>'}]));
      const text=window.DocumentSearch.readBlock(replaced,'p').text;
      const br=make(window.ReplacementDOM.replaceBlockDOM(make('<div data-node-id="p">ab<br>cd</div>'),[{start:1,end:4,replacement:'X\nY'}]));
      const repeated=make(window.ReplacementDOM.replaceBlockDOM(make('<div data-node-id="p">cat cat</div>'),[{start:0,end:3,replacement:'catcat'},{start:4,end:7,replacement:''}]));
      const code=make(window.ReplacementDOM.replaceBlockDOM(make('<div data-node-id="p" data-type="NodeCodeBlock"><div>abc def</div></div>'),[{start:0,end:3,replacement:'x\ny'}]));
      return {text,bold:replaced.querySelector('strong').textContent,style:replaced.querySelector('strong').getAttribute('style'),link:replaced.querySelector('a').getAttribute('href'),injected:replaced.querySelector('tag')!==null,
        br:window.DocumentSearch.readBlock(br,'p').text,repeated:window.DocumentSearch.readBlock(repeated,'p').text,code:window.DocumentSearch.readBlock(code,'p').text,codeBr:code.querySelectorAll('br').length};
    });
    assert.deepEqual(result,{text:'prefix Find <tag> suffix',bold:'Find <tag>',style:'color:red',link:'https://example.com',injected:false,br:'aX\nYd',repeated:'catcat ',code:'x\ny def',codeBr:0});
  }finally{await page.close()}
});

test('local arrow expands replacement; single, whole-document all and undo persist changes',async()=>{
  const {page,errors}=await setup();
  try {
    await openLocal(page);await counter(page,'1 / 8');
    const toggle=page.locator('.syp-searchbar .syp-replace-toggle');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    await page.locator('.syp-searchbar .syp-replacement-input').fill('Found');
    await page.locator('.syp-searchbar .syp-replace-row').getByRole('button',{name:'替换当前匹配',exact:true}).click();
    await counter(page,'1 / 7');assert.equal(await page.locator('#editor-a .protyle-title__input').textContent(),'Found handbook');
    await page.locator('.syp-searchbar .syp-undo-replace').click();await counter(page,'1 / 8');
    await page.locator('.syp-searchbar .syp-replace-row').getByRole('button',{name:'替换当前搜索范围内的全部匹配',exact:true}).click();
    await counter(page,'无匹配');
    assert.match(await page.locator('.syp-local-status').textContent(),/已替换 8/);
    assert.equal(await page.locator(`#editor-a [data-node-id="${id(2)}"] strong`).textContent(),'Found');
    await page.locator('.syp-searchbar .syp-undo-replace').click();await counter(page,'1 / 8');
    assert.equal(await page.locator(`#editor-a [data-node-id="${id(2)}"] strong`).textContent(),'Sea');
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('global replacement respects notebook scope and supports undo from the open panel',async()=>{
  const {page,errors}=await setup();
  try {
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    await page.locator('.syp-dialog .syp-query-input').fill('Quasar');
    await page.locator('.syp-dialog .syp-replace-toggle').click();
    await page.locator('.syp-dialog .syp-replacement-input').fill('Nebula');
    await page.locator('.syp-select').selectOption('notebook:notebook-b');
    await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='1 处匹配 · 1 篇文档');
    await page.locator('.syp-dialog .syp-replace-row').getByRole('button',{name:'替换当前搜索范围内的全部匹配',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent.includes('已替换 1 处'));
    assert.match(await page.evaluate(({rootB})=>window.noteBodies[rootB],{rootB}),/Nebula Search Search/);
    assert.match(await page.evaluate(({rootA})=>window.noteBodies[rootA],{rootA}),/Formatted/);
    await page.locator('.syp-dialog .syp-undo-replace').click();
    await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent.includes('已撤销 1 处'));
    assert.match(await page.evaluate(({rootB})=>window.noteBodies[rootB],{rootB}),/Quasar Search Search/);
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('Escape closes local find before host capture, including replacement and editor focus',async()=>{
  const {page,errors}=await setup();
  try {
    await openLocal(page);await counter(page,'1 / 8');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.syp-searchbar').count(),0);
    assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.protyle')),true);
    assert.equal(await page.evaluate(()=>CSS.highlights.has('syp-search-all')),false);
    await openLocal(page);await counter(page,'1 / 8');
    await page.locator('.syp-searchbar .syp-replace-toggle').click();
    await page.locator('.syp-replacement-input').focus();await page.keyboard.press('Escape');
    assert.equal(await page.locator('.syp-searchbar').count(),0);
    await openLocal(page);await counter(page,'1 / 8');
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Escape');
    assert.equal(await page.locator('.syp-searchbar').count(),0);
    assert.equal(await page.evaluate(()=>window.hostEscapeCount),0);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('Escape closes menu-opened search with shortcut takeover disabled',async()=>{
  const {page,errors}=await setup();
  try {
    await page.evaluate(()=>{const input=window.plugin.setting.items[0].actionElement;input.checked=false;input.dispatchEvent(new Event('change'));window.plugin.commands[0].callback()});
    await page.locator('.syp-searchbar .syp-query-input').focus();await page.keyboard.press('Escape');
    assert.equal(await page.locator('.syp-searchbar').count(),0);
    assert.equal(await page.evaluate(()=>window.hostEscapeCount),0);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('Ctrl+Shift+F and Escape preserve a note below the fold, its selection and horizontal scroll',async()=>{
  const {page,errors}=await setup();
  try{
    await page.evaluate(()=>{
      const editor=document.querySelector('#editor-a .protyle-wysiwyg');
      const before=document.createElement('div'),after=document.createElement('div');
      before.style.height='1600px';after.style.height='1600px';editor.prepend(before);editor.append(after);editor.style.minWidth='1800px';
    });
    for(const collapsed of [false,true]){
      const original=await page.evaluate(({id,collapsed})=>{
        const editable=document.querySelector('#editor-a .protyle-wysiwyg');
        const paragraph=editable.querySelector(`[data-node-id="${id}"]`);paragraph.scrollIntoView({block:'center'});
        editable.focus({preventScroll:true});
        const range=document.createRange();range.setStart(paragraph.firstChild,2);range.setEnd(paragraph.firstChild,collapsed?2:8);
        const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
        const scroll=document.querySelector('#editor-a .protyle-content');scroll.scrollLeft=140;
        window.expectedReturnNode=paragraph.firstChild;
        return {top:scroll.scrollTop,left:scroll.scrollLeft,start:range.startOffset,end:range.endOffset,text:selection.toString()};
      },{id:id(2),collapsed});
      assert.ok(original.top>1000);assert.ok(original.left>0);
      // Reproduce a synchronous host focus handler in addition to browser default scrolling.
      await page.evaluate(()=>{
        if(window.focusResetInstalled)return;window.focusResetInstalled=true;
        document.querySelector('#editor-a .protyle-wysiwyg').addEventListener('focus',()=>{
          const scroll=document.querySelector('#editor-a .protyle-content');scroll.scrollTop=0;scroll.scrollLeft=0;
        });
      });
      await page.keyboard.press('Control+Shift+f');assert.equal(await page.locator('.syp-dialog').count(),1);
      await page.keyboard.press('Control+Shift+f');await page.keyboard.press('Escape');
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const current=await page.evaluate(()=>{
        const scroll=document.querySelector('#editor-a .protyle-content'),selection=getSelection(),range=selection.getRangeAt(0);
        return {top:scroll.scrollTop,left:scroll.scrollLeft,start:range.startOffset,end:range.endOffset,text:selection.toString(),sameNode:range.startContainer===window.expectedReturnNode,focused:document.activeElement===document.querySelector('#editor-a .protyle-wysiwyg')};
      });
      assert.ok(Math.abs(current.top-original.top)<2);assert.ok(Math.abs(current.left-original.left)<2);
      assert.equal(current.start,original.start);assert.equal(current.end,original.end);assert.equal(current.text,original.text);
      assert.equal(current.sameNode,true);assert.equal(current.focused,true);assert.equal(await page.locator('.syp-dialog').count(),0);
    }
    assert.equal(await page.evaluate(()=>window.lastOpened),undefined);
    assert.equal(await page.evaluate(()=>window.hostEscapeCount),0);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('global dialog can be dragged, enlarged, reduced and reset while preserving search focus',async()=>{
  const {page,errors}=await setup();
  try {
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    await page.locator('.syp-dialog .syp-query-input').fill('Search');
    await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='3 处匹配 · 1 篇文档');
    const dialog=page.locator('.syp-dialog'),header=page.locator('.syp-dialog-header'),initial=await dialog.boundingBox();
    const bar=await header.boundingBox();
    await page.mouse.move(bar.x+140,bar.y+bar.height/2);await page.mouse.down();
    await page.mouse.move(bar.x+200,bar.y+bar.height/2+40,{steps:5});await page.mouse.up();
    const moved=await dialog.boundingBox();
    assert.ok(Math.abs(moved.x-initial.x-60)<2);assert.ok(Math.abs(moved.y-initial.y-40)<2);
    assert.equal(await page.evaluate(()=>document.activeElement.matches('.syp-query-input')),true);
    async function resize(dx,dy){
      const grip=await page.locator('[data-resize="se"]').boundingBox();
      await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
      await page.mouse.move(grip.x+grip.width/2+dx,grip.y+grip.height/2+dy,{steps:5});await page.mouse.up();
    }
    await resize(-260,-180);const smaller=await dialog.boundingBox();
    assert.ok(Math.abs(smaller.width-moved.width+260)<2);assert.ok(Math.abs(smaller.height-moved.height+180)<2);
    assert.equal(smaller.x,moved.x);assert.equal(smaller.y,moved.y);
    await resize(160,100);const larger=await dialog.boundingBox();
    assert.ok(Math.abs(larger.width-smaller.width-160)<2);assert.ok(Math.abs(larger.height-smaller.height-100)<2);
    const resetBar=await header.boundingBox();await page.mouse.dblclick(resetBar.x+140,resetBar.y+resetBar.height/2);
    const reset=await dialog.boundingBox();for(const key of ['x','y','width','height'])assert.ok(Math.abs(reset[key]-initial[key])<2);
    assert.equal(await page.locator('.syp-result').count(),3);
    await page.locator('.syp-dialog-header button').click();assert.equal(await dialog.count(),0);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('host window resize keeps the global dialog on screen and Escape cancels an active drag',async()=>{
  const {page,errors}=await setup();
  try {
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    await page.setViewportSize({width:640,height:480});
    await page.waitForFunction(()=>{const r=document.querySelector('.syp-dialog').getBoundingClientRect();return r.x>=8&&r.y>=8&&r.right<=innerWidth-8&&r.bottom<=innerHeight-8});
    assert.equal(await page.locator('.syp-preview').isVisible(),true);
    const bar=await page.locator('.syp-dialog-header').boundingBox();
    await page.mouse.move(bar.x+120,bar.y+bar.height/2);await page.mouse.down();
    await page.mouse.move(bar.x+150,bar.y+bar.height/2+20);
    await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal(await page.locator('.syp-modal-backdrop').count(),0);
    assert.equal(await page.evaluate(()=>window.hostEscapeCount),0);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('Ctrl+F preserves a selected occurrence below the fold and only scrolls after navigation',async()=>{
  const {page,errors}=await setup();
  try {
    await page.evaluate(()=>window.editors[0].protyle.getInstance().reload(false));
    await page.addStyleTag({content:`#editor-a [data-node-id="${id(8)}"] { margin-top: 1800px; }`});
    await page.evaluate(({id})=>{
      const paragraph=document.querySelector(`#editor-a [data-node-id="${id}"] [contenteditable]`);
      paragraph.scrollIntoView({block:'center'});paragraph.focus({preventScroll:true});
      const range=document.createRange();range.setStart(paragraph.firstChild,0);range.setEnd(paragraph.firstChild,6);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    },{id:id(8)});
    const before=await page.locator('#editor-a .protyle-content').evaluate(node=>node.scrollTop);
    assert.ok(before>1000);
    await page.keyboard.press('Control+f');await counter(page,'8 / 8');
    const after=await page.locator('#editor-a .protyle-content').evaluate(node=>node.scrollTop);
    assert.ok(Math.abs(after-before)<2);
    assert.equal(await page.evaluate(()=>Array.from(CSS.highlights.get('syp-search-active'))[0].startContainer.parentElement.closest('[data-node-id]').dataset.nodeId),id(8));
    await page.locator('.syp-query-input').press('Enter');await counter(page,'1 / 8');
    assert.ok(await page.locator('#editor-a .protyle-content').evaluate(node=>node.scrollTop)<before);
    await page.locator('.syp-query-input').press('Shift+Enter');await counter(page,'8 / 8');
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('Ctrl+F uses the selected duplicate inside one block and Escape restores that original selection',async()=>{
  const {page,errors}=await setup();
  try {
    await page.evaluate(()=>{
      const paragraph=document.querySelector('#editor-a .protyle-wysiwyg [data-node-id] [contenteditable]');
      paragraph.focus({preventScroll:true});const range=document.createRange();range.setStart(paragraph.firstChild,7);range.setEnd(paragraph.firstChild,13);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    });
    await page.keyboard.press('Control+f');await counter(page,'3 / 8');
    assert.equal(await page.locator('.syp-query-input').inputValue(),'search');
    assert.equal(await page.evaluate(()=>Array.from(CSS.highlights.get('syp-search-active'))[0].startOffset),7);
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(()=>{const selection=getSelection(),r=selection.getRangeAt(0);return {text:selection.toString(),start:r.startOffset,end:r.endOffset}}),{text:'search',start:7,end:13});
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('Ctrl+F in an already open bar honors a new selection across inline formatting',async()=>{
  const {page,errors}=await setup();
  try {
    await openLocal(page);await counter(page,'1 / 8');
    await page.evaluate(({id})=>{
      const paragraph=document.querySelector(`#editor-a [data-node-id="${id}"] [contenteditable]`);
      paragraph.focus({preventScroll:true});const range=document.createRange();range.setStart(paragraph.querySelector('strong').firstChild,0);range.setEnd(paragraph.lastChild,3);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    },{id:id(2)});
    const before=await page.locator('#editor-a .protyle-content').evaluate(node=>node.scrollTop);
    await page.keyboard.press('Control+f');await counter(page,'5 / 8');
    assert.ok(Math.abs(await page.locator('#editor-a .protyle-content').evaluate(node=>node.scrollTop)-before)<2);
    assert.equal(await page.evaluate(()=>Array.from(CSS.highlights.get('syp-search-active'))[0].toString()),'Search');
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>getSelection().toString()),'Search');
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('global search uses upper line/path rows and a lower complete scrolling document preview',async()=>{
  const {page,errors}=await setup({longPreview:true});
  try {
    await page.addStyleTag({content:'.syp-preview-reading pre { white-space: pre; line-height: 24px; }'});
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    await page.locator('.syp-dialog .syp-query-input').fill('Search');
    await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='3 处匹配 · 1 篇文档');
    const rows=page.locator('.syp-result');assert.equal(await rows.count(),3);
    assert.equal(await rows.nth(0).locator('.syp-result-text').textContent(),'first Search line');
    assert.equal(await rows.nth(1).locator('.syp-result-text').textContent(),'second Search line');
    await page.waitForFunction(()=>document.querySelector('.syp-result-path')?.textContent==='第二笔记本/Quasar');
    const upper=await page.locator('.syp-result-pane').boundingBox(),lower=await page.locator('.syp-preview').boundingBox();
    assert.ok(upper.y+upper.height<=lower.y+1);
    const snippet=await rows.nth(0).locator('.syp-result-text').boundingBox(),path=await rows.nth(0).locator('.syp-result-path').boundingBox();
    assert.ok(snippet.x<path.x);assert.ok(snippet.x+snippet.width<=path.x+1);
    await rows.nth(1).click();
    await page.waitForFunction(()=>{const range=Array.from(CSS.highlights.get('syp-preview-active')||[])[0];return range?.startContainer.textContent.slice(0,range.startOffset).endsWith('second ')});
    assert.match(await page.locator('.syp-preview-reading').textContent(),/preview prefix 0/);
    assert.match(await page.locator('.syp-preview-reading').textContent(),/preview tail 299/);
    assert.ok(await page.locator('.syp-preview-rich-scroll').evaluate(node=>node.scrollTop)>5000);
    assert.equal(await page.evaluate(()=>CSS.highlights.get('syp-preview-all').size),3);
    assert.equal(await page.evaluate(()=>Array.from(CSS.highlights.get('syp-preview-active'))[0].toString()),'Search');
    assert.equal(await page.evaluate(()=>window.previewReaders.length),0);
    assert.equal(await page.evaluate(()=>window.lastOpened),undefined);
    await rows.nth(1).dblclick();await page.waitForFunction(()=>!document.querySelector('.syp-dialog'));
    assert.equal(await page.evaluate(()=>window.lastOpened),'20260102000001-bbbbbbb');await counter(page,'2 / 3');
    assert.equal(await page.locator('#editor-b [data-node-id="20260102000002-bbbbbbb"]').count(),1);
    assert.match(await page.locator('#editor-b .protyle-wysiwyg').textContent(),/preview prefix 0/);
    assert.match(await page.locator('#editor-b .protyle-wysiwyg').textContent(),/preview tail 299/);
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('opening a global result exits an existing block focus and restores the document',async()=>{
  const {page,errors}=await setup();
  try{
    await page.evaluate(()=>{
      const protyle=window.editors[1].protyle;
      const hit=protyle.wysiwyg.element.firstElementChild;
      protyle.wysiwyg.element.replaceChildren(hit);
      Object.assign(protyle.block,{id:hit.dataset.nodeId,showAll:true,mode:0,action:['cb-get-all']});
      protyle.options.blockId=hit.dataset.nodeId;
      const exit=document.createElement('button');exit.dataset.type='exit-focus';
      exit.addEventListener('click',()=>setTimeout(()=>{
        protyle.wysiwyg.element.innerHTML=window.noteBodies[protyle.block.rootID];
        Object.assign(protyle.block,{id:protyle.block.rootID,showAll:false,mode:0,action:[]});
        exit.remove();
      },20));
      protyle.element.append(exit);
    });
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    await page.locator('.syp-dialog .syp-query-input').fill('Search');
    await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='3 处匹配 · 1 篇文档');
    await page.locator('.syp-result').nth(1).dblclick();await page.waitForFunction(()=>!document.querySelector('.syp-dialog'));
    await counter(page,'2 / 3');
    assert.equal(await page.locator('#editor-b [data-node-id="20260102000002-bbbbbbb"]').count(),1);
    assert.equal(await page.evaluate(()=>window.editors[1].protyle.block.showAll),false);
    assert.equal(await page.evaluate(()=>window.editors[1].protyle.block.id),rootB);
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('notebook-scoped result paths omit the notebook prefix while full preview stays available',async()=>{
  const {page,errors}=await setup();
  try {
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    await page.locator('.syp-dialog .syp-query-input').fill('Search');
    await page.locator('.syp-select').selectOption('notebook:notebook-b');
    await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='3 处匹配 · 1 篇文档');
    assert.deepEqual(await page.locator('.syp-result-path').allTextContents(),['Quasar','Quasar','Quasar']);
    await page.waitForFunction(()=>document.querySelector('.syp-preview-reading')&&document.querySelector('.syp-preview')?.getAttribute('aria-busy')==='false');
    assert.equal(await page.locator('.syp-preview-document-title').textContent(),'Quasar');
    assert.equal(await page.locator('.syp-preview-path').textContent(),'第二笔记本');
    await page.setViewportSize({width:640,height:480});assert.equal(await page.locator('.syp-preview').isVisible(),true);
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('rendered preview is the default, has no mode switch and only loads the selected document',async()=>{
  const fixture=await setup();const {page,errors}=fixture;
  try{
    await page.evaluate(({rootB})=>{
      window.noteBodies[rootB]=window.noteBodies[rootB].replace('Quasar Search Search','Quasar <strong>Search</strong> Search')+
        '<div data-node-id="20260102000003-bbbbbbb" data-type="NodeHeading">Rendered heading</div>'+
        '<div data-node-id="20260102000004-bbbbbbb" data-type="NodeTable"><table><tr><td>one</td><td>two</td></tr></table></div>'+
        '<div data-node-id="20260102000005-bbbbbbb" data-type="NodeParagraph"><img alt="example" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div>';
    },{rootB});
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    await page.locator('.syp-dialog .syp-query-input').fill('Search');
    await page.waitForFunction(()=>document.querySelector('.syp-preview-info')?.textContent.includes('渲染预览 · 3 处匹配'));
    assert.equal(await page.locator('.syp-preview-mode').count(),0);assert.equal(await page.locator('.syp-preview-content').count(),0);
    assert.equal(await page.locator('.syp-preview-reading strong').textContent(),'Search');
    assert.equal(await page.locator('.syp-preview-reading table td').count(),2);assert.equal(await page.locator('.syp-preview-reading img').count(),1);
    assert.equal(await page.locator('.syp-preview-reading [contenteditable="true"]').count(),0);
    assert.deepEqual(fixture.previewRequests,[rootB]);assert.equal(await page.evaluate(()=>window.previewReaders.length),0);
    await page.locator('.syp-result').nth(1).click();
    await page.waitForFunction(()=>{const range=Array.from(CSS.highlights.get('syp-preview-active')||[])[0];return range?.startContainer.textContent===' Search'});
    assert.deepEqual(fixture.previewRequests,[rootB]);assert.equal(await page.evaluate(()=>window.previewReaders.length),0);
    assert.equal(await page.locator('.syp-preview-reading table').count(),1);await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>CSS.highlights.has('syp-preview-all')),false);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('the divider resizes both panes, retains search focus and proportion after a query, and supports keyboard adjustment',async()=>{
  const {page,errors}=await setup();
  try{
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    const input=page.locator('.syp-dialog .syp-query-input');await input.fill('Search');
    await page.waitForFunction(()=>document.querySelector('.syp-preview-info')?.textContent.includes('3 处匹配'));
    const divider=page.getByRole('separator'),before=await page.locator('.syp-result-pane').boundingBox(),box=await divider.boundingBox();
    await input.focus();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+60,{steps:5});await page.mouse.up();
    const after=await page.locator('.syp-result-pane').boundingBox();assert.ok(Math.abs(after.height-before.height-60)<2);
    assert.equal(await input.evaluate(node=>document.activeElement===node),true);
    assert.equal(await page.locator('.syp-preview-document-title').textContent(),'Quasar');assert.equal(await page.locator('.syp-preview-path').textContent(),'第二笔记本');
    const proportion=Number(await divider.getAttribute('aria-valuenow'));
    await input.fill('Unrelated');await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='505 处匹配 · 1 篇文档');
    assert.equal(await page.locator('.syp-more').isVisible(),true);assert.equal(Number(await divider.getAttribute('aria-valuenow')),proportion);
    const more=await page.locator('.syp-more').boundingBox(),boundary=await divider.boundingBox();assert.ok(more.y+more.height<=boundary.y+1);
    await divider.focus();const selected=await page.locator('.syp-result[aria-selected="true"]').getAttribute('data-index');await divider.press('ArrowUp');
    assert.ok(Number(await divider.getAttribute('aria-valuenow'))<proportion);assert.equal(await page.locator('.syp-result[aria-selected="true"]').getAttribute('data-index'),selected);
    await divider.press('End');assert.equal(await divider.getAttribute('aria-valuenow'),await divider.getAttribute('aria-valuemax'));
    assert.ok((await page.locator('.syp-preview').boundingBox()).height>=99);
    await page.keyboard.press('Escape');assert.equal(await page.locator('.syp-dialog').count(),0);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('default bottom find panel starts beside the sidebar, reserves editor space and remains until explicitly closed',async()=>{
  const {page,errors}=await setup({popupFirst:null,sidebar:true,nestedPaths:true});
  try{
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');
    await page.locator('.syp-query-input').fill('Search');await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='3 处匹配 · 1 篇文档');
    const panel=await page.locator('.syp-dialog--tree').boundingBox(),center=await page.locator('.layout__center').boundingBox(),tabs=await page.locator('.layout-tab-container').boundingBox(),sidebar=await page.locator('#test-sidebar').boundingBox();
    assert.equal(panel.x,240);assert.ok(Math.abs(panel.x+panel.width-(center.x+center.width))<1);assert.ok(Math.abs(panel.y+panel.height-(center.y+center.height))<1);assert.ok(tabs.y+tabs.height<=panel.y+1);assert.equal(sidebar.height,center.height);
    assert.deepEqual(await page.locator('.syp-tree-label').allTextContents(),['第二笔记本','Projects','Attention','Quasar']);assert.equal(await page.locator('.syp-result').count(),0);
    const doc=page.locator('.syp-tree-branch[data-kind="document"]');assert.equal(await doc.getAttribute('aria-expanded'),'false');assert.equal(await doc.getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('.syp-results').getAttribute('aria-activedescendant'),await doc.getAttribute('id'));
    await doc.click();assert.equal(await page.locator('.syp-result').count(),3);
    await page.locator('.syp-query-input').fill('Quasar');await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='1 处匹配 · 1 篇文档');
    assert.equal(await page.locator('.syp-result').count(),0);assert.equal(await doc.getAttribute('aria-expanded'),'false');
    await page.locator('#editor-a .protyle-title__input').click();assert.equal(await page.locator('.syp-dialog--tree').count(),1);
    await page.keyboard.press('Escape');assert.equal(await page.locator('.syp-dialog--tree').count(),1);
    await page.getByRole('button',{name:'关闭查找窗口',exact:true}).click();assert.equal(await page.locator('.syp-dialog').count(),0);
    assert.equal(await page.locator('.syp-find-host').count(),0);assert.equal(await page.locator('.layout__center').evaluate(node=>getComputedStyle(node).paddingBottom),'0px');assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('auto-close bottom panel dismisses on outside clicks and Escape while internal clicks keep it open',async()=>{
  const {page,errors}=await setup({popupFirst:false,closeTreeOnOutside:true,sidebar:true});
  try{
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');await page.locator('.syp-query-input').fill('Search');await page.locator('.syp-tree-branch[data-kind="document"]').click();await page.waitForSelector('.syp-tree-match');
    await page.locator('.syp-tree-match').first().click();assert.equal(await page.locator('.syp-dialog').count(),1);
    await page.locator('#editor-a .protyle-title__input').click();assert.equal(await page.locator('.syp-dialog').count(),0);assert.equal(await page.locator('.syp-find-host').count(),0);
    await page.keyboard.press('Control+Shift+f');await page.waitForSelector('.syp-dialog--tree');await page.keyboard.press('Escape');assert.equal(await page.locator('.syp-dialog').count(),0);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('open find window promotes the existing popup, preserving scope, replacement and selected occurrence without refetching',async()=>{
  const f=await setup({sidebar:true,nestedPaths:true});const {page,errors}=f;
  try{
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');await page.locator('.syp-query-input').fill('Search');
    await page.locator('.syp-select').selectOption('notebook:notebook-b');await page.waitForFunction(()=>document.querySelector('.syp-summary')?.textContent==='3 处匹配 · 1 篇文档');
    await page.locator('.syp-replace-toggle').click();await page.locator('.syp-replacement-input').fill('Updated');await page.locator('.syp-result').nth(1).click();
    await page.waitForFunction(()=>{const range=Array.from(CSS.highlights.get('syp-preview-active')||[])[0];return range?.startOffset===14});const requests=f.previewRequests.length,scans=f.sqlRequests;
    await page.locator('.syp-open-find-window').click();await page.waitForSelector('.syp-dialog--tree');
    assert.equal(await page.locator('.syp-query-input').inputValue(),'Search');assert.equal(await page.locator('.syp-select').inputValue(),'notebook:notebook-b');assert.equal(await page.locator('.syp-replacement-input').inputValue(),'Updated');assert.equal(await page.locator('.syp-result').count(),0);
    assert.equal(await page.locator('.syp-tree-branch[data-kind="document"][aria-selected="true"] .syp-tree-label').textContent(),'Quasar');
    assert.equal(await page.evaluate(()=>Array.from(CSS.highlights.get('syp-preview-active'))[0].startOffset),14);
    await page.locator('.syp-tree-branch[data-kind="document"]').click();assert.equal(await page.locator('.syp-result[aria-selected="true"]').getAttribute('data-index'),'1');
    assert.equal(f.previewRequests.length,requests);assert.equal(f.sqlRequests,scans);assert.equal(await page.locator('.syp-resize-handle').count(),0);assert.equal((await page.locator('.syp-dialog--tree').boundingBox()).x,240);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('tree branches fold and both the column divider and panel top resize independently without changing preview selection',async()=>{
  const {page,errors}=await setup({popupFirst:false,sidebar:true,nestedPaths:true});
  try{
    await page.locator('#editor-a .protyle-wysiwyg').click();await page.keyboard.press('Control+Shift+f');const input=page.locator('.syp-query-input');await input.fill('Search');await page.waitForFunction(()=>document.querySelector('.syp-preview-info')?.textContent.includes('3 处匹配'));
    await page.locator('.syp-tree-branch').first().click();assert.equal(await page.locator('.syp-result').count(),0);await page.locator('.syp-tree-branch').first().click();assert.equal(await page.locator('.syp-result').count(),0);
    await page.locator('.syp-tree-branch[data-kind="document"]').click();assert.equal(await page.locator('.syp-result').count(),3);
    await page.locator('.syp-result').nth(1).click();const selection=await page.locator('.syp-result[aria-selected="true"]').getAttribute('data-index');await input.focus();
    const divider=await page.locator('.syp-pane-divider--vertical').boundingBox(),before=await page.locator('.syp-result-pane').boundingBox();
    await page.mouse.move(divider.x+3,divider.y+divider.height/2);await page.mouse.down();await page.mouse.move(divider.x+83,divider.y+divider.height/2,{steps:5});await page.mouse.up();
    assert.ok(Math.abs((await page.locator('.syp-result-pane').boundingBox()).width-before.width-80)<2);
    const top=await page.locator('.syp-find-dock-resize').boundingBox(),panel=await page.locator('.syp-dialog').boundingBox();await page.mouse.move(top.x+top.width/2,top.y+2);await page.mouse.down();await page.mouse.move(top.x+top.width/2,top.y-78,{steps:5});await page.mouse.up();
    const resized=await page.locator('.syp-dialog').boundingBox();assert.ok(Math.abs(resized.height-panel.height-80)<2);assert.ok(Math.abs(resized.y+resized.height-panel.y-panel.height)<1);
    assert.equal(await input.evaluate(node=>document.activeElement===node),true);assert.equal(await page.locator('.syp-result[aria-selected="true"]').getAttribute('data-index'),selection);assert.ok(await page.locator('.syp-preview-reading').textContent());assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('full preview text extraction preserves paragraphs, code, tables, formulas and media labels',async()=>{
  const {page}=await setup();
  try {
    const bundle=await build({entryPoints:['src/search/preview-source.ts'],bundle:true,write:false,format:'iife',globalName:'PreviewSource',target:'es2022'});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const blocks=await page.evaluate(()=>window.PreviewSource.previewBlocksFromDOM(
      '<div data-node-id="p" data-type="NodeParagraph"><div>hello <strong>world</strong><br>next<img alt="example" src="/assets/test.png"></div><div class="protyle-attr">ignore</div></div>'+ 
      '<div data-node-id="c" data-type="NodeCodeBlock" data-subtype="python"><div class="protyle-action">ignore</div><div>line 1\nline 2</div></div>'+ 
      '<div data-node-id="t" data-type="NodeTable"><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></div>'+ 
      '<div data-node-id="m" data-type="NodeMathBlock" class="render-node" data-content="x+y"></div>'+ 
      '<div data-node-id="av" data-type="NodeAttributeView"></div>', 'doc'));
    assert.deepEqual(blocks.map(block=>block.text),['hello world\nnext[图片：example]','line 1\nline 2','a\tb\nc\td','x+y','[数据库]']);
    assert.equal(blocks[1].language,'python');
  }finally{await page.close()}
});
