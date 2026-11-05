// Offline authoring tool. Runtime generation only applies verified Sudoku symmetries.
import {countSolutions, gradePuzzle} from '../src/engine.js';
import {writeFileSync} from 'node:fs';
const solution='534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const pools={beginner:[],easy:[],medium:[],hard:[],expert:[]};
let seed=91438;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const seen=new Set();
for(let attempt=0;attempt<6000;attempt++){
  const added=new Set();
  const board=solution.split('').map(Number),order=Array.from({length:81},(_,i)=>i).sort(()=>rand()-.5);
  for(const i of order){const prev=board[i];board[i]=0;if(countSolutions(board)!==1){board[i]=prev;continue;}
    const grade=gradePuzzle(board),level=grade.levelId,key=board.join('');
    if(pools[level].length<5&&!seen.has(key)&&!added.has(level)&&board.filter(v=>!v).length>=32){added.add(level);pools[level].push({givens:key,solution,grade});seen.add(key);console.log(level,pools[level].length,grade);}
  }
  if(Object.values(pools).every(p=>p.length>=5))break;
}
if(Object.values(pools).some(p=>!p.length))throw new Error('Could not produce every grade');
writeFileSync(new URL('../src/puzzles.js',import.meta.url),'// Verified unique puzzles, graded by the bundled logical solver. Generated offline.\nexport const PUZZLES = '+JSON.stringify(pools,null,2)+';\n');
