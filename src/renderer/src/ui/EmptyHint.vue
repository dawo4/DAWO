<script setup lang="ts">
/**
 * 统一的空状态提示：印章式圆形底 + 图标 + 主文案（衬线）+ 副文案 + 动作按钮。
 * 写作台右栏各标签页 / 时间线 / 故事线 / 关系图等处共用。
 * props 与 emits 与旧版一致。
 */
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
  <div class="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
    <!-- 印章式底座：低对比圆形，弱化「空」的失落感 -->
    <span
      v-if="icon"
      class="w-14 h-14 rounded-full flex items-center justify-center"
      :style="{ background: 'var(--bg-soft)', border: '1px solid var(--border)' }"
    >
      <component :is="icon" :size="20" class="text-[var(--text-faint)]" />
    </span>
    <p class="font-serif-ink text-body text-[var(--text-dim)]">{{ title }}</p>
    <p v-if="desc" class="text-meta text-[var(--text-faint)] leading-5 max-w-[320px]">{{ desc }}</p>
    <div v-if="action" class="mt-1">
      <InkButton variant="ghost" size="sm" @click="emit('action')">{{ action }}</InkButton>
    </div>
    <!-- 额外动作：需要第二个入口（如「让 AI 提取」）时由使用方塞进来 -->
    <slot />
  </div>
</template>
