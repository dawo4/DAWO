<script setup lang="ts">
/**
 * 通用节点画布（故事线 / 角色关系图共用）。
 * 只负责画与拖；数据由父组件持有并落盘，因此这里不做任何持久化。
 */
import { ref, watch, computed } from 'vue'
import { VueFlow, useVueFlow, type Node, type Edge, type Connection } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/controls/dist/style.css'

export interface CanvasNode {
  id: string
  label: string
  x: number
  y: number
  /** 角标：如「冲突」「亲情」 */
  badge?: string
  tone?: 'main' | 'sub' | 'plain'
}
export interface CanvasEdge {
  id: string
  source: string
  target: string
  label?: string
  color?: string
}

/** baseImage：世界坐标底图（1600x1000，与节点同一坐标系，跟随画布平移缩放）；baseOpacity：底图浓度 */
const props = defineProps<{ nodes: CanvasNode[]; edges: CanvasEdge[]; baseImage?: string; baseOpacity?: number }>()
const emit = defineEmits<{
  (e: 'update:nodes', v: CanvasNode[]): void
  (e: 'update:edges', v: CanvasEdge[]): void
  (e: 'connect', v: { source: string; target: string }): void
  (e: 'pick', id: string): void
}>()

const { fitView, zoomIn, zoomOut, onConnect, onNodeDragStop, onNodeClick, viewport } = useVueFlow()

/** 底图样式：套用画布视口变换，使 SVG 坐标 (x,y) 与节点世界坐标 (x,y) 一一对齐（viewport 是 Ref，须 .value） */
const baseStyle = computed(() => ({
  width: '1600px',
  height: '1000px',
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
  transformOrigin: '0 0',
  opacity: props.baseOpacity ?? 0.5
}))

const flowNodes = ref<Node[]>([])
const flowEdges = ref<Edge[]>([])
/** 由 props 同步到画布时记录 key，避免父组件回写相同数据再次重绘 */
let lastKey = ''

// ============ 连线形状：曲线（默认，贝塞尔）/ 直线（节点多时不缠绕，参考原版生产树图） ============
const EDGE_TYPE_KEY = 'inkdesk.canvas.edgeType'
const edgeType = ref<'curve' | 'straight'>(
  localStorage.getItem(EDGE_TYPE_KEY) === 'straight' ? 'straight' : 'curve'
)
function toggleEdgeType(): void {
  edgeType.value = edgeType.value === 'curve' ? 'straight' : 'curve'
  localStorage.setItem(EDGE_TYPE_KEY, edgeType.value)
}

function styleFor(n: CanvasNode): Record<string, string> {
  const border = n.tone === 'main' ? 'var(--accent)' : n.tone === 'sub' ? 'var(--text-faint)' : 'var(--border)'
  return {
    background: 'var(--panel-2)',
    color: n.tone === 'sub' ? 'var(--text-dim)' : 'var(--text)',
    border: `1px solid ${border}`,
    borderRadius: '10px',
    padding: '8px 12px',
    fontSize: '12.5px',
    maxWidth: '200px'
  }
}

function sync(): void {
  const key = JSON.stringify([props.nodes, props.edges])
  if (key === lastKey) return
  lastKey = key
  flowNodes.value = props.nodes.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.label, badge: n.badge, tone: n.tone || 'plain' },
    style: styleFor(n)
  }))
  flowEdges.value = props.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: edgeType.value === 'straight' ? 'straight' : 'default',
    label: e.label || undefined,
    style: { stroke: e.color || 'var(--text-faint)' },
    labelStyle: { fill: 'var(--text-dim)', fontSize: 11 },
    labelBgStyle: { fill: 'var(--panel)' }
  }))
}

// 切换连线形状：只改现有连线类型，不动数据（lastKey 不含形状，因此父组件数据未变时也不会重绘节点）
watch(edgeType, () => {
  flowEdges.value = flowEdges.value.map((e) => ({ ...e, type: edgeType.value === 'straight' ? 'straight' : 'default' }))
})

watch(() => [props.nodes, props.edges], sync, { deep: true, immediate: true })

/** 用户交互产生的更新：与 lastKey 比对而非时间窗，连续快速拖动不会丢事件 */
function emitNodes(): void {
  const next = flowNodes.value.map((n) => ({
    id: n.id,
    label: String(n.data?.label ?? ''),
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
    badge: n.data?.badge as string | undefined,
    tone: (n.data?.tone || 'plain') as CanvasNode['tone']
  }))
  if (JSON.stringify([next, props.edges]) === lastKey) return
  emit('update:nodes', next)
}

onNodeDragStop(emitNodes)
onNodeClick(({ node }) => emit('pick', node.id))
onConnect((c: Connection) => emit('connect', { source: c.source, target: c.target }))

defineExpose({
  fitView: () => fitView({ padding: 0.2 }),
  zoomIn: () => zoomIn(),
  zoomOut: () => zoomOut()
})
</script>

<template>
  <div class="relative h-full">
    <!-- 世界坐标底图：放在 VueFlow 之下、套同一视口变换，跟节点一起平移缩放 -->
    <div v-if="baseImage" class="absolute inset-0 overflow-hidden pointer-events-none">
      <img :src="baseImage" class="absolute left-0 top-0 max-w-none" :style="baseStyle" alt="" />
    </div>
    <VueFlow v-model:nodes="flowNodes" v-model:edges="flowEdges" :min-zoom="0.2" class="bg-[var(--bg-soft)]/40">
      <Background :pattern-color="'var(--border)'" :gap="22" />
      <Controls position="bottom-right" />
    </VueFlow>
    <!-- 连线形状切换：右上角，偏好存 localStorage 全局生效 -->
    <button
      class="absolute top-3 right-3 z-10 text-[11px] px-2.5 py-1 rounded-full cursor-pointer border transition-colors"
      :class="edgeType === 'straight' ? 'font-medium' : 'text-[var(--text-dim)] hover:text-[var(--accent)]'"
      :style="
        edgeType === 'straight'
          ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--panel)' }
          : { borderColor: 'var(--border)', background: 'var(--panel)' }
      "
      :title="edgeType === 'straight' ? '当前：直线连线（节点多时更清晰），点击切回曲线' : '当前：曲线连线，点击切换为直线（节点多时更清晰）'"
      @click="toggleEdgeType"
    >
      连线：{{ edgeType === 'straight' ? '直线' : '曲线' }}
    </button>
    <div class="absolute bottom-3 left-3 text-[11px] text-[var(--text-faint)] z-10 pointer-events-none">
      拖动节点调整布局 · 从节点边缘拖线连接 · 双击空白处新建
    </div>
  </div>
</template>