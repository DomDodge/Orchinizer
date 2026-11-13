<script setup>
import { connect } from '../net/socket.js'
import { unlock } from '../audio/engine.js'
import ConnectionChip from './ConnectionChip.vue'

const emit = defineEmits(['started'])

// Audio has to be unlocked inside the click, before anything else.
function start() {
  unlock().then(() => {
    connect()
    emit('started')
  })
}
</script>

<template>
  <div class="start">
    <h1>Phone Orchestra</h1>
    <p class="tag">Your phone is the instrument. On your turn, it's the baton.</p>
    <button class="btn big" @click="start">Start show</button>
    <p class="hint">Turn the volume up</p>
    <ConnectionChip class="conn" />
  </div>
</template>

<style scoped>
.start {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
}
h1 {
  font-size: 160px;
  line-height: 1;
}
.tag {
  font-size: 36px;
  color: var(--muted);
  margin: 0 0 40px;
}
.big {
  font-size: 56px;
  padding: 36px 96px;
}
.hint {
  font-size: 24px;
  color: var(--muted);
  margin: 0;
}
.conn {
  position: absolute;
  bottom: 48px;
}
</style>
