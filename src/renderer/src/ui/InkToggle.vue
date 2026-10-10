<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; label?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<template>
  <label class="inline-flex items-center gap-2 cursor-pointer select-none" @click.prevent="emit('update:modelValue', !props.modelValue)">
    <span
      class="relative inline-block w-9 h-5 rounded-full transition-colors"
      :style="{ background: props.modelValue ? 'var(--accent)' : 'var(--border)' }"
    >
      <span
        class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
        :style="{ left: props.modelValue ? '18px' : '2px' }"
      />
    </span>
    <span v-if="label" class="text-sm">{{ label }}</span>
  </label>
</template>
