import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const BG = '#0B0B12';
export const FG = '#F4F4F8';
export const DIM = '#8A8AA0';

export function Screen({ children, bg = BG, style }: { children: ReactNode; bg?: string; style?: ViewStyle }) {
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: bg }, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Btn({ label, onPress, color = '#6C63FF', disabled }: { label: string; onPress: () => void; color?: string; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.btn, { backgroundColor: color, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

export const H1 = ({ children, color = FG }: { children: ReactNode; color?: string }) => <Text style={[styles.h1, { color }]}>{children}</Text>;
export const P = ({ children, color = DIM }: { children: ReactNode; color?: string }) => <Text style={[styles.p, { color }]}>{children}</Text>;

/** The big seat badge the conductor looks for during calibration. */
export function SeatBadge({ seat, color, size = 160 }: { seat: number; color: string; size?: number }) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, borderColor: color }]}>
      <Text style={{ color, fontSize: size * 0.55, fontWeight: '900' }}>{seat}</Text>
    </View>
  );
}

export const Timer = ({ left }: { left: number }) => (left ? <Text style={styles.timer}>{left}s</Text> : null);

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, gap: 14 },
  btn: { paddingVertical: 16, paddingHorizontal: 24, borderRadius: 16, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  h1: { fontSize: 32, fontWeight: '900', textAlign: 'center' },
  p: { fontSize: 17, textAlign: 'center' },
  badge: { borderWidth: 8, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  timer: { color: FG, fontSize: 22, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
});
