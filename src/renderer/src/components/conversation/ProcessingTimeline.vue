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
    <div v-if="hasThinking" class="tl-item">
      <button class="tl-head w-full" @click="conv.toggleThinking(message.id)">
        <span class="tl-dot" />
        <Brain :size="13" class="shrink-0 tl-icon" />
        <span class="text-label">思考过程</span>
        <span class="text-micro text-[var(--text-faint)] flex-1">{{ message.thinking.length }} 字</span>
        <component :is="collapsed ? ChevronRight : ChevronDown" :size="13" class="text-[var(--text-faint)] shrink-0" />
      </button>
      <pre v-if="!collapsed" class="tl-body">{{ message.thinking }}</pre>
    </div>

    <!-- 工具执行 -->
    <div v-if="toolSteps.length" class="tl-item">
      <div class="tl-head">
        <span class="tl-dot" />
        <ListTree :size="13" class="shrink-0 tl-icon" />
        <span class="text-label">工具执行</span>
        <span class="text-micro text-[var(--text-faint)] flex-1">
          {{ message.toolCalls.length }}/{{ toolSteps.length }}<template v-if="totalMs"> · 累计 {{ totalMs }}ms</template>
        </span>
      </div>
      <ToolTraceCard
        v-for="s in toolSteps"
        :key="s.id"
        class="mt-1"
        :trace="traceMap.get(s.toolCallId)"
        :name="traceMap.get(s.toolCallId)?.name"
        :running="!traceMap.has(s.toolCallId)"
      />
    </div>
  </div>
</template>

<style scoped>
/* 细线时间轴：左侧 1px 竖线 + 节点圆点，思考与工具步骤同一条轴 */
.tl-item {
  position: relative;
  padding-left: 14px;
}
.tl-item::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 12px;
  bottom: 4px;
  width: 1px;
  background: var(--border);
}
.tl-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  cursor: pointer;
}
.tl-dot {
  position: absolute;
  left: -13px;
  top: 50%;
  width: 5px;
  height: 5px;
  margin-top: -2.5px;
  border-radius: var(--r-pill);
  background: var(--border-strong);
}
.tl-icon {
  color: var(--accent);
}
.tl-body {
  margin: 4px 0 0;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  background: var(--bg-soft);
  font-size: var(--fs-meta);
  line-height: 1.85;
  color: var(--text-faint);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 18rem;
  overflow-y: auto;
}
</style>