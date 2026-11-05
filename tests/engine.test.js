import test from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS,generatePuzzle,candidates,validateEntry,analyzeBoard,findHint,isSolved,countSolutions,gradePuzzle,solveLogical} from '../src/engine.js';
import {PUZZLES} from '../src/puzzles.js';
const empty=()=>Array(81).fill(0);

test('five levels have Russian labels and strictly increasing unlock requirements',()=>{
  assert.equal(LEVELS.length,5);
  LEVELS.forEach((l,i)=>{assert.match(l.label,/[А-Яа-я]/);if(i)assert.ok(l.unlockWins>LEVELS[i-1].unlockWins);});
});
test('all authored puzzles are unique, correctly graded, and have a valid matching solution',()=>{
  for(const level of LEVELS)for(const p of PUZZLES[level.id]){
    const g=[...p.givens].map(Number),s=[...p.solution].map(Number);
    assert.equal(g.length,81);assert.equal(countSolutions(g),1);assert.ok(isSolved(s));
    assert.ok(g.every((v,i)=>!v||v===s[i]));assert.equal(gradePuzzle(g).levelId,level.id);
  }
});
test('seeded variants are deterministic, unique, graded, and preserve givens',()=>{
  for(const level of LEVELS)for(let seed=0;seed<16;seed++){
    const p=generatePuzzle(level.id,seed);
    assert.deepEqual(generatePuzzle(level.id,seed),p);
    assert.equal(countSolutions(p.givens),1);assert.ok(isSolved(p.solution));
    assert.ok(p.givens.every((v,i)=>!v||v===p.solution[i]));
    assert.equal(gradePuzzle(p.givens).levelId,level.id);
  }
  assert.notDeepEqual(generatePuzzle('easy',1).givens,generatePuzzle('easy',2).givens);
});
test('completion checks rows, columns, boxes, types, and shape',()=>{
  const p=generatePuzzle('easy',17);assert.equal(isSolved(p.givens),false);assert.equal(isSolved(p.solution),true);
  const bad=p.solution.slice();bad[0]=bad[1];assert.equal(isSolved(bad),false);
  assert.equal(isSolved(p.solution.map(String)),false);assert.equal(isSolved([]),false);
});
test('candidate sets exclude occupied values in all peer units',()=>{
  const board=empty();board[1]=1;board[9]=2;board[10]=3;
  assert.deepEqual(candidates(board,0),[4,5,6,7,8,9]);assert.deepEqual(candidates(board,1),[]);
});
test('ambiguous right and wrong entries both remain neutral, even when puzzle is logically solvable',()=>{
  const p=generatePuzzle('easy',42);let checked=false;
  assert.equal(solveLogical(p.givens).solved,true);
  for(let index=0;index<81;index++)if(!p.givens[index]){
    const results=candidates(p.givens,index).map(value=>({value,...validateEntry({givens:p.givens,entries:empty(),index,value})}));
    const right=results.find(r=>r.value===p.solution[index]),wrong=results.find(r=>r.value!==p.solution[index]&&r.status==='tentative');
    if(right?.status==='tentative'&&wrong){checked=true;break;}
  }
  assert.ok(checked,'must not auto-fill unplayed inference chains');
});
test('tentative guesses never contaminate other validation, including tentative duplicates',()=>{
  const g=empty(),entries=empty();entries[0]=1;
  assert.equal(validateEntry({givens:g,entries,index:1,value:1}).status,'tentative');
  entries[1]=1;const a=analyzeBoard(g,entries);
  assert.deepEqual(a.tentativeIndices,[0,1]);assert.deepEqual(a.conflicts,[]);assert.deepEqual(a.trusted,g);
});
test('a known wrong but ambiguous guess does not affect any other verdict',()=>{
  const p=generatePuzzle('easy',42),entries=empty();let guess;
  for(let i=0;i<81&&!guess;i++)if(!p.givens[i])for(const v of candidates(p.givens,i))if(v!==p.solution[i]&&validateEntry({givens:p.givens,entries,index:i,value:v}).status==='tentative'){guess={i,v};break;}
  assert.ok(guess);entries[guess.i]=guess.v;
  for(let i=0;i<81;i++)if(!p.givens[i])for(let value=1;value<=9;value++)assert.deepEqual(validateEntry({givens:p.givens,entries,index:i,value}),validateEntry({givens:p.givens,entries:empty(),index:i,value}));
});
test('duplicate of trusted clue is rejected; originals cannot change; clear is permitted',()=>{
  const g=empty();g[0]=7;
  for(const index of [1,9,10])assert.equal(validateEntry({givens:g,entries:empty(),index,value:7}).status,'mistake');
  assert.equal(validateEntry({givens:g,entries:empty(),index:0,value:8}).status,'mistake');
  assert.equal(validateEntry({givens:g,entries:empty(),index:1,value:0}).status,'accepted');
});
test('played proven entries support future deductions without autofilling unplayed cells',()=>{
  const p=generatePuzzle('medium',71),entries=empty();let n=0;
  while(true){const h=findHint(p.givens,entries);if(!h)break;assert.equal(h.value,p.solution[h.index]);assert.ok(h.reason);assert.equal(validateEntry({givens:p.givens,entries,index:h.index,value:h.value}).status,'accepted');entries[h.index]=h.value;assert.ok(++n<=81);}
  assert.ok(n>20);assert.ok(isSolved(p.givens.map((g,i)=>g||entries[i])));
  assert.deepEqual(analyzeBoard(p.givens,entries).trusted,p.solution);
  assert.deepEqual(analyzeBoard(p.givens,empty()).trusted,p.givens);
});
test('unproved board has no speculative hint and invalid submissions are handled',()=>{
  assert.equal(findHint(empty(),empty()),null);
  for(const value of [-1,10,NaN,1.5,'2'])assert.equal(validateEntry({givens:empty(),entries:empty(),index:0,value}).status,'mistake');
});

test('duplicate explanations name the exact unit, value, and trusted witness cell',()=>{
  const g=empty();g[0]=7;
  for(const [index,unit] of [[1,'строка 1'],[9,'столбец 1'],[10,'блок 1']]){
    const result=validateEntry({givens:g,entries:empty(),index,value:7});
    assert.equal(result.technique,'conflict');assert.ok(result.reason.includes(unit));
    assert.match(result.reason,/цифра 7/);assert.match(result.reason,/строка 1, столбец 1/);
  }
});
test('deduction explanations identify singles and actual pair or intersection witnesses',()=>{
  const seen=new Set();
  for(let seed=0;seed<5;seed++){
    const p=generatePuzzle('hard',seed);
    for(let i=0;i<81;i++)if(!p.givens[i])for(const value of candidates(p.givens,i)){
      const r=validateEntry({givens:p.givens,entries:empty(),index:i,value});
      if(r.technique==='locked_candidates'&&r.status==='mistake'){
        seen.add('locked');assert.match(r.reason,/пересечени/);assert.match(r.reason,/клетк/);
      }
      if(r.technique==='naked_pair'&&r.status==='mistake'){
        seen.add('pair');assert.match(r.reason,/Открытая пара/);assert.match(r.reason,/область/);
      }
      if(r.technique==='hidden_single')assert.match(r.reason,/области «(?:строка|столбец|блок) \d»/);
      if(r.technique==='naked_single')assert.match(r.reason,/остался только/);
    }
  }
  assert.ok(seen.has('locked'));assert.ok(seen.has('pair'));
});
test('random tentative entries cannot cause false acceptance, false rejection, or poisoned trusted facts',()=>{
  let seed=3908;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  let accepted=0,rejected=0,tentative=0;
  for(const level of LEVELS)for(let variant=0;variant<3;variant++){
    const p=generatePuzzle(level.id,variant+300),entries=empty();
    // Seed a legitimate played deduction chain before mixing in arbitrary guesses.
    for(let step=0;step<7;step++){const hint=findHint(p.givens,entries);if(!hint)break;entries[hint.index]=hint.value;}
    for(let round=0;round<3;round++){
      for(let t=0;t<10;t++){const i=Math.floor(random()*81);if(!p.givens[i])entries[i]=1+Math.floor(random()*9);}
      const {trusted}=analyzeBoard(p.givens,entries);
      assert.ok(trusted.every((v,i)=>!v||v===p.solution[i]),'guesses must not poison certification');
      for(let probe=0;probe<6;probe++){
        let index=Math.floor(random()*81);while(p.givens[index])index=(index+1)%81;
        for(let value=1;value<=9;value++){
          const r=validateEntry({givens:p.givens,entries,index,value});
          if(r.status==='accepted'){accepted++;assert.equal(value,p.solution[index]);}
          if(r.status==='mistake'){rejected++;assert.notEqual(value,p.solution[index]);}
          if(r.status==='tentative')tentative++;
        }
      }
    }
  }
  assert.ok(accepted>0&&rejected>0&&tentative>0);
});
