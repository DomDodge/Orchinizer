import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMsg, joinRoom, newRoom, stateOf } from './mock-lobby.mts';

test('lobby rules: host conducts, picks are unique and limited to enabled categories', () => {
  const r = newRoom('ABCD');
  joinRoom(r, 'a', 'Ana');
  joinRoom(r, 'b', 'Ben');
  joinRoom(r, 'c', 'Cat');
  assert.equal(stateOf(r).conductor, 1);

  assert.equal(applyMsg(r, 'b', { type: 'categories', categories: ['wind'] }), 'Only the conductor picks categories');
  assert.equal(applyMsg(r, 'b', { type: 'pick', instrument: 'violin' }), null);
  assert.equal(applyMsg(r, 'c', { type: 'pick', instrument: 'violin' }), 'Ben already picked Violin');
  assert.equal(applyMsg(r, 'c', { type: 'pick', instrument: 'cello' }), null); // same category, different instrument

  // Turning strings off clears both strings picks.
  assert.equal(applyMsg(r, 'a', { type: 'categories', categories: ['wind', 'percussion'] }), null);
  assert.deepEqual(stateOf(r).players.map((p) => p.instrument), ['', '', '']);
  assert.equal(applyMsg(r, 'b', { type: 'pick', instrument: 'violin' }), "Violin isn't in this game");
});

test('disconnect keeps the seat; leave frees it and passes the baton', () => {
  const r = newRoom('ABCD');
  joinRoom(r, 'a', 'Ana');
  joinRoom(r, 'b', 'Ben');
  applyMsg(r, 'b', { type: 'pick', instrument: 'drums' });

  r.players[1].online = false; // socket dropped
  joinRoom(r, 'b', 'Ben'); // same id reconnects
  assert.deepEqual(stateOf(r).players.map((p) => [p.seat, p.online, p.instrument]), [[1, true, ''], [2, true, 'drums']]);

  applyMsg(r, 'a', { type: 'leave' });
  assert.equal(stateOf(r).conductor, 2); // next in join order conducts
  joinRoom(r, 'c', 'Cat');
  assert.equal(stateOf(r).players.find((p) => p.name === 'Cat')?.seat, 1); // reuses the freed seat
});

test('the conductor can remove a player, nobody else can', () => {
  const r = newRoom('ABCD');
  joinRoom(r, 'a', 'Ana');
  joinRoom(r, 'b', 'Ben');
  joinRoom(r, 'c', 'Cat');
  applyMsg(r, 'c', { type: 'pick', instrument: 'piano' });
  assert.equal(applyMsg(r, 'b', { type: 'kick', seat: 3 }), 'Only the conductor can remove players');
  assert.equal(applyMsg(r, 'a', { type: 'kick', seat: 1 }), 'No such player');
  assert.equal(applyMsg(r, 'a', { type: 'kick', seat: 8 }), 'No such player');
  assert.equal(r.players.length, 3);
  r.players[2].online = false; // offline seats can be removed too
  assert.equal(applyMsg(r, 'a', { type: 'kick', seat: 3 }), null);
  assert.deepEqual(stateOf(r).players.map((p) => p.name), ['Ana', 'Ben']);
  assert.equal(applyMsg(r, 'b', { type: 'pick', instrument: 'piano' }), null); // Cat's instrument is free again
  joinRoom(r, 'd', 'Dan');
  assert.equal(r.players[2].seat, 3); // the removed seat is available
});
