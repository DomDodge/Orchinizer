import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { clearError, connect, SERVER_URL, useNet } from '../net';
import { SensorTest } from './SensorTest';
import { Btn, DIM, FG, H1, P, Screen } from './ui';

/** Home (host, or enter a code) → name screen → connect. step.room '' = hosting. */
export function Join() {
  const { error, joining } = useNet();
  const [code, setCode] = useState('');
  const [step, setStep] = useState<{ room: string } | null>(null);
  const [name, setName] = useState('');
  const [sensorTest, setSensorTest] = useState(false);

  if (sensorTest) return <SensorTest onClose={() => setSensorTest(false)} />;

  if (step) {
    const go = () => name.trim() && connect(name, step.room);
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ gap: 14 }}>
          <H1>What&apos;s your name?</H1>
          <P>{step.room ? `Joining room ${step.room}` : "You're hosting, so you conduct first."}</P>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor="#444"
            maxLength={16}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={go}
          />
          <Btn label={step.room ? `Join ${step.room}` : 'Host room 🎼'} disabled={!name.trim() || joining} onPress={go} />
          {joining && <P>Connecting…</P>}
          {error && <P color="#FF5252">{error}</P>}
          <Btn
            label="Back"
            color="#333"
            onPress={() => {
              clearError();
              setStep(null);
            }}
          />
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  return (
    <Screen style={{ justifyContent: 'center' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ gap: 14 }}>
        {/* Long-press the title for the dev-only sensor test. */}
        <Pressable onLongPress={() => setSensorTest(true)}>
          <H1>🎼 Phone Orchestra</H1>
        </Pressable>
        <Btn label="Host a room" onPress={() => setStep({ room: '' })} />

        <View style={styles.divider} />

        <TextInput
          style={[styles.input, styles.code]}
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4))}
          placeholder="CODE"
          placeholderTextColor="#444"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => code.length === 4 && setStep({ room: code })}
        />
        <Btn label="Join a room" color="#333" disabled={code.length !== 4} onPress={() => setStep({ room: code })} />
        {error && <P color="#FF5252">{error}</P>}
        <P>{SERVER_URL}</P>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: '#1A1A26', color: FG, fontSize: 22, padding: 16, borderRadius: 14, textAlign: 'center' },
  code: { fontSize: 36, fontWeight: '900', letterSpacing: 10 },
  divider: { height: 1, backgroundColor: DIM, opacity: 0.3, marginVertical: 8 },
});
