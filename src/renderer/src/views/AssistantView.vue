<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import { useConversationStore } from '../store/conversation'
import { onHeaderAction } from '../ui/headerActions'
import { inkConfirm } from '../ui/inkPrompt'
import AgentConversation from '../components/conversation/AgentConversation.vue'
import InkButton from '../ui/InkButton.vue'
import EmptyHint from '../ui/EmptyHint.vue'
import { usePanelDrag } from '../ui/usePanelDrag'
import { Download, Plus, Trash2, Sparkles, Clock, BookOpen } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()
const conv = useConversationStore()

/** 会话历史栏可拖拽调宽 */
const listDrag = usePanelDrag('assistant.list', 240, 200, 420)

const listQuery = ref('')

const filteredConversations = computed(() => {
  const q = listQuery.value.trim().toLowerCase()
  const list = conv.conversations
  return q ? list.filter((c) => (c.title || '').toLowerCase().includes(q)) : list
})

const agentName = computed(() => conv.allAgents.find((a) => a.id === conv.agentId)?.name || '写作助手')

/** 顶部上下文条：让作者一眼知道 AI 现在针对什么工作 */
const contextParts = computed(() => {
  const parts: string[] = []
  if (lib.current) parts.push(lib.current.title)
  if (lib.current?.genre) parts.push(lib.current.genre)
  if (conv.activeFile) parts.push(conv.activeFile)
  parts.push(agentName.value)
  return parts
})

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return d.toDateString() === today.toDateString()
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getMonth() + 1}/${d.getDate()}`
}

let offHeader: (() => void) | null = null

/** 删除会话不可恢复，先确认再动手 */
async function removeConversation(id: string, title: string) {
  const ok = await inkConfirm(`确定删除会话「${title || '新会话'}」？`, {
    detail: '该会话的全部对话内容将被移除，此操作不可恢复。',
    confirmText: '删除',
    danger: true
  })
  if (!ok) return
  await conv.deleteConversation(id)
}

onMounted(async () => {
  offHeader = onHeaderAction((key) => {
    if (key === 'assistant:new') conv.newConversation()
  })
  if (lib.current && conv.book !== lib.current.title) await conv.init(lib.current.title)
  if (!conv.currentId) conv.newConversation()
})

onUnmounted(() => {
  offHeader?.()
  offHeader = null
})
</script>

<template>
  <div v-if="!lib.current" class="h-full">
    <EmptyHint
      :icon="BookOpen"
      title="先打开一部作品"
      desc="妙笔需要读到你的稿子，才能针对剧情与设定作答"
      action="去书架"
      @action="app.go('bookshelf')"
    />
  </div>

  <div v-else class="h-full flex">
    <!-- 左：会话历史 -->
    <aside
      class="relative shrink-0 border-r border-[var(--border)] flex flex-col"
      :style="{ width: listDrag.width.value + 'px' }"
    >
      <div class="panel-resizer right-0" :class="{ 'is-dragging': listDrag.dragging.value }" @mousedown="listDrag.onDown($event, 1)" />
      <div class="px-3 py-2.5 border-b border-[var(--border)] space-y-2">
        <InkButton block @click="conv.newConversation()"><Plus :size="13" /> 新建会话</InkButton>
        <input v-model="listQuery" class="ink-input h-7 py-0 text-label" placeholder="搜索会话…" />
      </div>

      <div class="flex-1 overflow-y-auto py-1.5 px-1.5 space-y-0.5">
        <div
          v-for="c in filteredConversations"
          :key="c.id"
          class="conv-item group"
          :class="{ 'is-on': c.id === conv.currentId }"
          @click="conv.loadConversation(c.id)"
        >
          <div class="min-w-0 flex-1">
            <div class="text-label truncate">{{ c.title || '新会话' }}</div>
            <div class="text-meta text-[var(--text-faint)] flex items-center gap-1 mt-0.5">
              <Clock :size="9" />{{ fmtTime(c.updatedAt) }} · {{ c.messageCount }} 条
            </div>
          </div>
          <button
            class="ink-icon-btn is-danger opacity-0 group-hover:opacity-100"
            title="删除会话"
            @click.stop="removeConversation(c.id, c.title)"
          >
            <Trash2 :size="12" />
          </button>
        </div>
        <p
          v-if="!filteredConversations.length"
          class="mx-1.5 my-1 py-6 text-center rounded-[var(--r-sm)] border border-dashed border-[var(--border)] text-label text-[var(--text-faint)]"
        >
          暂无历史会话
        </p>
      </div>

      <button
        class="shrink-0 flex items-center justify-center gap-1.5 text-meta py-2.5 border-t border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] cursor-pointer transition-colors"
        @click="conv.exportCurrent()"
      >
        <Download :size="12" /> 导出当前会话
      </button>
    </aside>

    <!-- 中：对话主体 -->
    <section class="flex-1 min-w-0 flex flex-col">
      <!-- 上下文指示条：chips 化，一眼看清 AI 正在针对什么工作 -->
      <div class="shrink-0 h-10 flex items-center gap-1.5 px-5 border-b border-[var(--border)]">
        <Sparkles :size="13" class="text-[var(--accent)]" />
        <span class="text-meta text-[var(--text-faint)] mr-1">上下文</span>
        <span
          v-for="(p, i) in contextParts"
          :key="p + i"
          class="ink-chip"
          :class="i === contextParts.length - 1 ? 'ink-chip-accent' : ''"
        >{{ p }}</span>
        <div class="flex-1" />
        <span class="text-meta text-[var(--text-faint)]">智能体在这里能读写整部作品；改稿会先给差异，由你决定是否接受</span>
      </div>

      <div class="flex-1 min-h-0">
        <AgentConversation full-width />
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 会话条目：左缘 2px 强调标记 + 极淡强调底（与全站选中态同一语言） */
.conv-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 6px 8px 10px;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background-color var(--dur-2), color var(--dur-2);
}
.conv-item:hover {
  background: var(--hover);
}
.conv-item.is-on {
  background: var(--accent-soft);
}
.conv-item.is-on::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: var(--r-pill);
  background: var(--accent);
}
.conv-item.is-on .text-label {
  color: var(--accent);
}
</style>