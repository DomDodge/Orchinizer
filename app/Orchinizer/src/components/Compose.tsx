import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { playNote, preload } from '../audio';
import { send, useSecondsLeft } from '../net';
import { DRUM_ROWS, emptySteps, instrumentInfo, noteName, ROWS, STEPS, type Player, type State, type Steps } from '../protocol';
import { Btn, DIM, FG, H1, P, Screen, Timer } from './ui';

/** Mount with key={round} so each round starts fresh. */
export function Compose({ state, me }: { state: State; me: Player }) {
  const info = instrumentInfo(me.instrument);
  const inst = info.voice;
  const drums = inst === 'drums';
  const [steps, setSteps] = useState<Steps>(() => state.patterns[me.seat] ?? emptySteps());
  const [playing, setPlaying] = useState(false);
  const [col, setCol] = useState(-1);
  const left = useSecondsLeft(state.deadline);
  // Top row = highest note. Drums only use rows 0–2.
  const rows = drums ? [2, 1, 0] : Array.from({ length: ROWS }, (_, i) => ROWS - 1 - i);

  useEffect(() => preload(inst, state.key), [inst, state.key]);

  useEffect(() => {
    if (!playing) return;
    let step = 0;
    const tick = () => {
      setCol(step);
      steps.forEach((row, r) => row[step] && rows.includes(r) && playNote(inst, state.key, r));
      step = (step + 1) % STEPS;
    };
    tick();
    const id = setInterval(tick, 60000 / state.tempo / 2); // 8th notes
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, steps, state.tempo, state.key, inst]);

  const toggle = (r: number, c: number) => {
    const next = steps.map((row, i) => (i === r ? row.map((on, j) => (j === c ? !on : on)) : row));
    setSteps(next);
    send({ type: 'pattern', steps: next });
    if (next[r][c] && !playing) playNote(inst, state.key, r);
  };

  return (
    <Screen bg="#0B0B12">
      <View style={styles.header}>
        <Text style={[styles.inst, { color: me.color }]}>
          {info.emoji} {info.label}
        </Text>
        <Timer left={left} />
      </View>
      <P>
        Round {state.round} · key of {state.key} · {state.tempo} bpm
      </P>
      <View style={styles.grid}>
        {rows.map((r) => (
          <View key={r} style={styles.row}>
            <Text style={styles.label}>{drums ? DRUM_ROWS[r] : noteName(state.key, r)}</Text>
            {steps[r].map((on, c) => (
              <Pressable
                key={c}
                onPress={() => toggle(r, c)}
                style={[
                  styles.cell,
                  c % 2 === 0 && styles.beat,
                  on && { backgroundColor: me.color },
                  playing && col === c && styles.playhead,
                ]}
              />
            ))}
          </View>
        ))}
      </View>
      <Btn label={playing ? '■ Stop preview' : '▶ Preview'} color={playing ? '#444' : '#6C63FF'} onPress={() => setPlaying(!playing)} />
      <P>Your part loops when the conductor cues you in. Empty parts get a default.</P>
    </Screen>
  );
}

/** What the conductor sees while the band composes. */
export function ConductorWaiting({ state }: { state: State }) {
  const left = useSecondsLeft(state.deadline);
  const band = state.players.filter((p) => p.instrument && p.seat !== state.conductor);
  const ready = band.filter((p) => p.noteCount > 0).length;
  const total = band.length;
  return (
    <Screen style={{ justifyContent: 'center' }}>
      <H1>🎼 You conduct round {state.round}</H1>
      <P>The band is writing their parts. Stand where you can point at everyone.</P>
      <Timer left={left} />
      <P color={FG}>
        {ready}/{total} parts started
      </P>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inst: { fontSize: 30, fontWeight: '900' },
  grid: { gap: 6, marginVertical: 8 },
  row: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  label: { width: 48, color: DIM, fontWeight: '700', fontSize: 14 },
  cell: { flex: 1, aspectRatio: 1, borderRadius: 8, backgroundColor: '#1E1E2C' },
  beat: { backgroundColor: '#26263A' },
  playhead: { borderWidth: 3, borderColor: '#fff' },
});
