<script setup lang="ts">
/**
 * 开关。
 * thumb 位移改用 transform（旧版用 left，会触发重排）。
 * 轨道宽度 36px、thumb 16px、左右各 2px 内缩 → 位移量固定 16px。
 */
const props = defineProps<{ modelValue: boolean; label?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<template>
  <label class="inline-flex items-center gap-2 cursor-pointer select-none" @click.prevent="emit('update:modelValue', !props.modelValue)">
    <span
      class="relative inline-block w-9 h-5 rounded-full transition-colors"
      :style="{
        background: props.modelValue ? 'var(--accent)' : 'var(--border)',
        transitionDuration: 'var(--dur-2)'
      }"
    >
      <span
        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
        :style="{
          transform: props.modelValue ? 'translateX(16px)' : 'translateX(0)',
          transitionDuration: 'var(--dur-2)',
          transitionTimingFunction: 'var(--ease-spring)',
          boxShadow: 'var(--sh-1)'
        }"
      />
    </span>
    <span v-if="label" class="text-label text-[var(--text-dim)]">{{ label }}</span>
  </label>
</template>
