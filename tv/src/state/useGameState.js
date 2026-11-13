import { useSyncExternalStore } from 'react'
import { getState, subscribe } from './store.js'

// const game = useGameState((s) => s.game)
// The selector must return something already in the store (not a new object/array),
// or React will re-render forever. Derive things in the component instead.
export function useGameState(selector = (s) => s) {
  return useSyncExternalStore(subscribe, () => selector(getState()))
}
