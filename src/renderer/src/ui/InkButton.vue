<script setup lang="ts">
/**
 * 基础按钮。
 * - variant：primary（强调色实底）/ ghost（描边静置）/ quiet（纯文字，hover 才显底）/ danger
 * - size：sm（28px 高）/ md（34px 高）
 * - loading：显示省略号并禁用点击
 * 涟漪由 .ink-ripple + .ripple-dot 提供（动效定义在 styles/animations.css）。
 */
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'ghost' | 'danger' | 'quiet'
    size?: 'sm' | 'md'
    loading?: boolean
    block?: boolean
    disabled?: boolean
  }>(),
  { variant: 'primary', size: 'md', loading: false, block: false, disabled: false }
)

const el = ref<HTMLButtonElement>()

const VARIANTS: Record<string, string> = {
  primary: 'bg-[var(--accent)] text-[var(--accent-ink)] font-medium hover:brightness-105',
  ghost: 'bg-transparent text-[var(--text)] border border-[var(--border)] hover:bg-[var(--hover)] hover:border-[var(--border-strong)]',
  quiet: 'bg-transparent text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]',
  danger: 'bg-[var(--danger)] text-white hover:brightness-105'
}

const SIZES: Record<string, string> = {
  sm: 'h-7 px-2.5 text-label gap-1',
  md: 'h-[34px] px-3.5 text-label gap-1.5'
}

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
  setTimeout(() => dot.remove(), 550)
}
</script>

<template>
  <button
    ref="el"
    class="ink-ripple inline-flex items-center justify-center rounded-[var(--r-sm)] cursor-pointer select-none transition-colors"
    :class="[
      VARIANTS[props.variant],
      SIZES[props.size],
      props.block ? 'w-full' : '',
      props.disabled || props.loading ? 'opacity-45 cursor-not-allowed' : ''
    ]"
    :disabled="props.disabled || props.loading"
    @click="ripple"
  >
    <slot />
    <span v-if="props.loading" class="ink-dots ml-1"><span /><span /><span /></span>
  </button>
</template>
