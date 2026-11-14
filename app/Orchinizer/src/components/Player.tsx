import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { send, useSecondsLeft, useNet } from '../net';
import { instrumentInfo, type Player, type State } from '../protocol';
import { rankPerformances, scoreAccuracy } from '../scoring';
import { BeatRing } from './Pulse';
import { BG, Btn, FG, H1, P, Screen, SeatBadge, Timer } from './ui';

/** Everyone except the conductor during calibrate: show the seat number big so the conductor can find you. */
export function HoldUp({ state, me }: { state: State; me: Player }) {
  const conductor = state.players.find((p) => p.seat === state.conductor);
  const left = useSecondsLeft(state.deadline);
  return (
    <Screen bg={me.color + '22'}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 14, paddingVertical: 12 }}>
        <P color={FG}>ORCHESTRA SETUP · ROUND {state.round}</P>
        <Timer left={left} />
        <P>Hold your phone up so {conductor?.name ?? 'the conductor'} can find you.</P>
        <SeatBadge seat={me.seat} color={me.color} size={180} />
        <H1 color={me.color}>{me.name}</H1>
        <P color={FG}>{instrumentInfo(me.instrument).emoji} {instrumentInfo(me.instrument).label}</P>
        <P>Stay in the same spot until the performance ends.</P>
      </ScrollView>
    </Screen>
  );
}

/** Perform: flash in your color and buzz when the conductor plays one of your notes; pulse on the beat. */
export function Playing({ state, me }: { state: State; me: Player }) {
  const left = useSecondsLeft(state.deadline);
  const last = state.scoring?.last;
  const lastSeat = last && state.scoring?.targets.find((t) => t.id === last.targetId)?.seat;
  const hit = lastSeat === me.seat && (last?.result === 'perfect' || last?.result === 'good');
  const hitKey = hit ? `${last?.targetId}-${last?.at}` : '';
  const [faded, setFaded] = useState(''); // the hit whose flash is over
  const on = hit && faded !== hitKey;
  useEffect(() => {
    if (!hitKey) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const t = setTimeout(() => setFaded(hitKey), 500);
    return () => clearTimeout(t);
  }, [hitKey]);

  if (!me.instrument)
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <H1>🎼 Watch the conductor</H1>
        <Timer left={left} />
      </Screen>
    );

  return (
    <Screen bg={on ? me.color : BG} style={{ justifyContent: 'center', alignItems: 'center' }}>
      <BeatRing color={on ? '#fff' : me.color} size={300} />
      <Text style={[styles.seat, { color: on ? BG : me.color }]}>{me.seat}</Text>
      <H1 color={on ? BG : me.color}>
        {instrumentInfo(me.instrument).emoji} {on ? 'Played!' : 'Watch the TV for your notes'}
      </H1>
      <Timer left={left} />
    </Screen>
  );
}

export function Results({ state }: { state: State }) {
  const { seat } = useNet();
  const win = state.performances.find((p) => p.round === state.winner);
  const color = state.players.find((p) => p.seat === win?.conductorSeat)?.color ?? FG;
  const ranked = rankPerformances(state.performances);
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 14 }}>
        <Text style={styles.crown}>👑</Text>
        <H1 color={color}>{win ? `${win.conductorName} wins!` : 'Show’s over'}</H1>
        {win?.score && <P>{win.score.points} points</P>}
        {ranked.map((performance, index) => performance.score && (
          <View key={performance.round} style={styles.scoreRow}>
            <Text style={[styles.voteName, { color: FG, fontSize: 20 }]}>{index + 1}. {performance.conductorName} · {performance.score.points}</Text>
            <P>{scoreAccuracy(performance.score)}% hits · best combo {performance.score.maxCombo} · {performance.score.misses} missed</P>
          </View>
        ))}
        {ranked.some(p => p.score) && <P>Highest score wins. A tie goes to the earlier round.</P>}
        {state.host === seat && <Btn label="Back to lobby" onPress={() => send({ type: 'host_action', action: 'restart' })} />}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  seat: { fontSize: 160, fontWeight: '900' },
  voteName: { fontSize: 24, fontWeight: '900' },
  scoreRow: { borderWidth: 1, borderColor: '#33334A', borderRadius: 14, padding: 14, gap: 6 },
  crown: { fontSize: 120, textAlign: 'center' },
});
