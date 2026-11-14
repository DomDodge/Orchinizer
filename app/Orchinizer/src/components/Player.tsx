import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { send, useSecondsLeft, useNet } from '../net';
import { instrumentInfo, type Player, type State } from '../protocol';
import { BeatRing } from './Pulse';
import { BG, Btn, DIM, FG, H1, P, Screen, SeatBadge, Timer } from './ui';

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

/** Perform: glow in your color while your part plays, pulse on the beat, buzz when cued in. */
export function Playing({ state, me }: { state: State; me: Player }) {
  const left = useSecondsLeft(state.deadline);
  const level = state.live[me.seat];
  const on = level != null;
  const was = useRef(on);
  useEffect(() => {
    if (on && !was.current) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    was.current = on;
  }, [on]);

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
        {instrumentInfo(me.instrument).emoji} {on ? `You're in! ${level}%` : 'Waiting for your cue'}
      </H1>
      <Timer left={left} />
    </Screen>
  );
}

/** Results: the winner and every conductor's score, top score first. */
export function Results({ state }: { state: State }) {
  const { seat } = useNet();
  // The server's `winner` (a round number) wins any tie.
  const ranked = [...state.performances].sort(
    (a, b) => b.score - a.score || Number(b.round === state.winner) - Number(a.round === state.winner) || a.round - b.round,
  );
  const win = ranked[0];
  const colorOf = (s?: number) => state.players.find((p) => p.seat === s)?.color ?? FG;
  return (
    <Screen style={{ justifyContent: 'center' }}>
      <Text style={styles.crown}>👑</Text>
      <H1 color={colorOf(win?.conductorSeat)}>{win ? `${win.conductorName} wins!` : 'Show’s over'}</H1>
      <ScrollView contentContainerStyle={{ gap: 10 }} style={{ flexGrow: 0 }}>
        {ranked.map((pf, i) => {
          const color = colorOf(pf.conductorSeat);
          return (
            <View key={pf.round} style={[styles.row, { borderColor: color, backgroundColor: pf.conductorSeat === seat ? color + '33' : 'transparent' }]}>
              <View style={styles.rowTop}>
                <Text style={[styles.rowName, { color }]}>
                  {i + 1}. {pf.conductorName}
                </Text>
                <Text style={styles.rowScore}>{pf.score}</Text>
              </View>
              <Text style={{ color: DIM }}>
                {pf.perfect} perfect · {pf.good} good · {pf.miss} miss
              </Text>
            </View>
          );
        })}
      </ScrollView>
      {state.host === seat && <Btn label="Back to lobby" onPress={() => send({ type: 'host_action', action: 'restart' })} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  seat: { fontSize: 160, fontWeight: '900' },
  row: { borderWidth: 3, borderRadius: 18, padding: 16, gap: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowName: { fontSize: 22, fontWeight: '900', flexShrink: 1 },
  rowScore: { fontSize: 28, fontWeight: '900', color: FG },
  crown: { fontSize: 120, textAlign: 'center' },
});
