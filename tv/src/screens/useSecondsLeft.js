import { useEffect, useState } from 'react'

// Whole seconds until `deadline` (ms timestamp). Re-renders only when the number changes.
export function useSecondsLeft(deadline) {
  const calc = () => Math.max(0, Math.ceil(((deadline || 0) - Date.now()) / 1000))
  const [secs, setSecs] = useState(calc)
  useEffect(() => {
    setSecs(calc())
    const id = setInterval(() => setSecs(calc()), 100)
    return () => clearInterval(id)
  }, [deadline])
  return secs
}
