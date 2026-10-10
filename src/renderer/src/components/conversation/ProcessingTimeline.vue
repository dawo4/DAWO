<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatMessage, ToolTrace } from '../../types'
import { useConversationStore } from '../../store/conversation'
import ToolTraceCard from './ToolTraceCard.vue'
import { Brain, ChevronDown, ChevronRight, ListTree } from 'lucide-vue-next'

const props = defineProps<{ message: ChatMessage }>()
const conv = useConversationStore()

const traceMap = computed(() => {
  const m = new Map<string, ToolTrace>()
  for (const t of props.message.toolCalls) m.set(t.id, t)
  return m
})

const hasThinking = computed(() => !!props.message.thinking.trim())
const toolSteps = computed(() => props.message.processingSteps.filter((s) => s.type === 'tool'))
const totalMs = computed(() => props.message.toolCalls.reduce((a, t) => a + t.durationMs, 0))
const collapsed = computed(() => conv.expandedThinking[props.message.id] === false)
</script>

<template>
  <div v-if="hasThinking || toolSteps.length" class="space-y-2">
    <!-- 思考过程 -->
    <div v-if="hasThinking" class="rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] overflow-hidden">
      <button class="w-full flex items-center gap-2 px-3 py-2 cursor-pointer text-left" @click="conv.toggleThinking(message.id)">
        <Brain :size="13" class="shrink-0" :style="{ color: 'var(--accent)' }" />
        <span class="text-[12px]">思考过程</span>
        <span class="text-[10px] text-[var(--text-faint)] flex-1">{{ message.thinking.length }} 字</span>
        <component :is="collapsed ? ChevronRight : ChevronDown" :size="13" class="text-[var(--text-faint)]" />
      </button>
      <pre
        v-if="!collapsed"
        class="px-3 pb-2.5 pt-2 text-[11.5px] whitespace-pre-wrap break-words text-[var(--text-faint)] m-0 leading-[1.85] max-h-72 overflow-y-auto border-t border-[var(--border)]"
      >{{ message.thinking }}</pre>
    </div>

    <!-- 工具执行 -->
    <div v-if="toolSteps.length" class="space-y-1.5">
      <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
        <ListTree :size="12" />
        <span>工具执行 {{ message.toolCalls.length }}/{{ toolSteps.length }}</span>
        <span v-if="totalMs">· 累计 {{ totalMs }}ms</span>
      </div>
      <ToolTraceCard
        v-for="s in toolSteps"
        :key="s.id"
        :trace="traceMap.get(s.toolCallId)"
        :name="traceMap.get(s.toolCallId)?.name"
        :running="!traceMap.has(s.toolCallId)"
      />
    </div>
  </div>
</template>