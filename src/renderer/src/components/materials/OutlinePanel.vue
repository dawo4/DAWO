<script setup lang="ts">
// 卷/章细纲板：每章一句话细纲 + 完成状态，全局看节奏；工作流逐章生文时自动落盘
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLibraryStore } from '../../store/library'
import { useAppStore } from '../../store/app'
import { inkConfirm } from '../../ui/inkPrompt'
import InkSelect from '../../ui/InkSelect.vue'
import EmptyHint from '../../ui/EmptyHint.vue'
import { ListChecks, Plus, Trash2, WandSparkles } from 'lucide-vue-next'
import type { OutlineEntry } from '../../types'

const lib = useLibraryStore()
const app = useAppStore()

const STATUSES = ['待写', '已写'] as const

/** 状态点颜色 */
const STATUS_COLOR: Record<string, string> = {
  待写: 'var(--warn)',
  已写: 'var(--ok)'
}

const book = computed(() => lib.current?.title || '')
const entries = ref<OutlineEntry[]>([])
const selectedId = ref('')
const busy = ref(false)

/** 按卷分组（空卷名 = 未分卷，排最后） */
const groups = computed(() => {
  const map = new Map<string, OutlineEntry[]>()
  for (const e of entries.value) {
    const k = e.vol || '未分卷'
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(e)
  }
  return [...map.entries()].map(([vol, list]) => ({ vol, list }))
})
const selected = computed(() => entries.value.find((e) => e.id === selectedId.value))
const doneCount = computed(() => entries.value.filter((e) => e.status === '已写').length)

async function load() {
  if (!book.value) return
  entries.value = ((await window.api.outlineRead(book.value)) as OutlineEntry[]) || []
  if (!entries.value.find((e) => e.id === selectedId.value)) selectedId.value = entries.value[0]?.id || ''
}

async function persist() {
  if (!book.value || busy.value) return
  busy.value = true
  try {
    entries.value = ((await window.api.outlineWrite(
      book.value,
      JSON.parse(JSON.stringify(entries.value))
    )) as OutlineEntry[]) || []
  } finally {
    busy.value = false
  }
}

function addEntry() {
  const maxNo = entries.value.reduce((m, e) => Math.max(m, e.no), 0)
  const entry: OutlineEntry = {
    id: `ol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    vol: '',
    no: maxNo + 1,
    title: '',
    beat: '',
    status: '待写'
  }
  entries.value.push(entry)
  selectedId.value = entry.id
  void persist()
}

/** 按工作流的章节数批量生成空条目（已有章节跳过） */
async function seedFromWorkflow() {
  const total = lib.current?.workflow?.chapterTotal || 0
  if (!total) return
  const have = new Set(entries.value.map((e) => e.no))
  for (let no = 1; no <= total; no++) {
    if (have.has(no)) continue
    entries.value.push({ id: `ol-${no}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, vol: '', no, title: `第${no}章`, beat: '', status: '待写' })
  }
  await persist()
}

async function removeEntry(id: string) {
  const e = entries.value.find((x) => x.id === id)
  if (!e) return
  const ok = await inkConfirm(`删除第 ${e.no} 章的细纲条目？`, { confirmText: '删除', danger: true })
  if (!ok) return
  entries.value = entries.value.filter((x) => x.id !== id)
  if (selectedId.value === id) selectedId.value = entries.value[0]?.id || ''
  await persist()
}

/** 交给智能体：从大纲梳理全书逐章细纲（走写入提案） */
async function askAgent() {
  if (!lib.current) return
  app.goAskAgent() // 切到妙笔页，用户能直接看到流式生成
  const { useConversationStore } = await import('../../store/conversation')
  const conv = useConversationStore()
  await conv.askWith(
    'outline',
    '请阅读本书大纲（用 read_document 读「大纲/故事大纲.md」等），把全书拆成逐章细纲，用 write_outline_plan 提交细纲提案。每章两条都填：beat 存一句话到三句话的简纲（这章发生什么、推进什么、埋什么钩子）；beatFull 存完整细纲全文（场景顺序拆解、出场角色、关键转折与结尾钩子）——逐章生文检测到 beatFull 会直接采用，不再重新构思。已有条目不要改动，只补充遗漏或修正明显错误。'
  )
}

/** AI 提案接受落盘后重载，防止本地旧状态把新数据覆盖回去 */
function onFileChanged(e: Event) {
  const p = (e as CustomEvent<{ path?: string }>).detail?.path
  if (p === '细纲.json') void load()
}
onMounted(() => window.addEventListener('inkdesk:file-changed', onFileChanged))
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))

watch(book, () => void load())
onMounted(() => void load())
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div class="panel-head">
      <span class="panel-head-title">卷 / 章细纲板</span>
      <span class="panel-head-meta">每章一句话细纲 + 完成状态，逐章生文前全局看节奏</span>
      <span v-if="entries.length" class="panel-head-meta" :style="{ color: 'var(--accent)' }">已写 {{ doneCount }} / {{ entries.length }}</span>
      <div class="flex-1" />
      <button
        class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer"
        title="按工作流设定的章节数批量生成空条目"
        @click="seedFromWorkflow"
      >
        <ListChecks :size="12" /> 按章节数生成
      </button>
      <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="askAgent">
        <WandSparkles :size="12" /> 让智能体梳理细纲
      </button>
      <button class="ink-chip-btn is-on text-label" @click="addEntry"><Plus :size="13" /> 新增章节</button>
    </div>

    <div class="flex-1 min-h-0 flex">
      <!-- 左：章节列表（按卷分组） -->
      <div class="panel-list w-80 py-2">
        <div v-for="g in groups" :key="g.vol" class="mb-2">
          <div class="section-title px-4 py-1">{{ g.vol }}（{{ g.list.length }}）</div>
          <div v-for="e in g.list" :key="e.id" class="panel-item group" :class="selectedId === e.id ? 'is-on' : ''" @click="selectedId = e.id">
            <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: STATUS_COLOR[e.status] }" />
            <div class="flex-1 min-w-0">
              <div class="text-label truncate flex items-center gap-1.5">
                <span class="truncate">{{ e.no }}. {{ e.title || `第${e.no}章` }}</span>
                <span
                  v-if="e.beatFull && e.beatFull.trim()"
                  class="ink-chip ink-chip-accent shrink-0"
                  title="已有全文存档，逐章生文会直接采用这份细纲"
                  >全文</span
                >
              </div>
              <div v-if="e.beat" class="text-micro text-[var(--text-faint)] truncate">{{ e.beat }}</div>
            </div>
            <button class="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click.stop="removeEntry(e.id)">
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
        <div v-if="!entries.length" class="px-4 py-8 text-center text-label text-[var(--text-faint)] leading-6">
          细纲还是空的<br />手动新增、按章节数生成，或让智能体梳理
        </div>
      </div>

      <!-- 右：编辑 -->
      <div class="panel-body px-6 py-5">
        <EmptyHint v-if="!selected" :icon="ListChecks" title="选择章节查看与编辑" />
        <div v-else class="max-w-xl space-y-4">
          <div class="flex gap-3">
            <div class="w-24 shrink-0">
              <div class="form-label">章节号</div>
              <input v-model.number="selected.no" type="number" min="1" class="ink-input" @change="persist" />
            </div>
            <div class="flex-1">
              <div class="form-label">章节标题</div>
              <input v-model="selected.title" class="ink-input" placeholder="如：夜探藏经阁" @change="persist" />
            </div>
            <div class="w-36 shrink-0">
              <div class="form-label">状态</div>
              <InkSelect v-model="selected.status" class="w-full" :options="STATUSES.map((s) => ({ label: s, value: s }))" @change="persist" />
            </div>
          </div>
          <div>
            <div class="form-label">所属卷（可空）</div>
            <input v-model="selected.vol" class="ink-input" placeholder="如：第一卷·初入宗门" @change="persist" />
          </div>
          <div>
            <div class="form-label">本章细纲（一句话到三句话）</div>
            <textarea v-model="selected.beat" rows="6" class="ink-textarea" placeholder="这一章发生什么、推进什么、埋什么钩子" @change="persist" />
          </div>
          <div>
            <div class="form-label flex items-center gap-1.5">
              全文细纲存档
              <span class="ink-chip ink-chip-accent">逐章生文直接采用</span>
            </div>
            <textarea
              v-model="selected.beatFull"
              rows="10"
              class="ink-textarea"
              placeholder="完整的章节细纲：场景顺序拆解、出场角色、关键转折与钩子。留空则逐章生文时现场构思。智能体经 write_outline_plan 提交的全文会自动存到这里"
              @change="persist"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
