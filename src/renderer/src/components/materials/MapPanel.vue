<script setup lang="ts">
// 地图路线图：多张地图标签页，地点节点+连线（复用 GraphCanvas），底层可手绘色块底图或上传图片
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLibraryStore } from '../../store/library'
import { useAppStore } from '../../store/app'
import { inkConfirm } from '../../ui/inkPrompt'
import InkSelect from '../../ui/InkSelect.vue'
import GraphCanvas, { type CanvasNode, type CanvasEdge } from './GraphCanvas.vue'
import { Eraser, ImagePlus, Map as MapIcon, Pencil, Plus, Trash2, WandSparkles, X } from 'lucide-vue-next'
import type { BookMap, MapNode, MapNodeStatus } from '../../types'

const lib = useLibraryStore()
const app = useAppStore()

const STATUSES: MapNodeStatus[] = ['待写', '已写过']
const PALETTE = ['#b58a5a', '#6fae6f', '#5a8fd9', '#d9a441', '#c96f6f']

const book = computed(() => lib.current?.title || '')
const maps = ref<BookMap[]>([])
const activeId = ref('')
const busy = ref(false)
const selectedNodeId = ref('')

// ============ 画笔状态 ============
const brushMode = ref(false)
const eraser = ref(false)
const brushColor = ref(PALETTE[0])
const brushSize = ref(26)
const baseOpacity = ref(0.5)
const canvasReady = ref(false)

const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvasW = 1600
const canvasH = 1000
let painting = false
let lastPt: { x: number; y: number } | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

const active = computed(() => maps.value.find((m) => m.id === activeId.value))
const baseImg = ref('')

const flowNodes = computed<CanvasNode[]>(() =>
  (active.value?.nodes || []).map((n) => ({
    id: n.id,
    label: n.label,
    x: n.x,
    y: n.y,
    badge: n.status,
    tone: n.status === '已写过' ? 'main' : 'plain'
  }))
)
const flowEdges = computed<CanvasEdge[]>(() =>
  (active.value?.edges || []).map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label }))
)
const selectedNode = computed(() => active.value?.nodes.find((n) => n.id === selectedNodeId.value))

/** 选中地点的关联连线（用于侧栏逐条删除） */
const selectedNodeEdges = computed(() => {
  const m = active.value
  const node = selectedNode.value
  if (!m || !node) return []
  return m.edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const otherId = e.source === node.id ? e.target : e.source
      return { edge: e, other: m.nodes.find((n) => n.id === otherId) }
    })
})

async function load() {
  if (!book.value) return
  maps.value = ((await window.api.mapRead(book.value)) as BookMap[]) || []
  if (!maps.value.find((m) => m.id === activeId.value)) activeId.value = maps.value[0]?.id || ''
}

async function persist() {
  if (!book.value || busy.value) return
  busy.value = true
  try {
    maps.value = ((await window.api.mapWrite(book.value, JSON.parse(JSON.stringify(maps.value)))) as BookMap[]) || []
  } finally {
    busy.value = false
  }
}

// ============ 底图：加载 / 手绘 / 上传 ============

/** 激活地图或底图路径变化 → 重绘底层（不含 opacity：浓度只影响显示，无需重绘，防覆盖未落盘笔迹） */
watch(
  () => [activeId.value, active.value?.base.path, active.value?.base.kind],
  async () => {
    const m = active.value
    baseOpacity.value = m?.base.opacity ?? 0.5
    await redrawBase()
  }
)

/** 立即把画布内容落盘（仅在有防抖挂起时执行，防 watch→重绘→再保存 死循环；重绘前先保住未落盘笔迹） */
async function flushSave() {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  const m = active.value
  const canvas = canvasRef.value
  if (!m || !canvas) return
  try {
    const path = await window.api.mapImageSave(book.value, m.id, canvas.toDataURL('image/png'))
    m.base = { kind: 'draw', path, opacity: baseOpacity.value }
    await persist()
  } catch {
    /* 保存失败忽略，下次停笔重试 */
  }
}

async function redrawBase() {
  await flushSave()
  const m = active.value
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvasW, canvasH)
  baseImg.value = ''
  canvasReady.value = false
  if (!m || !m.base.path) return
  const dataUrl = await window.api.mapImageRead(book.value, m.base.path)
  if (!dataUrl) return
  if (m.base.kind === 'draw') {
    // 手绘底图：画进 canvas，画笔可直接续画
    const img = new Image()
    await new Promise<void>((resolve) => {
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvasW, canvasH)
        resolve()
      }
      img.onerror = () => resolve()
      img.src = dataUrl
    })
    canvasReady.value = true
  } else {
    baseImg.value = dataUrl
  }
}

/** 开画笔：若当前是图片底图，把图片合进 canvas 转为手绘模式 */
async function toggleBrush() {
  if (!brushMode.value) {
    const m = active.value
    if (!m) return
    if (m.base.kind === 'image' && m.base.path) {
      const dataUrl = await window.api.mapImageRead(book.value, m.base.path)
      const canvas = canvasRef.value
      const ctx = canvas?.getContext('2d')
      if (dataUrl && canvas && ctx) {
        baseImg.value = ''
        const img = new Image()
        await new Promise<void>((resolve) => {
          img.onload = () => {
            ctx.drawImage(img, 0, 0, canvasW, canvasH)
            resolve()
          }
          img.onerror = () => resolve()
          img.src = dataUrl
        })
      }
    }
    canvasReady.value = true
  }
  brushMode.value = !brushMode.value
}

function canvasPoint(e: PointerEvent): { x: number; y: number } {
  const canvas = canvasRef.value!
  const r = canvas.getBoundingClientRect()
  return { x: ((e.clientX - r.left) / r.width) * canvasW, y: ((e.clientY - r.top) / r.height) * canvasH }
}

function strokeTo(pt: { x: number; y: number }) {
  const ctx = canvasRef.value?.getContext('2d')
  if (!ctx || !lastPt) return
  ctx.globalCompositeOperation = eraser.value ? 'destination-out' : 'source-over'
  ctx.strokeStyle = brushColor.value
  ctx.lineWidth = eraser.value ? brushSize.value * 2 : brushSize.value
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(lastPt.x, lastPt.y)
  ctx.lineTo(pt.x, pt.y)
  ctx.stroke()
  lastPt = pt
}

function onBrushDown(e: PointerEvent) {
  if (!active.value) return
  painting = true
  lastPt = canvasPoint(e)
  strokeTo({ x: lastPt.x + 0.01, y: lastPt.y + 0.01 })
}

function onBrushMove(e: PointerEvent) {
  if (!painting) return
  strokeTo(canvasPoint(e))
}

function onBrushUp() {
  if (!painting) return
  painting = false
  lastPt = null
  scheduleSave()
}

/** 手绘停手后防抖落盘 */
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flushSave(), 800)
}

async function pickBase() {
  const m = active.value
  if (!m || brushMode.value) return
  const path = await window.api.mapImagePick(book.value, m.id)
  if (!path) return
  m.base = { kind: 'image', path, opacity: baseOpacity.value }
  await persist()
  await redrawBase()
}

async function clearBase() {
  const m = active.value
  if (!m) return
  const ok = await inkConfirm('清除当前地图的底图？', { confirmText: '清除', danger: true })
  if (!ok) return
  m.base = { kind: 'none', path: '', opacity: baseOpacity.value }
  const ctx = canvasRef.value?.getContext('2d')
  ctx?.clearRect(0, 0, canvasW, canvasH)
  baseImg.value = ''
  await persist()
}

function onOpacityChange() {
  const m = active.value
  if (!m) return
  m.base = { ...m.base, opacity: baseOpacity.value }
  void persist()
}

// ============ 标签页管理 ============

async function addMap() {
  const m: BookMap = {
    id: `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: `地图 ${maps.value.length + 1}`,
    nodes: [],
    edges: [],
    base: { kind: 'none', path: '', opacity: 0.5 }
  }
  maps.value.push(m)
  activeId.value = m.id
  brushMode.value = false
  selectedNodeId.value = ''
  await persist()
}

async function removeMap(id: string) {
  const m = maps.value.find((x) => x.id === id)
  if (!m) return
  const ok = await inkConfirm(`删除地图「${m.name}」？底图与节点一并删除。`, { confirmText: '删除', danger: true })
  if (!ok) return
  maps.value = maps.value.filter((x) => x.id !== id)
  if (activeId.value === id) activeId.value = maps.value[0]?.id || ''
  await persist()
}

const renamingId = ref('')
const renamingName = ref('')

function startRename(m: BookMap) {
  renamingId.value = m.id
  renamingName.value = m.name
}

async function commitRename() {
  const m = maps.value.find((x) => x.id === renamingId.value)
  if (m && renamingName.value.trim()) m.name = renamingName.value.trim().slice(0, 40)
  renamingId.value = ''
  await persist()
}

// ============ 节点 / 连线 ============

async function addNode() {
  let m = active.value
  if (!m) {
    // 还没有地图时自动建第一张，避免按钮静默无效
    m = { id: `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: '地图 1', nodes: [], edges: [], base: { kind: 'none', path: '', opacity: baseOpacity.value } }
    maps.value.push(m)
    activeId.value = m.id
  }
  const n: MapNode = {
    id: `mn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label: '新地点',
    status: '待写',
    x: 240 + (m.nodes.length % 5) * 60,
    y: 180 + Math.floor(m.nodes.length / 5) * 90
  }
  m.nodes.push(n)
  selectedNodeId.value = n.id
  await persist()
}

function onNodesUpdate(nodes: CanvasNode[]) {
  const m = active.value
  if (!m) return
  m.nodes = nodes.map((n) => {
    const old = m.nodes.find((o) => o.id === n.id)
    return { id: n.id, label: n.label, status: old?.status || '待写', x: n.x, y: n.y }
  })
  void persist()
}

function onConnect(c: { source: string; target: string }) {
  const m = active.value
  if (!m || c.source === c.target) return
  if (m.edges.some((e) => (e.source === c.source && e.target === c.target) || (e.source === c.target && e.target === c.source))) return
  m.edges.push({ id: `me-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, source: c.source, target: c.target, label: '' })
  void persist()
}

/** 删除一条连线（不影响两端节点） */
async function removeEdge(id: string) {
  const m = active.value
  if (!m) return
  m.edges = m.edges.filter((e) => e.id !== id)
  await persist()
}

async function removeNode(id: string) {
  const m = active.value
  if (!m) return
  const n = m.nodes.find((x) => x.id === id)
  if (!n) return
  const ok = await inkConfirm(`删除地点「${n.label}」？（关联连线一并删除）`, { confirmText: '删除', danger: true })
  if (!ok) return
  m.nodes = m.nodes.filter((x) => x.id !== id)
  m.edges = m.edges.filter((e) => e.source !== id && e.target !== id)
  if (selectedNodeId.value === id) selectedNodeId.value = ''
  await persist()
}

/** 交给智能体：结合设定与正文梳理地图（走写入提案） */
async function askAgent() {
  if (!lib.current) return
  app.goAskAgent() // 切到妙笔页，用户能直接看到流式生成
  const { useConversationStore } = await import('../../store/conversation')
  const conv = useConversationStore()
  await conv.askWith(
    'mapper',
    '请阅读本书设定、大纲与已写章节（用 list_documents / read_document），梳理书中的地理格局——主要地点（城镇/山门/秘境等）、地点间的路径与距离关系、哪些场景已写过哪些还没写——用 write_map 提交地图提案（不传 mapId 时默认写到第一张地图）。'
  )
}

/** AI 提案接受落盘后重载（base.path 变化会经 watch 自动重绘底图） */
function onFileChanged(e: Event) {
  const p = (e as CustomEvent<{ path?: string }>).detail?.path
  if (p === '地图.json') void load()
}
onMounted(() => window.addEventListener('inkdesk:file-changed', onFileChanged))
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))

watch(book, () => void load())
onMounted(() => void load())
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- 顶栏：说明 + 工具 -->
    <div class="panel-head">
      <span class="panel-head-title">地图路线图</span>
      <span class="panel-head-meta">地点节点 + 连线，标已写过 / 待写；底层可手绘色块或贴图</span>
      <div class="flex-1" />
      <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="askAgent">
        <WandSparkles :size="12" /> 让智能体梳理地图
      </button>
      <button class="ink-chip-btn is-on text-label" @click="addNode"><Plus :size="13" /> 新增地点</button>
    </div>

    <div class="flex-1 min-h-0 flex flex-col">
      <!-- 标签条 -->
      <div class="h-9 shrink-0 flex items-center gap-1 px-4 border-b border-[var(--border)] overflow-x-auto">
        <div
          v-for="m in maps"
          :key="m.id"
          class="group flex items-center gap-1 px-3 py-1 rounded-t-[var(--r-sm)] text-label cursor-pointer border-b-2 whitespace-nowrap transition-colors"
          :class="
            activeId === m.id
              ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-dim)] hover:bg-[var(--hover)]'
          "
          @dblclick="startRename(m)"
          @click="activeId = m.id"
        >
          <template v-if="renamingId === m.id">
            <input
              v-model="renamingName"
              class="bg-transparent outline-none text-label w-24 border-b border-[var(--accent)]"
              @keydown.enter="commitRename"
              @blur="commitRename"
              @click.stop
            />
          </template>
          <template v-else>
            <MapIcon :size="12" class="shrink-0" />
            <span>{{ m.name }}</span>
            <button class="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" title="删除地图" @click.stop="removeMap(m.id)">
              <X :size="11" />
            </button>
          </template>
        </div>
        <button class="ink-icon-btn" title="新建地图" @click="addMap"><Plus :size="13" /></button>
        <div class="flex-1" />
        <span class="text-micro text-[var(--text-faint)] whitespace-nowrap">双击标签重命名</span>
      </div>

      <!-- 工具条 -->
      <div class="h-9 shrink-0 flex items-center gap-2 px-4 border-b border-[var(--border)]">
        <button class="ink-chip-btn" :class="brushMode ? 'is-on' : ''" @click="toggleBrush">
          <Pencil :size="12" /> 画笔
        </button>
        <template v-if="brushMode">
          <button class="ink-chip-btn" :class="eraser ? 'is-on' : ''" @click="eraser = !eraser">
            <Eraser :size="12" />
          </button>
          <span
            v-for="c in PALETTE"
            :key="c"
            class="w-4 h-4 rounded-full cursor-pointer border"
            :style="{ background: c, borderColor: brushColor === c && !eraser ? 'var(--text)' : 'transparent' }"
            @click="((brushColor = c), (eraser = false))"
          />
          <input v-model.number="brushSize" type="range" min="4" max="60" class="w-20" title="笔宽" />
          <span class="text-meta text-[var(--text-faint)]">停手自动保存</span>
        </template>
        <template v-else>
          <button class="text-label flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="pickBase">
            <ImagePlus :size="12" /> 上传底图
          </button>
          <button v-if="active?.base.path" class="text-label text-[var(--text-dim)] hover:text-[var(--danger)] cursor-pointer" @click="clearBase">清除底图</button>
          <label v-if="active?.base.path" class="flex items-center gap-1 text-meta text-[var(--text-faint)]">
            底图浓度
            <input v-model.number="baseOpacity" type="range" min="0.05" max="1" step="0.05" class="w-20" @change="onOpacityChange" />
          </label>
        </template>
      </div>

      <!-- 画布区：底层底图 → vue-flow 节点 → 画笔捕获层 -->
      <div class="flex-1 min-h-0 relative">
        <div class="absolute inset-0 flex items-center justify-center">
          <!-- 手绘 canvas（draw 模式） -->
          <canvas
            ref="canvasRef"
            :width="canvasW"
            :height="canvasH"
            class="max-w-full max-h-full"
            :style="{ opacity: baseOpacity, display: active?.base.kind === 'draw' || brushMode ? 'block' : 'none' }"
          />
          <!-- 上传图片底图（image 模式）已改走 GraphCanvas 世界坐标层，与节点对齐并跟随缩放平移 -->
        </div>

        <GraphCanvas
          v-if="active"
          class="absolute inset-0"
          :nodes="flowNodes"
          :edges="flowEdges"
          :base-image="active.base.kind === 'image' ? baseImg : ''"
          :base-opacity="baseOpacity"
          @update:nodes="onNodesUpdate"
          @connect="onConnect"
          @pick="(id: string) => (selectedNodeId = id)"
        />

        <!-- 画笔捕获层：盖住 vue-flow 手势 -->
        <div
          v-if="brushMode && active"
          class="absolute inset-0 z-10"
          style="cursor: crosshair"
          @pointerdown="onBrushDown"
          @pointermove="onBrushMove"
          @pointerup="onBrushUp"
          @pointerleave="onBrushUp"
        />

        <div v-if="!maps.length" class="absolute inset-0 flex items-center justify-center text-[var(--text-faint)] text-body">
          还没有地图，点上方标签条的 + 新建一张
        </div>
      </div>
    </div>

    <!-- 右侧：选中地点编辑（浮层小卡） -->
    <div v-if="selectedNode" class="w-72 shrink-0 border-l border-[var(--border)] overflow-y-auto px-5 py-4 space-y-3">
      <div class="flex items-center">
        <span class="section-title">地点</span>
        <div class="flex-1" />
        <button class="ink-icon-btn is-danger" title="删除该地点" @click="removeNode(selectedNode.id)"><Trash2 :size="13" /></button>
      </div>
      <div>
        <div class="form-label">名称</div>
        <input v-model="selectedNode.label" class="ink-input" placeholder="如：青云宗" @change="persist" />
      </div>
      <div>
        <div class="form-label">场景状态</div>
        <InkSelect v-model="selectedNode.status" class="w-full" :options="STATUSES.map((s) => ({ label: s, value: s }))" @change="persist" />
      </div>
      <div>
        <div class="form-label">相关路径（{{ selectedNodeEdges.length }}）</div>
        <div v-for="x in selectedNodeEdges" :key="x.edge.id" class="flex items-center gap-2 py-1">
          <span class="flex-1 min-w-0 truncate text-label text-[var(--text-dim)]">
            {{ x.other?.label || '未知地点' }}<template v-if="x.edge.label"> · {{ x.edge.label }}</template>
          </span>
          <button class="text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer shrink-0" title="删除这条路径" @click="removeEdge(x.edge.id)">
            <X :size="12" />
          </button>
        </div>
        <div v-if="!selectedNodeEdges.length" class="text-micro text-[var(--text-faint)] leading-5">从本节点边缘拖线到另一个节点即可连出路径</div>
      </div>
      <p class="text-micro text-[var(--text-faint)] leading-5">在画布上拖动节点摆位；从一个节点拖到另一个节点即连线路径。</p>
    </div>
  </div>
</template>
