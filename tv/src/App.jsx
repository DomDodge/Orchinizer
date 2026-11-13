import { useEffect, useState } from 'react'
import { useGameState } from './state/useGameState.js'
import StartShow from './screens/StartShow.jsx'
import Placeholder from './screens/Placeholder.jsx'
import Lobby from './screens/Lobby.jsx'
import Calibrate from './screens/Calibrate.jsx'
import Perform from './screens/Perform.jsx'
import Compose from './screens/Compose.jsx'
import NextRound from './screens/NextRound.jsx'
import Vote from './screens/Vote.jsx'
import Results from './screens/Results.jsx'

// Screens get registered here as they're built; anything missing shows the placeholder.
const SCREENS = {
  lobby: Lobby,
  compose: Compose,
  calibrate: Calibrate,
  perform: Perform,
  next_round: NextRound,
  vote: Vote,
  results: Results,
}

// Everything is laid out at 1920x1080 and scaled to fit the window.
function useFitScale() {
  const fit = () => Math.min(innerWidth / 1920, innerHeight / 1080)
  const [scale, setScale] = useState(fit)
  useEffect(() => {
    const onResize = () => setScale(fit())
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [])
  return scale
}

export default function App() {
  const [started, setStarted] = useState(false)
  const phase = useGameState((s) => s.game?.phase)
  const scale = useFitScale()

  const Screen = started ? SCREENS[phase] || Placeholder : null
  return (
    <div className="frame" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
      {Screen ? <Screen /> : <StartShow onStarted={() => setStarted(true)} />}
    </div>
  )
}
