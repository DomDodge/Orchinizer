import { SCORE_HIT_WINDOW_MS, type PerformanceSummary, type RoundScoring, type ScoreSummary } from '../../../protocol/messages.ts';

export const scoreMultiplier = (combo: number) => Math.min(4, 1 + Math.floor(combo / 5));

/** The next prompt still open at `now`: a flick until its hit window closes, a hold until it ends. */
export function nextTarget(scoring: RoundScoring | undefined, now: number) {
  return scoring?.targets.find(target => target.result === 'pending' && (target.kind === 'hold' ? target.end : target.at + SCORE_HIT_WINDOW_MS) >= now);
}

export const scoreAccuracy = (score: ScoreSummary) => score.total ? Math.round((score.perfect + score.good) / score.total * 100) : 0;

/** Same tie-breaks as the server; never reorder or mutate the received state. */
export function rankPerformances(performances: PerformanceSummary[]) {
  return [...performances].sort((a, b) => (b.score?.points ?? 0) - (a.score?.points ?? 0) || a.round - b.round);
}
