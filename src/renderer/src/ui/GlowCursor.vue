<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from '../store/app'

const app = useAppStore()
const el = ref<HTMLElement>()
let raf = 0
let tx = -500
let ty = -500
let cx = -500
let cy = -500

function onMove(e: MouseEvent) {
  tx = e.clientX
  ty = e.clientY
}
function loop() {
  cx += (tx - cx) * 0.12
  cy += (ty - cy) * 0.12
  if (el.value) el.value.style.left = `${cx}px`
  if (el.value) el.value.style.top = `${cy}px`
  raf = requestAnimationFrame(loop)
}
onMounted(() => {
  window.addEventListener('mousemove', onMove)
  if (app.appearance.glow) loop()
})
onUnmounted(() => {
  window.removeEventListener('mousemove', onMove)
  cancelAnimationFrame(raf)
})
// glow 开关变化时启动/停止
import { watch } from 'vue'
watch(
  () => app.appearance.glow,
  (v) => {
    cancelAnimationFrame(raf)
    if (v) loop()
    else if (el.value) el.value.style.left = '-500px'
  }
)
</script>

<template>
  <div v-if="app.appearance.glow" id="glow-cursor" ref="el" />
</template>
