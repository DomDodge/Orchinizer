import { connect } from '../net/socket.js'
import { unlock } from '../audio/engine.js'
import ConnectionChip from './ConnectionChip.jsx'
import './screens.css'

export default function StartShow({ onStarted }) {
  // Audio has to be unlocked inside the click, before anything else.
  const start = () =>
    unlock().then(() => {
      connect()
      onStarted()
    })

  return (
    <div className="start">
      <h1>Phone Orchestra</h1>
      <p className="start-tag">Your phone is the instrument. On your turn, it's the baton.</p>
      <button className="btn start-btn" onClick={start}>
        Start show
      </button>
      <p className="start-hint">Turn the volume up</p>
      <ConnectionChip className="start-conn" />
    </div>
  )
}
