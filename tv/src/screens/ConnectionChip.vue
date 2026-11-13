<script setup>
import { computed } from 'vue'
import { store } from '../state/store.js'
import { MOCK } from '../config.js'

const label = computed(
  () =>
    ({
      idle: 'Not connected',
      connecting: 'Connecting…',
      open: MOCK ? 'Connected (mock)' : 'Connected',
      reconnecting: 'Reconnecting…',
    })[store.connection],
)
</script>

<template>
  <span class="chip"><span class="dot" :class="store.connection" />{{ label }}</span>
</template>

<style scoped>
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--muted);
}
.dot.open {
  background: #a8e05f;
}
.dot.connecting,
.dot.reconnecting {
  background: var(--accent);
}
</style>
