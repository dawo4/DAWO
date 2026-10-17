<script setup lang="ts">
/**
 * 无边框分段选择器。
 * 选中指示器是一块滑动 pill：位移只用 transform（不动布局）；
 * 宽度在切换时直接赋值，不参与过渡，避免对 width 做动画。
 * 旧版「一排带边框小方框」的写法已废弃；props / emits 不变。
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
  options: { value: string; label: string; hint?: string }[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const wrap = ref<HTMLElement>()
const ind = ref<HTMLElement>()
const ready = ref(false)
let ro: ResizeObserver | null = null

/** 把指示器对齐到当前选中项（只改 transform + width） */
function measure(): void {
  const host = wrap.value
  const idx = props.options.findIndex((o) => o.value === props.modelValue)
  if (!host || !ind.value || idx < 0) return
  const btn = host.querySelectorAll('button')[idx] as HTMLElement | undefined
  if (!btn) return
  const br = btn.getBoundingClientRect()
  const wr = host.getBoundingClientRect()
  ind.value.style.width = `${br.width}px`
  ind.value.style.transform = `translateX(${br.left - wr.left}px)`
  ready.value = true
}

function pick(v: string) {
  if (v !== props.modelValue) emit('update:modelValue', v)
}

watch(() => props.modelValue, () => void nextTick(measure))

onMounted(() => {
  void nextTick(measure)
  if (wrap.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => measure())
    ro.observe(wrap.value)
  }
})

onUnmounted(() => {
  ro?.disconnect()
  ro = null
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div ref="wrap" class="relative inline-flex items-center p-0.5 rounded-full bg-[var(--bg-soft)]">
      <!-- 滑动指示器（纯装饰层，不占布局） -->
      <span
        ref="ind"
        class="absolute left-0 top-0.5 bottom-0.5 rounded-full pointer-events-none"
        :style="{
          background: 'var(--panel)',
          boxShadow: 'var(--sh-1)',
          transition: 'transform var(--dur-3) var(--ease-spring)',
          opacity: ready ? 1 : 0
        }"
      />
      <button
        v-for="o in options"
        :key="o.value"
        class="relative z-10 px-3 py-1 rounded-full text-label cursor-pointer transition-colors"
        :class="modelValue === o.value ? 'font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
        :style="modelValue === o.value ? { color: 'var(--accent)' } : {}"
        @click="pick(o.value)"
      >
        {{ o.label }}
      </button>
    </div>
    <span v-if="options.find((o) => o.value === modelValue)?.hint" class="text-meta text-[var(--text-faint)]">
      {{ options.find((o) => o.value === modelValue)?.hint }}
    </span>
  </div>
</template>
