// Turns DeviceMotion into baton samples. Heading comes from the OS's fused orientation (rotation), not from
// integrating the gyro: in the 2026-11-13 iPhone test, integration drifted 35° after a few flicks while the
// fused orientation came back within 2°. Calibration every round absorbs the compass zero.
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { Platform } from 'react-native';
import type { Sample } from './aim';

const DEG = 180 / Math.PI;
let heading = 0; // degrees, increases turning right
let subscribed = false;
type Listener = (s: Sample, raw: DeviceMotionMeasurement) => void;
const listeners = new Set<Listener>();

function onMotion(raw: DeviceMotionMeasurement) {
  const { rotation, acceleration: a, accelerationIncludingGravity: g } = raw;
  if (!rotation || !a || !g) return;
  const [dx, dy, dz] = [g.x - a.x, g.y - a.y, g.z - a.z]; // gravity, pointing down, device frame
  const len = Math.hypot(dx, dy, dz) || 1;
  heading = attitudeHeading(rotation);
  const sample: Sample = {
    t: Date.now(),
    heading,
    elevation: Math.asin(Math.max(-1, Math.min(1, -dy / len))) * DEG, // top edge above the horizon
    accel: Math.hypot(a.x, a.y, a.z),
  };
  listeners.forEach((l) => l(sample, raw));
}

export const motionSupported = Platform.OS !== 'web';

/** Start the sensor. It stays on so heading never loses track between calibrate and perform. */
export function startMotion() {
  if (subscribed || !motionSupported) return;
  subscribed = true;
  DeviceMotion.requestPermissionsAsync().then(({ granted }) => {
    if (!granted) return void (subscribed = false);
    DeviceMotion.setUpdateInterval(16);
    DeviceMotion.addListener(onMotion);
  });
}

/** Subscribe to ~60 Hz samples (raw reading included for debugging). */
export function onSample(l: Listener) {
  startMotion();
  listeners.add(l);
  return () => void listeners.delete(l);
}

export const currentHeading = () => heading;

/** Azimuth (degrees, turning right = up) of where the phone points, from rotation as Z-X'-Y'' Euler radians.
 *  The pointing axis is halfway between the top edge and the back camera, so it works held flat or upright. */
function attitudeHeading(rot: { alpha: number; beta: number; gamma: number }) {
  const { alpha: a, beta: b, gamma: g } = rot;
  const y = Math.cos(b) + Math.sin(b) * Math.cos(g);
  const x = Math.cos(a) * -Math.sin(g) - Math.sin(a) * y;
  const yw = Math.sin(a) * -Math.sin(g) + Math.cos(a) * y;
  return -Math.atan2(yw, x) * DEG;
}
