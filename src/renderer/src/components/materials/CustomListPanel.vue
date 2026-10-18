<script setup lang="ts">
/** 通用自定义列表面板（阶段二）：按注册表字段定义渲染条目卡片，防抖自动保存 */
import { onUnmounted, ref, watch } from 'vue'
import { useLibraryStore } from '../../store/library'
import { inkConfirm } from '../../ui/inkPrompt'
import { Plus, Trash2 } from 'lucide-vue-next'

const props = defineProps<{ panelId: string }>()
const emit = defineEmits<{ (e: 'removed', id: string): void }>()

const lib = useLibraryStore()

interface FieldDef {
  key: string
  label: string
  type: 'text' | 'longtext' | 'tags' | 'status'
}
interface Inst {
  id: string
  name: string
  prototype: string
  board?: string
  fields?: FieldDef[]
}
interface Entry {
  id: string
  [key: string]: unknown
}

const inst = ref<Inst | null>(null)
const entries = ref<Entry[]>([])
const loadErr = ref('')

let saveTimer: ReturnType<typeof setTimeout> | null = null
let seq = 0

async function load() {
  const book = lib.current?.title
  if (!book || !props.panelId) return
  const my = ++seq
  try {
    const list = (await window.api.panelsList(book)) as Inst[]
    const found = list.find((p) => p.id === props.panelId || p.name === props.panelId)
    if (my !== seq) return
    if (!found || found.board) {
      inst.value = null
      return
    }
    inst.value = found
    const data = (await window.api.panelsRead(book, found.id)) as { entries: Entry[] }
    if (my !== seq) return
    entries.value = data.entries || []
  } catch (e) {
    if (my === seq) loadErr.value = (e as Error).message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, 800)
}

async function flushSave() {
  const book = lib.current?.title
  if (!book || !inst.value) return
  try {
    // Vue 响应式 Proxy 无法过 IPC 结构化克隆，先转纯对象
    const plain = JSON.parse(JSON.stringify(entries.value))
    const data = (await window.api.panelsWrite(book, inst.value.id, plain)) as { entries: Entry[] }
    entries.value = data.entries || entries.value
  } catch (e) {
    loadErr.value = `保存失败：${(e as Error).message}`
  }
}

function addEntry() {
  entries.value.unshift({ id: `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` })
  scheduleSave()
}

async function removeEntry(i: number) {
  const ok = await inkConfirm('删除这一条？', { confirmText: '删除', danger: true })
  if (!ok) return
  entries.value.splice(i, 1)
  scheduleSave()
}

async function removePanel() {
  if (!lib.current || !inst.value) return
  const ok = await inkConfirm(`删除自定义面板「${inst.value.name}」及其全部条目？`, { confirmText: '删除', danger: true })
  if (!ok) return
  await window.api.panelsRemove(lib.current.title, inst.value.id)
  // 广播面板集合变化，左栏导航同步移除
  window.dispatchEvent(new CustomEvent('inkdesk:panels-changed'))
  emit('removed', inst.value.id)
}

watch(() => [lib.current?.title, props.panelId], () => void load(), { immediate: true })
onUnmounted(() => {
  if (saveTimer) clearTimeout(saveTimer)
})
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="panel-head">
      <span class="panel-head-title">{{ inst?.name || '…' }}</span>
      <span class="panel-head-meta">自定义面板 · {{ entries.length }} 条</span>
      <div class="flex-1" />
      <button class="text-label flex items-center gap-1 text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer" @click="removePanel">
        <Trash2 :size="12" /> 删除面板
      </button>
    </div>

    <div class="panel-body">
      <div class="max-w-[900px] mx-auto p-5 space-y-3">
        <div v-if="loadErr" class="text-label ink-text-danger">{{ loadErr }}</div>

        <div v-for="(e, i) in entries" :key="e.id" class="ink-card p-4 space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-meta text-[var(--text-faint)] tnum">#{{ entries.length - i }}</span>
            <button class="ink-icon-btn is-danger" title="删除此条" @click="removeEntry(i)">
              <Trash2 :size="13" />
            </button>
          </div>
          <div v-for="f in inst?.fields || []" :key="f.key" class="space-y-1">
            <div class="form-label">{{ f.label }}</div>
            <textarea
              v-if="f.type === 'longtext'"
              v-model="e[f.key]"
              class="ink-textarea h-20 text-body leading-6"
              @input="scheduleSave"
            />
            <input v-else v-model="e[f.key]" class="ink-input text-body" @input="scheduleSave" />
          </div>
        </div>

        <div v-if="inst && !entries.length" class="py-10 text-center text-label text-[var(--text-faint)]">
          空面板，点下方按钮添加第一条
        </div>

        <button
          class="w-full py-2.5 rounded-[var(--r-md)] border border-dashed border-[var(--border)] text-label text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)] cursor-pointer transition-colors flex items-center justify-center gap-1.5"
          @click="addEntry"
        >
          <Plus :size="14" /> 添加一条
        </button>
      </div>
    </div>
  </div>
</template>
