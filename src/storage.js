import {LEVELS,generatePuzzle,isSolved} from './engine.js';
const DB='supersudoku', KEY='current', MIRROR='supersudoku.backup.v1';
let dbPromise;
export const storageStatus={mode:'indexeddb',error:null};
export function emptyState(){return {version:1,updatedAt:new Date().toISOString(),game:null,profile:{wins:{},history:[],completedIds:[]},settings:{theme:'light',highlight:true}};}
function database(){
  if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore('state');req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result);};req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Database upgrade is blocked'));});
  return dbPromise;
}
export function validateState(input){
  if(!input||input.version!==1||!input.profile||!input.settings)throw new Error('Это не резервная копия SuperSudoku.');
  const output=emptyState(), levels=new Set(LEVELS.map(l=>l.id));
  output.updatedAt=typeof input.updatedAt==='string'&&!Number.isNaN(Date.parse(input.updatedAt))?input.updatedAt:output.updatedAt;
  output.settings={theme:input.settings.theme==='dark'?'dark':'light',highlight:input.settings.highlight!==false};
  const history=Array.isArray(input.profile.history)?input.profile.history:[];
  if(history.length>10000)throw new Error('Слишком большая история игр.');
  const seen=new Set();
  output.profile.history=history.filter(h=>h&&typeof h.id==='string'&&h.id.length<160&&levels.has(h.levelId)&&typeof h.won==='boolean'&&Number.isFinite(h.elapsedMs)&&h.elapsedMs>=0&&Number.isInteger(h.mistakes)&&h.mistakes>=0&&h.mistakes<=3&&typeof h.completedAt==='string'&&!Number.isNaN(Date.parse(h.completedAt))).filter(h=>{if(seen.has(h.id))return false;seen.add(h.id);return true;}).map(h=>({id:h.id,levelId:h.levelId,won:h.won,elapsedMs:Math.min(h.elapsedMs,31536000000),mistakes:h.mistakes,completedAt:h.completedAt}));
  output.profile.completedIds=output.profile.history.map(h=>h.id);
  for(const h of output.profile.history)if(h.won)output.profile.wins[h.levelId]=(output.profile.wins[h.levelId]||0)+1;
  if(input.game){
    const g=input.game;
    if(!levels.has(g.levelId)||!['number','string'].includes(typeof g.seed)||String(g.seed).length>100)throw new Error('Некорректная головоломка в копии.');
    const original=generatePuzzle(g.levelId,g.seed);
    const digits=a=>Array.isArray(a)&&a.length===81&&a.every(n=>Number.isInteger(n)&&n>=0&&n<=9);
    if(!digits(g.givens)||JSON.stringify(original.givens)!==JSON.stringify(g.givens)||!digits(g.entries)||g.entries.some((v,i)=>g.givens[i]&&v))throw new Error('Некорректное поле в копии.');
    if(!['playing','won','lost'].includes(g.status)||!Number.isInteger(g.mistakes)||g.mistakes<0||g.mistakes>3||!Number.isFinite(g.elapsedMs)||g.elapsedMs<0)throw new Error('Некорректное состояние игры.');
    if(g.status==='won'&&!isSolved(g.givens.map((v,i)=>v||g.entries[i])))throw new Error('Незавершённая игра помечена как победа.');
    const notes=Array.from({length:81},(_,i)=>Array.isArray(g.notes?.[i])?[...new Set(g.notes[i].filter(v=>Number.isInteger(v)&&v>=1&&v<=9))]:[]);
    const undo=Array.isArray(g.undo)?g.undo.slice(-120).filter(s=>digits(s.entries)&&Array.isArray(s.notes)&&s.notes.length===81&&!s.entries.some((v,i)=>g.givens[i]&&v)).map(s=>({entries:s.entries.slice(),notes:s.notes.map(a=>Array.isArray(a)?[...new Set(a.filter(v=>Number.isInteger(v)&&v>=1&&v<=9))]:[])})):[];
    output.game={id:original.id,seed:g.seed,levelId:g.levelId,givens:original.givens,entries:g.entries.slice(),notes,undo,mistakes:g.mistakes,elapsedMs:Math.min(g.elapsedMs,31536000000),status:g.mistakes===3?'lost':g.status,rejectedAttempts:Array.isArray(g.rejectedAttempts)?g.rejectedAttempts.filter(v=>typeof v==='string'&&/^\d{1,2}:[1-9]:[0-9]{81}$/.test(v)).slice(-1000):[],startedAt:typeof g.startedAt==='string'?g.startedAt:output.updatedAt};
  }
  return output;
}
export async function loadState(){
  let primary=null,mirror=null;
  try{const db=await database();primary=await new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get(KEY);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch(e){storageStatus.mode='localstorage';storageStatus.error=e.message;}
  try{mirror=JSON.parse(localStorage.getItem(MIRROR)||'null');}catch{}
  for(const value of [primary,mirror].filter(Boolean).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))){try{return validateState(value);}catch{}}
  return emptyState();
}
export function saveMirror(state){try{localStorage.setItem(MIRROR,JSON.stringify(state));return true;}catch{return false;}}
let writeChain=Promise.resolve();
export function saveState(state){
  const copy=structuredClone(state), mirrored=saveMirror(copy);
  writeChain=writeChain.catch(()=>{}).then(async()=>{try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(copy,KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});storageStatus.mode='indexeddb';return true;}catch(e){storageStatus.mode=mirrored?'localstorage':'memory';storageStatus.error=e.message;if(!mirrored)throw new Error('Браузер не разрешил сохранить игру. Экспортируйте копию в настройках.');return true;}});
  return writeChain;
}
export function unlockedLevelIndex(profile){const total=Object.values(profile.wins).reduce((a,b)=>a+b,0);let index=0;for(let i=1;i<LEVELS.length;i++){if(total>=LEVELS[i].unlockWins&&profile.wins[LEVELS[i-1].id]>0)index=i;else break;}return index;}
export function unlockDescription(levelIndex,profile){if(levelIndex===0)return 'Открыт с первой игры';const level=LEVELS[levelIndex],previous=LEVELS[levelIndex-1],total=Object.values(profile.wins).reduce((a,b)=>a+b,0);return `${Math.min(total,level.unlockWins)} / ${level.unlockWins} побед всего · нужна победа на уровне «${previous.label}»`;}
