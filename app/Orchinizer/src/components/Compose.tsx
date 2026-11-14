import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LOOP_STEPS, STEPS_PER_BEAT, type Note } from '../../../../protocol/messages.ts';
import { playNoteFor, preload } from '../audio';
import { onPatternRejected, send, useSecondsLeft } from '../net';
import { DRUM_ROWS, instrumentInfo, type Player, type State } from '../protocol';
import { NoteEditor, type SheetNote } from './NoteEditor';
import { Btn, FG, H1, P, Screen, Timer } from './ui';

/** Mount with key={round} so each round starts fresh. */
export function Compose({ state, me }: { state: State; me: Player }) {
  const info = instrumentInfo(me.instrument);
  const inst = me.instrument; // each instrument has its own preview sounds
  const drums = info.voice === 'drums';
  // A remount mid-round (e.g. after a reconnect) picks the part back up from the server.
  const [notes, setNotes] = useState<Note[]>(() => state.notes?.[me.seat] ?? []);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [rejected, setRejected] = useState<string | null>(null);
  const left = useSecondsLeft(state.deadline);
  const band = state.players.filter((p) => p.instrument && p.seat !== state.conductor);
  const doneCount = band.filter((p) => p.done).length;
  const stepMs = 60000 / state.tempo / STEPS_PER_BEAT;

  // The shared sheet: everyone else's notes, which mine have to fit around.
  const others: SheetNote[] = state.players
    .filter((p) => p.seat !== me.seat)
    .flatMap((p) => (state.notes?.[p.seat] ?? []).map((n) => ({ ...n, seat: p.seat, owner: p.name, color: p.color })));
  const instrumentOf = (seat: number) => state.players.find((p) => p.seat === seat)?.instrument || inst;

  useEffect(() => preload(inst, state.key), [inst, state.key]);

  // The server refused a change: go back to the last part it accepted and say why.
  const serverNotes = state.notes?.[me.seat];
  useEffect(
    () =>
      onPatternRejected((message) => {
        setNotes(serverNotes ?? []);
        setRejected(message);
      }),
    [serverNotes],
  );
  useEffect(() => {
    if (!rejected) return;
    const t = setTimeout(() => setRejected(null), 3000);
    return () => clearTimeout(t);
  }, [rejected]);

  // Preview: loop the whole song in 16th-note steps, each note on its writer's instrument for its length.
  // Read the sheet through a ref so other players' edits don't restart the preview from the top.
  const sheet = [
    ...notes.map((n) => ({ n, inst: n.instrument || inst })),
    ...others.map((n) => ({ n, inst: n.instrument || instrumentOf(n.seat) })),
  ];
  const song = useRef(sheet);
  useEffect(() => {
    song.current = sheet;
  });
  useEffect(() => {
    if (!playing) return;
    let s = 0;
    const tick = () => {
      setStep(s);
      for (const { n, inst: i } of song.current) if (n.start === s) playNoteFor(i, state.key, n.row, n.length * stepMs);
      s = (s + 1) % LOOP_STEPS;
    };
    tick();
    const id = setInterval(tick, stepMs);
    return () => clearInterval(id);
  }, [playing, stepMs, state.key]);

  const onChange = (next: Note[]) => {
    setNotes(next);
    send({ type: 'pattern', notes: next });
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
      <NoteEditor
        notes={notes}
        onChange={onChange}
        color={me.color}
        keyName={state.key}
        disabled={left === 0 || me.done}
        onPlace={(n) => playNoteFor(inst, state.key, n.row, n.length * stepMs)}
        rows={drums ? DRUM_ROWS.length : undefined}
        rowLabels={drums ? DRUM_ROWS : undefined}
        playhead={playing ? step : -1}
        others={others}
      />
      {rejected && <P color="#FF5252">{rejected}</P>}
      <Btn label={playing ? '■ Stop preview' : '▶ Preview'} color={playing ? '#444' : '#6C63FF'} onPress={() => setPlaying(!playing)} />
      {left > 0 && (
        <Btn
          label={me.done ? `Done ✓ · tap to keep editing (${doneCount}/${band.length})` : `✓ I'm done (${doneCount}/${band.length} done)`}
          color={me.done ? '#333' : '#2E7D32'}
          onPress={() => send({ type: 'done', done: !me.done })}
        />
      )}
      <P color={left === 0 || me.done ? FG : undefined}>
        {left === 0
          ? "Time's up! Your part is locked in."
          : me.done
            ? 'Waiting for the others. The song starts as soon as everyone is done.'
            : 'Everyone writes one 16-bar song: notes can’t overlap anyone’s. Your notes play when the conductor cues you in; an empty part gets filled in. Tap Done when you’re happy with it.'}
      </P>
    </Screen>
  );
}

/** What the conductor sees while the band composes. */
export function ConductorWaiting({ state }: { state: State }) {
  const left = useSecondsLeft(state.deadline);
  const band = state.players.filter((p) => p.instrument && p.seat !== state.conductor);
  const ready = band.filter((p) => p.done).length;
  const total = band.length;
  return (
    <Screen style={{ justifyContent: 'center' }}>
      <H1>🎼 You conduct round {state.round}</H1>
      <P>The band is writing their parts. Stand where you can point at everyone.</P>
      <Timer left={left} />
      <P color={FG}>
        {ready}/{total} done · starts when everyone is
      </P>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inst: { fontSize: 30, fontWeight: '900' },
});
