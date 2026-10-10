<script setup lang="ts">
// 智能体库：AI 起草自定义智能体 + 权限配置 + 妙笔启用管理
import { computed, onMounted, reactive, ref } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import { useConversationStore, AGENTS } from '../store/conversation'
import InkButton from '../ui/InkButton.vue'
import InkModal from '../ui/InkModal.vue'
import InkToggle from '../ui/InkToggle.vue'
import { inkConfirm } from '../ui/inkPrompt'
import type { CustomAgent, LibKind } from '../types'
import { Bot, Plus, Pencil, Trash2, Globe, Sparkles, LoaderCircle, LibraryBig, Users } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()
const conv = useConversationStore()

const customList = ref<CustomAgent[]>([])
const loading = ref(false)

const LIB_ITEMS: { key: LibKind; label: string }[] = [
  { key: 'materials', label: '素材库' },
  { key: 'skills', label: '技能库' },
  { key: 'notes', label: '灵感便签' }
]
const SCOPE_ITEMS = ['正文', '大纲', '设定', '角色']

/** 结构化板块权限（key 与主进程 agents.ts 的 STRUCT_BOARDS 一致） */
const STRUCT_ITEMS: { key: string; label: string }[] = [
  { key: 'timeline', label: '时间线' },
  { key: 'story', label: '故事线 / 关系图' },
  { key: 'dict', label: '专名词典' },
  { key: 'foreshadow', label: '伏笔登记' },
  { key: 'power', label: '境界体系' },
  { key: 'tracking', label: '出场追踪' },
  { key: 'outline', label: '卷 / 章细纲' },
  { key: 'map', label: '地图路线图' }
]

// ============ 创建 / 编辑弹层 ============
const modalOpen = ref(false)
const editingId = ref('') // 空 = 新建
const step = ref<1 | 2>(1)
const needDesc = ref('')
const drafting = ref(false)
const draftErr = ref('')

const form = reactive({
  name: '',
  desc: '',
  stage: '自定义',
  prompt: '',
  welcome: ['', '', '', ''] as string[],
  readScope: [] as string[],
  libsRead: [] as LibKind[],
  libsWrite: false,
  structBoards: [...STRUCT_ITEMS.map((s) => s.key)] as string[],
  panelBoards: [] as string[],
  webSearch: false,
  orchestrator: false
})

/** 本书自定义面板（list 原型）：结构化板块权限组动态追加 */
const customPanelNames = ref<string[]>([])

async function refreshCustomPanels() {
  if (!lib.current) {
    customPanelNames.value = []
    return
  }
  try {
    const list = (await window.api.panelsList(lib.current.title)) as { name: string; board?: string }[]
    customPanelNames.value = list.filter((p) => !p.board).map((p) => p.name)
  } catch {
    customPanelNames.value = []
  }
}

function togglePanelBoard(name: string) {
  const i = form.panelBoards.indexOf(name)
  if (i >= 0) form.panelBoards.splice(i, 1)
  else form.panelBoards.push(name)
}

/** 起草会话代次：关弹窗/重开时 +1，让在途的起草结果作废，不污染下一次 */
let draftSeq = 0

function openCreate() {
  editingId.value = ''
  step.value = 1
  needDesc.value = ''
  draftErr.value = ''
  draftSeq++ // 作废上一轮可能在途的起草
  drafting.value = false
  fillForm({
    id: '',
    name: '',
    desc: '',
    stage: '自定义',
    prompt: '',
    welcome: [],
    readScope: [],
    libsRead: [],
    libsWrite: false,
    webSearch: false,
    enabled: false,
    createdAt: ''
  })
  modalOpen.value = true
}

/** 关闭弹层：作废在途起草，防止迟到的结果悄悄改掉下次打开时的表单 */
function closeModal() {
  draftSeq++
  drafting.value = false
  modalOpen.value = false
}

function openEdit(a: CustomAgent) {
  editingId.value = a.id
  step.value = 2
  draftErr.value = ''
  fillForm(a)
  modalOpen.value = true
}

function fillForm(a: Partial<CustomAgent>) {
  form.name = a.name || ''
  form.desc = a.desc || ''
  form.stage = a.stage || '自定义'
  form.prompt = a.prompt || ''
  form.welcome = [...(a.welcome || []), '', '', '', ''].slice(0, 4)
  form.readScope = [...(a.readScope || [])]
  form.libsRead = [...(a.libsRead || [])]
  form.libsWrite = !!a.libsWrite
  // 旧数据无 structBoards = 全部允许，表单上全亮
  form.structBoards = a.structBoards ? [...a.structBoards] : STRUCT_ITEMS.map((s) => s.key)
  // 旧数据无 panelBoards = 全部允许：表单把当前所有自定义面板点亮
  void refreshCustomPanels().then(() => {
    form.panelBoards = a.panelBoards
      ? [...a.panelBoards].filter((n) => customPanelNames.value.includes(n))
      : [...customPanelNames.value]
  })
  form.webSearch = !!a.webSearch
  form.orchestrator = !!a.orchestrator
}

/** 让 AI 按需求描述起草定义，成功后进入预览表单 */
async function draft() {
  if (!needDesc.value.trim() || drafting.value) return
  const mySeq = draftSeq
  drafting.value = true
  draftErr.value = ''
  try {
    const book = lib.current
    const bookContext = book ? `书名《${book.title}》，题材：${book.genre || '未设置'}，简介：${(book.idea || '').slice(0, 200)}` : ''
    const draft = (await window.api.customAgentsDraft(needDesc.value.trim(), bookContext)) as CustomAgent
    // 弹窗已关/已重开：这轮结果作废，不能悄悄改掉当前表单
    if (mySeq !== draftSeq || !modalOpen.value) return
    fillForm(draft)
    form.name = draft.name
    step.value = 2
  } catch (e) {
    if (mySeq === draftSeq && modalOpen.value) draftErr.value = (e as Error).message
  } finally {
    if (mySeq === draftSeq) drafting.value = false
  }
}

async function saveForm() {
  if (!form.name.trim() || !form.prompt.trim()) return
  const payload: CustomAgent = {
    id: editingId.value || `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: form.name.trim(),
    desc: form.desc.trim(),
    stage: form.stage.trim() || '自定义',
    prompt: form.prompt,
    welcome: form.welcome.map((w) => w.trim()).filter(Boolean),
    readScope: [...form.readScope],
    libsRead: [...form.libsRead],
    libsWrite: form.libsWrite && form.libsRead.length > 0,
    structBoards: [...form.structBoards],
    panelBoards: [...form.panelBoards],
    webSearch: form.webSearch,
    orchestrator: form.orchestrator,
    enabled: editingId.value ? customList.value.find((x) => x.id === editingId.value)?.enabled ?? false : false,
    createdAt: customList.value.find((x) => x.id === editingId.value)?.createdAt || new Date().toISOString()
  }
  const res = (await window.api.customAgentsSave(payload as unknown as Record<string, unknown>)) as { ok: boolean; message: string }
  if (res.ok) {
    modalOpen.value = false
    await refresh()
    await conv.refreshCustomAgents()
  }
}

async function toggleEnabled(a: CustomAgent) {
  await window.api.customAgentsSetEnabled(a.id, !a.enabled)
  a.enabled = !a.enabled
  await conv.refreshCustomAgents()
}

async function toggleBuiltinWeb(id: string) {
  const cur = app.config?.agentWebSearch?.[id] === true
  await app.updateConfig({ agentWebSearch: { ...(app.config?.agentWebSearch || {}), [id]: !cur } })
}

async function toggleBuiltinOrch(id: string) {
  const cur = app.config?.agentOrchestrator?.[id] === true
  await app.updateConfig({ agentOrchestrator: { ...(app.config?.agentOrchestrator || {}), [id]: !cur } })
}

async function removeCustom(a: CustomAgent) {
  const ok = await inkConfirm(`确定删除自定义智能体「${a.name}」？`, {
    detail: '删除后不可恢复；它在妙笔里的历史会话仍保留，但无法继续使用该智能体。',
    confirmText: '删除',
    danger: true
  })
  if (!ok) return
  await window.api.customAgentsDelete(a.id)
  // 当前正用着它：立即回退到通用助手，避免静默换人还不自知
  if (conv.agentId === a.id) conv.agentId = 'general'
  await refresh()
  await conv.refreshCustomAgents()
}

async function refresh() {
  loading.value = true
  try {
    customList.value = ((await window.api.customAgentsList()) as CustomAgent[]) || []
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

const enabledCount = computed(() => customList.value.filter((a) => a.enabled).length)
function scopeText(scope: string[]): string {
  return scope.length ? scope.join(' · ') : '全部稿件'
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-[1000px] mx-auto px-6 py-6">
      <!-- 顶部 -->
      <div class="flex items-end justify-between mb-6 rise-in">
        <div>
          <h1 class="font-serif-ink text-2xl mb-1">智能体库</h1>
          <p class="text-[12.5px] text-[var(--text-faint)]">
            描述你想要的智能体，AI 会替你创建；在这里决定它能碰哪些库、能不能上网，以及是否在妙笔启用
          </p>
        </div>
        <InkButton @click="openCreate"><Plus :size="14" /> AI 创建智能体</InkButton>
      </div>

      <!-- 自定义智能体 -->
      <div class="mb-8 rise-in" style="animation-delay: 60ms">
        <div class="flex items-center gap-2 mb-3">
          <Bot :size="14" :style="{ color: 'var(--accent)' }" />
          <span class="text-[13.5px] font-medium">自定义智能体</span>
          <span class="text-[11px] text-[var(--text-faint)]">{{ customList.length }} 个 · {{ enabledCount }} 个已启用</span>
        </div>
        <div v-if="!customList.length" class="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <p class="text-[13px] text-[var(--text-dim)] mb-1">还没有自定义智能体</p>
          <p class="text-[11.5px] text-[var(--text-faint)]">点右上角「AI 创建智能体」，用一句话描述职责就行——比如「帮我查服装、饮食、官职这些历史细节是否穿帮」</p>
        </div>
        <div v-else class="grid gap-3 sm:grid-cols-2">
          <div
            v-for="a in customList"
            :key="a.id"
            class="rounded-xl border bg-[var(--panel)] p-4"
            :class="a.enabled ? 'border-[var(--accent)]' : 'border-[var(--border)]'"
          >
            <div class="flex items-center gap-2 mb-1.5">
              <span class="text-[14px] font-medium">{{ a.name }}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full" :style="{ background: 'var(--panel-2)', color: 'var(--accent)' }">{{ a.stage }}</span>
              <span v-if="a.webSearch" class="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-faint)]"><Globe :size="10" /> 联网</span>
              <span v-if="a.orchestrator" class="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-faint)]"><Users :size="10" /> 分配</span>
              <span v-if="a.libsRead.length" class="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-faint)]"><LibraryBig :size="10" /> {{ a.libsRead.length }} 个库</span>
              <div class="flex-1" />
              <button class="tool-btn" title="编辑" @click="openEdit(a)"><Pencil :size="12" /></button>
              <button class="tool-btn hover:text-[#e08a7a]" title="删除" @click="removeCustom(a)"><Trash2 :size="12" /></button>
            </div>
            <div class="text-[12px] text-[var(--text-dim)] mb-2">{{ a.desc }}</div>
            <div class="text-[11px] text-[var(--text-faint)] mb-3">可读：{{ scopeText(a.readScope) }}{{ a.libsWrite ? ' · 可写入资源库' : '' }}</div>
            <div class="flex items-center justify-between">
              <span class="text-[11px]" :style="a.enabled ? { color: 'var(--accent)' } : { color: 'var(--text-faint)' }">
                {{ a.enabled ? '已在妙笔启用' : '未启用' }}
              </span>
              <button
                class="relative w-9 h-5 rounded-full transition-colors cursor-pointer"
                :style="{ background: a.enabled ? 'var(--accent)' : 'var(--border)' }"
                @click="toggleEnabled(a)"
              >
                <span
                  class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  :style="{ left: a.enabled ? '18px' : '2px' }"
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 内置智能体：联网开关 -->
      <div class="rise-in" style="animation-delay: 120ms">
        <div class="flex items-center gap-2 mb-3">
          <Sparkles :size="14" :style="{ color: 'var(--accent)' }" />
          <span class="text-[13.5px] font-medium">内置智能体</span>
          <span class="text-[11px] text-[var(--text-faint)]">点击卡片右下角可给它们安装联网搜索</span>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="a in AGENTS" :key="a.id" class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <div class="flex items-center gap-2 mb-1.5">
              <span class="text-[14px] font-medium">{{ a.name }}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-faint)]">{{ a.stage }}</span>
              <span
                v-if="a.panel"
                class="text-[10px] px-1.5 py-0.5 rounded-full"
                :style="{ background: 'var(--panel-2)', color: 'var(--accent)' }"
                title="通常由对应资料面板一键调用，妙笔选择列表里默认折叠"
              >资料区工具</span>
            </div>
            <div class="text-[12px] text-[var(--text-dim)] mb-2">{{ a.desc }}</div>
            <div class="text-[11px] text-[var(--text-faint)] mb-3">可读：{{ scopeText(a.readScope) }}</div>
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <button
                class="inline-flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
                :class="app.config?.agentWebSearch?.[a.id] ? 'bg-[var(--panel-2)]' : 'bg-[var(--bg-soft)] text-[var(--text-dim)] hover:text-[var(--text)]'"
                :style="app.config?.agentWebSearch?.[a.id] ? { color: 'var(--accent)' } : {}"
                :title="app.config?.agentWebSearch?.[a.id] ? '已安装联网搜索，点击移除' : '安装联网搜索'"
                @click="toggleBuiltinWeb(a.id)"
              >
                <Globe :size="12" />
                {{ app.config?.agentWebSearch?.[a.id] ? '已装联网搜索' : '安装联网搜索' }}
              </button>
              <button
                class="inline-flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
                :class="app.config?.agentOrchestrator?.[a.id] ? 'bg-[var(--panel-2)]' : 'bg-[var(--bg-soft)] text-[var(--text-dim)] hover:text-[var(--text)]'"
                :style="app.config?.agentOrchestrator?.[a.id] ? { color: 'var(--accent)' } : {}"
                :title="app.config?.agentOrchestrator?.[a.id] ? '分配模式已开启，点击关闭' : '开启分配模式：它可在妙笔里把工作分配给其他智能体，每次分配需你确认'"
                @click="toggleBuiltinOrch(a.id)"
              >
                <Users :size="12" />
                {{ app.config?.agentOrchestrator?.[a.id] ? '已开分配模式' : '开启分配模式' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建 / 编辑弹层 -->
    <InkModal :open="modalOpen" :title="editingId ? '编辑自定义智能体' : 'AI 创建智能体'" wide @close="closeModal">
      <!-- 第一步：需求描述 -->
      <div v-if="step === 1" class="space-y-3">
        <p class="text-[12.5px] text-[var(--text-dim)]">
          描述这个智能体要做什么、擅长什么、什么时候用得上。AI 会生成完整的职责、提示词与权限建议，之后你可以逐项修改。
        </p>
        <textarea
          v-model="needDesc"
          class="ink-textarea h-28"
          placeholder="例如：帮我考据古代背景的细节——服饰、饮食、官职、礼仪这些，我写到哪它查到哪，发现穿帮就指出来并给替换建议"
        />
        <p v-if="draftErr" class="text-[12.5px] text-[#e08a7a]">{{ draftErr }}</p>
        <p v-if="drafting" class="ink-dots text-[12px]" style="color: var(--accent)">
          正在起草，模型响应通常需要 10~40 秒，请保持窗口打开
        </p>
        <div class="flex items-center gap-2 justify-end">
          <InkButton variant="ghost" :disabled="drafting" @click="step = 2">跳过，手写定义</InkButton>
          <InkButton :disabled="drafting || !needDesc.trim()" @click="draft">
            <LoaderCircle v-if="drafting" :size="14" class="animate-spin" />
            <Sparkles v-else :size="14" />
            {{ drafting ? '起草中…' : '让 AI 起草' }}
          </InkButton>
        </div>
      </div>

      <!-- 第二步：预览 / 编辑表单 -->
      <div v-else class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <label class="text-[12px] text-[var(--text-dim)] block">
            名称
            <input v-model="form.name" class="ink-input mt-1" placeholder="智能体名" />
          </label>
          <label class="text-[12px] text-[var(--text-dim)] block">
            分类标签
            <input v-model="form.stage" class="ink-input mt-1" placeholder="如：考据 / 文风" />
          </label>
        </div>
        <label class="text-[12px] text-[var(--text-dim)] block">
          一句话职责
          <input v-model="form.desc" class="ink-input mt-1" placeholder="显示在妙笔选择列表里" />
        </label>

        <div>
          <div class="text-[12px] text-[var(--text-dim)] mb-1.5">可读写目录（越少越聚焦）</div>
          <div class="flex gap-2 flex-wrap">
            <button
              v-for="s in SCOPE_ITEMS"
              :key="s"
              class="text-[12px] px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
              :class="form.readScope.includes(s) ? 'bg-[var(--panel-2)]' : 'bg-[var(--bg-soft)] text-[var(--text-dim)]'"
              :style="form.readScope.includes(s) ? { color: 'var(--accent)' } : {}"
              @click="form.readScope.includes(s) ? form.readScope.splice(form.readScope.indexOf(s), 1) : form.readScope.push(s)"
            >
              {{ s }}
            </button>
            <span class="text-[11px] text-[var(--text-faint)] self-center">不选 = 可访问全部稿件</span>
          </div>
        </div>

        <div>
          <div class="text-[12px] text-[var(--text-dim)] mb-1.5">资源库权限（能引用哪些库的内容）</div>
          <div class="flex gap-2 flex-wrap items-center">
            <button
              v-for="l in LIB_ITEMS"
              :key="l.key"
              class="text-[12px] px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
              :class="form.libsRead.includes(l.key) ? 'bg-[var(--panel-2)]' : 'bg-[var(--bg-soft)] text-[var(--text-dim)]'"
              :style="form.libsRead.includes(l.key) ? { color: 'var(--accent)' } : {}"
              @click="form.libsRead.includes(l.key) ? form.libsRead.splice(form.libsRead.indexOf(l.key), 1) : form.libsRead.push(l.key)"
            >
              {{ l.label }}
            </button>
            <span class="w-px h-4 bg-[var(--border)] mx-1" />
            <InkToggle v-model="form.libsWrite" label="允许写入资源库" />
          </div>
        </div>

        <div>
          <div class="text-[12px] text-[var(--text-dim)] mb-1.5">结构化板块（时间线 / 词典 / 伏笔 / 境界等，允许读写）</div>
          <div class="flex gap-2 flex-wrap">
            <button
              v-for="sb in STRUCT_ITEMS"
              :key="sb.key"
              class="text-[12px] px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
              :class="form.structBoards.includes(sb.key) ? 'bg-[var(--panel-2)]' : 'bg-[var(--bg-soft)] text-[var(--text-dim)]'"
              :style="form.structBoards.includes(sb.key) ? { color: 'var(--accent)' } : {}"
              @click="form.structBoards.includes(sb.key) ? form.structBoards.splice(form.structBoards.indexOf(sb.key), 1) : form.structBoards.push(sb.key)"
            >
              {{ sb.label }}
            </button>
            <span class="text-[11px] text-[var(--text-faint)] self-center">不选的板块 AI 看不见也改不了（写操作仍走提案审阅）</span>
          </div>
          <template v-if="customPanelNames.length">
            <div class="text-[12px] text-[var(--text-dim)] mt-2.5 mb-1.5">自定义面板（本书自建，允许读写）</div>
            <div class="flex gap-2 flex-wrap">
              <button
                v-for="n in customPanelNames"
                :key="n"
                class="text-[12px] px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
                :class="form.panelBoards.includes(n) ? 'bg-[var(--panel-2)]' : 'bg-[var(--bg-soft)] text-[var(--text-dim)]'"
                :style="form.panelBoards.includes(n) ? { color: 'var(--accent)' } : {}"
                @click="togglePanelBoard(n)"
              >
                {{ n }}
              </button>
              <span class="text-[11px] text-[var(--text-faint)] self-center">不选的面板该智能体无法读写（通过 read_panel / write_panel 访问）</span>
            </div>
          </template>
        </div>

        <InkToggle v-model="form.webSearch" label="安装联网搜索（查现实资料 / 考据 / 市场）" />
        <div class="space-y-1">
          <InkToggle v-model="form.orchestrator" label="分配模式（可把工作分配给其他智能体执行）" />
          <p class="text-[10.5px] text-[var(--text-faint)] leading-4">开启后它在妙笔里可作为主智能体指挥团队，每次分配都会先征求你同意。</p>
        </div>

        <div>
          <div class="text-[12px] text-[var(--text-dim)] mb-1.5">欢迎语建议（最多 4 条，留空忽略）</div>
          <div class="grid grid-cols-2 gap-2">
            <input v-for="(_, i) in form.welcome" :key="i" v-model="form.welcome[i]" class="ink-input h-8 py-0 text-[12.5px]" placeholder="建议提问" />
          </div>
        </div>

        <label class="text-[12px] text-[var(--text-dim)] block">
          系统提示词（职责 / 工作方法 / 输出风格）
          <textarea v-model="form.prompt" class="ink-textarea mt-1 h-52 font-mono text-[12.5px]" />
        </label>

        <div class="flex items-center gap-2 justify-end">
          <InkButton v-if="!editingId" variant="ghost" @click="step = 1">返回修改需求</InkButton>
          <InkButton :disabled="!form.name.trim() || !form.prompt.trim()" @click="saveForm">保存入库</InkButton>
        </div>
      </div>
    </InkModal>
  </div>
</template>
