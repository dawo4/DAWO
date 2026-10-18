<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../../store/app'
import { useLibraryStore } from '../../store/library'
import { useConversationStore } from '../../store/conversation'
import { inkPrompt, inkConfirm } from '../../ui/inkPrompt'
import EmptyHint from '../../ui/EmptyHint.vue'
import InkButton from '../../ui/InkButton.vue'
import GraphCanvas, { type CanvasNode, type CanvasEdge } from './GraphCanvas.vue'
import { Plus, Sparkles, LayoutGrid, Maximize2, ZoomIn, ZoomOut, Trash2, Users } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()
const conv = useConversationStore()

interface CharNode {
  id: string
  name: string
  role: string
  x: number
  y: number
}
type RelationKind = 'family' | 'love' | 'friend' | 'enemy' | 'other'
interface CharEdge {
  id: string
  source: string
  target: string
  relation: RelationKind
  label: string
}

/** 关系类型配色：亲情/敌对走语义 token，其余为关系专属色（仅本面板使用） */
const RELATIONS: { key: RelationKind; label: string; color: string }[] = [
  { key: 'family', label: '亲情', color: 'var(--accent)' },
  { key: 'love', label: '爱情', color: '#c96f8a' },
  { key: 'friend', label: '友情', color: '#6f9ac9' },
  { key: 'enemy', label: '敌对', color: 'var(--danger)' },
  { key: 'other', label: '其他', color: '#8a8378' }
]

const nodes = ref<CharNode[]>([])
const edges = ref<CharEdge[]>([])
const pickedId = ref('')
const activeRelations = ref<RelationKind[]>([...RELATIONS.map((r) => r.key)])
const busy = ref(false)
const canvas = ref<InstanceType<typeof GraphCanvas>>()

const book = computed(() => lib.current?.title || '')
const picked = computed(() => nodes.value.find((n) => n.id === pickedId.value) || null)

function relationOf(kind: RelationKind) {
  return RELATIONS.find((r) => r.key === kind) || RELATIONS[4]
}

const canvasNodes = computed<CanvasNode[]>(() =>
  nodes.value.map((n) => ({ id: n.id, label: n.role ? `${n.name}\n${n.role}` : n.name, x: n.x, y: n.y, tone: 'plain' }))
)
const canvasEdges = computed<CanvasEdge[]>(() =>
  edges.value
    .filter((e) => activeRelations.value.includes(e.relation))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label || relationOf(e.relation).label,
      color: relationOf(e.relation).color
    }))
)

/** 最近一次与磁盘对齐的内容快照（载入或成功写回后更新）；用于杜绝「载入后冗余回写」与「旧状态覆盖 AI 新数据」 */
let lastSync = ''

function snap(): string {
  return JSON.stringify({ nodes: nodes.value, edges: edges.value })
}

async function load() {
  if (!book.value) return
  const d = (await window.api.charGraphRead(book.value)) as { nodes?: CharNode[]; edges?: CharEdge[] }
  nodes.value = d.nodes || []
  edges.value = d.edges || []
  if (!nodes.value.find((n) => n.id === pickedId.value)) pickedId.value = nodes.value[0]?.id || ''
  lastSync = snap()
}

async function persist() {
  if (!book.value) return
  const cur = snap()
  if (cur === lastSync) return // 内存与磁盘对齐：不写盘（消灭载入后的冗余回写）
  // 冲突检测：磁盘已被别的写入者（如 AI 提案）改动 → 放弃本次写盘并重载，AI 数据优先
  const disk = (await window.api.charGraphRead(book.value)) as { nodes?: CharNode[]; edges?: CharEdge[] } | null
  if (JSON.stringify({ nodes: disk?.nodes || [], edges: disk?.edges || [] }) !== lastSync) {
    await load()
    return
  }
  await window.api.charGraphWrite(book.value, JSON.parse(JSON.stringify(nodes.value)), JSON.parse(JSON.stringify(edges.value)))
  lastSync = cur
}

function addNode() {
  const id = `cn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const i = nodes.value.length
  nodes.value.push({ id, name: '新角色', role: '', x: 80 + (i % 5) * 190, y: 80 + Math.floor(i / 5) * 130 })
  pickedId.value = id
  void persist()
}

async function removeNode(id: string) {
  const n = nodes.value.find((x) => x.id === id)
  if (!n) return
  const ok = await inkConfirm(`确定删除「${n.name}」及其关系？`, { confirmText: '删除', danger: true })
  if (!ok) return
  nodes.value = nodes.value.filter((x) => x.id !== id)
  edges.value = edges.value.filter((e) => e.source !== id && e.target !== id)
  pickedId.value = nodes.value[0]?.id || ''
  await persist()
}

async function onConnect(c: { source: string; target: string }) {
  const options = RELATIONS.map((r) => `${r.label}=${r.key}`).join('，')
  const input = await inkPrompt(`关系类型（${options}），可再跟一句说明，例如「enemy 因灭门结仇」`, 'friend')
  if (input === null) return
  const [head, ...rest] = String(input).trim().split(/\s+/)
  const relation = (RELATIONS.find((r) => r.key === head || r.label === head)?.key || 'other') as RelationKind
  const label = rest.join(' ')
  edges.value.push({ id: `ce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, source: c.source, target: c.target, relation, label })
  void persist()
}

/** 自动整理：主角居中，其余角色环形排布 */
function autoLayout() {
  const list = nodes.value
  if (!list.length) return
  const cx = 520
  const cy = 320
  list.forEach((n, i) => {
    if (i === 0) {
      n.x = cx
      n.y = cy
      return
    }
    const angle = ((i - 1) / Math.max(1, list.length - 1)) * Math.PI * 2
    n.x = Math.round(cx + Math.cos(angle) * 300)
    n.y = Math.round(cy + Math.sin(angle) * 220)
  })
  void persist()
  setTimeout(() => canvas.value?.fitView(), 60)
}

/** 画布拖动后回写坐标 */
function onCanvasNodes(v: CanvasNode[]) {
  nodes.value = v.map((n) => {
    const old = nodes.value.find((x) => x.id === n.id)
    return old ? { ...old, x: n.x, y: n.y } : { id: n.id, name: n.label, role: '', x: n.x, y: n.y }
  })
}

/** 某个角色的关系列表 */
function relationsOf(id: string) {
  return edges.value.filter((e) => e.source === id || e.target === id)
}

function otherName(e: CharEdge, selfId: string): string {
  const otherId = e.source === selfId ? e.target : e.source
  return nodes.value.find((n) => n.id === otherId)?.name || '（已删除）'
}

async function askAgent() {
  if (busy.value || !book.value) return
  busy.value = true
  try {
    app.goAskAgent()
    await conv.askWith(
      'storyline',
      '请根据大纲与角色资料生成/更新角色关系图：列出主要角色（含身份定位），并给出他们之间的关系（family 亲情 / love 爱情 / friend 友情 / enemy 敌对 / other 其他），每条关系要写依据，连线的 source/target 直接写角色名即可。先 read_graph（kind=characters）看现状，最后用 write_graph（kind=characters）提交差异。',
      '角色/关系图.json'
    )
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
  if ((e as CustomEvent<{ path?: string }>).detail?.path === '角色/关系图.json') void load()
}

onMounted(() => {
  void load()
  window.addEventListener('inkdesk:file-changed', onFileChanged)
})
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 关系类型筛选 + 工具条 -->
    <div class="panel-head">
      <div class="flex items-center gap-1.5">
        <button
          v-for="r in RELATIONS"
          :key="r.key"
          class="ink-chip-btn"
          :class="activeRelations.includes(r.key) ? 'is-on' : ''"
          @click="
            activeRelations.includes(r.key)
              ? (activeRelations = activeRelations.filter((x) => x !== r.key))
              : activeRelations.push(r.key)
          "
        >
          <span class="w-2 h-2 rounded-full" :style="{ background: r.color }" />
          <span>{{ r.label }}</span>
        </button>
      </div>

      <div class="w-px h-4 bg-[var(--border)]" />

      <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="addNode">
        <Plus :size="13" /> 新建角色
      </button>
      <button class="ink-chip-btn is-on text-label" :disabled="busy" @click="askAgent">
        <Sparkles :size="13" /> AI 生成关系
      </button>
      <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="autoLayout">
        <LayoutGrid :size="13" /> 自动整理
      </button>
      <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="canvas?.fitView()">
        <Maximize2 :size="13" /> 适应画布
      </button>
      <button class="ink-icon-btn" title="缩小" @click="canvas?.zoomOut()"><ZoomOut :size="14" /></button>
      <button class="ink-icon-btn" title="放大" @click="canvas?.zoomIn()"><ZoomIn :size="14" /></button>
      <div class="flex-1" />
      <span class="panel-head-meta">{{ nodes.length }} 个角色 · {{ edges.length }} 条关系</span>
    </div>

    <EmptyHint v-if="!nodes.length" :icon="Users" title="还没有角色" desc="从节点边缘拖线即可建立关系">
      <div class="flex gap-2">
        <InkButton variant="ghost" size="sm" @click="addNode">新建角色</InkButton>
        <InkButton size="sm" @click="askAgent">让 AI 生成关系图</InkButton>
      </div>
    </EmptyHint>

    <div v-else class="flex-1 min-h-0 flex">
      <div class="flex-1 min-w-0">
        <GraphCanvas
          ref="canvas"
          :nodes="canvasNodes"
          :edges="canvasEdges"
          @update:nodes="onCanvasNodes"
          @connect="onConnect"
          @pick="(id) => (pickedId = id)"
        />
      </div>

      <div class="w-72 shrink-0 border-l border-[var(--border)] overflow-y-auto px-5 py-4">
        <div v-if="!picked" class="text-label text-[var(--text-faint)] py-8 text-center">选择角色查看详情</div>
        <div v-else class="space-y-3.5">
          <div class="flex items-center gap-2">
            <span class="section-title">角色详情</span>
            <div class="flex-1" />
            <button class="text-label flex items-center gap-1 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click="removeNode(picked.id)">
              <Trash2 :size="12" /> 删除
            </button>
          </div>
          <input v-model="picked.name" class="ink-input" placeholder="角色名" />
          <input v-model="picked.role" class="ink-input" placeholder="身份定位，如「打更人·主角」" />

          <div>
            <div class="form-label">相关关系</div>
            <div v-if="!relationsOf(picked?.id || '').length" class="text-label text-[var(--text-faint)]">暂无关系</div>
            <div v-for="e in relationsOf(picked?.id || '')" :key="e.id" class="flex items-center gap-2 mb-1.5">
              <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: relationOf(e.relation).color }" />
              <span class="text-label text-[var(--text-dim)] flex-1 truncate">
                {{ otherName(e, picked?.id || '') }} · {{ relationOf(e.relation).label }}{{ e.label ? ` ${e.label}` : '' }}
              </span>
              <button class="text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click="edges = edges.filter((x) => x.id !== e.id)">
                ✕
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>