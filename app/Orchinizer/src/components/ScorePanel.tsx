import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SCORE_HIT_WINDOW_MS } from '../../../../protocol/messages.ts';
import { serverNow } from '../net';
import { instrumentInfo, type State } from '../protocol';
import { nextTarget, scoreMultiplier } from '../scoring';
import { DIM, FG, P } from './ui';

export function ScorePanel({ state }: { state: State }) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 50);
    return () => clearInterval(timer);
  }, []);
  const scoring = state.scoring;
  if (!scoring) return null;
  const target = nextTarget(scoring, now);
  const player = state.players.find(p => p.seat === target?.seat);
  const remaining = target ? target.at - now : 0;
  const inWindow = !!target && remaining <= 0 && remaining >= -SCORE_HIT_WINDOW_MS;
  const color = player?.color ?? FG;
  const feedback = scoring.last && now - scoring.last.at < 1200 ? scoring.last : null;
  const progress = Math.max(0, Math.min(1, 1 - remaining / 2200));
  const resultColor = feedback?.result === 'perfect' ? '#69F0AE' : feedback?.result === 'good' ? '#FFB300' : '#FF5252';

  return (
    <View style={styles.panel}>
      <View style={styles.metrics}>
        <View><Text style={styles.value}>{scoring.summary.points}</Text><Text style={styles.label}>POINTS</Text></View>
        <View><Text style={styles.value}>{scoring.combo}</Text><Text style={styles.label}>COMBO</Text></View>
        <View><Text style={[styles.value, { color: '#FFB300' }]}>×{scoreMultiplier(scoring.combo)}</Text><Text style={styles.label}>MULTIPLIER</Text></View>
      </View>
      {target && player ? (
        <View style={[styles.prompt, { borderColor: color }]}>
          <Text style={[styles.when, { color }]}>{inWindow ? 'NOW' : `IN ${(Math.max(0, remaining) / 1000).toFixed(1)}s`} · CUE {target.action.toUpperCase()}</Text>
          <Text style={styles.who}>{player.name} · {instrumentInfo(player.instrument).label}</Text>
          <View style={styles.track}><View style={[styles.progress, { backgroundColor: color, width: `${progress * 100}%` }]} /></View>
        </View>
      ) : <P color={FG}>All prompts finished</P>}
      <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: feedback ? resultColor : DIM }]}>
        {feedback ? feedback.result === 'early' ? 'Too early — wait for NOW' : `${feedback.result.toUpperCase()}${feedback.points ? ` +${feedback.points}` : ' · combo reset'}` : 'Perfect 100 · Good 50 · combo bonus every 5 hits'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
