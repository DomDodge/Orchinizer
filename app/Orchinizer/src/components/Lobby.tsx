import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { clearError, leave, send, useNet, SERVER_URL } from '../net';
import { ALL_CATEGORIES, CATEGORIES, INSTRUMENTS, instrumentInfo, type Category, type Player, type State } from '../protocol';
import { BG, Btn, DIM, FG, P, Screen } from './ui';

export function Lobby({ state, me }: { state: State; me: Player }) {
  const { error } = useNet();
  const conducting = state.host === me.seat;
  const [confirmKick, setConfirmKick] = useState(0); // seat waiting for a 2nd tap
  const takenBy = new Map(state.players.filter((p) => p.instrument).map((p) => [p.instrument, p]));

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 3000);
    return () => clearTimeout(t);
  }, [error]);

  const toggleCategory = (c: Category) => {
    const on = state.categories.includes(c);
    send({ type: 'categories', categories: on ? state.categories.filter((x) => x !== c) : [...state.categories, c] });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 40 }}>
        <View style={styles.header}>
          <View>
            <Text style={styles.label}>ROOM CODE</Text>
            <Text style={styles.code}>{state.room}</Text>
          </View>
          <Btn label="Leave" color="#333" onPress={leave} />
        </View>

        <Section title={`Band · ${state.players.length}/8`}>
          {state.players.map((p, i) => (
            <View key={p.seat} style={[styles.member, { borderColor: p.color, opacity: p.connected ? 1 : 0.4 }]}>
              <Text style={[styles.seat, { color: p.color }]}>{p.seat}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {p.name}
                  {p.seat === me.seat ? ' (you)' : ''}
                </Text>
                <Text style={styles.role}>
                  {roleText(p, state)} · conducts {ordinal(i + 1)}
                  {p.connected ? '' : ' · offline'}
                </Text>
              </View>
              {conducting && p.seat !== me.seat && (
                <Pressable
                  hitSlop={10}
                  onPress={() => {
                    if (confirmKick !== p.seat) return setConfirmKick(p.seat);
                    send({ type: 'kick', seat: p.seat });
                    setConfirmKick(0);
                  }}
                  style={[styles.kick, confirmKick === p.seat && styles.kickConfirm]}
                >
                  <Text style={styles.kickText}>{confirmKick === p.seat ? 'Remove?' : '✕'}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </Section>

        {conducting && (
          <Section title="Pick the sections for this game">
            <View style={styles.wrap}>
              {ALL_CATEGORIES.map((c) => {
                const on = state.categories.includes(c);
                return (
                  <Pressable key={c} onPress={() => toggleCategory(c)} style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipText, on && { color: BG }]}>
                      {CATEGORIES[c].emoji} {CATEGORIES[c].label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>
        )}

        <Section title={conducting ? "Your instrument (for rounds you're not conducting)" : 'Pick your instrument'}>
          {state.categories.map((c) => (
            <View key={c} style={{ gap: 8 }}>
              <Text style={styles.label}>
                {CATEGORIES[c].emoji} {CATEGORIES[c].label.toUpperCase()}
              </Text>
              <View style={styles.wrap}>
                {Object.entries(INSTRUMENTS)
                  .filter(([, info]) => info.category === c)
                  .map(([id, info]) => {
                    const owner = takenBy.get(id);
                    const mine = owner?.seat === me.seat;
                    const taken = !!owner && !mine;
                    return (
                      <Pressable
                        key={id}
                        disabled={taken}
                        onPress={() => send({ type: 'pick', instrument: mine ? null : id })}
                        style={[styles.inst, mine && { backgroundColor: me.color, borderColor: me.color }, taken && styles.instTaken]}
                      >
                        <Text style={styles.instEmoji}>{info.emoji}</Text>
                        <Text style={[styles.instName, mine && { color: BG }]}>{info.label}</Text>
                        {taken && <Text style={styles.instOwner}>{owner.name}</Text>}
                      </Pressable>
                    );
                  })}
              </View>
            </View>
          ))}
        </Section>

        {error && <P color="#FF5252">{error}</P>}
        <P>{state.tvConnected ? 'TV connected · ready for sound' : 'Connect the TV screen to hear the orchestra.'}</P>
        {!state.tvConnected && <P>Open {SERVER_URL.replace(/^ws/, 'http').replace(/\/ws\/?$/, '/')} on the TV and enter room {state.room}.</P>}
        {conducting ? (
          <Btn label="Start game" disabled={!state.tvConnected || state.players.some((p) => p.connected && !p.bot && !p.instrument)} onPress={() => send({ type: 'host_action', action: 'start' })} />
        ) : <P>Waiting for the host to start…</P>}
        {conducting && state.players.some((p) => p.connected && !p.instrument) && <P>Everyone needs to pick an instrument first, including you.</P>}
      </ScrollView>
    </Screen>
  );
}

function roleText(p: Player, s: State) {
  const inst = p.instrument ? `${instrumentInfo(p.instrument).emoji} ${instrumentInfo(p.instrument).label}` : 'picking…';
  return p.seat === s.conductor ? `🎼 Conductor · ${inst}` : inst;
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.section}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: DIM, fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  code: { color: FG, fontSize: 44, fontWeight: '900', letterSpacing: 8 },
  section: { color: FG, fontSize: 20, fontWeight: '900' },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderRadius: 14, padding: 12 },
  kick: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#2A2A3A' },
  kickConfirm: { backgroundColor: '#FF5252' },
  kickText: { color: FG, fontWeight: '900' },
  seat: { fontSize: 28, fontWeight: '900', width: 32, textAlign: 'center' },
  name: { color: FG, fontSize: 18, fontWeight: '800' },
  role: { color: DIM, fontSize: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 2, borderColor: FG, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: FG },
  chipText: { color: FG, fontWeight: '800' },
  inst: { width: '31%', borderWidth: 2, borderColor: '#33334A', borderRadius: 14, padding: 10, alignItems: 'center', backgroundColor: '#15151F' },
  instTaken: { opacity: 0.3 },
  instEmoji: { fontSize: 26 },
  instName: { color: FG, fontWeight: '800', fontSize: 13 },
  instOwner: { color: DIM, fontSize: 11 },
});
