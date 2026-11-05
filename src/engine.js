import { PUZZLES } from './puzzles.js';

/** Unlock requirements are total completed puzzles; the UI additionally enforces sequential access. */
export const LEVELS = [
  {id:'beginner',label:'Начальный',description:'Одиночные кандидаты, много открытых клеток',unlockWins:0},
  {id:'easy',label:'Лёгкий',description:'Больше шагов с одиночными кандидатами',unlockWins:2},
  {id:'medium',label:'Средний',description:'Скрытые одиночные кандидаты',unlockWins:5},
  {id:'hard',label:'Сложный',description:'Заблокированные кандидаты и пары',unlockWins:9},
  {id:'expert',label:'Эксперт',description:'За пределами базовых логических приёмов',unlockWins:14},
];
const DIGITS = [1,2,3,4,5,6,7,8,9];
export const UNITS = [
  ...Array.from({length:9},(_,r)=>DIGITS.map((_,c)=>r*9+c)),
  ...Array.from({length:9},(_,c)=>DIGITS.map((_,r)=>r*9+c)),
  ...Array.from({length:9},(_,b)=>DIGITS.map((_,k)=>(Math.floor(b/3)*3+Math.floor(k/3))*9+(b%3)*3+k%3)),
];
const PEERS = Array.from({length:81},(_,i)=>[...new Set(UNITS.filter(u=>u.includes(i)).flat())].filter(j=>j!==i));
/** Remove only the placed digit from its peers; keep the input intact for undo. */
export function removePeerNotes(notes,index,value) {
  const peers=new Set(PEERS[index]);
  return notes.map((cellNotes,i)=>i===index?[]:peers.has(i)?cellNotes.filter(d=>d!==value):cellNotes.slice());
}
const norm = board => Array.from({length:81},(_,i)=>Number.isInteger(board?.[i]) && board[i]>=1 && board[i]<=9 ? board[i] : 0);
const valid = board => UNITS.every(u=>{const a=u.map(i=>board[i]).filter(Boolean); return new Set(a).size===a.length;});
/** Candidates reflect the supplied board. For validation, use validateEntry rather than passing guesses here. */
export function candidates(board,index) {
  if(!Number.isInteger(index)||index<0||index>80||board[index]) return [];
  return DIGITS.filter(d=>!PEERS[index].some(i=>board[i]===d));
}
export function isSolved(board) {return Array.isArray(board)&&board.length===81&&board.every(d=>Number.isInteger(d)&&d>=1&&d<=9)&&valid(board);}
const label = {naked_single:'Единственный кандидат',hidden_single:'Скрытый одиночный кандидат',locked_candidates:'Заблокированные кандидаты',naked_pair:'Открытая пара'};
const rank = {naked_single:1,hidden_single:2,locked_candidates:3,naked_pair:4};
/** Pure logical solver: no solution oracle or search. Deductions are valid consequences of givens. */
export function solveLogical(input) {
  const board=norm(input), deductions=[], sets=board.map((v,i)=>new Set(v?[]:candidates(board,i)));
  if(!valid(board)) return {board,deductions,solved:false,contradiction:true,maxTechnique:0};
  let maxTechnique=0, lastElimination=null;
  const place=(index,value,technique)=>{
    const effective=lastElimination&&rank[lastElimination]>rank[technique]?lastElimination:technique;
    const reason=`${label[effective]}: в строке ${Math.floor(index/9)+1}, столбце ${index%9+1} можно доказать ${value}.`;
    board[index]=value; sets[index].clear(); PEERS[index].forEach(j=>sets[j].delete(value));
    deductions.push({index,value,technique:effective,reason}); maxTechnique=Math.max(maxTechnique,rank[effective]);
  };
  for(let guard=0;guard<1000;guard++) {
    if(board.some((v,i)=>!v&&!sets[i].size)) return {board,deductions,solved:false,contradiction:true,maxTechnique};
    const single=board.findIndex((v,i)=>!v&&sets[i].size===1);
    if(single>=0){place(single,[...sets[single]][0],'naked_single');continue;}
    let hidden=null;
    for(const u of UNITS){for(const d of DIGITS){if(u.some(i=>board[i]===d))continue;const cells=u.filter(i=>!board[i]&&sets[i].has(d));if(!cells.length)return {board,deductions,solved:false,contradiction:true,maxTechnique};if(cells.length===1){hidden=[cells[0],d];break;}}if(hidden)break;}
    if(hidden){place(...hidden,'hidden_single');continue;}
    let changed=false;
    for(const u of UNITS){for(const d of DIGITS){const cells=u.filter(i=>!board[i]&&sets[i].has(d));if(cells.length<2)continue;for(const v of UNITS){if(v===u||!cells.every(i=>v.includes(i)))continue;for(const i of v){if(!u.includes(i)&&sets[i].delete(d))changed=true;}}}}
    if(changed){lastElimination='locked_candidates';maxTechnique=Math.max(maxTechnique,3);continue;}
    for(const u of UNITS){const pairs=new Map();for(const i of u){if(sets[i].size===2){const key=[...sets[i]].sort().join('');pairs.set(key,[...(pairs.get(key)||[]),i]);}}for(const [key, cells]of pairs){if(cells.length!==2)continue;for(const i of u){if(cells.includes(i))continue;for(const d of key.split('').map(Number)){if(sets[i].delete(d))changed=true;}}}}
    if(changed){lastElimination='naked_pair';maxTechnique=Math.max(maxTechnique,4);continue;}
    break;
  }
  return {board,deductions,solved:isSolved(board),contradiction:false,maxTechnique};
}
const cellName=i=>`строка ${Math.floor(i/9)+1}, столбец ${i%9+1}`;
const unitName=u=>{const n=UNITS.indexOf(u);return n<9?`строка ${n+1}`:n<18?`столбец ${n-8}`:`блок ${n-17}`;};
/** Candidate eliminations do not place unplayed numbers. Each removed digit retains its witness. */
function immediateProof(board) {
  const sets=board.map((v,i)=>new Set(v?[]:candidates(board,i)));
  const exclusions=Array.from({length:81},()=>new Map());
  for(let i=0;i<81;i++)if(!board[i])for(const d of DIGITS)if(!sets[i].has(d)){
    const peer=PEERS[i].find(j=>board[j]===d);
    const unit=UNITS.find(u=>u.includes(i)&&u.includes(peer));
    exclusions[i].set(d,{technique:'conflict',reason:`${unitName(unit)}: цифра ${d} уже есть в доказанной клетке (${cellName(peer)}). В клетке (${cellName(i)}) повторять её нельзя.`});
  }
  const remove=(i,d,technique,reason)=>{if(!sets[i].delete(d))return false;exclusions[i].set(d,{technique,reason});return true;};
  for(let guard=0;guard<100;guard++) {
    let changed=false;
    for(const u of UNITS)for(const d of DIGITS){
      const cells=u.filter(i=>!board[i]&&sets[i].has(d));
      if(cells.length<2)continue;
      for(const v of UNITS){
        if(v===u||!cells.every(i=>v.includes(i)))continue;
        for(const i of v)if(!u.includes(i)&&remove(i,d,'locked_candidates',`Заблокированные кандидаты: в области «${unitName(u)}» цифра ${d} возможна только в пересечении с областью «${unitName(v)}»; поэтому она исключена из клетки (${cellName(i)}) вне пересечения.`))changed=true;
      }
    }
    for(const u of UNITS){
      const pairs=new Map();
      for(const i of u)if(sets[i].size===2){const key=[...sets[i]].sort().join('');pairs.set(key,[...(pairs.get(key)||[]),i]);}
      for(const [key,cells] of pairs){
        // Earlier eliminations in this unit can change a pair: re-check the live sets.
        if(cells.length!==2||!cells.every(i=>sets[i].size===2&&[...sets[i]].sort().join('')===key))continue;
        for(const i of u)if(!cells.includes(i))for(const d of key.split('').map(Number))if(remove(i,d,'naked_pair',`Открытая пара ${key[0]} и ${key[1]} в клетках (${cellName(cells[0])}) и (${cellName(cells[1])}), область «${unitName(u)}»: цифра ${d} исключена из клетки (${cellName(i)}).`))changed=true;
      }
    }
    if(!changed)break;
  }
  const moves=new Map();
  for(let i=0;i<81;i++)if(!board[i]&&sets[i].size===1){
    const value=[...sets[i]][0],advanced=[...exclusions[i].values()].filter(e=>e.technique!=='conflict');
    const technique=advanced.length?advanced.at(-1).technique:'naked_single';
    const reason=`В клетке (${cellName(i)}) остался только ${value}: остальные цифры исключены.`+(advanced.length?` ${advanced.at(-1).reason}`:' Цифры исключены уже заполненными доказанными клетками строки, столбца и блока.');
    moves.set(i,{index:i,value,technique,reason});
  }
  for(const u of UNITS)for(const d of DIGITS){
    if(u.some(i=>board[i]===d))continue;
    const cells=u.filter(i=>!board[i]&&sets[i].has(d));
    if(cells.length===1&&!moves.has(cells[0]))moves.set(cells[0],{index:cells[0],value:d,technique:'hidden_single',reason:`Скрытый одиночный кандидат: в области «${unitName(u)}» цифра ${d} возможна только в клетке (${cellName(cells[0])}).`});
  }
  return {sets,moves,exclusions};
}
function certify(givens,entries,exclude=-1){
  const trusted=norm(givens),e=norm(entries);
  if(!valid(trusted))return {trusted,proof:immediateProof(trusted)};
  for(let guard=0;guard<81;guard++){
    const p=immediateProof(trusted);let changed=false;
    // All moves were proven against the same trusted snapshot, so simultaneous
    // placements cannot rely on one another or on any tentative submitted values.
    for(const m of p.moves.values())if(m.index!==exclude&&e[m.index]===m.value){trusted[m.index]=m.value;changed=true;}
    if(!changed)return {trusted,proof:p};
  }
  return {trusted,proof:immediateProof(trusted)};
}
function classify(p,index,value){
  const excluded=p.exclusions[index].get(value);
  if(excluded)return {status:'mistake',...excluded};
  const move=p.moves.get(index);
  if(move)return value===move.value?{status:'accepted',reason:move.reason,technique:move.technique}:{status:'mistake',reason:move.reason,technique:move.technique};
  return {status:'tentative',reason:'Пока нет логического доказательства. Запись не считается ошибкой.',technique:null};
}
/** accepted = proven using current played facts; tentative = neither proven nor disproven. */
export function validateEntry({givens,entries,index,value}) {
  if(!Number.isInteger(index)||index<0||index>=81||!Number.isInteger(value)||value<0||value>9)return {status:'mistake',reason:'Недопустимое значение клетки.',technique:'invalid'};
  const g=norm(givens);
  if(g[index])return {status:value===g[index]?'accepted':'mistake',reason:'Это исходная подсказка, её нельзя менять.',technique:'given'};
  if(value===0)return {status:'accepted',reason:'Клетка очищена.',technique:'clear'};
  if(!valid(g))return {status:'tentative',reason:'Не удалось проверить исходное поле.',technique:null};
  return classify(certify(g,entries,index).proof,index,value);
}
/** Trusted entries are iteratively proven without filling unplayed deductions. Conflict indices are explainable errors only. */
export function analyzeBoard(givens,entries) {
  const g=norm(givens),e=norm(entries),{trusted,proof}=certify(g,e),tentativeIndices=[],conflicts=[];
  for(let i=0;i<81;i++)if(!g[i]&&e[i]&&!trusted[i]){if(classify(proof,i,e[i]).status==='mistake')conflicts.push(i);else tentativeIndices.push(i);}
  return {trusted,tentativeIndices,conflicts};
}
/** A hint is a provable current move, never a guess. Null means this solver cannot justify a placement. */
export function findHint(givens,entries) {
  const {proof}=certify(givens,entries);
  return [...proof.moves.values()].find(d=>entries?.[d.index]!==d.value)||null;
}
/** Counts solutions with a bounded search; used for puzzle verification only, never input validation. */
export function countSolutions(input,limit=2) {
  const board=norm(input);if(!valid(board))return 0;let count=0;
  function visit(){let idx=-1,opts=null;for(let i=0;i<81;i++){if(board[i])continue;const c=candidates(board,i);if(!c.length)return;if(!opts||c.length<opts.length){idx=i;opts=c;if(c.length===1)break;}}if(idx<0){count++;return;}for(const d of opts){board[idx]=d;visit();if(count>=limit)break;}board[idx]=0;}
  visit();return count;
}
export function gradePuzzle(input) {
  const r=solveLogical(input),blanks=norm(input).filter(v=>!v).length;
  return {levelId:!r.solved?'expert':r.maxTechnique>=3?'hard':r.maxTechnique===2?'medium':blanks>40?'easy':'beginner', solvedLogically:r.solved,maxTechnique:r.maxTechnique,steps:r.deductions.length};
}
function rng(seed){let s=2166136261;for(const c of String(seed)){s^=c.charCodeAt(0);s=Math.imul(s,16777619);}return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
function shuffle(a,random){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
/** Instant, deterministic digit/row/column/transpose symmetries preserve uniqueness. */
export function generatePuzzle(levelId='beginner',seed=Date.now()) {
  if(!LEVELS.some(l=>l.id===levelId))levelId='beginner';
  const random=rng(seed),pool=PUZZLES[levelId],source=pool[Math.floor(random()*pool.length)],digits=[0,...shuffle(DIGITS,random)];
  const axis=()=>shuffle([0,1,2],random).flatMap(b=>shuffle([0,1,2],random).map(i=>b*3+i));
  const rows=axis(),cols=axis(),transpose=random()<0.5;
  const transform=s=>Array.from({length:81},(_,i)=>{let r=rows[Math.floor(i/9)],c=cols[i%9];return digits[Number(s[transpose?c*9+r:r*9+c])];});
  return {id:`${levelId}-${String(seed)}`,givens:transform(source.givens),solution:transform(source.solution),levelId,seed};
}
