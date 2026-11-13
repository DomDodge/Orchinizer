import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextTarget, rankPerformances, scoreAccuracy, scoreMultiplier } from './scoring.ts';
import type { PerformanceSummary, RoundScoring, ScoreSummary } from '../../../protocol/messages.ts';

const summary: ScoreSummary = { points: 600, maxCombo: 5, perfect: 4, good: 1, misses: 1, total: 6 };

test('prompt selection skips resolved and expired targets using server time', () => {
  const scoring: RoundScoring = { summary, combo: 0, targets: [
    { id: 1, seat: 2, action: 'in', at: 1000, result: 'perfect' },
    { id: 2, seat: 3, action: 'out', at: 2000, result: 'pending' },
    { id: 3, seat: 4, action: 'in', at: 3000, result: 'pending' },
  ] };
  assert.equal(nextTarget(scoring, 2300)?.id, 2);
  assert.equal(nextTarget(scoring, 2301)?.id, 3);
  assert.equal(nextTarget(scoring, 3301), undefined);
  assert.equal(nextTarget(undefined, 0), undefined);
});

test('combo display matches bonus thresholds and cap; final accuracy counts misses', () => {
  assert.deepEqual([0, 4, 5, 9, 10, 14, 15, 100].map(scoreMultiplier), [1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(scoreAccuracy(summary), 83);
  assert.equal(scoreAccuracy({ ...summary, total: 0 }), 0);
});

test('leaderboard uses points, then votes, then earlier round without changing state', () => {
  const performance = (round: number, points: number, votes: number): PerformanceSummary => ({
    round, conductorSeat: round, conductorName: `Player ${round}`, key: 'C', tempo: 100, votes, score: { ...summary, points },
  });
  const performances = [performance(3, 100, 9), performance(4, 600, 1), performance(2, 600, 2), performance(1, 600, 2)];
  assert.deepEqual(rankPerformances(performances).map(p => p.round), [1, 2, 4, 3]);
  assert.deepEqual(performances.map(p => p.round), [3, 4, 2, 1]);
});
