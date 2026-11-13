import { useGameState } from '../state/useGameState.js'
import { MOCK } from '../config.js'

const LABELS = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  open: MOCK ? 'Connected (mock)' : 'Connected',
  reconnecting: 'Reconnecting…',
}
const DOT = { open: '#A8E05F', connecting: '#F2C14E', reconnecting: '#F2C14E' }

export default function ConnectionChip({ className = '' }) {
  const connection = useGameState((s) => s.connection)
  return (
    <span className={`chip ${className}`}>
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: DOT[connection] || '#A3A8C3' }} />
      {LABELS[connection]}
    </span>
  )
}
