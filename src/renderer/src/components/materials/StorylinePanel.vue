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
import GraphCanvas, { type CanvasNode, type CanvasEdge } from './GraphCanvas.vue'
import { Plus, Sparkles, LayoutGrid, Maximize2, Shrink, ZoomIn, ZoomOut, Trash2, Network } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()
const conv = useConversationStore()

interface StoryNode {
  id: string
  label: string
  kind: string
  main: boolean
  chapters: string[]
  desc: string
  x: number
  y: number
}
interface StoryEdge {
  id: string
  source: string
  target: string
  label: string
}

const KIND_LABEL: Record<string, string> = {
  setup: '铺垫',
  conflict: '冲突',
  turn: '转折',
  climax: '高潮',
  ending: '收束',
  foreshadow: '伏笔',
  payoff: '回收'
}

const VIEWS = [
  { key: 'map', label: '思维导图' },
  { key: 'axis', label: '时间轴' },
  { key: 'bind', label: '绑定关系' }
]

const view = ref('map')
const onlyMain = ref(false)
const nodes = ref<StoryNode[]>([])
const edges = ref<StoryEdge[]>([])
const pickedId = ref('')
const busy = ref(false)
const canvas = ref<InstanceType<typeof GraphCanvas>>()

const book = computed(() => lib.current?.title || '')
const picked = computed(() => nodes.value.find((n) => n.id === pickedId.value) || null)
const shownNodes = computed(() => (onlyMain.value ? nodes.value.filter((n) => n.main) : nodes.value))

const canvasNodes = computed<CanvasNode[]>(() =>
  shownNodes.value.map((n) => ({
    id: n.id,
    label: n.label,
    x: n.x,
    y: n.y,
    badge: `${KIND_LABEL[n.kind] || n.kind}${n.main ? '' : ' · 支'}`,
    tone: n.main ? 'main' : 'sub'
  }))
)

const visibleIds = computed(() => new Set(shownNodes.value.map((n) => n.id)))
const canvasEdges = computed<CanvasEdge[]>(() =>
  edges.value
    .filter((e) => visibleIds.value.has(e.source) && visibleIds.value.has(e.target))
    .map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label, color: 'var(--text-faint)' }))
)

const orderedNodes = computed(() => [...nodes.value].sort((a, b) => a.x - b.x || a.y - b.y))
/** 按绑定章节分组（节点可绑多章，会出现在每个章节组里） */
const byChapter = computed(() => {
  const map = new Map<string, StoryNode[]>()
  for (const n of orderedNodes.value) {
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
  if (!picked.value || !c || picked.value.chapters.includes(c)) return
  picked.value.chapters.push(c)
}
function removeChapter(c: string) {
  if (!picked.value) return
  picked.value.chapters = picked.value.chapters.filter((x) => x !== c)
}

/** 最近一次与磁盘对齐的内容快照：防止载入后冗余回写、旧状态覆盖 AI 新数据 */
let lastSync = ''

function snap(): string {
  return JSON.stringify({ nodes: nodes.value, edges: edges.value })
}

async function load() {
  if (!book.value) return
  const d = (await window.api.storyRead(book.value)) as { nodes?: StoryNode[]; edges?: StoryEdge[] }
  nodes.value = d.nodes || []
  edges.value = d.edges || []
  if (!nodes.value.find((n) => n.id === pickedId.value)) pickedId.value = nodes.value[0]?.id || ''
  lastSync = snap()
}

async function persist() {
  if (!book.value) return
  const cur = snap()
  if (cur === lastSync) return // 内存与磁盘对齐：不写盘
  // 冲突检测：磁盘已被别的写入者（如 AI 提案）改动 → 放弃本次写盘并重载，AI 数据优先
  const disk = (await window.api.storyRead(book.value)) as { nodes?: StoryNode[]; edges?: StoryEdge[] } | null
  if (JSON.stringify({ nodes: disk?.nodes || [], edges: disk?.edges || [] }) !== lastSync) {
    await load()
    return
  }
  await window.api.storyWrite(book.value, JSON.parse(JSON.stringify(nodes.value)), JSON.parse(JSON.stringify(edges.value)))
  lastSync = cur
}

function addNode() {
  const id = `sn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const last = orderedNodes.value[orderedNodes.value.length - 1]
  nodes.value.push({
    id,
    label: '新故事节点',
    kind: 'setup',
    main: true,
    chapters: [],
    desc: '',
    x: last ? last.x + 240 : 80,
    y: last ? last.y : 80
  })
  pickedId.value = id
  void persist()
}

async function removeNode(id: string) {
  const n = nodes.value.find((x) => x.id === id)
  if (!n) return
  const ok = await inkConfirm(`确定删除「${n.label}」及其连线？`, { confirmText: '删除', danger: true })
  if (!ok) return
  nodes.value = nodes.value.filter((x) => x.id !== id)
  edges.value = edges.value.filter((e) => e.source !== id && e.target !== id)
  pickedId.value = nodes.value[0]?.id || ''
  await persist()
}

function onConnect(c: { source: string; target: string }) {
  if (edges.value.some((e) => e.source === c.source && e.target === c.target)) return
  edges.value.push({ id: `se-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, source: c.source, target: c.target, label: '' })
  void persist()
}

/** 画布拖动后回写坐标（只更新位置，其他字段以脚本数据为准） */
function onCanvasNodes(v: CanvasNode[]) {
  nodes.value = v.map((n) => {
    const old = nodes.value.find((x) => x.id === n.id)
    return old
      ? { ...old, x: n.x, y: n.y }
      : { id: n.id, label: n.label, kind: 'setup', main: true, chapters: [], desc: '', x: n.x, y: n.y }
  })
}

/** 自动整理：主线排一行，支线挂在其下 */
function autoLayout() {
  const main = [...nodes.value.filter((n) => n.main)].sort((a, b) => a.x - b.x || a.y - b.y)
  const sub = [...nodes.value.filter((n) => !n.main)]
  main.forEach((n, i) => {
    n.x = 80 + i * 230
    n.y = 120
  })
  sub.forEach((n, i) => {
    n.x = 140 + (i % 4) * 230
    n.y = 320 + Math.floor(i / 4) * 130
  })
  void persist()
  setTimeout(() => canvas.value?.fitView(), 60)
}

const AI_TASKS = {
  generate:
    '请根据大纲与正文生成故事线：把关键节点梳理出来，标注节点类型（铺垫/冲突/转折/高潮/收束/伏笔/回收）、主线或支线、能对应的章节。先 read_graph 看现状，再 read_document 读大纲与正文，最后用 write_graph（kind=story）提交差异。',
  relations:
    '请根据大纲与角色资料生成/更新角色关系图：列出主要角色（含身份定位），并给出他们之间的关系（family 亲情 / love 爱情 / friend 友情 / enemy 敌对 / other 其他），关系要有依据。先 read_graph（kind=characters）看现状，最后用 write_graph（kind=characters）提交差异。'
} as const

async function askAgent(task: keyof typeof AI_TASKS) {
  if (busy.value || !book.value) return
  busy.value = true
  try {
    app.goAskAgent()
    await conv.askWith('storyline', AI_TASKS[task], '故事线.json')
  } finally {
    busy.value = false
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
watch([nodes, edges], () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void persist(), 700)
}, { deep: true })

function onFileChanged(e: Event) {
  if ((e as CustomEvent<{ path?: string }>).detail?.path === '故事线.json') void load()
}

onMounted(() => {
  void load()
  window.addEventListener('inkdesk:file-changed', onFileChanged)
})
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 视图 -->
    <div class="panel-head">
      <InkSegmented v-model="view" :options="VIEWS.map((v) => ({ value: v.key, label: v.label }))" />
      <div class="flex-1" />
      <span class="panel-head-meta">{{ nodes.length }} 个节点 · {{ edges.length }} 条连接</span>
    </div>

    <!-- 工具条 -->
    <div class="flex items-center gap-2 px-6 h-11 border-b border-[var(--border)] shrink-0">
      <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="addNode">
        <Plus :size="13" /> 新建节点
      </button>
      <button
        class="ink-chip-btn is-on text-label"
        :disabled="busy"
        @click="askAgent('generate')"
      >
        <Sparkles :size="13" /> AI 生成
      </button>
      <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="autoLayout">
        <LayoutGrid :size="13" /> 自动整理
      </button>
      <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="canvas?.fitView()">
        <Maximize2 :size="13" /> 适应画布
      </button>
      <div class="w-px h-4 bg-[var(--border)]" />
      <button class="ink-icon-btn" title="缩小" @click="canvas?.zoomOut()"><ZoomOut :size="14" /></button>
      <button class="ink-icon-btn" title="放大" @click="canvas?.zoomIn()"><ZoomIn :size="14" /></button>
      <div class="flex-1" />
      <label class="flex items-center gap-1.5 text-label text-[var(--text-dim)] cursor-pointer select-none">
        <input v-model="onlyMain" type="checkbox" class="accent-[var(--accent)]" /> 仅看主线
      </label>
    </div>

    <!-- 内容 -->
    <EmptyHint
      v-if="!nodes.length"
      :icon="Network"
      title="还没有故事节点"
      desc="也可用右键 / 双击画布新建；从节点四周圆点拖线即可连接"
    >
      <div class="flex gap-2">
        <InkButton variant="ghost" size="sm" @click="addNode">新建第一个节点</InkButton>
        <InkButton size="sm" @click="askAgent('generate')">让 AI 根据大纲生成</InkButton>
      </div>
    </EmptyHint>

    <div v-else class="flex-1 min-h-0 flex">
      <div v-if="view === 'map'" class="flex-1 min-w-0">
        <GraphCanvas
          ref="canvas"
          :nodes="canvasNodes"
          :edges="canvasEdges"
          @update:nodes="onCanvasNodes"
          @connect="onConnect"
          @pick="(id) => (pickedId = id)"
        />
      </div>

      <!-- 时间轴视图 -->
      <div v-else-if="view === 'axis'" class="panel-body px-6 py-4">
        <div class="max-w-2xl">
          <div
            v-for="n in orderedNodes"
            :key="n.id"
            class="relative pl-6 pb-5 rounded-[var(--r-sm)] cursor-pointer transition-colors"
            :class="pickedId === n.id ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--hover)]'"
            @click="pickedId = n.id"
          >
            <span class="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full" :style="{ background: n.main ? 'var(--accent)' : 'var(--text-faint)' }" />
            <span class="absolute left-[4px] top-4 bottom-0 w-px bg-[var(--border)]" />
            <div class="flex items-center gap-2">
              <span class="ink-chip">{{ KIND_LABEL[n.kind] || n.kind }}</span>
              <span class="ink-chip">{{ n.main ? '主线' : '支线' }}</span>
              <span class="text-body" :style="pickedId === n.id ? { color: 'var(--accent)' } : {}">{{ n.label }}</span>
            </div>
            <div v-if="n.desc" class="text-meta text-[var(--text-faint)] mt-1">{{ n.desc }}</div>
          </div>
        </div>
      </div>

      <!-- 绑定关系视图 -->
      <div v-else class="panel-body px-6 py-4">
        <div v-for="[chapter, list] in byChapter" :key="chapter" class="mb-4">
          <div class="section-title mb-1.5">{{ chapter === '未绑定' ? '未绑定章节' : chapter }}</div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="n in list"
              :key="n.id"
              class="ink-chip-btn"
              :class="pickedId === n.id ? 'is-on' : ''"
              @click="pickedId = n.id"
            >
              {{ n.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- 右侧详情 -->
      <div class="w-80 shrink-0 border-l border-[var(--border)] overflow-y-auto px-5 py-4">
        <div v-if="!picked" class="text-label text-[var(--text-faint)] py-8 text-center">选择节点查看详情</div>
        <div v-else class="space-y-3.5">
          <div class="flex items-center gap-2">
            <span class="section-title">节点详情</span>
            <div class="flex-1" />
            <button class="text-label flex items-center gap-1 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click="removeNode(picked.id)">
              <Trash2 :size="12" /> 删除
            </button>
          </div>
          <input v-model="picked.label" class="ink-input" placeholder="节点标题" />
          <div>
            <div class="form-label">节点类型</div>
            <InkSelect v-model="picked.kind" class="w-full" :options="Object.entries(KIND_LABEL).map(([k, v]) => ({ label: v, value: k }))" />
          </div>
          <div class="flex items-center gap-3">
            <label class="flex items-center gap-1.5 text-label text-[var(--text-dim)] cursor-pointer">
              <input v-model="picked.main" type="checkbox" class="accent-[var(--accent)]" /> 主线
            </label>
          </div>
          <div>
            <div class="form-label">绑定章节（可绑多个）</div>
            <div v-if="picked.chapters.length" class="flex flex-wrap gap-1.5 mb-1.5">
              <span v-for="c in picked.chapters" :key="c" class="ink-chip ink-chip-accent group">
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
              :options="lib.chapterList().filter((x) => !picked.chapters.includes(x.path)).map((x) => ({ label: `+ ${x.path.replace('正文/', '')}`, value: x.path }))"
              placeholder="添加章节绑定…"
              @update:model-value="(v: string) => addChapter(v)"
            />
          </div>
          <textarea v-model="picked.desc" rows="4" class="ink-textarea" placeholder="这个节点发生了什么" />
          <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer disabled:opacity-45" :disabled="busy" @click="askAgent('relations')">
            <Sparkles :size="12" /> 让故事线智能体顺便整理角色关系图
          </button>
        </div>
      </div>
    </div>
  </div>
</template>