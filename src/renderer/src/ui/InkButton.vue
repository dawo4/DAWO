<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ variant?: 'primary' | 'ghost' | 'danger' }>()
const el = ref<HTMLElement>()

function ripple(e: MouseEvent) {
  const host = el.value
  if (!host) return
  const rect = host.getBoundingClientRect()
  const dot = document.createElement('span')
  dot.className = 'ripple-dot'
  const size = Math.max(rect.width, rect.height)
  dot.style.width = dot.style.height = `${size}px`
  dot.style.left = `${e.clientX - rect.left - size / 2}px`
  dot.style.top = `${e.clientY - rect.top - size / 2}px`
  host.appendChild(dot)
  setTimeout(() => dot.remove(), 600)
}
</script>

<template>
  <button
    ref="el"
    class="ink-ripple inline-flex items-center gap-1.5 rounded-[var(--radius)] px-4 py-2 text-sm cursor-pointer select-none transition-colors"
    :class="{
      'bg-[var(--accent)] text-[#1a150c] font-medium hover:brightness-110': props.variant !== 'ghost' && props.variant !== 'danger',
      'bg-[var(--panel-2)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--hover)]': props.variant === 'ghost',
      'bg-[#8c3b2e] text-white hover:brightness-110': props.variant === 'danger'
    }"
    @click="ripple"
  >
    <slot />
  </button>
</template>
