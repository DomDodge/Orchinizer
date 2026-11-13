import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { BG } from '../components/ui';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: BG } }} />
    </>
  );
}
