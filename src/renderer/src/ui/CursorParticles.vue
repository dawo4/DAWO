<script setup lang="ts">
/**
 * 简约风光标粒子：打字时在文本插入符处生成细小光点，淡出上浮。
 * 编辑器通过 window 事件 'inkdesk:caret' (detail: {x, y}) 上报插入符坐标。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from '../store/app'

const app = useAppStore()
const canvas = ref<HTMLCanvasElement>()
let ctx: CanvasRenderingContext2D | null = null
let raf = 0
interface P {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  size: number
}
const parts: P[] = []

function onCaret(e: Event) {
  const d = (e as CustomEvent<{ x: number; y: number }>).detail
  if (!d || parts.length > 40) return
  parts.push({ x: d.x + (Math.random() - 0.5) * 6, y: d.y, vx: (Math.random() - 0.5) * 0.4, vy: -0.4 - Math.random() * 0.6, life: 1, size: 1.2 + Math.random() * 1.4 })
}
function loop() {
  if (!ctx) return
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c9a15f'
  ctx.fillStyle = accent
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    p.x += p.vx
    p.y += p.vy
    p.life -= 0.025
    if (p.life <= 0) {
      parts.splice(i, 1)
      continue
    }
    ctx.globalAlpha = p.life * 0.6
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  raf = requestAnimationFrame(loop)
}
function resize() {
  if (!canvas.value) return
  canvas.value.width = window.innerWidth
  canvas.value.height = window.innerHeight
}
onMounted(() => {
  if (!app.appearance.particles) return
  ctx = canvas.value?.getContext('2d') || null
  resize()
  window.addEventListener('resize', resize)
  window.addEventListener('inkdesk:caret', onCaret)
  loop()
})
onUnmounted(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', resize)
  window.removeEventListener('inkdesk:caret', onCaret)
})
import { watch } from 'vue'
watch(
  () => app.appearance.particles,
  (v) => {
    if (v && !ctx) {
      ctx = canvas.value?.getContext('2d') || null
      resize()
      loop()
    }
  }
)
</script>

<template>
  <canvas v-show="app.appearance.particles" id="particle-canvas" ref="canvas" />
</template>
