<script setup lang="ts">
// 伏笔登记板：埋下的钩子统一挂账，回收/作废有据可查
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLibraryStore } from '../../store/library'
import { useAppStore } from '../../store/app'
import { inkConfirm } from '../../ui/inkPrompt'
import InkSelect from '../../ui/InkSelect.vue'
import EmptyHint from '../../ui/EmptyHint.vue'
import { GitBranch, Plus, Trash2, WandSparkles } from 'lucide-vue-next'
import type { ForeshadowEntry, ForeshadowStatus } from '../../types'

const lib = useLibraryStore()
const app = useAppStore()

const STATUSES: ForeshadowStatus[] = ['悬置', '已收', '作废']

/** 状态点颜色 */
const STATUS_COLOR: Record<string, string> = {
  悬置: 'var(--warn)',
  已收: 'var(--ok)',
  作废: 'var(--text-faint)'
}

const book = computed(() => lib.current?.title || '')
const entries = ref<ForeshadowEntry[]>([])
const filterStatus = ref('全部')
const selectedId = ref('')
const busy = ref(false)

const shown = computed(() =>
  filterStatus.value === '全部' ? entries.value : entries.value.filter((e) => e.status === filterStatus.value)
)
const countOf = (st: string) => (st === '全部' ? entries.value.length : entries.value.filter((e) => e.status === st).length)
const selected = computed(() => entries.value.find((e) => e.id === selectedId.value))

async function load() {
  if (!book.value) return
  entries.value = ((await window.api.foreshadowRead(book.value)) as ForeshadowEntryLocal[]) || []
  if (!entries.value.find((e) => e.id === selectedId.value)) selectedId.value = entries.value[0]?.id || ''
}

async function persist() {
  if (!book.value || busy.value) return
  busy.value = true
  try {
    entries.value = ((await window.api.foreshadowWrite(
      book.value,
      JSON.parse(JSON.stringify(entries.value))
    )) as ForeshadowEntry[]) || []
  } finally {
    busy.value = false
  }
}

function addEntry() {
  const entry: ForeshadowEntry = {
    id: `fs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    content: '新伏笔',
    plantChapter: '',
    planRecycle: '',
    status: '悬置',
    note: ''
  }
  entries.value.push(entry)
  selectedId.value = entry.id
  void persist()
}

async function removeEntry(id: string) {
  const e = entries.value.find((x) => x.id === id)
  if (!e) return
  const ok = await inkConfirm(`删除伏笔「${e.content.slice(0, 20)}」？`, { confirmText: '删除', danger: true })
  if (!ok) return
  entries.value = entries.value.filter((x) => x.id !== id)
  if (selectedId.value === id) selectedId.value = entries.value[0]?.id || ''
  await persist()
}

/** 交给智能体：从正文里排查伏笔埋设与回收情况（走写入提案） */
async function askAgent() {
  if (!lib.current) return
  app.goAskAgent() // 切到妙笔页，用户能直接看到流式生成
  const { useConversationStore } = await import('../../store/conversation')
  const conv = useConversationStore()
  await conv.askWith(
    'foreshadow',
    '请阅读本书大纲与已写章节（用 list_documents / read_document），排查所有伏笔与钩子——哪里埋了、埋在哪个章节、打算在哪里回收——用 write_foreshadow 提交伏笔登记提案。已有条目不要改动，只补充遗漏或修正状态。'
  )
}

/** AI 提案接受落盘后重载，防止本地旧状态把新数据覆盖回去 */
function onFileChanged(e: Event) {
  const p = (e as CustomEvent<{ path?: string }>).detail?.path
  if (p === '伏笔登记.json') void load()
}
onMounted(() => window.addEventListener('inkdesk:file-changed', onFileChanged))
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))

watch(book, () => void load())
onMounted(() => void load())
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div class="panel-head">
      <span class="panel-head-title">伏笔登记板</span>
      <span class="panel-head-meta">埋下的钩子统一挂账，悬置 / 已收 / 作废一目了然，防遗忘防泄底</span>
      <div class="flex-1" />
      <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="askAgent">
        <WandSparkles :size="12" /> 让智能体排查伏笔
      </button>
      <button class="ink-chip-btn is-on text-label" @click="addEntry"><Plus :size="13" /> 新增伏笔</button>
    </div>

    <div class="flex-1 min-h-0 flex">
      <!-- 左：伏笔列表（按状态筛选） -->
      <div class="panel-list w-80 py-2">
        <div class="px-4 pb-2 flex flex-wrap gap-1">
          <button
            v-for="s in ['全部', ...STATUSES]"
            :key="s"
            class="ink-chip-btn"
            :class="filterStatus === s ? 'is-on' : ''"
            @click="filterStatus = s"
          >
            {{ s }}（{{ countOf(s) }}）
          </button>
        </div>
        <div v-for="e in shown" :key="e.id" class="panel-item group" :class="selectedId === e.id ? 'is-on' : ''" @click="selectedId = e.id">
          <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: STATUS_COLOR[e.status] }" />
          <div class="flex-1 min-w-0">
            <div class="text-label truncate">{{ e.content }}</div>
            <div class="text-micro text-[var(--text-faint)] truncate">
              {{ e.plantChapter ? `埋设：${e.plantChapter}` : '未标注埋设章节' }}<template v-if="e.planRecycle"> · 回收：{{ e.planRecycle }}</template>
            </div>
          </div>
          <button class="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click.stop="removeEntry(e.id)">
            <Trash2 :size="12" />
          </button>
        </div>
        <div v-if="!shown.length" class="px-4 py-8 text-center text-label text-[var(--text-faint)] leading-6">
          还没有登记伏笔<br />手动新增，或让智能体从正文排查
        </div>
      </div>

      <!-- 右：编辑 -->
      <div class="panel-body px-6 py-5">
        <EmptyHint v-if="!selected" :icon="GitBranch" title="选择伏笔查看与编辑" />
        <div v-else class="max-w-xl space-y-4">
          <div>
            <div class="form-label">伏笔内容</div>
            <textarea v-model="selected.content" rows="2" class="ink-textarea" placeholder="埋了什么钩子、读者看到了什么" @change="persist" />
          </div>
          <div class="flex gap-3">
            <div class="flex-1">
              <div class="form-label">埋设章节</div>
              <input v-model="selected.plantChapter" class="ink-input" placeholder="正文/第003章" @change="persist" />
            </div>
            <div class="w-36 shrink-0">
              <div class="form-label">状态</div>
              <InkSelect v-model="selected.status" class="w-full" :options="STATUSES.map((s) => ({ label: s, value: s }))" @change="persist" />
            </div>
          </div>
          <div>
            <div class="form-label">计划回收点（可空）</div>
            <input v-model="selected.planRecycle" class="ink-input" placeholder="正文/第020章，或「决战时揭晓」" @change="persist" />
          </div>
          <div>
            <div class="form-label">备注</div>
            <textarea v-model="selected.note" rows="4" class="ink-textarea" placeholder="回收方式、关联线索、注意事项" @change="persist" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
