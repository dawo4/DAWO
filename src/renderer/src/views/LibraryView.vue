<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLibrariesStore } from '../store/libraries'
import { useLibraryStore } from '../store/library'
import { useAppStore } from '../store/app'
import { useConversationStore } from '../store/conversation'
import type { LibEntry, LibKind } from '../types'
import InkButton from '../ui/InkButton.vue'
import InkSegmented from '../ui/InkSegmented.vue'
import InkModal from '../ui/InkModal.vue'
import PageSubNav from '../ui/PageSubNav.vue'
import { onHeaderAction } from '../ui/headerActions'
import { inkPrompt, inkConfirm } from '../ui/inkPrompt'
import { aiRun } from '../ai'
import {
  Plus,
  Trash2,
  FolderOpen,
  FileText,
  Sparkles,
  BookOpen,
  Save,
  Lightbulb,
  WandSparkles,
  ListChecks,
  Stethoscope,
  Square,
  SquareCheckBig,
  Bot
} from 'lucide-vue-next'

const libs = useLibrariesStore()
const lib = useLibraryStore()
const app = useAppStore()
const conv = useConversationStore()

const TAB = ref<'materials' | 'skills' | 'notes' | 'bindings'>('skills')
const TABS: { k: 'materials' | 'skills' | 'notes' | 'bindings'; l: string }[] = [
  { k: 'skills', l: '技能库' },
  { k: 'materials', l: '素材库' },
  { k: 'notes', l: '灵感便签' },
  { k: 'bindings', l: '智能体默认引用' }
]
const tabValue = computed({
  get: () => TAB.value,
  set: (v: string) => (TAB.value = v as typeof TAB.value)
})
const kind = computed<LibKind>(() => (TAB.value === 'materials' ? 'materials' : TAB.value === 'notes' ? 'notes' : 'skills'))
const groups = computed(() => libs.groups(kind.value))

const active = ref<{ kind: LibKind; group: string; name: string } | null>(null)
const form = ref({ name: '', group: '通用', summary: '', tags: '', body: '' })
const original = ref({ group: '', name: '' })
const savedTip = ref(false)

async function openEntry(e: LibEntry) {
  const raw = await libs.read(e.kind, e.group, e.name)
  active.value = { kind: e.kind, group: e.group, name: e.name }
  original.value = { group: e.group, name: e.name }
  form.value = {
    name: raw.name,
    group: e.group,
    summary: raw.summary,
    tags: raw.tags.join(', '),
    body: raw.body
  }
}

function newEntry(k?: LibKind, group = '通用') {
  const g = k || kind.value
  active.value = { kind: g, group, name: '' }
  original.value = { group: '', name: '' }
  form.value = { name: '', group, summary: '', tags: '', body: '' }
}

async function saveEntry() {
  if (!active.value) return
  if (!form.value.name.trim()) {
    await inkPrompt('请填写名称', '')
    return
  }
  const name = form.value.name.trim()
  const tags = form.value.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
  // 改名/换分组到已存在的条目名时先确认，防止静默覆盖别人的内容
  const renaming = original.value.name && (original.value.name !== name || original.value.group !== form.value.group)
  if (renaming) {
    const exists = libs.groups(active.value.kind).some((g) => g.group === form.value.group && g.entries.some((e) => e.name === name))
    if (exists) {
      const ok = await inkConfirm(`「${form.value.group}/${name}」已存在，覆盖它的内容？`, { confirmText: '覆盖', danger: true })
      if (!ok) return
    }
  }
  await libs.write(active.value.kind, form.value.group, name, form.value.summary, tags, form.value.body)
  if (renaming) {
    await libs.remove(active.value.kind, original.value.group, original.value.name)
  }
  active.value = { kind: active.value.kind, group: form.value.group, name }
  original.value = { group: form.value.group, name }
  savedTip.value = true
  setTimeout(() => (savedTip.value = false), 1500)
}

async function removeEntry() {
  if (!active.value || !original.value.name) return
  const ok = await inkConfirm(`确定删除「${original.value.name}」？`, { confirmText: '删除', danger: true })
  if (!ok) return
  await libs.remove(active.value.kind, original.value.group, original.value.name)
  active.value = null
}

async function addGroup() {
  const name = await inkPrompt('新建分组名称', '')
  if (!name) return
  await libs.createGroup(kind.value, name)
}

async function delGroup(name: string, count: number) {
  // 无论分组是否为空都要确认：删除是不可恢复操作
  const ok = await inkConfirm(`确定删除分组「${name}」？`, {
    detail: count > 0 ? `该分组下还有 ${count} 个条目，删除后会一并移除。` : '该分组当前为空。',
    confirmText: '删除',
    danger: true
  })
  if (!ok) return
  try {
    await libs.deleteGroup(kind.value, name)
  } catch (e) {
    await inkConfirm('删除分组失败', {
      detail: (e as Error).message.replace('Error invoking remote method', '').trim(),
      cancelText: ''
    })
    return
  }
  if (active.value && original.value.group === name) active.value = null
}

async function importSkill() {
  try {
    const name = await libs.importSkill(form.value.group || '通用')
    if (name) await openEntry({ kind: 'skills', group: form.value.group || '通用', name, path: '', summary: '', tags: [], updatedAt: '', size: 0 })
  } catch (e) {
    // 重名导入等主进程报错要有可见反馈，不能静默失败
    await inkConfirm('导入技能失败', {
      detail: (e as Error).message.replace('Error invoking remote method', '').trim(),
      cancelText: ''
    })
  }
}

// ============ 多选 ============
const selected = ref<string[]>([])

function selKey(k: LibKind, group: string, name: string): string {
  return `${k}/${group}/${name}`
}

function isSelected(e: LibEntry): boolean {
  return selected.value.includes(selKey(e.kind, e.group, e.name))
}

function toggleSelect(e: LibEntry) {
  const k = selKey(e.kind, e.group, e.name)
  const i = selected.value.indexOf(k)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(k)
}

/** 当前标签页下所有条目（用于全选与批量删除） */
const tabEntries = computed<LibEntry[]>(() => libs.groups(kind.value).flatMap((g) => g.entries))

function selectAll() {
  selected.value = selected.value.length === tabEntries.value.length ? [] : tabEntries.value.map((e) => selKey(e.kind, e.group, e.name))
}

// 切换标签页时清空选择，避免跨库误操作
watch(kind, () => (selected.value = []))

async function removeSelected() {
  const n = selected.value.length
  if (!n) return
  const ok = await inkConfirm(`确定删除选中的 ${n} 个条目？`, { detail: '此操作不可恢复。', confirmText: '删除', danger: true })
  if (!ok) return
  const targets = tabEntries.value.filter(isSelected)
  for (const e of targets) await window.api.libDelete(e.kind, e.group, e.name)
  selected.value = []
  if (active.value && targets.some((t) => t.group === active.value!.group && t.name === active.value!.name)) active.value = null
  await libs.refresh(kind.value)
}

// ============ AI：轻通道（起草 / 改写）与智能体分流 ============
const KIND_LABEL: Record<LibKind, string> = { materials: '素材库', skills: '技能库', notes: '灵感便签' }

/** 交给资源管家：批量整理、体检等需要读全库与多轮判断的任务 */
async function askLibrarian(text: string) {
  if (!lib.current) {
    await inkConfirm('尚未打开作品', { detail: '资源管家需要结合作品上下文工作，请先到书架打开一部作品。', cancelText: '' })
    return
  }
  app.go('assistant')
  await conv.askWith('librarian', text)
}

/** 体检：把当前库的条目清单直接交给资源管家，省得它再问一遍 */
function healthCheck() {
  const list = libs
    .groups(kind.value)
    .map((g) => `【${g.name}】${g.entries.map((e) => e.name).join('、')}`)
    .join('\n')
  void askLibrarian(
    `请对${KIND_LABEL[kind.value]}做一次体检：找出内容重复或主题高度相近的条目、命名不一致的条目；指出哪些分组条目太少、还缺什么方向的素材。给出可执行建议。\n\n当前分组与条目：\n${list || '（空库）'}`
  )
}

/** 整理选中的条目 */
function organizeSelected() {
  const targets = tabEntries.value.filter(isSelected)
  if (targets.length < 2) return
  const list = targets.map((e) => `${e.name}（${e.group}，${e.summary || '无摘要'}）`).join('\n')
  void askLibrarian(
    `以下是${KIND_LABEL[kind.value]}中我选中的 ${targets.length} 个条目：\n${list}\n\n请先 read_material 读它们的全文，然后判断该怎么整理：内容重复或互补的合并成一条更完整的；一条里混了多个主题的拆成几条；归类不当的调整分组。整理结果用 write_materials 提交入库提案。`
  )
}

// ============ AI 起草浮层 ============
const draftOpen = ref(false)
const draftReq = ref('')
const draftBatch = ref(false)
const draftText = ref('')
const draftRunning = ref(false)
const draftError = ref('')
let draftAborter: { abort: () => void } | null = null

interface DraftItem {
  name: string
  summary: string
  tags: string[]
  body: string
  picked: boolean
}

const draftItems = ref<DraftItem[]>([])

const DRAFT_FORMAT_SINGLE =
  '第一行「名称：具体条目名」，第二行「摘要：一句话」，第三行「标签：逗号分隔的 2-4 个标签」，然后一个空行，之后是 Markdown 正文。'
const DRAFT_FORMAT_BATCH =
  '每个条目以「=== 条目 ===」单独一行开始，随后是「名称：」「摘要：」「标签：」三行，一个空行后是正文；下一条目再以「=== 条目 ===」开始。产出 3-8 条，每条独立成形、可单独引用。'

function openDraft() {
  draftOpen.value = true
  draftReq.value = ''
  draftText.value = ''
  draftItems.value = []
  draftError.value = ''
}

/** 解析单条产出：前几行为「名称/摘要/标签」，首个空行后为正文 */
function parseDraft(text: string): DraftItem | null {
  const lines = text.split('\n')
  let name = ''
  let summary = ''
  let tags: string[] = []
  let bodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) {
      bodyStart = i + 1
      break
    }
    const m = line.match(/^(名称|摘要|标签)[:：]\s*(.*)$/)
    if (!m) {
      // 没有规范头部，退化为：首行当名称，全文当正文
      name = name || line
      bodyStart = 1
      break
    }
    if (m[1] === '名称') name = m[2].trim()
    else if (m[1] === '摘要') summary = m[2].trim()
    else tags = m[2].split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    bodyStart = i + 1
  }
  const body = lines.slice(bodyStart).join('\n').trim()
  if (!name && !body) return null
  return { name: name || '未命名条目', summary, tags, body: body || text.trim(), picked: true }
}

/** 解析批量产出：按「=== 条目 ===」切分 */
function parseDraftMulti(text: string): DraftItem[] {
  const chunks = text
    .split(/^\s*={2,}\s*条目\s*={2,}\s*$/m)
    .map((c) => c.trim())
    .filter(Boolean)
  const items: DraftItem[] = []
  for (const c of chunks) {
    const it = parseDraft(c)
    if (it) items.push(it)
  }
  // 模型没按分隔符输出时，退化为单条
  if (!items.length) {
    const one = parseDraft(text)
    if (one) items.push(one)
  }
  return items
}

async function runDraft() {
  if (!draftReq.value.trim() || draftRunning.value) return
  draftRunning.value = true
  draftError.value = ''
  draftText.value = ''
  draftItems.value = []
  const existing = libs
    .groups(kind.value)
    .flatMap((g) => g.entries.map((e) => `${e.group}/${e.name}${e.summary ? ` — ${e.summary}` : ''}`))
    .slice(0, 200)
    .join('\n')
  const bookLabel = lib.current ? `${lib.current.title}｜${lib.current.genre || '未设题材'}` : '未打开作品'
  draftAborter = aiRun(
    'workflow',
    'lib-draft',
    {
      kind: KIND_LABEL[kind.value],
      group: form.value.group || '通用',
      book: bookLabel,
      existing: existing || '（该库还是空的）',
      request: draftReq.value.trim(),
      format: draftBatch.value ? DRAFT_FORMAT_BATCH : DRAFT_FORMAT_SINGLE
    },
    { onChunk: (c) => (draftText.value += c) }
  )
  try {
    await draftAborter.promise
    draftItems.value = draftBatch.value ? parseDraftMulti(draftText.value) : [parseDraft(draftText.value)].filter((x): x is DraftItem => !!x)
    if (!draftItems.value.length) draftError.value = '未能从输出中解析出条目，可把结果手动复制到表单里。'
  } catch (e) {
    draftError.value = (e as Error).message
  } finally {
    draftRunning.value = false
    draftAborter = null
  }
}

function stopDraft() {
  draftAborter?.abort()
}

/** 起草结果的全选 / 全不选 */
function toggleAllDraft() {
  const all = draftItems.value.every((i) => i.picked)
  draftItems.value.forEach((i) => (i.picked = !all))
}

/** 把某条产出填进编辑表单，由作者继续润色后手动保存 */
async function fillForm(it: DraftItem) {
  const g = form.value.group || '通用'
  active.value = { kind: kind.value, group: g, name: '' }
  original.value = { group: '', name: '' }
  form.value = { name: it.name, group: g, summary: it.summary, tags: it.tags.join(', '), body: it.body }
  draftOpen.value = false
}

/** 直接入库勾选的条目（同名先确认覆盖） */
async function saveDraftItems() {
  const g = form.value.group || '通用'
  const pickedItems = draftItems.value.filter((i) => i.picked)
  if (!pickedItems.length) return
  const dup = pickedItems.filter((i) => tabEntries.value.some((e) => e.group === g && e.name === i.name))
  if (dup.length) {
    const ok = await inkConfirm(`有 ${dup.length} 个条目与现有条目同名`, {
      detail: `入库会覆盖同名条目的内容：${dup.map((d) => d.name).join('、')}`,
      confirmText: '覆盖入库',
      danger: true
    })
    if (!ok) return
  }
  for (const i of pickedItems) {
    await window.api.libWrite(kind.value, g, i.name, i.summary, i.tags, i.body)
  }
  await libs.refresh(kind.value)
  const first = pickedItems[0]
  await openEntry({ kind: kind.value, group: g, name: first.name, path: '', summary: '', tags: [], updatedAt: '', size: 0 })
  draftOpen.value = false
}

// ============ AI 改写当前条目 ============
const rewriteOpen = ref(false)
const rewriteReq = ref('')
const rewriteText = ref('')
const rewriteRunning = ref(false)
const rewriteError = ref('')
let rewriteAborter: { abort: () => void } | null = null

function openRewrite() {
  if (!original.value.name) return
  rewriteOpen.value = true
  rewriteReq.value = ''
  rewriteText.value = ''
  rewriteError.value = ''
}

async function runRewrite() {
  if (!rewriteReq.value.trim() || rewriteRunning.value) return
  rewriteRunning.value = true
  rewriteError.value = ''
  rewriteText.value = ''
  rewriteAborter = aiRun(
    'workflow',
    'lib-rewrite',
    {
      kind: KIND_LABEL[active.value?.kind || kind.value],
      name: form.value.name,
      summary: form.value.summary,
      tags: form.value.tags,
      body: form.value.body,
      request: rewriteReq.value.trim()
    },
    { onChunk: (c) => (rewriteText.value += c) }
  )
  try {
    await rewriteAborter.promise
  } catch (e) {
    rewriteError.value = (e as Error).message
  } finally {
    rewriteRunning.value = false
    rewriteAborter = null
  }
}

function stopRewrite() {
  rewriteAborter?.abort()
}

/** 把改写结果填回表单（不直接落盘，作者确认后再保存） */
function applyRewrite() {
  const it = parseDraft(rewriteText.value)
  if (!it) return
  form.value = {
    name: it.name || form.value.name,
    group: form.value.group,
    summary: it.summary || form.value.summary,
    tags: it.tags.length ? it.tags.join(', ') : form.value.tags,
    body: it.body
  }
  rewriteOpen.value = false
}

// ============ 智能体默认引用 ============
const bindAgent = ref('general')
const bindKind = ref<LibKind>('skills')
const bindKindValue = computed({
  get: () => bindKind.value as string,
  set: (v: string) => (bindKind.value = v as LibKind)
})

const bindings = computed(() => app.config?.bindings || {})

function isBound(kindKey: LibKind, group: string, name: string): boolean {
  const b = bindings.value[bindAgent.value]
  if (!b) return false
  const arr = kindKey === 'skills' ? b.skills : kindKey === 'notes' ? b.notes || [] : b.materials
  return arr.includes(`${group}/${name}`)
}

async function toggleBind(kindKey: LibKind, group: string, name: string) {
  const cur = bindings.value[bindAgent.value] || { materials: [], skills: [] }
  const key = `${group}/${name}`
  const next = {
    materials: [...(cur.materials || [])],
    skills: [...(cur.skills || [])],
    notes: [...(cur.notes || [])]
  }
  const arr = kindKey === 'skills' ? next.skills : kindKey === 'notes' ? next.notes : next.materials
  const i = arr.indexOf(key)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(key)
  await app.updateConfig({ bindings: { ...bindings.value, [bindAgent.value]: next } })
}

let offHeader: (() => void) | null = null

/** 智能体确认入库后，资源库列表要跟着刷新 */
function onLibChanged() {
  void libs.refresh()
}

onMounted(() => {
  offHeader = onHeaderAction((key) => {
    if (key === 'library:newEntry') newEntry()
    else if (key === 'library:importSkill') void importSkill()
    else if (key === 'library:aiDraft') openDraft()
  })
  window.addEventListener('inkdesk:lib-changed', onLibChanged)
  void libs.refresh()
})

/** 顶部栏全局搜索点到技能/素材条目后，跳转过来并打开它 */
watch(
  () => app.openLibRequest?.nonce,
  async () => {
    const req = app.openLibRequest
    if (!req) return
    const kind = (req.kind === 'materials' ? 'materials' : req.kind === 'notes' ? 'notes' : 'skills') as LibKind
    TAB.value = kind
    await libs.refresh(kind)
    const g = libs.groups(kind).find((x) => x.name === req.group)
    const e = g?.entries.find((x) => x.name === req.name)
    if (e) await openEntry(e)
  },
  { immediate: true }
)

onUnmounted(() => {
  offHeader?.()
  offHeader = null
  window.removeEventListener('inkdesk:lib-changed', onLibChanged)
})

/** 侧栏点「技能库 / 素材库」时切到对应标签 */
watch(
  () => app.libraryTab,
  async (t) => {
    if (!t || app.view !== 'library') return
    TAB.value = t === 'materials' ? 'materials' : t === 'notes' ? 'notes' : 'skills'
    await libs.refresh(TAB.value)
  },
  { immediate: true }
)
</script>

<template>
  <div class="h-full flex flex-col">
    <PageSubNav v-model="tabValue" :tabs="TABS.map((t) => ({ value: t.k, label: t.l }))">
      <template #right>
        <template v-if="TAB !== 'bindings'">
          <button class="text-[12px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer flex items-center gap-1" @click="openDraft">
            <WandSparkles :size="13" /> AI 起草
          </button>
          <button class="text-[12px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer flex items-center gap-1 ml-3" @click="healthCheck">
            <Stethoscope :size="13" /> 体检
          </button>
          <button class="text-[12px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer flex items-center gap-1 ml-3" @click="askLibrarian(`我想给${KIND_LABEL[kind]}补充一些内容，先帮我看看现在缺什么，再问我要什么。`)">
            <Bot :size="13" /> AI 管家
          </button>
          <button class="text-[12px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer flex items-center gap-1 ml-3" @click="addGroup">
            <Plus :size="13" /> 新建分组
          </button>
          <button class="text-[12px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer flex items-center gap-1 ml-3" @click="libs.open(kind)">
            <FolderOpen :size="13" /> 打开目录
          </button>
        </template>
      </template>
    </PageSubNav>

    <!-- 批量操作条：有选中时出现 -->
    <div
      v-if="TAB !== 'bindings' && selected.length"
      class="shrink-0 flex items-center gap-3 px-5 py-2 border-b border-[var(--border)] bg-[var(--panel)]"
    >
      <span class="text-[12px]" :style="{ color: 'var(--accent)' }">已选 {{ selected.length }} 项</span>
      <button class="text-[12px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="selectAll">
        {{ selected.length === tabEntries.length ? '全不选' : '全选本库' }}
      </button>
      <div class="flex-1" />
      <button
        class="text-[12px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer flex items-center gap-1 disabled:opacity-40"
        :disabled="selected.length < 2"
        :title="selected.length < 2 ? '至少选择 2 个条目才能整理' : '让资源管家读全文后合并/拆分/改归类'"
        @click="organizeSelected"
      >
        <ListChecks :size="13" /> AI 整理
      </button>
      <button class="text-[12px] text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer flex items-center gap-1" @click="removeSelected">
        <Trash2 :size="13" /> 批量删除
      </button>
      <button class="text-[12px] text-[var(--text-faint)] hover:text-[var(--text-dim)] cursor-pointer" @click="selected = []">取消</button>
    </div>

    <!-- 绑定矩阵 -->
    <div v-if="TAB === 'bindings'" class="flex-1 min-h-0 overflow-y-auto px-6 py-5">
      <div class="max-w-3xl">
        <p class="text-[12.5px] text-[var(--text-dim)] leading-6 mb-4">
          为每个智能体指定默认引用的技能与素材。新建会话时会自动带上这些引用，也可以在输入框里临时增删。
        </p>
        <div class="flex flex-wrap gap-1 mb-4">
          <button
            v-for="a in conv.allAgents"
            :key="a.id"
            class="px-3 py-1.5 text-[12px] rounded-full cursor-pointer transition-colors"
            :class="bindAgent === a.id ? 'bg-[var(--panel-2)] font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
            :style="bindAgent === a.id ? { color: 'var(--accent)' } : {}"
            @click="bindAgent = a.id"
          >
            {{ a.name }}
          </button>
        </div>
        <div class="mb-4">
          <InkSegmented
            v-model="bindKindValue"
            :options="[
              { value: 'skills', label: '技能库' },
              { value: 'materials', label: '素材库' },
              { value: 'notes', label: '灵感便签' }
            ]"
          />
        </div>
        <div v-for="g in libs.groups(bindKind)" :key="g.name" class="mb-4">
          <div class="text-[11px] text-[var(--text-faint)] mb-2 tracking-wider">{{ g.name }}</div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="e in g.entries"
              :key="e.name"
              class="px-2.5 py-1.5 text-[12px] rounded-full cursor-pointer transition-colors"
              :class="isBound(bindKind, g.name, e.name) ? 'bg-[var(--panel-2)] font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
              :style="isBound(bindKind, g.name, e.name) ? { color: 'var(--accent)' } : { background: 'var(--bg-soft)' }"
              @click="toggleBind(bindKind, g.name, e.name)"
            >
              {{ isBound(bindKind, g.name, e.name) ? '✓ ' : '' }}{{ e.name }}
            </button>
            <span v-if="!g.entries.length" class="text-[11.5px] text-[var(--text-faint)]">该分组暂无条目</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 列表 + 编辑 -->
    <div v-else class="flex-1 min-h-0 flex">
      <aside class="w-72 shrink-0 border-r border-[var(--border)] overflow-y-auto py-2">
        <div v-for="g in groups" :key="g.name" class="mb-1">
          <div class="flex items-center gap-1.5 px-3 py-1.5 group">
            <span class="text-[11px] tracking-wider text-[var(--text-faint)] flex-1">{{ g.name }} · {{ g.entries.length }}</span>
            <button class="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer" @click="delGroup(g.name, g.entries.length)">
              <Trash2 :size="12" />
            </button>
          </div>
          <div
            v-for="e in g.entries"
            :key="e.name"
            class="w-full flex items-center gap-2 pl-2 pr-3.5 py-2 cursor-pointer border-l-2 transition-colors"
            :class="active?.group === g.name && active?.name === e.name ? 'bg-[var(--panel-2)]' : 'border-transparent hover:bg-[var(--hover)]'"
            :style="active?.group === g.name && active?.name === e.name ? { borderColor: 'var(--accent)' } : {}"
            @click="openEntry(e)"
          >
            <!-- 多选复选框 -->
            <button
              class="shrink-0 text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer"
              :title="isSelected(e) ? '取消选择' : '选择（可批量操作）'"
              @click.stop="toggleSelect(e)"
            >
              <component :is="isSelected(e) ? SquareCheckBig : Square" :size="14" :style="isSelected(e) ? { color: 'var(--accent)' } : {}" />
            </button>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <component :is="e.kind === 'skills' ? Sparkles : e.kind === 'notes' ? Lightbulb : BookOpen" :size="12" :style="{ color: 'var(--accent)' }" />
                <span class="text-[12.5px] truncate">{{ e.name }}</span>
              </div>
              <div class="text-[11px] text-[var(--text-faint)] truncate mt-0.5">{{ e.summary || '无摘要' }}</div>
            </div>
          </div>
        </div>
        <div v-if="!groups.length" class="px-3 py-8 text-center text-[12px] text-[var(--text-faint)] leading-6">
          库为空<br />
          <button class="underline hover:text-[var(--accent)] cursor-pointer" @click="openDraft">让 AI 起草一条</button>
        </div>
      </aside>

      <section class="flex-1 min-w-0 overflow-y-auto">
        <div v-if="!active" class="h-full flex flex-col items-center justify-center gap-3 text-[var(--text-faint)]">
          <FileText :size="26" />
          <p class="text-[12.5px]">从左侧选择条目，或新建一个</p>
        </div>
        <div v-else class="max-w-3xl px-7 py-5 space-y-4">
          <div class="flex gap-2">
            <input v-model="form.name" class="ink-input flex-1" placeholder="条目名称" />
            <input v-model="form.group" class="ink-input w-40" placeholder="所属分组" list="group-list" />
            <datalist id="group-list">
              <option v-for="g in groups" :key="g.name" :value="g.name" />
            </datalist>
          </div>
          <input v-model="form.summary" class="ink-input" placeholder="一句话摘要（智能体据此判断是否引用）" />
          <input v-model="form.tags" class="ink-input" placeholder="标签，用逗号分隔" />
          <div>
            <div class="text-[11px] text-[var(--text-faint)] mb-1.5 tracking-wider">正文（Markdown）</div>
            <textarea v-model="form.body" rows="16" class="ink-textarea font-mono text-[12.5px]" placeholder="技能步骤 / 素材内容…" />
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <InkButton @click="saveEntry"><Save :size="13" /> 保存</InkButton>
            <InkButton v-if="original.name" variant="ghost" @click="removeEntry"><Trash2 :size="13" /> 删除</InkButton>
            <button
              v-if="original.name"
              class="text-[12px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer px-1 inline-flex items-center gap-1"
              @click="openRewrite"
            >
              <WandSparkles :size="12" /> AI 改写
            </button>
            <button
              v-if="original.name"
              class="text-[12px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer px-1"
              @click="
                active && active.kind === 'skills'
                  ? conv.addSkillRef({ group: original.group, name: original.name })
                  : active && active.kind === 'notes'
                    ? conv.addNoteRef({ group: original.group, name: original.name })
                    : conv.addMaterialRef({ group: original.group, name: original.name })
              "
            >
              引用到当前会话
            </button>
            <span v-if="savedTip" class="text-[11.5px]" style="color: #7fae7a">已保存</span>
          </div>
        </div>
      </section>
    </div>

    <!-- AI 起草浮层 -->
    <InkModal :open="draftOpen" title="AI 起草条目" wide @close="draftOpen = false">
      <div class="space-y-4">
        <div class="flex items-center gap-2 text-[12px]">
          <span class="text-[var(--text-faint)]">目标库</span>
          <span style="color: var(--accent)">{{ KIND_LABEL[kind] }}</span>
          <span class="text-[var(--text-faint)]">· 分组</span>
          <input v-model="form.group" class="ink-input w-32" placeholder="通用" list="group-list" />
          <div class="flex-1" />
          <InkSegmented
            :model-value="draftBatch ? 'batch' : 'single'"
            :options="[
              { value: 'single', label: '单条' },
              { value: 'batch', label: '批量' }
            ]"
            @update:model-value="(v: string) => (draftBatch = v === 'batch')"
          />
        </div>
        <p class="text-[11px] text-[var(--text-faint)] leading-5">
          {{ draftBatch ? '批量：AI 会产出一条条独立条目，可逐条勾选入库' : '单条：AI 产出一个完整条目' }}
          ——会参考本库已有条目的命名与摘要风格，避免重复。
        </p>

        <textarea
          v-model="draftReq"
          rows="3"
          class="ink-textarea text-[13px]"
          :placeholder="
            kind === 'skills'
              ? '例如：我想要一个「怎么写出窒息感追妻火葬场」的写作方法，要能直接照着执行'
              : kind === 'notes'
                ? '例如：给我几个开篇钩子的点子，主角是重生复仇的'
                : '例如：我要 5 条阴狠但不说脏话的反派台词素材'
          "
        />

        <div class="flex items-center gap-2">
          <InkButton :disabled="draftRunning || !draftReq.trim()" @click="runDraft">
            <WandSparkles :size="13" /> {{ draftRunning ? '生成中…' : '生成' }}
          </InkButton>
          <InkButton v-if="draftRunning" variant="ghost" @click="stopDraft">停止</InkButton>
          <span v-if="draftError" class="text-[12px] text-[#e08a7a]">{{ draftError }}</span>
        </div>

        <!-- 解析出的条目卡片 -->
        <div v-if="draftItems.length" class="space-y-2 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] p-2.5">
          <div class="flex items-center gap-2">
            <button class="text-[11.5px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="toggleAllDraft">
              {{ draftItems.every((i) => i.picked) ? '全不选' : '全选' }}
            </button>
            <span class="text-[11px] text-[var(--text-faint)]">解析出 {{ draftItems.length }} 条</span>
          </div>
          <div v-for="(it, idx) in draftItems" :key="idx" class="flex items-start gap-2.5 py-2 border-t border-[var(--border)] first:border-t-0">
            <button
              class="mt-0.5 shrink-0 cursor-pointer"
              :style="it.picked ? { color: 'var(--accent)' } : { color: 'var(--text-faint)' }"
              @click="it.picked = !it.picked"
            >
              <component :is="it.picked ? SquareCheckBig : Square" :size="15" />
            </button>
            <div class="flex-1 min-w-0">
              <div class="text-[12.5px]">{{ it.name }}</div>
              <div class="text-[11.5px] text-[var(--text-dim)] mt-0.5">{{ it.summary || '无摘要' }}</div>
              <div v-if="it.tags.length" class="flex gap-1 mt-1 flex-wrap">
                <span v-for="t in it.tags" :key="t" class="text-[10px] text-[var(--text-faint)]">#{{ t }}</span>
              </div>
            </div>
            <button class="text-[11px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer shrink-0" @click="fillForm(it)">
              填入表单
            </button>
          </div>
        </div>

        <!-- 流式原文（解析失败时兜底） -->
        <div v-else-if="draftText" class="max-h-60 overflow-y-auto rounded-lg bg-[var(--bg-soft)] p-3 text-[12px] leading-6 whitespace-pre-wrap select-text">
          {{ draftText }}
        </div>

        <div class="flex items-center justify-end gap-2 pt-1">
          <InkButton variant="ghost" @click="draftOpen = false">关闭</InkButton>
          <InkButton :disabled="!draftItems.filter((i) => i.picked).length" @click="saveDraftItems">
            入库 {{ draftItems.filter((i) => i.picked).length }} 条
          </InkButton>
        </div>
      </div>
    </InkModal>

    <!-- AI 改写浮层 -->
    <InkModal :open="rewriteOpen" title="AI 改写条目" @close="rewriteOpen = false">
      <div class="space-y-4">
        <div class="text-[12px] text-[var(--text-faint)]">
          正在改写：<span style="color: var(--accent)">{{ form.name || '未命名' }}</span>
        </div>
        <textarea
          v-model="rewriteReq"
          rows="3"
          class="ink-textarea text-[13px]"
          placeholder="例如：太短了帮我充实一下 / 精简到一半 / 换成更适合男频的直给风格 / 补上标签和摘要"
        />
        <div class="flex items-center gap-2">
          <InkButton :disabled="rewriteRunning || !rewriteReq.trim()" @click="runRewrite">
            <WandSparkles :size="13" /> {{ rewriteRunning ? '改写中…' : '开始改写' }}
          </InkButton>
          <InkButton v-if="rewriteRunning" variant="ghost" @click="stopRewrite">停止</InkButton>
          <span v-if="rewriteError" class="text-[12px] text-[#e08a7a]">{{ rewriteError }}</span>
        </div>
        <div v-if="rewriteText" class="max-h-64 overflow-y-auto rounded-lg bg-[var(--bg-soft)] p-3 text-[12px] leading-6 whitespace-pre-wrap select-text">
          {{ rewriteText }}
        </div>
        <p class="text-[11px] text-[var(--text-faint)]">
          改写结果会填回表单，不会直接覆盖。你确认后再点「保存」。
        </p>
        <div class="flex items-center justify-end gap-2">
          <InkButton variant="ghost" @click="rewriteOpen = false">关闭</InkButton>
          <InkButton :disabled="!rewriteText.trim()" @click="applyRewrite">填入表单</InkButton>
        </div>
      </div>
    </InkModal>
  </div>
</template>