import { useKeepAwake } from 'expo-keep-awake';
import { Compose, ConductorWaiting } from '../components/Compose';
import { Calibrate } from '../components/Calibration';
import { Perform } from '../components/Conductor';
import { Join } from '../components/Join';
import { Lobby } from '../components/Lobby';
import { HoldUp, Playing, Results, Vote } from '../components/Player';
import { H1, P, Screen } from '../components/ui';
import { useNet } from '../net';

// The server drives every phase; this screen only renders what state says.
export default function Index() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true }); // web throws if the lock never activated
  const { state, seat, connected } = useNet();
  const me = state?.players.find((p) => p.seat === seat);

  if (!state || !me) return <Join />;
  const conducting = state.conductor === seat;

  const body = (() => {
    switch (state.phase) {
      case 'lobby':
        return <Lobby state={state} me={me} />;
      case 'compose':
        return conducting ? <ConductorWaiting state={state} /> : <Compose key={state.round} state={state} me={me} />;
      case 'calibrate':
        return conducting ? <Calibrate key={state.round} state={state} /> : <HoldUp state={state} me={me} />;
      case 'perform':
        return conducting ? <Perform key={state.round} state={state} /> : <Playing state={state} me={me} />;
      case 'vote':
        return <Vote state={state} me={me} />;
      case 'results':
        return <Results state={state} />;
    }
  })();

  if (!connected)
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <H1>Reconnecting…</H1>
        <P>Your seat and part are saved.</P>
      </Screen>
    );
  return body;
}
