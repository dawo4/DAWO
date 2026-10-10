<script setup lang="ts">
/** 通用画布编辑器：角色关系图 / 故事线思维导图共用 */
import { ref, watch } from 'vue'
import { VueFlow, useVueFlow, type Node, type Edge, type Connection } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/controls/dist/style.css'
import InkButton from '../ui/InkButton.vue'
import { inkPrompt } from '../ui/inkPrompt'

const props = defineProps<{ modelValue: string; kind: 'relation' | 'mindmap' }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const { addNodes, addEdges, onConnect, onNodeDoubleClick, getSelectedNodes, onNodesChange, onEdgesChange } = useVueFlow()

interface GraphData {
  nodes: { id: string; label: string; x: number; y: number }[]
  edges: { from: string; to: string; label: string }[]
}

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
let suppress = false

function parse(json: string): GraphData {
  try {
    const d = JSON.parse(json) as GraphData
    if (Array.isArray(d.nodes)) return d
  } catch {
    /* 空/损坏返回空图 */
  }
  return { nodes: [], edges: [] }
}

function syncIn() {
  suppress = true
  const d = parse(props.modelValue)
  nodes.value = d.nodes.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.label },
    style: { background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '10px', padding: '10px 14px', fontSize: '13px' }
  }))
  edges.value = d.edges.map((e, i) => ({
    id: `e-${e.from}-${e.to}-${i}`,
    source: e.from,
    target: e.to,
    label: e.label || undefined,
    style: { stroke: 'var(--text-faint)' },
    labelStyle: { fill: 'var(--text-dim)', fontSize: 11 },
    labelBgStyle: { fill: 'var(--panel)' }
  }))
  setTimeout(() => (suppress = false), 50)
}

function serialize() {
  if (suppress) return
  const d: GraphData = {
    nodes: nodes.value.map((n) => ({ id: n.id, label: String(n.data?.label ?? ''), x: Math.round(n.position.x), y: Math.round(n.position.y) })),
    edges: edges.value.map((e) => ({ from: e.source, to: e.target, label: String((e.label as string) || '') }))
  }
  emit('update:modelValue', JSON.stringify(d, null, 2))
}

watch(() => props.modelValue, syncIn, { immediate: true })
watch([nodes, edges], serialize, { deep: true })

onConnect(async (c: Connection) => {
  const label = await inkPrompt('关系 / 连线说明（可留空）', '')
  addEdges([{ ...c, label: label || undefined, style: { stroke: 'var(--text-faint)' }, labelStyle: { fill: 'var(--text-dim)', fontSize: 11 } }])
})

onNodeDoubleClick(async ({ node }) => {
  const label = await inkPrompt('修改名称', String(node.data?.label ?? ''))
  if (label) {
    node.data = { ...node.data, label }
    serialize()
  }
})

async function addNode() {
  const label = await inkPrompt('名称（角色名 / 故事节点）', '')
  if (!label) return
  const id = `n${Date.now()}`
  const n = parse(props.modelValue)
  const cx = n.nodes.length ? n.nodes.reduce((s, x) => s + x.x, 0) / n.nodes.length : 0
  const cy = n.nodes.length ? n.nodes.reduce((s, x) => s + x.y, 0) / n.nodes.length : 0
  addNodes([{ id, position: { x: cx + (Math.random() - 0.5) * 300, y: cy + (Math.random() - 0.5) * 240 }, data: { label }, style: { background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '10px', padding: '10px 14px', fontSize: '13px' } }])
}

async function deleteSelected() {
  const sel = getSelectedNodes.value
  if (!sel.length) return
  const ids = new Set(sel.map((n) => n.id))
  nodes.value = nodes.value.filter((n) => !ids.has(n.id))
  edges.value = edges.value.filter((e) => !ids.has(e.source) && !ids.has(e.target))
  serialize()
}
</script>

<template>
  <div class="relative h-full">
    <VueFlow v-model:nodes="nodes" v-model:edges="edges" :fit-view-on-init="true" :min-zoom="0.2" class="bg-[var(--bg-soft)]/40">
      <Background :pattern-color="'var(--border)'" :gap="24" />
      <Controls position="bottom-right" />
    </VueFlow>
    <div class="absolute top-3 left-3 flex gap-2 z-10">
      <InkButton @click="addNode">添加节点</InkButton>
      <InkButton variant="ghost" @click="deleteSelected">删除选中</InkButton>
    </div>
    <div class="absolute bottom-3 left-3 text-[11px] text-[var(--text-faint)] z-10">
      双击节点改名 · 拖动节点边缘连线 · 拖拽可调整布局（自动保存）
    </div>
  </div>
</template>
