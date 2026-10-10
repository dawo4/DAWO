<script setup lang="ts">
import { useAppStore } from '../store/app'
import InkSegmented from './InkSegmented.vue'

/**
 * 二级导航行：所有页面的「标题下方那一行」统一高度、内边距与字号。
 * 左侧可选分段导航，左右两侧也可放自定义内容。
 */
defineProps<{
  tabs?: { value: string; label: string }[]
  modelValue?: string
  /** 覆盖默认高度（写作台编辑器工具行需要更紧凑） */
  dense?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const app = useAppStore()
</script>

<template>
  <div
    class="app-chrome shrink-0 flex items-center gap-3 px-6 border-b border-[var(--border)]"
    :class="[dense ? 'h-11' : 'h-12', { 'focus-dim': app.focusMode }]"
  >
    <slot name="left">
      <InkSegmented
        v-if="tabs && tabs.length"
        :model-value="modelValue || ''"
        :options="tabs"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </slot>
    <div class="flex-1 min-w-0" />
    <slot name="right" />
  </div>
</template>