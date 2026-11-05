import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
const require=createRequire(import.meta.url);
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js'));}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
await mkdir('test-results',{recursive:true});
const base=process.env.BASE_URL||'http://localhost:4173';let failures=0;
async function test(name,run){try{await run();console.log('PASS',name);}catch(e){failures++;console.error('FAIL',name,e.stack);}}
const ctx=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('supersudoku.backup.v1')));
async function seed(level='easy',seed=42,mutate=null){await page.goto(base+'/manifest.webmanifest');await page.evaluate(async({level,seed})=>{const {generatePuzzle}=await import('./src/engine.js');const {emptyState,saveState}=await import('./src/storage.js');const s=emptyState(),p=generatePuzzle(level,seed);s.game={...p,seed,levelId:level,entries:Array(81).fill(0),notes:Array.from({length:81},()=>[]),undo:[],rejectedAttempts:[],mistakes:0,elapsedMs:0,status:'playing',startedAt:s.updatedAt};await saveState(s);},{level,seed});if(mutate)await page.evaluate(mutate);await page.goto(base);await page.waitForSelector('.cell');}
async function choose(i){await page.locator(`[data-index="${i}"]`).click();}
await page.goto(base);await page.waitForSelector('.cell');
await test('desktop layout and initial playable game',async()=>{assert.equal(await page.locator('.cell').count(),81);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'test-results/desktop.png',fullPage:true});});
await test('notes, keyboard erase and undo, pause',async()=>{await seed();const s=await read(),i=s.game.givens.findIndex(v=>!v);await choose(i);await page.keyboard.press('n');await page.keyboard.press('3');assert.deepEqual((await read()).game.notes[i],[3]);await page.keyboard.press('Delete');assert.deepEqual((await read()).game.notes[i],[]);await page.keyboard.press('Control+z');assert.deepEqual((await read()).game.notes[i],[3]);await page.locator('#pause-button').click();await page.keyboard.press('4');assert.deepEqual((await read()).game.notes[i],[3]);assert.equal(await page.locator('#board').getAttribute('inert'),'');await page.locator('#resume-button').click();await page.keyboard.press('n');});
await test('placements clean peer notes atomically; undo, replacement, erase and reload preserve them',async()=>{
  await seed('easy',42,async()=>{
    const {saveState}=await import('./src/storage.js');
    const s=JSON.parse(localStorage.getItem('supersudoku.backup.v1'));
    s.game.notes=s.game.givens.map(v=>v?[]:[1,2,3,4,5,6,7,8,9]);
    await saveState(s);
  });
  const before=(await read()).game;
  const move=await page.evaluate(async()=>{
    const {generatePuzzle,validateEntry}=await import('./src/engine.js'),p=generatePuzzle('easy',42);
    for(let i=0;i<81;i++)if(!p.givens[i]){
      const values=Array.from({length:9},(_,n)=>n+1).filter(value=>validateEntry({givens:p.givens,entries:Array(81).fill(0),index:i,value}).status==='tentative');
      if(values.length>1)return {i,values};
    }
  });
  assert.ok(move);
  const peer=i=>Math.floor(i/9)===Math.floor(move.i/9)||i%9===move.i%9||(Math.floor(i/27)===Math.floor(move.i/27)&&Math.floor((i%9)/3)===Math.floor((move.i%9)/3));
  const expected=value=>before.notes.map((notes,i)=>i===move.i?[]:peer(i)?notes.filter(n=>n!==value):notes);
  await choose(move.i);await page.keyboard.press(String(move.values[0]));
  assert.deepEqual((await read()).game.notes,expected(move.values[0]));
  for(let i=0;i<81;i++)if(!before.givens[i]&&i!==move.i)assert.equal((await page.locator(`[data-index="${i}"]`).textContent()).replace(/\s/g,''),expected(move.values[0])[i].join(''));
  await page.reload();await page.waitForSelector('.cell');
  assert.deepEqual((await read()).game.notes,expected(move.values[0]));
  await page.locator('#undo-button').click();
  assert.deepEqual((await read()).game.notes,before.notes);
  assert.deepEqual((await read()).game.entries,before.entries);
  await choose(move.i);await page.keyboard.press(String(move.values[0]));
  await page.keyboard.press(String(move.values[1]));
  const replaced=expected(move.values[0]).map((notes,i)=>peer(i)?notes.filter(n=>n!==move.values[1]):notes);
  assert.deepEqual((await read()).game.notes,replaced);
  await page.keyboard.press('Delete');
  assert.deepEqual((await read()).game.notes,replaced);
  await page.keyboard.press('Control+z');
  assert.equal((await read()).game.entries[move.i],move.values[1]);
  await page.keyboard.press('Control+z');
  assert.deepEqual((await read()).game.notes,expected(move.values[0]));
  await page.keyboard.press('Control+z');
  assert.deepEqual((await read()).game.notes,before.notes);
  const invalid=before.givens.find((v,i)=>v&&peer(i));
  assert.ok(invalid);await page.keyboard.press(String(invalid));
  assert.deepEqual((await read()).game.notes,before.notes);
  assert.equal((await read()).game.undo.length,0);
  assert.equal((await read()).game.mistakes,1);
});
await test('ambiguous correct and incorrect candidates render identically and persist',async()=>{await seed();const move=await page.evaluate(async()=>{const {generatePuzzle,candidates,validateEntry}=await import('./src/engine.js'),p=generatePuzzle('easy',42);for(let i=0;i<81;i++)if(!p.givens[i]){const values=candidates(p.givens,i).filter(value=>validateEntry({givens:p.givens,entries:Array(81).fill(0),index:i,value}).status==='tentative');if(values.includes(p.solution[i])&&values.some(v=>v!==p.solution[i]))return {i,right:p.solution[i],wrong:values.find(v=>v!==p.solution[i])};}});assert.ok(move);await choose(move.i);await page.keyboard.press(String(move.right));const cls=await page.locator(`[data-index="${move.i}"]`).getAttribute('class');await page.keyboard.press(String(move.wrong));assert.equal(await page.locator(`[data-index="${move.i}"]`).getAttribute('class'),cls);assert.equal((await read()).game.mistakes,0);await page.reload();assert.equal((await read()).game.entries[move.i],move.wrong);assert.equal(await page.locator(`[data-index="${move.i}"]`).textContent(),String(move.wrong));});
await test('repeated rejected input only penalized once; three distinct mistakes lose',async()=>{await seed();const moves=await page.evaluate(async()=>{const {validateEntry}=await import('./src/engine.js'),g=JSON.parse(localStorage.getItem('supersudoku.backup.v1')).game;return g.givens.flatMap((v,i)=>v?[]:Array.from({length:9},(_,j)=>({i,v:j+1})).filter(m=>validateEntry({givens:g.givens,entries:g.entries,index:m.i,value:m.v}).status==='mistake')).slice(0,3);});await choose(moves[0].i);await page.keyboard.press(String(moves[0].v));await page.keyboard.press(String(moves[0].v));await choose(moves[0].i);await page.keyboard.press(String(moves[0].v));assert.equal((await read()).game.mistakes,1);for(const m of moves.slice(1)){await choose(m.i);await page.keyboard.press(String(m.v));}assert.equal((await read()).game.status,'lost');assert.equal((await read()).profile.history.length,1);await page.locator('[data-close]').click();assert.equal(await page.locator('.digit').first().isDisabled(),true);await page.reload();assert.equal((await read()).game.status,'lost');});
await test('completion counted once and level unlock at second win',async()=>{await seed('beginner',11,async()=>{const {generatePuzzle}=await import('./src/engine.js'),{saveState}=await import('./src/storage.js'),s=JSON.parse(localStorage.getItem('supersudoku.backup.v1')),p=generatePuzzle('beginner',11);const blank=s.game.givens.findIndex(v=>!v);s.game.entries=p.solution.map((v,i)=>s.game.givens[i]||i===blank?0:v);s.profile={wins:{beginner:1},completedIds:['prior-win'],history:[{id:'prior-win',levelId:'beginner',won:true,elapsedMs:10000,mistakes:0,completedAt:new Date().toISOString()}]};await saveState(s);});const s=await read(),i=s.game.givens.findIndex((v,i)=>!v&&!s.game.entries[i]);const v=await page.evaluate(async i=>(await import('./src/engine.js')).generatePuzzle('beginner',11).solution[i],i);await choose(i);await page.keyboard.press(String(v));assert.equal((await read()).game.status,'won');assert.equal((await read()).profile.wins.beginner,2);assert.match(await page.locator('#dialog-content').textContent(),/Открыт уровень/);await page.reload();assert.equal((await read()).profile.wins.beginner,2);await page.locator('[data-view="progress"]').first().click();assert.equal(await page.locator('[data-level="easy"]').isDisabled(),false);});
await test('settings dark mode, export and validated import',async()=>{await page.locator('#settings-button').click();await page.locator('#theme-toggle').check();assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('dark')),true);const download=page.waitForEvent('download');await page.locator('#export-button').click();const d=await download;await d.saveAs('test-results/backup.json');await page.locator('#import-input').setInputFiles('test-results/backup.json');await page.locator('[data-action="1"]').click();assert.equal((await read()).profile.wins.beginner,2);await page.reload();assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('dark')),true);});
await test('IndexedDB recovers progress without localStorage mirror',async()=>{const before=await read();await page.goto(base+'/manifest.webmanifest');await page.evaluate(()=>localStorage.removeItem('supersudoku.backup.v1'));await page.goto(base);await page.waitForSelector('.cell');assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('dark')),true);assert.match(await page.locator('#stats').textContent(),/2/);assert.equal(await page.evaluate(async()=>{const {loadState}=await import('./src/storage.js');return (await loadState()).game.id;}),before.game.id);});
await test('mobile layouts 320, 375, 390, 768px have no overflow',async()=>{for(const width of [320,375,390,768]){await page.setViewportSize({width,height:844});await page.goto(base);await page.waitForSelector('.cell');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);await page.locator('#settings-button').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`dialog overflow at ${width}`);await page.locator('[data-close]').click();if(width===390)await page.screenshot({path:'test-results/mobile.png',fullPage:true});}});
await test('service-worker offline reload',async()=>{const offlineCtx=await browser.newContext(),p=await offlineCtx.newPage();await p.goto(base);await p.waitForSelector('.cell');await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await p.waitForFunction(()=>!!navigator.serviceWorker.controller);await offlineCtx.setOffline(true);await p.reload();await p.waitForSelector('.cell');assert.equal(await p.locator('.cell').count(),81);await offlineCtx.close();});
await test('no runtime exceptions',()=>assert.deepEqual(errors,[]));
await browser.close();if(failures)process.exitCode=1;
