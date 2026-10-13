<script setup lang="ts">
// 批量修订：多章套用同一条修订指令，逐章调「润色」模型，每章生成差异提案，作者逐个审阅接受。
import { computed, ref, watch, onUnmounted } from 'vue'
import { useLibraryStore } from '../../store/library'
import { LoaderCircle, Square, X, ChevronDown, ChevronRight, Check, SquareCheckBig } from 'lucide-vue-next'
import ProposalDiff from '../conversation/ProposalDiff.vue'
import type { EditProposal } from '../../types'

const props = defineProps<{ book: string; currentFile: string; open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const lib = useLibraryStore()

interface Item {
  path: string
  title: string
  no: number
  checked: boolean
  status: 'wait' | 'run' | 'ok' | 'error' | 'applied' | 'rejected'
  proposal: EditProposal | null
  error: string
  expanded: boolean
}

const items = ref<Item[]>([])
const instruction = ref('')
const rangeText = ref('')
const running = ref(false)
const runId = ref('')
const doneInfo = ref('')
const expandedAll = ref(false)

const PRESETS = ['对话再精炼一点，删掉口头禅式的重复', '加强场景氛围描写，各加一两句环境细节', '节奏加快：压缩过渡段，直入冲突', '情绪拉满：强化章末钩子的悬念感']

const checked = computed(() => items.value.filter((x) => x.checked))
const doneCount = computed(() => items.value.filter((x) => ['ok', 'error', 'applied', 'rejected'].includes(x.status)).length)
const okItems = computed(() => items.value.filter((x) => x.status === 'ok' && x.proposal))

function loadChapters() {
  items.value = lib.chapterList().map((c) => {
    const no = Number(c.name.match(/第(\d+)章/)?.[1] || 0)
    return { path: c.path, title: c.name.replace(/\.md$/, ''), no, checked: false, status: 'wait' as const, proposal: null, error: '', expanded: false }
  })
}

/** 快捷范围：如 3-20 / 5 */
function applyRange() {
  const m = rangeText.value.trim().match(/^(\d+)\s*[-~]\s*(\d+)$/)
  const single = rangeText.value.trim().match(/^(\d+)$/)
  items.value.forEach((x) => (x.checked = false))
  if (m) {
    const [a, b] = [Math.min(+m[1], +m[2]), Math.max(+m[1], +m[2])]
    items.value.forEach((x) => {
      if (x.no >= a && x.no <= b) x.checked = true
    })
  } else if (single) {
    const x = items.value.find((i) => i.no === +single[1])
    if (x) x.checked = true
  }
}

function toggleAll() {
  const allOn = items.value.length > 0 && items.value.every((x) => x.checked)
  items.value.forEach((x) => (x.checked = !allOn))
}

function onEvent(evt: { runId: string; type: string; payload?: Record<string, unknown> }) {
  if (evt.runId !== runId.value) return
  const p = evt.payload || {}
  const idx = typeof p.index === 'number' ? p.index : -1
  if (evt.type === 'chapter-start' && idx >= 0) {
    items.value[idx].status = 'run'
  } else if (evt.type === 'chapter-proposal' && idx >= 0) {
    items.value[idx].status = 'ok'
    items.value[idx].proposal = p.proposal as EditProposal
  } else if (evt.type === 'chapter-error' && idx >= 0) {
    items.value[idx].status = 'error'
    items.value[idx].error = String(p.error || '未知错误')
  } else if (evt.type === 'batch-done') {
    running.value = false
    const done = Number(p.done || 0)
    const failed = Number(p.failed || 0)
    doneInfo.value = p.aborted ? `已停止：完成 ${done} 章，失败 ${failed} 章` : `跑完了：${done} 章生成提案，${failed} 章失败`
  } else if (evt.type === 'batch-error') {
    running.value = false
    doneInfo.value = String(p.error || '')
  }
}

function start() {
  if (!checked.value.length || !instruction.value.trim() || running.value) return
  items.value.forEach((x) => {
    x.status = 'wait'
    x.proposal = null
    x.error = ''
    x.expanded = false
  })
  doneInfo.value = ''
  runId.value = `batch-${Date.now()}`
  running.value = true
  void window.api.batchRevise({
    runId: runId.value,
    book: props.book,
    chapters: checked.value.map((x) => ({ path: x.path, title: x.title })),
    instruction: instruction.value.trim()
  })
}

function stop() {
  if (runId.value) void window.api.batchAbort(runId.value)
}

/** 事件监听：aiOnEvent 挂在 agent:event 通道上（批量事件也走这条通道） */
let off: (() => void) | null = null
watch(
  () => props.open,
  (v) => {
    if (v) {
      loadChapters()
      doneInfo.value = ''
      if (!off) off = window.api.aiOnEvent(onEvent)
    } else if (running.value) {
      stop()
    }
  }
)
onUnmounted(() => {
  off?.()
  off = null
  if (running.value) stop()
})

/** 接受 / 拒绝：走全局提案 IPC；接受后通知写作台刷新对应文件 */
async function decide(item: Item, accept: boolean) {
  if (!item.proposal) return
  const r = accept
    ? await window.api.proposalApply(item.proposal.id)
    : await window.api.proposalReject(item.proposal.id)
  item.status = accept ? 'applied' : 'rejected'
  if (!accept) item.proposal = null
  if (accept && r.ok) {
    window.dispatchEvent(new CustomEvent('inkdesk:file-changed', { detail: { path: item.path } }))
  }
}

async function acceptAll() {
  for (const item of okItems.value) {
    if (item.status !== 'ok') continue
    await decide(item, true)
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" @click.self="emit('close')">
      <div class="w-[680px] max-w-[94vw] h-[82vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)]" style="box-shadow: var(--shadow)">
        <!-- 头部 -->
        <div class="shrink-0 flex items-center gap-2 px-5 py-3.5 border-b border-[var(--border)]">
          <SquareCheckBig :size="15" :style="{ color: 'var(--accent)' }" />
          <span class="font-serif-ink text-[16px]">批量修订</span>
          <span class="text-[11px] text-[var(--text-faint)]">多章套用同一条指令，逐章出差异，你逐个审</span>
          <div class="flex-1" />
          <button class="text-[var(--text-faint)] hover:text-[var(--text)] cursor-pointer" @click="emit('close')"><X :size="16" /></button>
        </div>

        <!-- 第一步：选章 + 指令 -->
        <div v-if="!running && !doneCount" class="shrink-0 px-5 py-3 space-y-2.5 border-b border-[var(--border)]">
          <div class="flex items-center gap-2 flex-wrap">
            <button class="text-[11.5px] px-2.5 py-1 rounded-lg cursor-pointer border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)]" @click="toggleAll">
              全选 / 反选
            </button>
            <input v-model="rangeText" class="ink-input w-28 py-1" placeholder="范围如 3-20" @keydown.enter="applyRange" />
            <button class="text-[11.5px] px-2.5 py-1 rounded-lg cursor-pointer border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)]" @click="applyRange">
              选中范围
            </button>
            <span class="text-[11px] text-[var(--text-faint)]">已选 {{ checked.length }} / {{ items.length }} 章</span>
          </div>

          <div class="max-h-[180px] overflow-y-auto rounded-lg border border-[var(--border)] p-1.5 flex flex-wrap gap-1">
            <button
              v-for="it in items"
              :key="it.path"
              class="px-2 py-1 text-[11px] rounded-full cursor-pointer transition-colors"
              :class="it.checked ? 'font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
              :style="it.checked ? { background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' } : { background: 'var(--bg-soft)' }"
              @click="it.checked = !it.checked"
            >
              {{ it.title }}
            </button>
          </div>

          <textarea v-model="instruction" class="ink-textarea text-[12.5px]" rows="3" placeholder="修订指令，对选中的每一章都生效。如：把对话精炼三成，保留关键信息；删掉「一瞬间」「仿佛」堆叠。" />
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="p in PRESETS"
              :key="p"
              class="text-[11px] px-2 py-0.5 rounded-full text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--hover)] cursor-pointer"
              @click="instruction = p"
            >
              {{ p }}
            </button>
          </div>

          <div class="flex items-center gap-2">
            <div class="flex-1 text-[11px] text-[var(--text-faint)] leading-4">逐章调「润色 / 扩写 / 纠错」任务模型；每章生成差异提案，不改指令之外的内容。</div>
            <button
              class="text-[12.5px] px-5 py-1.5 rounded-lg cursor-pointer font-medium text-[#1b1712] transition-[filter] hover:brightness-110 disabled:opacity-40"
              style="background: var(--accent)"
              :disabled="!checked.length || !instruction.trim()"
              @click="start"
            >
              开始修订（{{ checked.length }} 章）
            </button>
          </div>
        </div>

        <!-- 第二步：进度与审阅 -->
        <template v-else>
          <div class="shrink-0 px-5 py-2.5 border-b border-[var(--border)] flex items-center gap-3">
            <template v-if="running">
              <LoaderCircle :size="13" class="animate-spin" style="color: var(--accent)" />
              <span class="text-[12px] text-[var(--text-dim)]">进度 {{ doneCount }}/{{ checked.length }}</span>
              <button class="text-[11.5px] px-2.5 py-1 rounded-lg cursor-pointer border border-[var(--border)] text-[var(--text-dim)] hover:text-[#e08a7a]" @click="stop">
                <Square :size="11" class="inline mr-1 -mt-0.5" />停止
              </button>
            </template>
            <template v-else>
              <span class="text-[12px]" style="color: var(--accent)">{{ doneInfo }}</span>
              <button v-if="okItems.length" class="text-[11.5px] px-2.5 py-1 rounded-lg cursor-pointer border border-[var(--accent)]" style="color: var(--accent)" @click="acceptAll">
                <Check :size="11" class="inline mr-1 -mt-0.5" />全部接受（{{ okItems.length }}）
              </button>
              <button class="text-[11.5px] px-2.5 py-1 rounded-lg cursor-pointer border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]" @click="loadChapters(); doneInfo = ''">
                再来一轮
              </button>
            </template>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-1.5">
            <div
              v-for="it in items"
              :key="it.path"
              class="rounded-lg border text-[12px]"
              :class="[it.status === 'error' ? 'border-[#e08a7a55]' : 'border-[var(--border)]', it.status === 'run' ? 'bg-[var(--bg-soft)]' : 'bg-[var(--bg-soft)]/50']"
            >
              <button
                class="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
                :disabled="!it.proposal"
                @click="it.proposal && (it.expanded = !it.expanded)"
              >
                <template v-if="it.status === 'run'"><LoaderCircle :size="12" class="animate-spin" style="color: var(--accent)" /></template>
                <template v-else-if="it.status === 'ok'"><ChevronDown v-if="it.expanded" :size="12" class="text-[var(--accent)]" /><ChevronRight v-else :size="12" style="color: var(--accent)" /></template>
                <template v-else-if="it.status === 'applied'"><Check :size="12" style="color: var(--accent)" /></template>
                <template v-else-if="it.status === 'error'"><X :size="12" style="color: #e08a7a" /></template>
                <span v-else-if="it.status === 'rejected'" class="text-[var(--text-faint)]">—</span>
                <b v-else class="text-[var(--text-faint)]">·</b>
                <span class="flex-1" :class="it.status === 'wait' ? 'text-[var(--text-faint)]' : ''">{{ it.title }}</span>
                <span v-if="it.status === 'wait'" class="text-[10.5px] text-[var(--text-faint)]">等待</span>
                <span v-else-if="it.status === 'run'" class="text-[10.5px]" style="color: var(--accent)">修订中…</span>
                <span v-else-if="it.status === 'ok'" class="text-[10.5px]" style="color: var(--accent)">
                  提案 {{ it.proposal ? `+${it.proposal.additions} −${it.proposal.deletions}` : '' }}
                </span>
                <span v-else-if="it.status === 'applied'" class="text-[10.5px]" style="color: var(--accent)">已应用</span>
                <span v-else-if="it.status === 'rejected'" class="text-[10.5px] text-[var(--text-faint)]">已放弃</span>
                <span v-else-if="it.status === 'error'" class="text-[10.5px] text-left flex-1" style="color: #e08a7a">{{ it.error }}</span>
              </button>
              <div v-if="it.expanded && it.proposal" class="px-3 pb-2.5">
                <div class="rounded-lg border border-[var(--border)] overflow-hidden max-h-[320px] overflow-y-auto">
                  <ProposalDiff :hunks="it.proposal.hunks" :truncated="it.proposal.truncated" />
                </div>
                <div class="flex gap-2 mt-2 justify-end">
                  <button class="text-[11.5px] px-3 py-1 rounded-lg cursor-pointer border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]" @click="decide(it, false)">
                    放弃
                  </button>
                  <button
                    class="text-[11.5px] px-3 py-1 rounded-lg cursor-pointer font-medium text-[#1b1712]"
                    style="background: var(--accent)"
                    @click="decide(it, true)"
                  >
                    接受并写入
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
