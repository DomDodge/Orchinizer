<script setup>
// Temporary stand-in for screens not built yet. Shows the raw state and host controls.
import { store } from '../state/store.js'
import { hostAction } from '../net/socket.js'
import { setMuted } from '../audio/engine.js'
import ConnectionChip from './ConnectionChip.vue'
</script>

<template>
  <div class="ph">
    <header>
      <h1>{{ store.state?.phase || 'waiting for server' }}</h1>
      <span class="chip">Room {{ store.room || '----' }}</span>
      <ConnectionChip />
    </header>
    <div class="controls">
      <button class="btn" @click="hostAction('start')">start</button>
      <button class="btn" @click="hostAction('next')">next</button>
      <button class="btn" @click="hostAction('skip')">skip</button>
      <button class="btn" @click="setMuted(!store.muted)">{{ store.muted ? 'unmute' : 'mute' }}</button>
    </div>
    <div class="audio">
      <span class="chip">bar {{ store.bar }}</span>
      <span v-for="i in 4" :key="i" class="beat" :class="{ on: store.beat >= 0 && store.beat % 4 === i - 1 }" />
      <span
        v-for="p in store.state?.players"
        :key="p.seat"
        class="seat"
        :style="store.playing[p.seat] ? { background: p.color, color: '#0D0E17' } : { borderColor: p.color }"
        >{{ p.seat }} {{ p.instrument }} {{ store.volumes[p.seat] ?? '' }}</span
      >
      <span v-if="store.lastCue" class="chip">
        last cue: seat {{ store.lastCue.seat }} {{ store.lastCue.action }} on beat {{ store.lastCue.beat }}
      </span>
    </div>
    <div class="cols">
      <pre>{{ JSON.stringify({ ...store.state, players: undefined }, null, 1) }}</pre>
      <pre>{{
        JSON.stringify(
          {
            selected: store.selected,
            volumes: store.volumes,
            calibrated: store.calibrated,
            noteCounts: store.noteCounts,
            votes: store.votes,
          },
          null,
          1,
        )
      }}</pre>
      <pre>{{ store.messages.map((m) => JSON.stringify(m.msg).slice(0, 90)).join('\n') }}</pre>
    </div>
    <ul>
      <li v-for="p in store.state?.players" :key="p.seat" :style="{ color: p.color }">
        {{ p.seat }}. {{ p.name }}: {{ p.instrument }}{{ p.pattern ? ' (pattern locked)' : '' }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ph {
  padding: 48px;
  font-size: 20px;
}
header {
  display: flex;
  gap: 24px;
  align-items: center;
}
h1 {
  font-size: 72px;
}
.controls {
  display: flex;
  gap: 16px;
  margin: 24px 0;
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  gap: 16px;
}
.audio {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}
.beat {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--border);
}
.beat.on {
  background: var(--accent);
}
.seat {
  padding: 8px 14px;
  border-radius: 10px;
  border: 2px solid transparent;
}
pre {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  margin: 0;
  height: 460px;
  overflow: hidden;
  font-size: 16px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
