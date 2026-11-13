<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { store } from './state/store.js'
import StartShow from './screens/StartShow.vue'
import Placeholder from './screens/Placeholder.vue'

const started = ref(false)

// Real screens get registered here as they're built; anything missing shows the placeholder.
const screens = {}
const screen = computed(() => (started.value ? screens[store.state?.phase] || Placeholder : StartShow))

// Everything is laid out at 1920x1080 and scaled to fit the window.
const scale = ref(1)
const fit = () => (scale.value = Math.min(innerWidth / 1920, innerHeight / 1080))
onMounted(() => (fit(), addEventListener('resize', fit)))
onUnmounted(() => removeEventListener('resize', fit))
</script>

<template>
  <div class="frame" :style="{ transform: `translate(-50%, -50%) scale(${scale})` }">
    <component :is="screen" @started="started = true" />
  </div>
</template>

<style scoped>
.frame {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
}
</style>
