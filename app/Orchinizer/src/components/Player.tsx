import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { send, useSecondsLeft } from '../net';
import { instrumentInfo, type Player, type State } from '../protocol';
import { BeatRing } from './Pulse';
import { BG, DIM, FG, H1, P, Screen, SeatBadge, Timer } from './ui';

/** Everyone except the conductor during calibrate: show the seat number big so the conductor can find you. */
export function HoldUp({ state, me }: { state: State; me: Player }) {
  const conductor = state.players.find((p) => p.seat === state.conductor);
  return (
    <Screen bg={me.color + '22'} style={{ justifyContent: 'center' }}>
      <P color={FG}>Hold your phone up — {conductor?.name ?? 'the conductor'} is calibrating</P>
      <SeatBadge seat={me.seat} color={me.color} size={240} />
      <H1 color={me.color}>{me.name}</H1>
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

export function Vote({ state, me }: { state: State; me: Player }) {
  const left = useSecondsLeft(state.deadline);
  const [mine, setMine] = useState(0);
  return (
    <Screen>
      <H1>🗳️ Best performance?</H1>
      <Timer left={left} />
      {state.performances.map((pf) => {
        const own = pf.conductor === me.seat;
        const color = state.players.find((p) => p.seat === pf.conductor)?.color ?? FG;
        return (
          <Pressable
            key={pf.round}
            disabled={own}
            onPress={() => {
              setMine(pf.round);
              send({ type: 'vote', round: pf.round });
              Haptics.selectionAsync();
            }}
            style={[styles.vote, { borderColor: color, backgroundColor: mine === pf.round ? color : 'transparent', opacity: own ? 0.35 : 1 }]}
          >
            <Text style={[styles.voteName, { color: mine === pf.round ? BG : color }]}>{pf.name}</Text>
            <Text style={{ color: mine === pf.round ? BG : DIM }}>
              Round {pf.round} · key of {pf.key} · {own ? 'yours' : `${pf.votes} votes`}
            </Text>
          </Pressable>
        );
      })}
    </Screen>
  );
}

export function Results({ state }: { state: State }) {
  const win = state.performances.find((p) => p.round === state.winner);
  const color = state.players.find((p) => p.seat === win?.conductor)?.color ?? FG;
  return (
    <Screen style={{ justifyContent: 'center' }}>
      <Text style={styles.crown}>👑</Text>
      <H1 color={color}>{win ? `${win.name} wins!` : 'Show’s over'}</H1>
      {win && <P>{win.votes} votes · watch the TV for the replay</P>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  seat: { fontSize: 160, fontWeight: '900' },
  vote: { borderWidth: 3, borderRadius: 18, padding: 18, gap: 4 },
  voteName: { fontSize: 24, fontWeight: '900' },
  crown: { fontSize: 120, textAlign: 'center' },
});
