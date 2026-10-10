<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../../store/app'
import { useLibraryStore } from '../../store/library'
import { useConversationStore } from '../../store/conversation'
import ConversationMessage from './ConversationMessage.vue'
import AgentComposer from './AgentComposer.vue'
import { inkConfirm } from '../../ui/inkPrompt'
import { ChevronDown, ChevronRight, History, Download, Trash2, Sparkles, ScrollText } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ fullWidth?: boolean }>(), { fullWidth: false })

const app = useAppStore()
const lib = useLibraryStore()
const conv = useConversationStore()

/** 全宽模式（妙笔独立页）下给内容与输入区一个舒适的可读宽度 */
const innerWidth = computed(() => (props.fullWidth ? 'max-w-[820px] mx-auto w-full' : ''))

const listEl = ref<HTMLElement>()
const agentOpen = ref(false)
const historyOpen = ref(false)
const summaryOpen = ref(false)

const currentAgent = computed(() => conv.allAgents.find((a) => a.id === conv.agentId) || conv.allAgents[0])
const book = computed(() => lib.current?.title || '')

/** 智能体选择列表分组：常用 / 资料区工具（默认折叠）/ 自定义 */
const toolOpen = ref(false)
const agentGroups = computed(() =>
  [
    { key: 'main', label: '常用智能体', collapsible: false, list: conv.allAgents.filter((a) => !a.custom && !a.panel) },
    { key: 'tool', label: '资料区工具 · 通常由资料面板一键调用', collapsible: true, list: conv.allAgents.filter((a) => !a.custom && a.panel) },
    { key: 'custom', label: '自定义智能体', collapsible: false, list: conv.allAgents.filter((a) => a.custom) }
  ].filter((g) => g.list.length)
)

let off: (() => void) | null = null

onMounted(async () => {
  // 应用级单例监听（store 内防重），组件卸载不断开：运行中切页事件不丢
  conv.ensureAgentListener()
  off = () => {}
  if (book.value && conv.book !== book.value) await conv.init(book.value)
})

onUnmounted(() => {
  off?.()
  off = null
})

watch(book, async (b) => {
  if (b && conv.book !== b) await conv.init(b)
})

function scrollToBottom() {
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
}

/** 用户是否贴在底部（80px 容差）：贴底才跟随流式输出自动滚动，向上翻阅时不被强拉回去 */
const stickToBottom = ref(true)
function onListScroll() {
  const el = listEl.value
  if (!el) return
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

function followScroll() {
  if (stickToBottom.value) void nextTick(scrollToBottom)
}

watch(
  () => {
    const last = conv.messages[conv.messages.length - 1]
    return [conv.messages.length, last?.content.length || 0, last?.thinking.length || 0, last?.processingSteps.length || 0]
  },
  (cur, old) => {
    // 新消息落场（用户发送 / AI 回复开始）：强制到底部；流式增量：仅在用户贴底时跟随
    if (!old || cur[0] !== old[0]) {
      stickToBottom.value = true
      void nextTick(scrollToBottom)
    } else {
      followScroll()
    }
  }
)

// 切换会话：直接回到最新位置
watch(
  () => conv.currentId,
  () => {
    stickToBottom.value = true
    void nextTick(scrollToBottom)
  }
)

async function pickAgent(id: string) {
  conv.agentId = id
  agentOpen.value = false
  await conv.persist()
}

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

async function quickSend(t: string) {
  await conv.send(t)
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- 头部 -->
    <header class="shrink-0 flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--border)]">
      <div class="relative">
        <button
          class="flex items-center gap-1.5 text-[13px] cursor-pointer px-2.5 py-1.5 rounded-lg hover:bg-[var(--hover)]"
          @click="agentOpen = !agentOpen; historyOpen = false"
        >
          <Sparkles :size="13" :style="{ color: 'var(--accent)' }" />
          <span class="font-medium">{{ currentAgent.name }}</span>
          <ChevronDown :size="13" class="text-[var(--text-faint)]" />
        </button>
        <div
          v-if="agentOpen"
          class="absolute top-full left-0 mt-1 w-80 rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow)] overflow-hidden z-40 max-h-[70vh] flex flex-col"
        >
          <div class="overflow-y-auto">
            <template v-for="g in agentGroups" :key="g.key">
              <!-- 组头：可折叠的做成按钮 -->
              <button
                v-if="g.collapsible"
                class="w-full flex items-center gap-1 px-3.5 py-1.5 text-[10.5px] tracking-wider bg-[var(--bg-soft)] text-[var(--text-faint)] cursor-pointer hover:text-[var(--text-dim)] sticky top-0 z-10"
                @click="toolOpen = !toolOpen"
              >
                <component :is="toolOpen ? ChevronDown : ChevronRight" :size="11" />
                {{ g.label }}（{{ g.list.length }}）
              </button>
              <div v-else class="px-3.5 py-1.5 text-[10.5px] tracking-wider bg-[var(--bg-soft)] text-[var(--text-faint)] sticky top-0 z-10">
                {{ g.label }}
              </div>
              <template v-if="!g.collapsible || toolOpen">
                <button
                  v-for="a in g.list"
                  :key="a.id"
                  class="w-full text-left px-3.5 py-2.5 hover:bg-[var(--hover)] cursor-pointer border-b border-[var(--border)] last:border-b-0"
                  @click="pickAgent(a.id)"
                >
                  <div class="flex items-center gap-2">
                    <span class="text-[13px]" :style="a.id === conv.agentId ? { color: 'var(--accent)' } : {}">{{ a.name }}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-faint)]">{{ a.stage }}</span>
                    <span
                      v-if="a.custom"
                      class="text-[10px] px-1.5 py-0.5 rounded-full"
                      :style="{ background: 'var(--panel-2)', color: 'var(--accent)' }"
                    >自定义</span>
                    <span v-if="a.webSearch" class="text-[10px] text-[var(--text-faint)]">联网</span>
                  </div>
                  <div class="text-[11px] text-[var(--text-faint)] mt-0.5">{{ a.desc }}</div>
                </button>
              </template>
            </template>
          </div>
        </div>
      </div>

      <div class="flex-1" />

      <div class="relative">
        <button
          class="flex items-center gap-1.5 text-[11.5px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer px-2 py-1.5 rounded-lg hover:bg-[var(--hover)]"
          @click="historyOpen = !historyOpen; agentOpen = false"
        >
          <History :size="13" /> 历史 {{ conv.conversations.length }}
        </button>
        <div
          v-if="historyOpen"
          class="absolute top-full right-0 mt-1 w-80 rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow)] overflow-hidden z-40"
        >
          <div class="flex items-center justify-between px-3.5 py-2 border-b border-[var(--border)]">
            <span class="text-[11px] text-[var(--text-faint)]">会话记录</span>
            <button class="text-[11px] cursor-pointer" :style="{ color: 'var(--accent)' }" @click="conv.newConversation(); historyOpen = false">新建会话</button>
          </div>
          <div class="max-h-72 overflow-y-auto">
            <div
              v-for="c in conv.conversations"
              :key="c.id"
              class="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--hover)]"
            >
              <button class="flex-1 min-w-0 text-left cursor-pointer" @click="conv.loadConversation(c.id); historyOpen = false">
                <div class="text-[12.5px] truncate" :style="c.id === conv.currentId ? { color: 'var(--accent)' } : {}">{{ c.title || '新会话' }}</div>
                <div class="text-[10px] text-[var(--text-faint)]">{{ fmtTime(c.updatedAt) }} · {{ c.messageCount }} 条</div>
              </button>
              <button class="text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer" @click="removeConversation(c.id, c.title)">
                <Trash2 :size="13" />
              </button>
            </div>
            <div v-if="!conv.conversations.length" class="px-3.5 py-6 text-center text-[12px] text-[var(--text-faint)]">暂无历史会话</div>
          </div>
          <button
            class="w-full flex items-center justify-center gap-1.5 text-[11.5px] py-2 cursor-pointer border-t border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)]"
            @click="conv.exportCurrent()"
          >
            <Download :size="13" /> 导出当前会话为 Markdown
          </button>
        </div>
      </div>
    </header>

    <!-- 消息列表 -->
    <div ref="listEl" class="flex-1 min-h-0 overflow-y-auto px-5 py-5" @scroll="onListScroll">
      <div class="space-y-5" :class="innerWidth">
        <!-- 上下文压缩摘要卡：早期对话被自动压缩后置顶展示 -->
        <div
          v-if="conv.contextSummary"
          class="rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel)] px-4 py-3 cursor-pointer"
          @click="summaryOpen = !summaryOpen"
        >
          <div class="flex items-center gap-2 text-[11.5px]" :style="{ color: 'var(--accent)' }">
            <ScrollText :size="12" />
            <span>已自动压缩 {{ conv.messages.filter((m) => m.compacted).length }} 条早期对话，摘要随每轮发送</span>
            <ChevronDown :size="12" class="ml-auto transition-transform" :class="summaryOpen ? 'rotate-180' : ''" />
          </div>
          <div v-if="summaryOpen" class="mt-2 text-[12px] text-[var(--text-dim)] whitespace-pre-wrap leading-5">{{ conv.contextSummary }}</div>
        </div>

        <div v-if="!conv.messages.length" class="pt-8">
          <div class="text-center mb-6">
            <div class="font-serif-ink text-xl mb-1.5">{{ currentAgent.name }}</div>
            <div class="text-[12.5px] text-[var(--text-faint)]">{{ currentAgent.desc }}</div>
          </div>
          <div class="grid gap-2" :class="props.fullWidth ? 'sm:grid-cols-2' : ''">
            <button
              v-for="w in currentAgent.welcome"
              :key="w"
              class="text-left text-[12.5px] px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] hover:border-[var(--accent)] cursor-pointer transition-colors"
              @click="quickSend(w)"
            >
              {{ w }}
            </button>
          </div>
          <div v-if="currentAgent.readScope.length" class="mt-5 text-[11.5px] text-[var(--text-faint)] text-center">
            可访问范围：{{ currentAgent.readScope.join(' · ') }}
          </div>
          <div v-else class="mt-5 text-[11.5px] text-[var(--text-faint)] text-center">可访问全部稿件与资料</div>
        </div>

        <ConversationMessage v-for="m in conv.messages" :key="m.id" :message="m" :agent-id="conv.agentId" />
      </div>
    </div>

    <!-- 输入区 -->
    <div class="shrink-0 px-5 pb-4 pt-1">
      <div :class="innerWidth">
        <AgentComposer />
      </div>
    </div>
  </div>
</template>