<script setup lang="ts">
/**
 * 无边框分段选择器。
 * 取代原先「一排带边框小方框」的写法：选中靠底色与文字色区分，不画边框。
 */
const props = defineProps<{
  modelValue: string
  options: { value: string; label: string; hint?: string }[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

function pick(v: string) {
  if (v !== props.modelValue) emit('update:modelValue', v)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-[var(--bg-soft)]">
      <button
        v-for="o in options"
        :key="o.value"
        class="px-3 py-1 rounded-full text-[12.5px] cursor-pointer transition-colors"
        :class="
          modelValue === o.value
            ? 'bg-[var(--panel-2)] font-medium'
            : 'text-[var(--text-dim)] hover:text-[var(--text)]'
        "
        :style="modelValue === o.value ? { color: 'var(--accent)' } : {}"
        @click="pick(o.value)"
      >
        {{ o.label }}
      </button>
    </div>
    <span v-if="options.find((o) => o.value === modelValue)?.hint" class="text-[11px] text-[var(--text-faint)]">
      {{ options.find((o) => o.value === modelValue)?.hint }}
    </span>
  </div>
</template>