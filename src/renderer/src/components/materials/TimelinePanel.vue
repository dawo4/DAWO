<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../../store/app'
import { useLibraryStore } from '../../store/library'
import { useConversationStore } from '../../store/conversation'
import { inkConfirm } from '../../ui/inkPrompt'
import InkSelect from '../../ui/InkSelect.vue'
import InkSegmented from '../../ui/InkSegmented.vue'
import EmptyHint from '../../ui/EmptyHint.vue'
import InkButton from '../../ui/InkButton.vue'
import { Plus, Sparkles, TriangleAlert, ArrowUpDown, Clock, Trash2, WandSparkles } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()
const conv = useConversationStore()

export interface TimelineNode {
  id: string
  title: string
  time: string
  sortKey: number
  line: 'main' | 'sub'
  chapters: string[]
  desc: string
  characters: string[]
}

const VIEWS = [
  { key: 'axis', label: '时间轴' },
  { key: 'cards', label: '卡片列表' },
  { key: 'chapter', label: '关联章节' }
]
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'main', label: '主线' },
  { key: 'sub', label: '支线' },
  { key: 'bound', label: '已绑定' },
  { key: 'free', label: '未绑定' }
]

const view = ref('axis')
const filter = ref('all')
const nodes = ref<TimelineNode[]>([])
const selectedId = ref('')
const busy = ref(false)
const orderDesc = ref(false)

const book = computed(() => lib.current?.title || '')

const selected = computed(() => nodes.value.find((n) => n.id === selectedId.value) || null)

const shown = computed(() => {
  let list = nodes.value
  if (filter.value === 'main') list = list.filter((n) => n.line === 'main')
  else if (filter.value === 'sub') list = list.filter((n) => n.line === 'sub')
  else if (filter.value === 'bound') list = list.filter((n) => n.chapters.length > 0)
  else if (filter.value === 'free') list = list.filter((n) => n.chapters.length === 0)
  const sorted = [...list].sort((a, b) => a.sortKey - b.sortKey)
  return orderDesc.value ? sorted.reverse() : sorted
})

const chapters = computed(() => lib.chapterList().map((c) => c.path))

/** 按绑定章节分组（一个节点可绑多章，会出现在每个章节组里），供「关联章节」视图使用 */
const byChapter = computed(() => {
  const map = new Map<string, TimelineNode[]>()
  for (const n of [...nodes.value].sort((a, b) => a.sortKey - b.sortKey)) {
    const keys = n.chapters.length ? n.chapters : ['未绑定']
    for (const key of keys) {
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(n)
    }
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'))
})

/** 详情编辑：添加 / 移除章节绑定 */
function addChapter(c: string) {
  if (!selected.value || !c || selected.value.chapters.includes(c)) return
  selected.value.chapters.push(c)
}
function removeChapter(c: string) {
  if (!selected.value) return
  selected.value.chapters = selected.value.chapters.filter((x) => x !== c)
}

/** 最近一次与磁盘对齐的内容快照：防止载入后冗余回写、旧状态覆盖 AI 新数据 */
let lastSync = ''

function snap(): string {
  return JSON.stringify(nodes.value)
}

async function load() {
  if (!book.value) return
  nodes.value = ((await window.api.tlRead(book.value)) as TimelineNode[]) || []
  if (!nodes.value.find((n) => n.id === selectedId.value)) selectedId.value = nodes.value[0]?.id || ''
  lastSync = snap()
}

async function persist() {
  if (!book.value) return
  const cur = snap()
  if (cur === lastSync) return // 内存与磁盘对齐：不写盘
  // 冲突检测：磁盘已被别的写入者（如 AI 提案）改动 → 放弃本次写盘并重载，AI 数据优先
  const disk = (await window.api.tlRead(book.value)) as TimelineNode[]
  if (JSON.stringify(disk || []) !== lastSync) {
    await load()
    return
  }
  await window.api.tlWrite(book.value, JSON.parse(JSON.stringify(nodes.value)))
  lastSync = cur
}

function addNode(at?: number) {
  const index = at ?? nodes.value.length
  const node: TimelineNode = {
    id: `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: '新事件',
    time: '',
    sortKey: index,
    line: 'main',
    chapters: [],
    desc: '',
    characters: []
  }
  nodes.value.splice(index, 0, node)
  nodes.value.forEach((n, i) => (n.sortKey = i))
  selectedId.value = node.id
  void persist()
}

async function removeNode(id: string) {
  const node = nodes.value.find((n) => n.id === id)
  if (!node) return
  const ok = await inkConfirm(`确定删除「${node.title}」？`, { confirmText: '删除', danger: true })
  if (!ok) return
  nodes.value = nodes.value.filter((n) => n.id !== id)
  nodes.value.forEach((n, i) => (n.sortKey = i))
  selectedId.value = nodes.value[0]?.id || ''
  await persist()
}

function move(id: string, dir: -1 | 1) {
  const list = [...nodes.value].sort((a, b) => a.sortKey - b.sortKey)
  const i = list.findIndex((n) => n.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  const a = list[i]
  const b = list[j]
  const t = a.sortKey
  a.sortKey = b.sortKey
  b.sortKey = t
  nodes.value = list
  void persist()
}

/** 交给时间线智能体的三种任务 */
const AI_TASKS = {
  extract: '请从现有正文与大纲中提取时间线：按事件发生顺序整理成节点，标出主线/支线，能对应到章节的填上绑定章节。先 read_timeline 看现有数据，再 read_document 读正文，最后用 write_timeline 提交差异。',
  complete: '请补全时间线上的断档：找出事件之间缺失的环节，补齐合理的中间事件（不得编造与正文冲突的内容），并用 write_timeline 提交差异。',
  check: '请检测时间线的一致性：逐条比对节点与正文、设定，找出矛盾（人物同时出现在两地、时间顺序颠倒、与设定冲突等），明确指出冲突的节点与依据。若需要修正，用 write_timeline 提交修正后的完整时间线。'
} as const

async function askAgent(task: keyof typeof AI_TASKS) {
  if (busy.value) return
  if (!book.value) return
  busy.value = true
  try {
    // 先切到写作台让智能体面板就位，再发任务，用户能直接看到流式生成
    app.goAskAgent()
    await conv.askWith('timeline', AI_TASKS[task], '时间线.json')
  } finally {
    busy.value = false
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  nodes,
  () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void persist(), 700)
  },
  { deep: true }
)

watch(book, () => void load())

/** 智能体的提案被接受后，时间线文件会变，需要重新载入 */
function onFileChanged(e: Event) {
  const p = (e as CustomEvent<{ path?: string }>).detail?.path
  if (p === '时间线.json') void load()
}

onMounted(() => {
  void load()
  window.addEventListener('inkdesk:file-changed', onFileChanged)
})

onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))

defineExpose({ reload: load })
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 视图切换 -->
    <div class="panel-head">
      <InkSegmented v-model="view" :options="VIEWS.map((v) => ({ value: v.key, label: v.label }))" />
      <div class="flex-1" />
      <span class="panel-head-meta">共 {{ nodes.length }} 个节点</span>
    </div>

    <!-- 筛选 + 工具条 -->
    <div class="flex items-center gap-2 px-6 h-11 border-b border-[var(--border)] shrink-0 flex-wrap">
      <InkSegmented v-model="filter" :options="FILTERS.map((f) => ({ value: f.key, label: f.label }))" />

      <div class="w-px h-4 bg-[var(--border)]" />

      <button
        class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer"
        @click="addNode()"
      >
        <Plus :size="13" /> 新建时间节点
      </button>
      <button
        class="ink-chip-btn is-on text-label"
        :disabled="busy"
        title="让时间线智能体读正文并提取节点"
        @click="askAgent('extract')"
      >
        <Sparkles :size="13" /> AI 提取
      </button>
      <button
        class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer disabled:opacity-45"
        :disabled="busy"
        title="让智能体补全缺失的时间节点"
        @click="askAgent('complete')"
      >
        <WandSparkles :size="13" /> 补全
      </button>
      <button
        class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer disabled:opacity-45"
        :disabled="busy"
        title="让智能体检查时间线矛盾"
        @click="askAgent('check')"
      >
        <TriangleAlert :size="13" /> 检测
      </button>

      <div class="flex-1" />

      <button
        class="text-label flex items-center gap-1 text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer"
        @click="orderDesc = !orderDesc"
      >
        <ArrowUpDown :size="12" /> 排序：{{ orderDesc ? '倒序' : '时间顺序' }}
      </button>
    </div>

    <!-- 内容区 -->
    <EmptyHint
      v-if="!nodes.length"
      :icon="Clock"
      title="还没有时间节点"
      desc="可以让时间线智能体读正文自动提取，提取结果会先出差异、你确认后才写入"
    >
      <div class="flex gap-2">
        <InkButton variant="ghost" size="sm" @click="addNode()">新建第一个节点</InkButton>
        <InkButton size="sm" @click="askAgent('extract')">让 AI 从正文提取</InkButton>
      </div>
    </EmptyHint>

    <div v-else class="flex-1 min-h-0 flex">
      <!-- 左：节点列表 -->
      <div class="panel-list w-80">
        <!-- 时间轴视图：竖线 + 节点 -->
        <div v-if="view === 'axis'" class="px-3 py-3">
          <div
            v-for="n in shown"
            :key="n.id"
            class="relative pl-4 pr-5 pb-4 rounded-[var(--r-sm)] cursor-pointer group transition-colors"
            :class="selectedId === n.id ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--hover)]'"
            @click="selectedId = n.id"
          >
            <span class="absolute left-0 top-1.5 w-2 h-2 rounded-full" :style="{ background: n.line === 'main' ? 'var(--accent)' : 'var(--text-faint)' }" />
            <span class="absolute left-[3px] top-3 bottom-0 w-px bg-[var(--border)]" />
            <button
              class="absolute right-1 top-0.5 opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer p-0.5 transition-opacity"
              title="删除该节点"
              @click.stop="removeNode(n.id)"
            >
              <Trash2 :size="12" />
            </button>
            <div class="text-label text-[var(--text-faint)]">{{ n.time || '时间未定' }}</div>
            <div class="text-body truncate" :style="selectedId === n.id ? { color: 'var(--accent)' } : {}">{{ n.title }}</div>
            <div class="text-meta text-[var(--text-faint)] truncate">
              {{ n.line === 'main' ? '主线' : '支线' }}{{ n.chapters.length ? ` · ${n.chapters.map((c) => c.replace('正文/', '')).join('、')}` : ' · 未绑定' }}
            </div>
          </div>
        </div>

        <!-- 卡片列表 -->
        <div v-else-if="view === 'cards'" class="p-3 space-y-2">
          <div
            v-for="n in shown"
            :key="n.id"
            class="ink-card px-3 py-2 cursor-pointer group relative"
            :class="selectedId === n.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'hover:border-[var(--border-strong)]'"
            @click="selectedId = n.id"
          >
            <button
              class="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer p-0.5 transition-opacity"
              title="删除该节点"
              @click.stop="removeNode(n.id)"
            >
              <Trash2 :size="12" />
            </button>
            <div class="flex items-center gap-1.5">
              <span class="ink-chip">{{ n.line === 'main' ? '主线' : '支线' }}</span>
              <span class="text-label truncate pr-5">{{ n.title }}</span>
            </div>
            <div class="text-meta text-[var(--text-faint)] mt-1 truncate">{{ n.time || '时间未定' }}{{ n.desc ? ` · ${n.desc}` : '' }}</div>
          </div>
        </div>

        <!-- 关联章节 -->
        <div v-else class="p-3 space-y-3">
          <div v-for="[chapter, list] in byChapter" :key="chapter">
            <div class="section-title mb-1">{{ chapter === '未绑定' ? '未绑定章节' : chapter }}</div>
            <button
              v-for="n in list"
              :key="n.id"
              class="w-full text-left px-2.5 py-1.5 rounded-[var(--r-sm)] text-label cursor-pointer transition-colors"
              :class="selectedId === n.id ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'hover:bg-[var(--hover)] text-[var(--text-dim)]'"
              @click="selectedId = n.id"
            >
              {{ n.time ? `${n.time} · ` : '' }}{{ n.title }}
            </button>
          </div>
        </div>
      </div>

      <!-- 右：详情 -->
      <div class="panel-body px-6 py-5">
        <EmptyHint v-if="!selected" :icon="Clock" title="选择时间节点查看详情" />
        <div v-else class="max-w-xl space-y-4">
          <div class="flex items-center gap-2">
            <button class="text-label text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer" @click="move(selected.id, -1)">↑ 上移</button>
            <button class="text-label text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer" @click="move(selected.id, 1)">↓ 下移</button>
            <div class="flex-1" />
            <button class="text-label flex items-center gap-1 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click="removeNode(selected.id)">
              <Trash2 :size="12" /> 删除
            </button>
          </div>

          <div>
            <div class="form-label">事件标题</div>
            <input v-model="selected.title" class="ink-input" placeholder="例如：许七安入打更人" />
          </div>

          <div class="flex gap-3">
            <div class="flex-1">
              <div class="form-label">时间</div>
              <input v-model="selected.time" class="ink-input" placeholder="入冬第三日 / 三年前" />
            </div>
            <div class="w-40 shrink-0">
              <div class="form-label">主线 / 支线</div>
              <InkSegmented
                v-model="selected.line"
                :options="[
                  { value: 'main', label: '主线' },
                  { value: 'sub', label: '支线' }
                ]"
              />
            </div>
          </div>

          <div>
            <div class="form-label">绑定章节（可绑多个，大线可跨十几章）</div>
            <div v-if="selected.chapters.length" class="flex flex-wrap gap-1.5 mb-1.5">
              <span v-for="c in selected.chapters" :key="c" class="ink-chip ink-chip-accent group">
                {{ c.replace('正文/', '') }}
                <button
                  class="opacity-60 group-hover:opacity-100 hover:text-[var(--danger)] cursor-pointer"
                  title="移除该章节绑定"
                  @click="removeChapter(c)"
                >
                  ✕
                </button>
              </span>
            </div>
            <InkSelect
              class="w-full"
              :model-value="''"
              :options="chapters.filter((c) => !selected.chapters.includes(c)).map((c) => ({ label: `+ ${c.replace('正文/', '')}`, value: c }))"
              placeholder="添加章节绑定…"
              @update:model-value="(v: string) => addChapter(v)"
            />
          </div>

          <div>
            <div class="form-label">事件说明</div>
            <textarea v-model="selected.desc" rows="5" class="ink-textarea" placeholder="发生了什么、牵扯到谁、后续影响" />
          </div>

          <div>
            <div class="form-label">涉及角色（逗号分隔）</div>
            <input
              :value="selected.characters.join('，')"
              class="ink-input"
              placeholder="许七安，魏渊"
              @input="selected.characters = ($event.target as HTMLInputElement).value.split(/[,，]/).map((s) => s.trim()).filter(Boolean)"
            />
          </div>

          <p class="text-meta text-[var(--text-faint)]">改动会自动保存到「时间线.json」</p>
        </div>
      </div>
    </div>
  </div>
</template>