import { useEffect, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useBeat } from '../net';

/** A ring that flashes on every beat of the TV's clock. */
export function BeatRing({ color, size = 260 }: { color: string; size?: number }) {
  const beat = useBeat();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!beat) return;
    v.setValue(1);
    Animated.timing(v, { toValue: 0, duration: 350, useNativeDriver: true }).start();
  }, [beat, v]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({ ring: { position: 'absolute', alignSelf: 'center', borderWidth: 10 } });
