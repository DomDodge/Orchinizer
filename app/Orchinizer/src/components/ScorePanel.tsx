import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SCORE_HIT_WINDOW_MS } from '../../../../protocol/messages.ts';
import { serverNow } from '../net';
import { instrumentInfo, type State } from '../protocol';
import { nextTarget, scoreMultiplier } from '../scoring';
import { DIM, FG, P } from './ui';

/** aimSeat: who the conductor is pointing at now, so a hold can show when they drift off. */
export function ScorePanel({ state, aimSeat = 0 }: { state: State; aimSeat?: number }) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      setNow(serverNow());
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);
  const scoring = state.scoring;
  if (!scoring) return null;
  const target = nextTarget(scoring, now);
  const player = state.players.find(p => p.seat === target?.seat);
  const remaining = target ? target.at - now : 0;
  const inWindow = !!target && remaining <= 0 && remaining >= -SCORE_HIT_WINDOW_MS;
  const color = player?.color ?? FG;
  const feedback = scoring.last && now - scoring.last.at < 1200 ? scoring.last : null;
  const holding = target?.kind === 'hold' && remaining <= 0;
  const onTarget = !holding || aimSeat === target.seat;
  // Approach bar before a prompt; during a hold, how much of the hold has passed.
  const progress = holding ? Math.min(1, (now - target.at) / (target.end - target.at)) : Math.max(0, Math.min(1, 1 - remaining / 2200));
  const what = target?.kind === 'hold' ? 'FLICK + HOLD' : 'PLAY';
  const resultColor = feedback?.result === 'perfect' ? '#69F0AE' : feedback?.result === 'good' ? '#FFB300' : '#FF5252';

  return (
    <View style={styles.panel}>
      <View style={styles.metrics}>
        <View><Text style={styles.value}>{scoring.summary.points}</Text><Text style={styles.label}>POINTS</Text></View>
        <View><Text style={styles.value}>{scoring.combo}</Text><Text style={styles.label}>COMBO</Text></View>
        <View><Text style={[styles.value, { color: '#FFB300' }]}>×{scoreMultiplier(scoring.combo)}</Text><Text style={styles.label}>MULTIPLIER</Text></View>
      </View>
      <Lanes state={state} now={now} aimSeat={aimSeat} />
      {target && player ? (
        <View style={[styles.prompt, { borderColor: color }]}>
          <Text style={[styles.when, { color }]}>
            {holding ? 'HOLD · keep pointing' : `${inWindow ? 'NOW' : `IN ${(Math.max(0, remaining) / 1000).toFixed(1)}s`} · ${what}`}
          </Text>
          <Text style={styles.who}>
            {player.name} · {instrumentInfo(player.instrument).label}
            {!onTarget ? ' · point back!' : ''}
          </Text>
          <View style={styles.track}><View style={[styles.progress, { backgroundColor: onTarget ? color : '#FF5252', width: `${progress * 100}%` }]} /></View>
        </View>
      ) : <P color={FG}>All prompts finished</P>}
      <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: feedback ? resultColor : DIM }]}>
        {feedback ? feedback.result === 'early' ? 'Too early — wait for NOW' : `${feedback.result.toUpperCase()}${feedback.points ? ` +${feedback.points}` : ' · combo reset'}` : 'Perfect 100 · Good 50 · combo bonus every 5 hits'}
      </Text>
    </View>
  );
}

const LOOK_MS = 3000; // how far ahead the lanes show prompts
const LANES_H = 170;
const HIT_Y = LANES_H - 34; // the line a prompt crosses at its time; seat badges sit below it

/** Prompts falling toward each player's lane, like the TV's, so the conductor can read ahead. */
function Lanes({ state, now, aimSeat }: { state: State; now: number; aimSeat: number }) {
  const band = state.players.filter((p) => p.instrument && p.seat !== state.conductor);
  const y = (t: number) => HIT_Y - ((t - now) / LOOK_MS) * HIT_Y;
  return (
    <View style={styles.lanes}>
      {band.map((p) => (
        <View key={p.seat} style={[styles.lane, p.seat === aimSeat && { backgroundColor: p.color + '33' }]}>
          {state.scoring!.targets.map((t) => {
            if (t.seat !== p.seat || t.result === 'perfect' || t.result === 'good') return null;
            const bottom = y(t.at);
            const top = t.kind === 'hold' ? y(t.end) : bottom;
            if (bottom < -14 || top > HIT_Y + 20) return null; // not in view yet, or long past
            const missed = t.result === 'miss';
            return (
              <View
                key={t.id}
                style={[styles.chip, { top: top - 12, height: bottom - top + 24, backgroundColor: missed ? '#33334A' : p.color }]}
              >
                <Text style={styles.chipText}>{missed ? 'MISS' : t.kind === 'hold' ? 'HOLD' : 'PLAY'}</Text>
              </View>
            );
          })}
          <View style={[styles.hitLine, { backgroundColor: p.color }]} />
          <Text style={[styles.laneSeat, { color: p.color }]}>{p.seat}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  lanes: { flexDirection: 'row', gap: 4, height: LANES_H },
  lane: { flex: 1, backgroundColor: '#15151F', borderRadius: 10, overflow: 'hidden' },
  chip: { position: 'absolute', left: 4, right: 4, borderRadius: 12, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 4 },
  chipText: { color: '#0B0B12', fontSize: 11, fontWeight: '900' },
  hitLine: { position: 'absolute', left: 0, right: 0, top: HIT_Y, height: 3 },
  laneSeat: { position: 'absolute', left: 0, right: 0, bottom: 4, textAlign: 'center', fontSize: 18, fontWeight: '900' },
  panel: { gap: 8 },
  metrics: { flexDirection: 'row', justifyContent: 'space-around' },
  value: { color: FG, fontSize: 28, fontWeight: '900', textAlign: 'center', fontVariant: ['tabular-nums'] },
  label: { color: DIM, fontSize: 10, fontWeight: '800', textAlign: 'center', letterSpacing: 1 },
  prompt: { padding: 12, gap: 6, borderRadius: 14, borderWidth: 2, backgroundColor: '#15151F' },
  when: { fontWeight: '900', fontSize: 16 },
  who: { color: FG, fontWeight: '700', fontSize: 16 },
  track: { height: 6, backgroundColor: '#33334A', borderRadius: 3, overflow: 'hidden' },
  progress: { height: 6 },
  feedback: { fontSize: 13, fontWeight: '700', textAlign: 'center', minHeight: 18 },
});
