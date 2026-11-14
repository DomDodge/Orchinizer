import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createBaton } from '../aim';
import { clearCalibration, getCalibration } from '../calibration';
import { send, serverNow, useSecondsLeft } from '../net';
import { motionSupported, onSample } from '../pointer';
import { instrumentInfo, type Player, type State } from '../protocol';
import { nextTarget } from '../scoring';
import { BeatRing } from './Pulse';
import { ScorePanel } from './ScorePanel';
import { BG, FG, H1, P, Screen, Timer } from './ui';

const band = (s: State) => s.players.filter((p) => p.instrument && p.seat !== s.conductor);
let cueN = 0;
const cueId = () => `${Date.now().toString(36)}-${cueN++}`;

/** Perform phase: point + flick to play each note as it lands on its player (keep pointing through long notes), tilt for volume. */
export function Perform({ state }: { state: State }) {
  const left = useSecondsLeft(state.deadline);
  const [selected, setSelected] = useState(0);
  const [directions] = useState(() => getCalibration(state));
  const [buttons, setButtons] = useState(!motionSupported || directions.length === 0);
  useEffect(() => () => clearCalibration(), []);
  const sel = useRef(0);

  const cue = (seat: number) => {
    if (!seat) return;
    send({ type: 'cue', id: cueId(), seat });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  };

  // In button mode, pressing and holding a player's button is aiming at them (for hold prompts).
  const aim = (seat: number) => {
    sel.current = seat;
    setSelected(seat);
    send({ type: 'select', seat });
  };

  useEffect(() => {
    if (buttons) return;
    const baton = createBaton(directions);
    return onSample((s) => {
      for (const e of baton.update(s)) {
        if (e.type === 'select') {
          sel.current = e.seat;
          setSelected(e.seat);
          send({ type: 'select', seat: e.seat });
          if (e.seat) Haptics.selectionAsync();
        } else if (e.type === 'flick') cue(e.seat);
        else if (e.type === 'volume' && sel.current) send({ type: 'volume', seat: sel.current, level: e.level });
      }
    });
  }, [buttons, directions]);

  const players = band(state);
  const p = players.find((x) => x.seat === selected);
  // The player whose note is up next: highlighted so the conductor knows who to play.
  const nextSeat = nextTarget(state.scoring, serverNow())?.seat;
  const isNext = (x: Player) => x.seat === nextSeat;

  return (
    <Screen bg={p ? p.color + '33' : BG}>
      {/* Long-press the header for the hidden fallback: on-screen cue buttons. */}
      <Pressable onLongPress={() => setButtons(!buttons)} style={styles.header}>
        <Text style={styles.headerText}>🎼 Conducting</Text>
        <Timer left={left} />
      </Pressable>

      <ScorePanel state={state} aimSeat={selected} />

      {buttons ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.buttons}>
          {players.map((x) => (
            <Pressable
              key={x.seat}
              onPressIn={() => aim(x.seat)}
              onPressOut={() => aim(0)}
              onPress={() => cue(x.seat)}
              style={[styles.cueBtn, { borderColor: x.color, backgroundColor: isNext(x) ? x.color : '#15151F' }]}
            >
              <Text style={[styles.cueSeat, { color: isNext(x) ? BG : x.color }]}>{x.seat}</Text>
              <Text style={[styles.cueName, { color: isNext(x) ? BG : FG }]}>{x.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        // Tapping while pointing cues too, as a fallback for flicks that don't register.
        <Pressable style={styles.stage} onPress={() => cue(sel.current)}>
          <BeatRing color={p?.color ?? '#444'} />
          {p ? (
            <>
              <Text style={[styles.huge, { color: p.color }]}>{p.seat}</Text>
              <H1 color={p.color}>{p.name}</H1>
              <P color={FG}>
                {instrumentInfo(p.instrument).emoji} volume {p.level}%
              </P>
            </>
          ) : (
            <P>Point at a player</P>
          )}
        </Pressable>
      )}

      <View style={styles.liveRow}>
        {players.map((x) => (
          <View key={x.seat} style={[styles.dot, { backgroundColor: isNext(x) ? x.color : 'transparent', borderColor: x.color }]}>
            <Text style={{ color: isNext(x) ? BG : x.color, fontWeight: '900' }}>{x.seat}</Text>
          </View>
        ))}
      </View>
      {!buttons && <P>Point at the player whose note is landing and flick (or tap) on NOW · keep pointing through long notes · tilt for volume</P>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  huge: { fontSize: 140, fontWeight: '900', textAlign: 'center', color: FG },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerText: { color: FG, fontSize: 22, fontWeight: '900' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  buttons: { flexGrow: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignContent: 'center' },
  cueBtn: { width: '47%', aspectRatio: 1.2, borderWidth: 4, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cueSeat: { fontSize: 48, fontWeight: '900' },
  cueName: { fontSize: 16, fontWeight: '700' },
  liveRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  dot: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
