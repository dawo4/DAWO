<script setup lang="ts">
// 专名词典（书内圣经）：统一登记专有名词，AI 写作时强制引用防吃书
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLibraryStore } from '../../store/library'
import { useAppStore } from '../../store/app'
import { inkConfirm } from '../../ui/inkPrompt'
import InkSelect from '../../ui/InkSelect.vue'
import EmptyHint from '../../ui/EmptyHint.vue'
import { BookMarked, Plus, Trash2, WandSparkles, Map as MapIcon } from 'lucide-vue-next'
import type { BookMap } from '../../types'

const lib = useLibraryStore()
const app = useAppStore()

const CATEGORIES = ['人物', '地点', '组织势力', '功法技能', '物品道具', '称谓礼仪', '其他']

interface DictEntry {
  id: string
  term: string
  category: string
  aliases: string[]
  desc: string
  firstChapter: string
}

const book = computed(() => lib.current?.title || '')
const entries = ref<DictEntry[]>([])
const filterCat = ref('全部')
const selectedId = ref('')
const busy = ref(false)

const shown = computed(() => (filterCat.value === '全部' ? entries.value : entries.value.filter((e) => e.category === filterCat.value)))
const grouped = computed(() => {
  const map = new Map<string, DictEntry[]>()
  for (const e of shown.value) {
    if (!map.has(e.category)) map.set(e.category, [])
    map.get(e.category)!.push(e)
  }
  return CATEGORIES.filter((c) => map.has(c)).map((c) => ({ cat: c, list: map.get(c)! }))
})
const selected = computed(() => entries.value.find((e) => e.id === selectedId.value))

async function load() {
  if (!book.value) return
  entries.value = ((await window.api.dictRead(book.value)) as DictEntry[]) || []
  if (!entries.value.find((e) => e.id === selectedId.value)) selectedId.value = entries.value[0]?.id || ''
}

async function persist() {
  if (!book.value || busy.value) return
  busy.value = true
  try {
    entries.value = ((await window.api.dictWrite(book.value, JSON.parse(JSON.stringify(entries.value)))) as DictEntry[]) || []
  } finally {
    busy.value = false
  }
}

function addEntry() {
  const entry: DictEntry = {
    id: `dict-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    term: '新词条',
    category: filterCat.value !== '全部' ? filterCat.value : '其他',
    aliases: [],
    desc: '',
    firstChapter: ''
  }
  entries.value.push(entry)
  selectedId.value = entry.id
  void persist()
}

async function removeEntry(id: string) {
  const e = entries.value.find((x) => x.id === id)
  if (!e) return
  const ok = await inkConfirm(`删除词条「${e.term}」？`, { confirmText: '删除', danger: true })
  if (!ok) return
  entries.value = entries.value.filter((x) => x.id !== id)
  if (selectedId.value === id) selectedId.value = entries.value[0]?.id || ''
  await persist()
}

/** 交给智能体：从正文提取专有名词登记入册（走写入提案） */
async function askAgent() {
  if (!lib.current) return
  app.goAskAgent() // 切到妙笔页，用户能直接看到流式生成
  const { useConversationStore } = await import('../../store/conversation')
  const conv = useConversationStore()
  await conv.askWith(
    'setting',
    '请阅读本书大纲、设定与已写章节（用 list_documents / read_document），提取所有专有名词——人名、地名、组织、功法、物品、称谓——整理成词条，用 write_dictionary 提交词典提案。已有词条不要改动，只补充遗漏。'
  )
}

/** 地点词条一键转成地图节点（写到第一张地图，没有就新建一张） */
async function toMap(e: DictEntry) {
  if (!book.value) return
  const maps = ((await window.api.mapRead(book.value)) as BookMap[]) || []
  let map = maps[0]
  if (!map) {
    map = { id: `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: '地图 1', nodes: [], edges: [], base: { kind: 'none', path: '', opacity: 0.5 } }
    maps.push(map)
  }
  if (!map.nodes.some((n) => n.label === e.term)) {
    map.nodes.push({
      id: `mn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      label: e.term,
      status: '待写',
      x: 240 + (map.nodes.length % 5) * 60,
      y: 180 + Math.floor(map.nodes.length / 5) * 90
    })
  }
  await window.api.mapWrite(book.value, JSON.parse(JSON.stringify(maps)))
}

/** 别名输入：只在确认（回车/失焦）时切分，避免输入分隔符时被实时重写吞字 */
function onAliasChange(e: Event) {
  if (!selected.value) return
  const v = (e.target as HTMLInputElement).value
  selected.value.aliases = v.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
  void persist()
}

/** AI 提案接受落盘后重载，防止本地旧状态把新数据覆盖回去 */
function onFileChanged(e: Event) {
  const p = (e as CustomEvent<{ path?: string }>).detail?.path
  if (p === '专名词典.json') void load()
}
onMounted(() => window.addEventListener('inkdesk:file-changed', onFileChanged))
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))

watch(book, () => void load())
onMounted(() => void load())
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div class="panel-head">
      <span class="panel-head-title">专名词典</span>
      <span class="panel-head-meta">专有名词统一登记，智能体写作时强制对齐，防吃书</span>
      <div class="flex-1" />
      <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="askAgent">
        <WandSparkles :size="12" /> 让智能体从正文提取
      </button>
      <button class="ink-chip-btn is-on text-label" @click="addEntry"><Plus :size="13" /> 新增词条</button>
    </div>

    <div class="flex-1 min-h-0 flex">
      <!-- 左：词条列表（按类别分组） -->
      <div class="panel-list w-80 py-2">
        <div class="chip-grid px-4 pb-2.5" style="--chip-cols: 3">
          <button
            v-for="c in ['全部', ...CATEGORIES]"
            :key="c"
            class="ink-chip-btn"
            :class="filterCat === c ? 'is-on' : ''"
            @click="filterCat = c"
          >
            {{ c }}
          </button>
        </div>
        <div v-for="g in grouped" :key="g.cat" class="mb-2">
          <div class="section-title px-4 py-1">{{ g.cat }}（{{ g.list.length }}）</div>
          <div v-for="e in g.list" :key="e.id" class="panel-item group" :class="selectedId === e.id ? 'is-on' : ''" @click="selectedId = e.id">
            <div class="flex-1 min-w-0">
              <div class="text-label truncate">{{ e.term }}</div>
              <div v-if="e.desc" class="text-micro text-[var(--text-faint)] truncate">{{ e.desc }}</div>
            </div>
            <button
              v-if="e.category === '地点'"
              class="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer"
              title="转成地图节点"
              @click.stop="toMap(e)"
            >
              <MapIcon :size="12" />
            </button>
            <button class="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click.stop="removeEntry(e.id)">
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
        <div v-if="!shown.length" class="px-4 py-8 text-center text-label text-[var(--text-faint)] leading-6">
          词典还是空的<br />手动新增，或让智能体从正文提取
        </div>
      </div>

      <!-- 右：编辑 -->
      <div class="panel-body px-6 py-5">
        <EmptyHint v-if="!selected" :icon="BookMarked" title="选择词条查看与编辑" />
        <div v-else class="max-w-xl space-y-4">
          <div class="flex gap-3">
            <div class="flex-1">
              <div class="form-label">专名</div>
              <input v-model="selected.term" class="ink-input" placeholder="如：青云剑诀" @change="persist" />
            </div>
            <div class="w-40 shrink-0">
              <div class="form-label">类别</div>
              <InkSelect v-model="selected.category" class="w-full" :options="CATEGORIES.map((c) => ({ label: c, value: c }))" @change="persist" />
            </div>
          </div>
          <div>
            <div class="form-label">别名 / 旧称（顿号分隔）</div>
            <input :value="selected.aliases.join('、')" class="ink-input" placeholder="如：青莲剑歌、青云诀" @change="onAliasChange" />
          </div>
          <div>
            <div class="form-label">首次出场章节（可空）</div>
            <input v-model="selected.firstChapter" class="ink-input" placeholder="正文/第003章" @change="persist" />
          </div>
          <div>
            <div class="form-label">设定说明</div>
            <textarea v-model="selected.desc" rows="5" class="ink-textarea" placeholder="它是什么、有什么规则、和谁有关联" @change="persist" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
