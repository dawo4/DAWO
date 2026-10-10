<script setup lang="ts">
// 统一的空状态提示：图标 + 主文案 + 副文案 + 动作按钮，写作台右栏各标签页共用
import InkButton from './InkButton.vue'

defineProps<{
  icon?: unknown
  title: string
  desc?: string
  action?: string
}>()
const emit = defineEmits<{ (e: 'action'): void }>()
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center gap-2.5 text-center px-6">
    <component :is="icon" v-if="icon" :size="22" class="text-[var(--text-faint)]" />
    <p class="text-[12.5px] text-[var(--text-dim)]">{{ title }}</p>
    <p v-if="desc" class="text-[11.5px] text-[var(--text-faint)] leading-5">{{ desc }}</p>
    <div v-if="action" class="mt-1.5">
      <InkButton @click="emit('action')">{{ action }}</InkButton>
    </div>
  </div>
</template>
