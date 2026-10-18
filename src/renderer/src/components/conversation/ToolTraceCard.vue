<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolTrace } from '../../types'
import { ChevronDown, ChevronRight, LoaderCircle, CircleCheck, CircleAlert, Wrench } from 'lucide-vue-next'

const props = defineProps<{ trace?: ToolTrace; name?: string; running?: boolean }>()
const open = ref(false)

const LABELS: Record<string, string> = {
  list_documents: '查看作品目录',
  read_document: '读取文稿',
  search_book: '全文检索',
  propose_edit: '提交修改提案',
  list_materials: '查看素材与技能',
  read_material: '读取素材',
  write_material: '写入素材/技能'
}

const label = computed(() => LABELS[props.name || props.trace?.name || ''] || props.name || props.trace?.name || '工具调用')

const argPreview = computed(() => {
  const raw = props.trace?.args
  if (!raw) return ''
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const parts: string[] = []
    if (o.path) parts.push(String(o.path))
    if (o.query) parts.push(`“${String(o.query)}”`)
    if (o.name) parts.push(String(o.name))
    if (o.summary) parts.push(String(o.summary))
    return parts.join(' · ').slice(0, 90)
  } catch {
    return raw.slice(0, 90)
  }
})
</script>

<template>
  <div class="trace">
    <button class="trace-head" @click="open = !open">
      <span class="trace-dot" :class="{ 'is-on': running }" />
      <LoaderCircle v-if="running" :size="13" class="animate-spin shrink-0 text-[var(--accent)]" />
      <CircleCheck v-else-if="trace?.ok" :size="13" class="shrink-0 ink-text-ok" />
      <CircleAlert v-else-if="trace" :size="13" class="shrink-0 ink-text-danger" />
      <Wrench v-else :size="13" class="shrink-0 text-[var(--text-faint)]" />
      <span class="text-label shrink-0">{{ label }}</span>
      <span class="text-meta text-[var(--text-faint)] truncate flex-1">{{ argPreview }}</span>
      <span v-if="trace" class="text-micro text-[var(--text-faint)] shrink-0 tnum">{{ trace.durationMs }}ms</span>
      <component :is="open ? ChevronDown : ChevronRight" :size="13" class="text-[var(--text-faint)] shrink-0" />
    </button>
    <div v-if="open" class="trace-body">
      <div>
        <div class="text-micro text-[var(--text-faint)] mb-1">参数</div>
        <pre class="trace-pre">{{ trace?.args || '(执行中)' }}</pre>
      </div>
      <div v-if="trace">
        <div class="text-micro text-[var(--text-faint)] mb-1">结果</div>
        <pre class="trace-pre max-h-56 overflow-y-auto">{{ trace.result }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 工具步骤：无边框扁平行，靠左侧细线时间轴的节点定位 */
.trace {
  position: relative;
}
.trace-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px 4px 8px;
  border-radius: var(--r-sm);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur-2);
}
.trace-head:hover {
  background: var(--hover);
}
.trace-dot {
  position: absolute;
  left: -12px;
  top: 50%;
  width: 4px;
  height: 4px;
  margin-top: -2px;
  border-radius: var(--r-pill);
  background: var(--border-strong);
}
.trace-dot.is-on {
  background: var(--accent);
}
.trace-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 8px 8px;
}
.trace-pre {
  margin: 0;
  font-size: var(--fs-meta);
  line-height: 1.6;
  color: var(--text-dim);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>