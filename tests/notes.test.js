import test from 'node:test';
import assert from 'node:assert/strict';
import {removePeerNotes,generatePuzzle,validateEntry} from '../src/engine.js';
import {emptyState,validateState} from '../src/storage.js';

const allNotes=()=>Array.from({length:81},()=>[1,2,3,4,5,6,7,8,9]);
const isPeer=(a,b)=>Math.floor(a/9)===Math.floor(b/9)||a%9===b%9||(Math.floor(a/27)===Math.floor(b/27)&&Math.floor((a%9)/3)===Math.floor((b%9)/3));

test('every placed digit removes only matching notes from all row, column and box peers',()=>{
  for(let index=0;index<81;index++)for(let value=1;value<=9;value++){
    const before=allNotes(),after=removePeerNotes(before,index,value);
    let changedPeers=0;
    for(let i=0;i<81;i++){
      const expected=i===index?[]:isPeer(index,i)?before[i].filter(d=>d!==value):before[i];
      assert.deepEqual(after[i],expected,`cell ${index}, digit ${value}, peer ${i}`);
      assert.notEqual(after[i],before[i]);
      assert.equal(before[i].length,9,'undo input must remain unchanged');
      if(i!==index&&after[i].length===8)changedPeers++;
    }
    assert.equal(changedPeers,20);
  }
});

test('empty notes stay empty; replacements only remove the newly placed digit',()=>{
  const notes=allNotes();notes[1]=[];
  const first=removePeerNotes(notes,0,4),replacement=removePeerNotes(first,0,7);
  assert.deepEqual(first[1],[]);
  assert.deepEqual(replacement[9],[1,2,3,5,6,8,9]);
  assert.deepEqual(replacement[40],notes[40]);
  assert.deepEqual(first[9],[1,2,3,5,6,7,8,9]);
});

test('cleaned notes and exact pre-move undo snapshot survive a save round-trip',()=>{
  const state=emptyState(),puzzle=generatePuzzle('easy',42),index=puzzle.givens.findIndex(v=>!v);
  const entries=Array(81).fill(0),notes=allNotes();
  const value=Array.from({length:9},(_,i)=>i+1).find(value=>validateEntry({givens:puzzle.givens,entries,index,value}).status!=='mistake');
  state.game={id:puzzle.id,seed:42,levelId:'easy',givens:puzzle.givens,entries:entries.slice(),notes:removePeerNotes(notes,index,value),undo:[{entries,notes}],rejectedAttempts:[],mistakes:0,elapsedMs:0,status:'playing',startedAt:state.updatedAt};
  state.game.entries[index]=value;
  const restored=validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.game.notes,state.game.notes);
  assert.deepEqual(restored.game.undo[0],{entries,notes});
  const previous=restored.game.undo.pop();
  restored.game.entries=previous.entries;restored.game.notes=previous.notes;
  assert.equal(restored.game.entries[index],0);
  assert.deepEqual(restored.game.notes,notes);
});
