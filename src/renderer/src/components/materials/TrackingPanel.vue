<script setup lang="ts">
// 角色出场追踪板：每个角色最近在哪、什么状态，防失忆防神隐
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLibraryStore } from '../../store/library'
import { useAppStore } from '../../store/app'
import { inkConfirm } from '../../ui/inkPrompt'
import InkSelect from '../../ui/InkSelect.vue'
import { Plus, Trash2, WandSparkles } from 'lucide-vue-next'
import type { TrackingEntry, TrackingStatus } from '../../types'

const lib = useLibraryStore()
const app = useAppStore()

const STATUSES: TrackingStatus[] = ['健康', '受伤', '闭关', '离场', '死亡']

/** 状态点颜色 */
const STATUS_COLOR: Record<string, string> = {
  健康: '#6fae6f',
  受伤: '#d97a5a',
  闭关: '#5a8fd9',
  离场: 'var(--text-faint)',
  死亡: '#4a4a4a'
}

const book = computed(() => lib.current?.title || '')
const entries = ref<TrackingEntry[]>([])
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
  entries.value = ((await window.api.trackingRead(book.value)) as TrackingEntry[]) || []
  if (!entries.value.find((e) => e.id === selectedId.value)) selectedId.value = entries.value[0]?.id || ''
}

async function persist() {
  if (!book.value || busy.value) return
  busy.value = true
  try {
    entries.value = ((await window.api.trackingWrite(
      book.value,
      JSON.parse(JSON.stringify(entries.value))
    )) as TrackingEntry[]) || []
  } finally {
    busy.value = false
  }
}

function addEntry() {
  const entry: TrackingEntry = {
    id: `tk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: '新角色',
    status: '健康',
    lastChapter: '',
    location: '',
    note: ''
  }
  entries.value.push(entry)
  selectedId.value = entry.id
  void persist()
}

async function removeEntry(id: string) {
  const e = entries.value.find((x) => x.id === id)
  if (!e) return
  const ok = await inkConfirm(`移除角色「${e.name}」的出场登记？`, { confirmText: '移除', danger: true })
  if (!ok) return
  entries.value = entries.value.filter((x) => x.id !== id)
  if (selectedId.value === id) selectedId.value = entries.value[0]?.id || ''
  await persist()
}

/** 交给智能体：从正文梳理角色出场状态（走写入提案） */
async function askAgent() {
  if (!lib.current) return
  app.goAskAgent() // 切到妙笔页，用户能直接看到流式生成
  const { useConversationStore } = await import('../../store/conversation')
  const conv = useConversationStore()
  await conv.askWith(
    'tracking',
    '请阅读本书已写章节（用 list_documents / read_document），按最近章节从后往前梳理每个角色的出场情况——当前状态（健康/受伤/闭关/离场/死亡）、最近出场的章节、现在所在的位置——用 write_tracking 提交出场追踪提案。已有条目不要改动，只补充遗漏或更新状态。'
  )
}

/** AI 提案接受落盘后重载，防止本地旧状态把新数据覆盖回去 */
function onFileChanged(e: Event) {
  const p = (e as CustomEvent<{ path?: string }>).detail?.path
  if (p === '出场追踪.json') void load()
}
onMounted(() => window.addEventListener('inkdesk:file-changed', onFileChanged))
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))

watch(book, () => void load())
onMounted(() => void load())
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div class="h-11 shrink-0 flex items-center gap-3 px-6 border-b border-[var(--border)]">
      <span class="text-[12.5px]" style="color: var(--accent)">角色出场追踪</span>
      <span class="text-[11px] text-[var(--text-faint)]">谁在哪儿、什么状态，防神隐防死人复活防穿越瞬移</span>
      <div class="flex-1" />
      <button class="text-[11.5px] flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="askAgent">
        <WandSparkles :size="12" /> 让智能体梳理出场
      </button>
      <button class="text-[11.5px] flex items-center gap-1 text-[var(--accent)] cursor-pointer" @click="addEntry"><Plus :size="13" /> 添加角色</button>
    </div>

    <div class="flex-1 min-h-0 flex">
      <!-- 左：角色列表（按状态筛选） -->
      <div class="w-80 shrink-0 border-r border-[var(--border)] overflow-y-auto py-2">
        <div class="px-4 pb-2 flex flex-wrap gap-1">
          <button
            v-for="s in ['全部', ...STATUSES]"
            :key="s"
            class="px-2 py-0.5 text-[11px] rounded-full cursor-pointer transition-colors"
            :class="filterStatus === s ? 'bg-[var(--panel-2)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
            :style="filterStatus === s ? { color: 'var(--accent)' } : {}"
            @click="filterStatus = s"
          >
            {{ s }}（{{ countOf(s) }}）
          </button>
        </div>
        <div
          v-for="e in shown"
          :key="e.id"
          class="group flex items-center gap-2 px-4 py-1.5 cursor-pointer border-l-2"
          :class="selectedId === e.id ? 'bg-[var(--panel-2)]' : 'border-transparent hover:bg-[var(--hover)]'"
          :style="selectedId === e.id ? { borderColor: 'var(--accent)' } : {}"
          @click="selectedId = e.id"
        >
          <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: STATUS_COLOR[e.status] }" />
          <div class="flex-1 min-w-0">
            <div class="text-[12.5px] truncate" :style="selectedId === e.id ? { color: 'var(--accent)' } : {}">{{ e.name }}</div>
            <div class="text-[10.5px] text-[var(--text-faint)] truncate">
              {{ e.location || '位置未知' }}<template v-if="e.lastChapter"> · {{ e.lastChapter }}</template>
            </div>
          </div>
          <button class="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer" @click.stop="removeEntry(e.id)">
            <Trash2 :size="12" />
          </button>
        </div>
        <div v-if="!shown.length" class="px-4 py-8 text-center text-[11.5px] text-[var(--text-faint)] leading-6">
          还没有登记角色<br />手动添加，或让智能体从正文梳理
        </div>
      </div>

      <!-- 右：编辑 -->
      <div class="flex-1 min-w-0 overflow-y-auto px-6 py-5">
        <div v-if="!selected" class="h-full flex items-center justify-center text-[var(--text-faint)] text-[13px]">
          选择角色查看与编辑
        </div>
        <div v-else class="max-w-xl space-y-4">
          <div class="flex gap-3">
            <div class="flex-1">
              <div class="text-[11px] text-[var(--text-faint)] mb-1.5 tracking-wider">角色名</div>
              <input v-model="selected.name" class="ink-input" placeholder="角色名" @change="persist" />
            </div>
            <div class="w-36 shrink-0">
              <div class="text-[11px] text-[var(--text-faint)] mb-1.5 tracking-wider">状态</div>
              <InkSelect v-model="selected.status" class="w-full" :options="STATUSES.map((s) => ({ label: s, value: s }))" @change="persist" />
            </div>
          </div>
          <div class="flex gap-3">
            <div class="flex-1">
              <div class="text-[11px] text-[var(--text-faint)] mb-1.5 tracking-wider">最近出场章节</div>
              <input v-model="selected.lastChapter" class="ink-input" placeholder="正文/第012章" @change="persist" />
            </div>
            <div class="flex-1">
              <div class="text-[11px] text-[var(--text-faint)] mb-1.5 tracking-wider">当前所在地</div>
              <input v-model="selected.location" class="ink-input" placeholder="如：青云宗·藏经阁" @change="persist" />
            </div>
          </div>
          <div>
            <div class="text-[11px] text-[var(--text-faint)] mb-1.5 tracking-wider">备注</div>
            <textarea v-model="selected.note" rows="4" class="ink-textarea" placeholder="伤势详情、闭关时长、何时该回归剧情" @change="persist" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
