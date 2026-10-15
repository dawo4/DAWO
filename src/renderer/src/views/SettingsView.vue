<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useAppStore } from '../store/app'
import { bgDataUrl } from '../store/app'
import InkButton from '../ui/InkButton.vue'
import InkSelect from '../ui/InkSelect.vue'
import InkToggle from '../ui/InkToggle.vue'
import InkSegmented from '../ui/InkSegmented.vue'
import { onHeaderAction } from '../ui/headerActions'
import { inkPrompt, inkConfirm } from '../ui/inkPrompt'
import { renderMarkdown } from '../ui/markdown'
import { aiRun } from '../ai'
import { useLibraryStore } from '../store/library'
import { CREATIVE_LEVELS, THINKING_LEVELS, levelToTemp, tempToLevel } from '../ui/writingScale'
import { Plus, Trash2, FolderOpen, RefreshCw, Search, Palette, Database, Bot, FileText, History, HardDrive, ArchiveRestore, CloudUpload, ShieldCheck, LoaderCircle, CircleCheck, CircleX, ImagePlus, Globe, Eye, Brain, Github } from 'lucide-vue-next'
import dawoLogo from '../assets/dawo-logo.png'

const logoUrl = dawoLogo
const appVersion = __APP_VERSION__

const app = useAppStore()
const lib = useLibraryStore()

// ============ 分组导航 ============
const GROUPS = [
  {
    label: '常规',
    items: [
      { key: 'appearance', label: '外观' },
      { key: 'data', label: '数据' },
      { key: 'sensitive', label: '敏感词库' },
      { key: 'about', label: '关于' }
    ]
  },
  {
    label: 'AI 设置',
    items: [
      { key: 'ai', label: 'AI 服务' },
      { key: 'memory', label: '记忆' },
      { key: 'prompts', label: '提示词' },
      { key: 'ailog', label: 'AI 调用记录' }
    ]
  },
  {
    label: '存储',
    items: [{ key: 'backup', label: '保存与备份' }]
  }
]
const tab = computed<string>({
  get: () => app.settingsTab || 'ai',
  set: (v: string) => (app.settingsTab = v)
})

// ============ 自动更新（GitHub Releases 源） ============
const upd = reactive({
  state: 'idle' as 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'downloaded' | 'error',
  version: '',
  percent: 0,
  /** 下载明细：已下载 / 总量（字节）与速度（字节/秒） */
  transferred: 0,
  total: 0,
  bps: 0,
  /** 出错前最后一步动作（download = 下载中断，可一键重试下载） */
  lastAction: '' as '' | 'download',
  message: ''
})
let offStatus: (() => void) | null = null
onMounted(() => {
  offStatus = window.api.onUpdateStatus((s) => {
    if (s.status === 'checking') upd.state = 'checking'
    else if (s.status === 'available') { upd.state = 'available'; upd.version = s.version || ''; void fetchNotes() }
    else if (s.status === 'none') { upd.state = 'none'; upd.version = s.version || '' }
    else if (s.status === 'downloading') {
      upd.state = 'downloading'
      upd.percent = s.percent || 0
      upd.transferred = s.transferred || 0
      upd.total = s.total || 0
      upd.bps = s.bps || 0
    }
    else if (s.status === 'downloaded') { upd.state = 'downloaded'; upd.version = s.version || '' }
    else if (s.status === 'error') { upd.state = 'error'; upd.message = s.message || '未知错误' }
  })
})
onUnmounted(() => offStatus?.())
async function checkUpdate() {
  upd.state = 'checking'
  upd.message = ''
  // 35 秒看门狗：主进程 30 秒超时兜底之外的最后一道保险，任何原因收不到结果都不许永远转圈
  let done = false
  const watchdog = setTimeout(() => {
    if (!done && upd.state === 'checking') {
      upd.state = 'error'
      upd.message = '检查超时：连不上 GitHub（网络原因，可尝试开代理后重试），或到 Releases 页手动下载。'
    }
  }, 35000)
  try {
    const r = await window.api.updateCheck()
    if (!r.ok) {
      upd.state = 'error'
      upd.message = r.message || '检查失败'
    }
    // 成功路径由 update:status 事件驱动（available / none）
  } catch (e) {
    upd.state = 'error'
    upd.message = (e as Error).message || '检查失败'
  } finally {
    done = true
    clearTimeout(watchdog)
  }
}
function doDownload() {
  upd.lastAction = 'download'
  void window.api.updateDownload()
}
function doInstall() {
  void window.api.updateInstall()
}
function openReleasePage() {
  void window.api.updateOpenPage()
}

// ============ 更新日志：拉最新 Release 的 Markdown 说明、日期与安装包体积 ============
const updNotes = ref('')
const updNotesHtml = computed(() => renderMarkdown(updNotes.value))
const updMeta = ref<{ tag: string; date: string; sizeBytes: number } | null>(null)
const updNotesErr = ref('')
const updNotesBusy = ref(false)

async function fetchNotes() {
  updNotesBusy.value = true
  updNotesErr.value = ''
  try {
    const r = (await window.api.updateNotes()) as { ok: boolean; tag: string; notes: string; publishedAt: string; sizeBytes: number; message?: string }
    if (r.ok) {
      updNotes.value = r.notes || ''
      updMeta.value = { tag: r.tag, date: r.publishedAt, sizeBytes: r.sizeBytes }
      if (!r.notes) updNotesErr.value = '该 Release 没有写更新说明，可到 Releases 页查看。'
    } else {
      updNotesErr.value = r.message || '拉取更新日志失败'
    }
  } catch (e) {
    updNotesErr.value = (e as Error).message
  } finally {
    updNotesBusy.value = false
  }
}

// fmtBytes 复用下方「AI 调用记录」区的同名函数（B/KB/MB 三档）

// ============ 作者记忆（全局跨书 + 本书单书，条目式） ============
interface MemoryEntry {
  id: string
  text: string
  category: string
  createdAt: string
}
const memGEntries = ref<MemoryEntry[]>([])
const memBEntries = ref<MemoryEntry[]>([])
const newGText = ref('')
const newGCat = ref('')
const newBText = ref('')
const newBCat = ref('')
const memTip = ref('')
const memBusy = ref(false)
let memSeq = 0

async function loadMemory() {
  try {
    memGEntries.value = ((await window.api.memoryReadGlobal()) as MemoryEntry[]) || []
    memBEntries.value = lib.current ? ((await window.api.memoryReadBook(lib.current.title)) as MemoryEntry[]) || [] : []
  } catch {
    /* 首次为空 */
  }
}

watch(tab, (t) => {
  if (t === 'memory') void loadMemory()
})

function persistMemory(scope: 'global' | 'book') {
  const plain = JSON.parse(JSON.stringify(scope === 'global' ? memGEntries.value : memBEntries.value))
  if (scope === 'global') void window.api.memoryWriteGlobal(plain)
  else if (lib.current) void window.api.memoryWriteBook(lib.current.title, plain)
}

function addMemoryEntry(scope: 'global' | 'book') {
  const text = (scope === 'global' ? newGText.value : newBText.value).trim()
  if (!text) return
  const list = scope === 'global' ? memGEntries.value : memBEntries.value
  if (list.some((e) => e.text === text)) {
    memTip.value = '这条记忆已存在'
    setTimeout(() => (memTip.value = ''), 3000)
    return
  }
  list.unshift({ id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, text, category: (scope === 'global' ? newGCat.value : newBCat.value).trim(), createdAt: new Date().toISOString() })
  if (scope === 'global') {
    newGText.value = ''
    newGCat.value = ''
  } else {
    newBText.value = ''
    newBCat.value = ''
  }
  persistMemory(scope)
}

function removeMemoryEntry(scope: 'global' | 'book', id: string) {
  if (scope === 'global') memGEntries.value = memGEntries.value.filter((e) => e.id !== id)
  else memBEntries.value = memBEntries.value.filter((e) => e.id !== id)
  persistMemory(scope)
}

/** AI 整理：去重 / 合并 / 旧决策覆盖，直接保存（整理由作者主动触发） */
async function organizeMemory(scope: 'global' | 'book') {
  const list = scope === 'global' ? memGEntries.value : memBEntries.value
  if (!list.length || memBusy.value) return
  memBusy.value = true
  memTip.value = ''
  const my = ++memSeq
  try {
    const content = JSON.stringify(list.map(({ text, category }) => ({ text, category })), null, 2)
    const out = await (
      await aiRun('workflow', 'memory-organize', {
        content,
        scope: scope === 'global' ? '全局记忆（跨书通用）' : `本书记忆（《${lib.current?.title || ''}》）`
      })
    ).promise
    if (my !== memSeq) return
    const m = out.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('AI 未返回结构化结果')
    const parsed = JSON.parse(m[0]) as { entries?: { text: string; category?: string }[] }
    const entries = (parsed.entries || [])
      .filter((e) => e.text?.trim())
      .map((e) => ({ id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${Math.random().toString(36).slice(2, 5)}`, text: String(e.text).slice(0, 500), category: String(e.category || '').slice(0, 20), createdAt: new Date().toISOString() }))
    if (scope === 'global') memGEntries.value = entries
    else memBEntries.value = entries
    persistMemory(scope)
    memTip.value = `整理完成并已保存（${list.length} 条 → ${entries.length} 条）`
  } catch (e) {
    if (my === memSeq) memTip.value = `整理失败：${(e as Error).message}`
  } finally {
    if (my === memSeq) memBusy.value = false
  }
}

function openMemFile(scope: 'global' | 'book') {
  void window.api.memoryOpen(scope, lib.current?.title)
}

// ============ AI 服务 ============
const PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1' },
  { name: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { name: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1' },
  { name: 'MiMo 订阅版', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { name: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1' }
]

const TASK_LABELS: Record<string, string> = {
  draft: '灵感与取名',
  structure: '建书大纲与设定',
  chapter: '逐章正文',
  workflow: '拆书 / 资料登记',
  continue: '智能续写',
  polish: '润色 / 扩写 / 纠错',
  deai: '去 AI 味',
  selection: '划词自定义',
  agent: '智能体对话'
}

/** 向量化通道单独放在「向量化检索」标签页配置；清理服务商引用时要一并处理 */
const EMBEDDING_KEY = 'embedding'

// ============ AI 服务页内部标签页：分门别类，避免一页竖排到底 ============
const AI_TABS = [
  { key: 'providers', label: '服务商' },
  { key: 'tasks', label: '任务模型' },
  { key: 'vector', label: '向量化检索' },
  { key: 'search', label: '联网搜索' },
  { key: 'behavior', label: '智能体行为' }
]
const AI_TAB_KEY = 'inkdesk.settings.aiTab'
const aiTab = ref(localStorage.getItem(AI_TAB_KEY) || 'providers')
watch(aiTab, (v) => {
  try {
    localStorage.setItem(AI_TAB_KEY, v)
  } catch {
    /* 存储不可用忽略 */
  }
})

/** 任务配置完整性：任一必配任务没配服务商或模型 → 任务模型标签上挂提示点（向量化可选，不提醒） */
const tasksIncomplete = computed(
  () => Object.entries(cfg.tasks).some(([k, t]) => k !== EMBEDDING_KEY && (!t.providerId || !t.model))
)

/** 某服务商被哪些任务使用（卡片上显示占用徽标；删除时提醒）。向量化已独立成 embeddingService，与服务商列表无关 */
function providerUsage(id: string): string[] {
  return Object.entries(TASK_LABELS)
    .filter(([k]) => cfg.tasks[k]?.providerId === id)
    .map(([, label]) => label)
}

/** 删除服务商：在用则确认，确认后清空引用它的任务配置（防残留死引用导致「尚未配置 AI 服务」） */
async function deleteProvider(id: string) {
  const usage = providerUsage(id)
  const p = cfg.providers.find((x) => x.id === id)
  if (usage.length) {
    const ok = await inkConfirm(`「${p?.name || id}」正被以下任务使用：${usage.join('、')}。删除后会一并清空这些任务的服务商配置，确定？`, {
      confirmText: '删除',
      danger: true
    })
    if (!ok) return
    for (const [k] of Object.entries(TASK_LABELS)) {
      if (cfg.tasks[k]?.providerId === id) {
        cfg.tasks[k].providerId = ''
        cfg.tasks[k].model = ''
      }
    }
  } else if (p?.name) {
    const ok = await inkConfirm(`删除服务商「${p.name}」？`, { confirmText: '删除', danger: true })
    if (!ok) return
  }
  cfg.providers = cfg.providers.filter((x: { id: string }) => x.id !== id)
}

/** 把某一行任务的服务商 + 模型一键应用到全部任务（配好一个就不用挨个选） */
function applyToAllTasks(key: string) {
  const src = cfg.tasks[key]
  for (const k of Object.keys(TASK_LABELS)) {
    cfg.tasks[k].providerId = src.providerId
    cfg.tasks[k].model = src.model
  }
}

// ============ 向量化检索标签页 ============
/** 相似度阈值选项（低→宽松召回多，高→严格只留强相关） */
const MIN_SCORE_OPTS = [
  { label: '宽松（0.20）· 结果多噪音也多', value: 0.2 },
  { label: '标准（0.30）· 推荐', value: 0.3 },
  { label: '适中（0.40）', value: 0.4 },
  { label: '严格（0.50）· 只留强相关', value: 0.5 }
]
const TOPK_OPTS = Array.from({ length: 10 }, (_, i) => ({ label: `${i + 1} 条`, value: i + 1 }))
const CHUNK_FULL_OPTS = [1500, 2000, 3000, 4000, 6000].map((n) => ({ label: `${n} 字`, value: n }))
const WIN_OPTS = [800, 1000, 1500, 2000, 3000].map((n) => ({ label: `${n} 字`, value: n }))

// 直接绑定全局配置对象（不再克隆快照）：设置页的编辑即时写入 store，
// save() 只负责持久化——旧快照方案会把其他页面的并发修改（activeBook 等）覆盖回去
const cfg = app.config as AppConfig
/** 更新检查设置（旧配置缺对象时现场补默认值） */
const updConf = (cfg.update ||= { autoCheck: true, frequency: 'startup' }) as NonNullable<AppConfig['update']>
const CHECK_FREQ_OPTS = [
  { label: '每次启动', value: 'startup' },
  { label: '每天最多一次', value: 'daily' },
  { label: '仅手动', value: 'manual' }
]
/** 向量化检索行为配置对象（嵌入服务独立在 embeddingService，不再绑服务商列表） */
const vo = (cfg.embeddingOpts ||= {
  includeLib: true,
  chunkFull: 3000,
  winSize: 1500,
  minScore: 0.3,
  injectBeat: true,
  topKBeat: 5,
  injectAgent: true,
  topKAgent: 4,
  injectSearch: true,
  topKSearch: 6
}) as NonNullable<AppConfig['embeddingOpts']>
/** 嵌入服务：独立的接口地址 / Key / 模型，与对话模型的服务商列表互不影响 */
const es = (cfg.embeddingService ||= { baseUrl: '', apiKey: '', model: '' }) as NonNullable<AppConfig['embeddingService']>

/** 嵌入服务预设：baseUrl + 该家当前主流向量化模型（2026-10 核对：Qwen3-Embedding 系列 / qwen3.7-text-embedding / embedding-3(-pro) / bge-m3） */
const EMBED_PRESETS = [
  {
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['BAAI/bge-m3', 'Qwen/Qwen3-Embedding-8B', 'Qwen/Qwen3-Embedding-4B', 'Qwen/Qwen3-Embedding-0.6B']
  },
  {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.7-text-embedding', 'text-embedding-v4']
  },
  {
    name: '智谱',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['embedding-3', 'embedding-3-pro']
  },
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['text-embedding-3-large', 'text-embedding-3-small']
  },
  {
    name: 'Ollama 本地',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['bge-m3', 'qwen3-embedding', 'nomic-embed-text']
  }
]
/** 当前接口地址匹配到的预设（有则显示「推荐模型」快捷 chips） */
const embPreset = computed(() => EMBED_PRESETS.find((p) => p.baseUrl === es.baseUrl))
/** 点预设：填地址；模型名为空时顺带带上该家第一个推荐模型（不覆盖已填的自定义模型） */
function pickEmbPreset(p: (typeof EMBED_PRESETS)[number]) {
  es.baseUrl = p.baseUrl
  if (!es.model.trim()) es.model = p.models[0]
}
const embModels = ref<string[]>([])
const embErr = ref('')
const embFetching = ref(false)
const embTesting = ref(false)
const embTest = ref<{ ok: boolean; latencyMs: number; dim: number; error: string } | null>(null)

/** 拉取嵌入服务的可用模型列表（/models），供模型名自动补全 */
async function fetchEmbModels() {
  embErr.value = ''
  if (!es.baseUrl.trim()) {
    embErr.value = '请先填写接口地址'
    return
  }
  embFetching.value = true
  try {
    const list = (await window.api.aiFetchModels({ id: '', name: '', baseUrl: es.baseUrl, apiKey: es.apiKey })) as { id: string }[]
    embModels.value = list.map((m) => m.id).filter(Boolean)
    if (!embModels.value.length) embErr.value = '该接口地址没有返回任何模型'
  } catch (e) {
    embErr.value = `获取模型失败：${(e as Error).message}`
  } finally {
    embFetching.value = false
  }
}

/** 端到端测试嵌入服务：发一条最小 /embeddings 请求，验证地址 / Key / 模型并显示向量维度 */
async function testEmb() {
  embErr.value = ''
  embTest.value = null
  embTesting.value = true
  try {
    embTest.value = await window.api.vectorTest(es.baseUrl, es.apiKey, es.model)
  } catch (e) {
    embTest.value = { ok: false, latencyMs: 0, dim: 0, error: (e as Error).message }
  } finally {
    embTesting.value = false
  }
}

/** 停用向量化：清空嵌入服务与旧版通道引用。旧版测试时配过的向量化会被自动迁移成独立配置，
 *  作者以为「没配置」实际在向旧地址发全书嵌入——此按钮一键归零，语义功能立即彻底静默 */
async function clearEmbedding() {
  const ok = await inkConfirm('停用后所有语义检索功能立即关闭（生文细纲注入 / 妙笔注入 / Ctrl+K 语义检索），索引文件保留，随时可重新配置。确定停用？', {
    confirmText: '停用'
  })
  if (!ok) return
  es.baseUrl = ''
  es.apiKey = ''
  es.model = ''
  if (cfg.tasks[EMBEDDING_KEY]) {
    cfg.tasks[EMBEDDING_KEY].providerId = ''
    cfg.tasks[EMBEDDING_KEY].model = ''
  }
  embTest.value = null
  embErr.value = ''
  embModels.value = []
  await save()
}
// 旧版本配置缺新字段时兜底补齐
if (cfg.modelContexts === undefined) cfg.modelContexts = {}
if (cfg.search === undefined) cfg.search = { provider: 'auto', apiKey: '' }
if (cfg.agentWebSearch === undefined) cfg.agentWebSearch = {}
if (cfg.providerSearch === undefined) cfg.providerSearch = {}
const providerModels = reactive<Record<string, string[]>>({})
const modelErr = ref('')
/** 获取模型：进行中的服务商 id 与成功提示（点了要有反馈，不能无声无息） */
const fetchingId = ref('')
const fetchTip = reactive<Record<string, string>>({})

/** 审批与创意档位的可选项（无边框分段选择器用） */
const APPROVAL_OPTIONS = [
  { value: 'manual', label: '我来审阅', hint: '智能体只给差异，你点接受才写入文稿' },
  { value: 'auto-approve', label: '替我审批', hint: '智能体的改动静默写入，适合快速迭代' }
]

const thinkingLevel = computed({
  get: () => cfg.agentParams.thinkingLevel,
  set: (v: string) => (cfg.agentParams.thinkingLevel = v as typeof cfg.agentParams.thinkingLevel)
})

const creativeLevel = computed({
  get: () => tempToLevel(cfg.agentParams.temperature),
  set: (v: string) => (cfg.agentParams.temperature = levelToTemp(v))
})

const themeValue = computed({
  get: () => cfg.appearance.theme,
  set: (v: string) => (cfg.appearance.theme = v as typeof cfg.appearance.theme)
})

const THEME_OPTIONS = [
  { value: 'dark', label: '暗夜书墨' },
  { value: 'ink-blue', label: '玄青夜砚' },
  { value: 'ink-green', label: '黛竹烟雨' },
  { value: 'ink-purple', label: '紫霞夜卷' },
  { value: 'light', label: '明亮纸白' },
  { value: 'sepia', label: '羊皮古卷' },
  { value: 'moon', label: '月白风清' },
  { value: 'celadon', label: '青瓷雨霁' }
]

const RADIUS_OPTIONS = [
  { value: 'sm', label: '紧凑' },
  { value: 'md', label: '标准' },
  { value: 'lg', label: '圆润' }
]

const FONT_SCALE_OPTIONS = [
  { value: 0.9, label: '小' },
  { value: 1, label: '标准' },
  { value: 1.1, label: '大' },
  { value: 1.2, label: '特大' }
]

const radiusValue = computed({
  get: () => cfg.appearance.radius || 'md',
  set: (v: string) => (cfg.appearance.radius = v as typeof cfg.appearance.radius)
})

const fontScaleValue = computed({
  get: () => cfg.appearance.fontScale || 1,
  set: (v: number) => (cfg.appearance.fontScale = v)
})

function addProvider(preset?: { name: string; baseUrl: string }) {
  cfg.providers.push({
    id: `p${Date.now()}`,
    name: preset?.name || '自定义服务',
    baseUrl: preset?.baseUrl || '',
    apiKey: ''
  })
}

async function fetchModels(id: string) {
  modelErr.value = ''
  const p = cfg.providers.find((x) => x.id === id)
  if (!p?.baseUrl) {
    fetchTip[id] = '请先填写接口地址'
    setTimeout(() => delete fetchTip[id], 3000)
    return
  }
  fetchingId.value = id
  try {
    const list = (await window.api.aiFetchModels({ ...p })) as { id: string; contextLength?: number }[]
    providerModels[id] = list.map((m) => m.id)
    // 自动回填拿得到的上下文窗口（手动填写优先，不覆盖已有值）
    let filled = 0
    for (const m of list) {
      if (m.contextLength) {
        const key = `${id}/${m.id}`
        if (!cfg.modelContexts[key]) {
          cfg.modelContexts[key] = m.contextLength
          filled++
        }
      }
    }
    fetchTip[id] = providerModels[id].length
      ? `已获取 ${providerModels[id].length} 个模型${filled ? `，${filled} 个自动识别了上下文窗口` : ''}，在下方任务分配中选用`
      : '接口未返回模型列表，可手动输入模型名'
  } catch (e) {
    modelErr.value = `获取模型列表失败：${(e as Error).message}`
    fetchTip[id] = ''
  } finally {
    fetchingId.value = ''
    if (fetchTip[id]) setTimeout(() => delete fetchTip[id], 5000)
  }
}

/** 测试连接：进行中的服务商 id 与最近一次测试结果（成功留延迟，失败留原因） */
const testingId = ref('')
const testResult = reactive<Record<string, { ok: boolean; latencyMs: number; model: string; error: string }>>({})

async function testProvider(id: string) {
  const p = cfg.providers.find((x) => x.id === id)
  if (!p?.baseUrl) {
    testResult[id] = { ok: false, latencyMs: 0, model: '', error: '请先填写接口地址' }
    return
  }
  // 测哪个模型：优先取任务分配里绑到该服务商的第一个模型，其次取已获取列表的第一个
  const bound = Object.values(cfg.tasks)
    .map((t) => (t.providerId === id ? t.model.trim() : ''))
    .filter(Boolean)[0]
  const model = bound || providerModels[id]?.[0] || ''
  testingId.value = id
  try {
    testResult[id] = (await window.api.aiTestProvider({ baseUrl: p.baseUrl, apiKey: p.apiKey }, model)) as {
      ok: boolean
      latencyMs: number
      model: string
      error: string
    }
  } catch (e) {
    testResult[id] = { ok: false, latencyMs: 0, model: '', error: (e as Error).message }
  } finally {
    testingId.value = ''
  }
}

/** 上下文窗口输入框的双向绑定（留空删除记录） */
function ctxFor(providerId: string, model: string): string {
  if (!model) return ''
  const v = cfg.modelContexts[`${providerId}/${model}`]
  return v ? String(v) : ''
}
function setCtx(providerId: string, model: string, v: string) {
  const key = `${providerId}/${model}`
  const n = Math.round(Number(v))
  if (v && Number.isFinite(n) && n > 0) cfg.modelContexts[key] = n
  else delete cfg.modelContexts[key]
}

// ============ 服务商自带联网搜索 ============
/** 各服务商的接口地址是否支持自带搜索（Kimi / 智谱 / MiMo / 通义） */
const searchSupported = reactive<Record<string, boolean>>({})

async function refreshSearchSupport() {
  for (const p of cfg.providers) {
    const base = (p.baseUrl || '').trim()
    if (!base) {
      delete searchSupported[p.id]
      continue
    }
    searchSupported[p.id] = await window.api.aiProviderSearchSupported(base)
  }
}

async function toggleProviderSearch(id: string) {
  const cur = cfg.providerSearch[id] === true
  if (cur) delete cfg.providerSearch[id]
  else cfg.providerSearch[id] = true
}

/** 切换服务商的图片理解开关并即时保存 */
async function toggleVision(p: { vision?: boolean }) {
  p.vision = !p.vision
  await save()
}

/** 已启用自带联网搜索的服务商（联网搜索块的 chips） */
const searchEnabledProviders = computed(() => cfg.providers.filter((p: { id: string }) => cfg.providerSearch[p.id] === true))

watch(() => cfg.providers.map((p: { baseUrl?: string }) => p.baseUrl).join('|'), () => void refreshSearchSupport(), { immediate: true })

const promptList = ref<string[]>([])
const promptActive = ref('')
const promptContent = ref('')
const promptSavedTip = ref(false)
const promptsDir = ref('')

async function loadPromptList() {
  promptList.value = await window.api.promptsList()
  promptsDir.value = await window.api.promptsDir()
  if (!promptActive.value && promptList.value.length) promptActive.value = promptList.value[0]
}
watch(promptActive, async (id) => {
  if (id) promptContent.value = await window.api.promptsGet(id)
})

async function savePrompt() {
  await window.api.promptsSave(promptActive.value, promptContent.value)
  promptSavedTip.value = true
  setTimeout(() => (promptSavedTip.value = false), 1500)
}

async function changeLibraryRoot() {
  const v = await inkPrompt('书架根目录（书籍将以文件夹形式存放）', cfg.libraryRoot)
  if (!v) return
  cfg.libraryRoot = v
  await save()
}

/** 选择背景图：主进程弹文件对话框并复制进应用数据目录，赋值后由 appearance 深度 watch 自动保存生效 */
async function pickBg() {
  const p = await window.api.bgPick()
  if (p) cfg.appearance.backgroundImage = p
}

/** 背景预览缩略图样式（data URL，dev 下 file:// 图片会被安全策略拦截） */
const bgPreview = ref('')
watch(
  () => cfg.appearance.backgroundImage,
  async (p) => {
    bgPreview.value = p ? await bgDataUrl(p) : ''
  },
  { immediate: true }
)
const bgPreviewStyle = computed(() => ({
  backgroundImage: bgPreview.value ? `url("${bgPreview.value}")` : 'none'
}))

async function save() {
  const patch = JSON.parse(JSON.stringify(cfg))
  // bindings 在「资源库 → 智能体默认引用」中维护，避免被本页旧快照覆盖
  patch.bindings = app.config?.bindings || {}
  await app.updateConfig(patch)
  await window.api.configUpdate({}) // 触发主进程初始化书架目录
  // 保存要有可见反馈：顶栏显示「设置已保存」，2.5 秒后消退
  app.setSaveState(false, '设置已保存')
  if (saveClearTimer) clearTimeout(saveClearTimer)
  saveClearTimer = setTimeout(() => app.setSaveState(false, ''), 2500)
}

let saveClearTimer: ReturnType<typeof setTimeout> | null = null
onUnmounted(() => {
  if (saveClearTimer) clearTimeout(saveClearTimer)
})

// 外观变更自动保存。cfg 直接绑定全局对象后，save→主进程返回→原地合并会替换 appearance 引用，
// 需用 JSON 签名判断「内容真的变了」才保存，否则保存本身会触发死循环
let appearanceSig = JSON.stringify(cfg.appearance)
watch(
  () => cfg.appearance,
  (v) => {
    const sig = JSON.stringify(v)
    if (sig === appearanceSig) return
    appearanceSig = sig
    void save()
  },
  { deep: true }
)

async function openLibrary() {
  await save()
  await window.api.openLibrary()
}

// ============ 敏感词库 ============
const sensitiveText = ref((cfg.sensitiveWords || []).join('\n'))
const sensitiveCount = computed(() =>
  sensitiveText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean).length
)

function saveSensitive() {
  cfg.sensitiveWords = sensitiveText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  void save()
}

// ============ AI 调用记录 ============
interface AiRecord {
  id: string
  at: string
  kind: 'text' | 'agent'
  feature: string
  featureLabel: string
  provider: string
  model: string
  ok: boolean
  status: 'success' | 'failed' | 'aborted'
  durationMs: number
  tokens: number
  error: string
}
const logStats = ref<{ total: number; success: number; failed: number; aborted: number; tokens: number; avgMs: number } | null>(null)
const logList = ref<AiRecord[]>([])
const logFeatures = ref<{ key: string; label: string }[]>([])
const logKind = ref<'all' | 'text' | 'agent'>('all')
const logStatus = ref<'all' | 'success' | 'failed' | 'aborted'>('all')
const logFeature = ref('all')
const logKeyword = ref('')
const logBusy = ref(false)

const LOG_STATUS_LABEL: Record<string, string> = { success: '成功', failed: '失败', aborted: '中止' }

function fmtTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19)
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function refreshLog() {
  logBusy.value = true
  try {
    const [stats, features, list] = await Promise.all([
      window.api.aiLogStats(),
      window.api.aiLogFeatures(),
      window.api.aiLogQuery({
        kind: logKind.value,
        status: logStatus.value,
        feature: logFeature.value === 'all' ? undefined : logFeature.value,
        keyword: logKeyword.value || undefined,
        limit: 200
      })
    ])
    logStats.value = stats
    logFeatures.value = features
    logList.value = list as AiRecord[]
  } finally {
    logBusy.value = false
  }
}

async function clearLog() {
  const v = await inkPrompt('确认清空全部 AI 调用记录？输入「清空」确认', '')
  if (v !== '清空') return
  await window.api.aiLogClear()
  await refreshLog()
}

watch([logKind, logStatus, logFeature], () => void refreshLog())

/** 设置页被 KeepAlive 缓存：切回页面时自动刷新调用记录，避免一直显示旧数据 */
onActivated(() => {
  if (tab.value === 'ailog') void refreshLog()
})

// ============ 保存与备份 ============
const backups = ref<{ book: string; dir: string; at: string; sizeBytes: number }[]>([])
const backupBusy = ref(false)
const backupTip = ref('')

async function refreshBackups() {
  backups.value = (await window.api.backupList()) || []
}

async function createBackupNow() {
  const book = app.config?.activeBook
  if (!book) {
    backupTip.value = '尚未打开作品，无法备份'
    setTimeout(() => (backupTip.value = ''), 2500)
    return
  }
  backupBusy.value = true
  try {
    await window.api.backupCreate(book)
    backupTip.value = `已备份「${book}」`
    await refreshBackups()
  } catch (e) {
    backupTip.value = `备份失败：${(e as Error).message}`
  } finally {
    backupBusy.value = false
    setTimeout(() => (backupTip.value = ''), 3000)
  }
}

async function restoreOne(dir: string, book: string) {
  const v = await inkPrompt(`用备份覆盖书架中的「${book}」？当前版本会先自动做一次恢复前快照。输入「恢复」确认`, '')
  if (v !== '恢复') return
  backupBusy.value = true
  try {
    await window.api.backupRestore(dir)
    backupTip.value = `已恢复「${book}」`
    await refreshBackups()
  } catch (e) {
    backupTip.value = `恢复失败：${(e as Error).message}`
  } finally {
    backupBusy.value = false
    setTimeout(() => (backupTip.value = ''), 3000)
  }
}

async function deleteOne(dir: string, book: string) {
  const v = await inkPrompt(`删除「${book}」的这份备份？输入「删除」确认`, '')
  if (v !== '删除') return
  await window.api.backupDelete(dir)
  await refreshBackups()
}

async function openBackupDir() {
  await window.api.backupOpen()
}

// 切到新页面时懒加载对应数据
watch(tab, (t) => {
  if (t === 'prompts') void loadPromptList()
  if (t === 'ailog') void refreshLog()
  if (t === 'backup') void refreshBackups()
})

let offHeader: (() => void) | null = null

onMounted(() => {
  offHeader = onHeaderAction((key) => {
    if (key === 'settings:save') void save()
  })
  if (tab.value === 'prompts') void loadPromptList()
})

onUnmounted(() => {
  offHeader?.()
  offHeader = null
})
</script>

<template>
  <div class="h-full flex">
    <!-- 左侧组内分组导航 -->
    <aside class="w-52 shrink-0 border-r border-[var(--border)] overflow-y-auto py-4 px-3 space-y-5">
      <div v-for="g in GROUPS" :key="g.label">
        <div class="text-[11px] text-[var(--text-faint)] tracking-widest mb-1.5 px-2">{{ g.label }}</div>
        <button
          v-for="item in g.items"
          :key="item.key"
          class="w-full text-left text-sm px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors flex items-center gap-2"
          :class="tab === item.key ? 'bg-[var(--hover)] text-[var(--accent)]' : 'text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--hover)]'"
          @click="tab = item.key"
        >
          <Palette v-if="item.key === 'appearance'" :size="14" />
          <Database v-else-if="item.key === 'data'" :size="14" />
          <ShieldCheck v-else-if="item.key === 'sensitive'" :size="14" />
          <Bot v-else-if="item.key === 'ai'" :size="14" />
          <Brain v-else-if="item.key === 'memory'" :size="14" />
          <FileText v-else-if="item.key === 'prompts'" :size="14" />
          <History v-else-if="item.key === 'ailog'" :size="14" />
          <HardDrive v-else-if="item.key === 'backup'" :size="14" />
          {{ item.label }}
        </button>
      </div>
    </aside>

    <div class="flex-1 min-w-0 overflow-y-auto">
      <div class="prose-ink" style="max-width: 860px">
        <!-- AI 服务 -->
        <div v-if="tab === 'ai'" class="space-y-6">
        <!-- 内部标签页：服务商 / 任务模型 / 联网搜索 / 智能体行为 -->
        <div class="inline-flex items-center gap-0.5 p-1 rounded-full bg-[var(--bg-soft)] sticky top-0 z-10">
          <button
            v-for="t in AI_TABS"
            :key="t.key"
            class="px-3.5 py-1.5 rounded-full text-[12.5px] cursor-pointer transition-colors relative"
            :class="aiTab === t.key ? 'bg-[var(--panel-2)] font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
            :style="aiTab === t.key ? { color: 'var(--accent)' } : {}"
            @click="aiTab = t.key"
          >
            {{ t.label }}
            <span
              v-if="t.key === 'tasks' && tasksIncomplete"
              class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
              style="background: #e0a87a"
              title="有任务还没配好服务商或模型"
            />
          </button>
        </div>

        <!-- 服务商 -->
        <div v-show="aiTab === 'providers'" class="space-y-4">
        <div>
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm text-[var(--text-dim)]">服务商（OpenAI 兼容接口，Key 仅保存在本机）</div>
            <div class="flex gap-1.5 flex-wrap justify-end">
              <button
                v-for="p in PRESETS"
                :key="p.name"
                class="text-xs px-2.5 py-1 rounded-full text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] cursor-pointer transition-colors"
                @click="addProvider(p)"
              >
                + {{ p.name }}
              </button>
              <button class="text-xs px-2.5 py-1 rounded-full text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] cursor-pointer transition-colors" @click="addProvider()">
                + 自定义
              </button>
            </div>
          </div>
          <div v-if="cfg.providers.length === 0" class="text-sm text-[var(--text-faint)] py-6 text-center rounded-lg border border-dashed border-[var(--border)]">
            尚未添加服务商，点击上方预设快速添加
          </div>
          <div v-for="p in cfg.providers" :key="p.id" class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 mb-3 space-y-2.5">
            <div class="flex gap-2">
              <input v-model="p.name" class="ink-input w-36" placeholder="名称" />
              <input v-model="p.baseUrl" class="ink-input flex-1" placeholder="接口地址，如 https://api.deepseek.com/v1" />
              <button class="text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer px-1" title="删除服务商" @click="deleteProvider(p.id)">
                <Trash2 :size="15" />
              </button>
            </div>
            <div v-if="providerUsage(p.id).length" class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[10.5px] text-[var(--text-faint)]">正在服务：</span>
              <span
                v-for="u in providerUsage(p.id)"
                :key="u"
                class="text-[10.5px] px-2 py-0.5 rounded-full"
                :style="{ background: 'var(--panel-2)', color: 'var(--accent)' }"
              >
                {{ u }}
              </span>
            </div>
            <div class="flex gap-2 items-center">
              <input v-model="p.apiKey" class="ink-input flex-1" type="password" placeholder="API Key（Ollama 等本地服务留空）" />
              <InkButton variant="ghost" :disabled="fetchingId === p.id" @click="fetchModels(p.id)">
                <LoaderCircle v-if="fetchingId === p.id" :size="13" class="animate-spin" />
                <RefreshCw v-else :size="13" :class="{ 'text-[var(--accent)]': providerModels[p.id]?.length }" />
                {{ fetchingId === p.id ? '获取中…' : providerModels[p.id]?.length ? `已获取 ${providerModels[p.id].length} 个` : '获取模型' }}
              </InkButton>
              <InkButton variant="ghost" :disabled="testingId === p.id" @click="testProvider(p.id)">
                <LoaderCircle v-if="testingId === p.id" :size="13" class="animate-spin" />
                {{ testingId === p.id ? '测试中…' : '测试连接' }}
              </InkButton>
            </div>
            <div v-if="testResult[p.id]" class="text-[11.5px] inline-flex items-center gap-1" :style="{ color: testResult[p.id].ok ? 'var(--accent)' : '#e08a7a' }">
              <CircleCheck v-if="testResult[p.id].ok" :size="12" />
              <CircleX v-else :size="12" />
              {{
                testResult[p.id].ok
                  ? `连接正常 · 延迟 ${testResult[p.id].latencyMs}ms${testResult[p.id].model ? ` · 模型 ${testResult[p.id].model}` : ''}`
                  : `连接失败：${testResult[p.id].error || (testResult[p.id].model ? '' : '没有可用模型——先「获取模型」或在任务分配里绑定')}`
              }}
            </div>
            <div v-if="fetchTip[p.id]" class="ok-pulse text-[11.5px] inline-flex items-center gap-1" style="color: var(--accent)">
              <CircleCheck :size="12" /> {{ fetchTip[p.id] }}
            </div>
            <!-- 多模态：图片理解开关 -->
            <div class="flex items-center gap-2">
              <button
                class="inline-flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
                :class="p.vision ? 'bg-[var(--panel-2)]' : 'bg-[var(--bg-soft)] text-[var(--text-dim)] hover:text-[var(--text)]'"
                :style="p.vision ? { color: 'var(--accent)' } : {}"
                :title="p.vision ? '已开启：聊天可附图给该服务商的模型（如 GPT-4o / Gemini / GLM-4V）' : '开启后聊天输入框可附图，仅多模态模型可用'"
                @click="toggleVision(p)"
              >
                <Eye :size="12" />
                {{ p.vision ? '已支持图片理解' : '不支持图片理解' }}
              </button>
              <span class="text-[10.5px] text-[var(--text-faint)]">多模态模型（能看图的）请开启；纯文本模型请保持关闭，否则附图会报错</span>
            </div>
            <!-- 服务商自带联网搜索（Kimi / 智谱 / MiMo / 通义支持） -->
            <div v-if="searchSupported[p.id]" class="flex items-center gap-2">
              <button
                class="inline-flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
                :class="cfg.providerSearch[p.id] ? 'bg-[var(--panel-2)]' : 'bg-[var(--bg-soft)] text-[var(--text-dim)] hover:text-[var(--text)]'"
                :style="cfg.providerSearch[p.id] ? { color: 'var(--accent)' } : {}"
                :title="cfg.providerSearch[p.id] ? '已启用：智能体对话时由服务商平台执行联网搜索，点击关闭' : '启用后智能体对话可使用该厂商平台侧的联网搜索（如 Kimi $web_search，按次计费）'"
                @click="toggleProviderSearch(p.id)"
              >
                <Globe :size="12" />
                {{ cfg.providerSearch[p.id] ? '已启用自带联网搜索' : '启用自带联网搜索' }}
              </button>
              <span class="text-[10.5px] text-[var(--text-faint)]">由厂商平台执行搜索，按厂商定价计费；MiMo 需先在其控制台开通联网服务插件</span>
            </div>
            <datalist :id="'models-' + p.id">
              <option v-for="m in providerModels[p.id] || []" :key="m" :value="m" />
            </datalist>
          </div>
          <div v-if="modelErr" class="text-sm text-[#e08a7a]">{{ modelErr }}</div>
        </div>
        </div>

        <!-- 任务模型 -->
        <div v-show="aiTab === 'tasks'" class="space-y-1">
          <div class="text-sm text-[var(--text-dim)] mb-1">任务模型分配（不同任务可用不同模型）</div>
          <div class="text-[11px] text-[var(--text-faint)] mb-3">「上下文窗口」填模型 token 上限，用于妙笔会话自动压缩；获取模型时能识别的会自动填。配好一行后可「应用到全部」。</div>
          <div v-for="(label, key) in TASK_LABELS" :key="key" class="flex items-center gap-2 mb-2.5">
            <span class="w-40 text-sm shrink-0">{{ label }}</span>
            <InkSelect
              v-model="cfg.tasks[key].providerId"
              class="w-40 shrink-0"
              :options="[{ label: '选择服务商', value: '' }, ...cfg.providers.map((p) => ({ label: p.name, value: p.id }))]"
            />
            <input
              v-model="cfg.tasks[key].model"
              class="ink-input flex-1"
              :list="'models-' + cfg.tasks[key].providerId"
              placeholder="模型名，如 deepseek-chat"
            />
            <input
              :value="ctxFor(cfg.tasks[key].providerId, cfg.tasks[key].model)"
              class="ink-input w-36 shrink-0"
              placeholder="上下文窗口，如 65536"
              title="模型上下文窗口（token 数）。点上方「获取模型」会自动识别填入；识别不到的可手动填。妙笔会话占用到窗口 80% 时自动压缩早期对话"
              @input="setCtx(cfg.tasks[key].providerId, cfg.tasks[key].model, ($event.target as HTMLInputElement).value)"
            />
            <button
              class="text-[11px] px-2 py-1 rounded-full text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] cursor-pointer transition-colors shrink-0"
              title="把这一行的服务商和模型应用到全部任务"
              @click="applyToAllTasks(String(key))"
            >
              应用到全部
            </button>
          </div>
        </div>

        <!-- 向量化检索 -->
        <div v-show="aiTab === 'vector'" class="space-y-1">
          <div class="text-sm text-[var(--text-dim)] mb-1">向量化检索（语义搜索）</div>
          <div class="text-[11px] text-[var(--text-faint)] leading-5 mb-3">
            给全书文稿与资源库建立本地向量索引，驱动三处语义能力：逐章生文构思细纲前自动检索相关前文、妙笔对话自动注入相关片段、
            Ctrl+K 语义混合检索。需要服务商支持 <b>/embeddings</b> 接口（如硅基流动 BAAI/bge-m3、智谱 embedding-3、通义 text-embedding-v4、OpenAI、Ollama 本地）。
            <span style="color: var(--accent)">未配置服务商与模型时以上功能自动降级，不影响其他功能。</span>
          </div>

          <!-- 嵌入服务（独立面板，与服务商列表互不影响） -->
          <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5 mb-4 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs text-[var(--text-dim)] tracking-wider">嵌入服务（独立于上方服务商列表，删除 / 修改对话模型服务商不影响这里）</div>
              <button
                v-if="es.baseUrl || es.model || cfg.tasks[EMBEDDING_KEY]?.providerId"
                class="text-[11px] px-2 py-0.5 rounded-full cursor-pointer border transition-colors shrink-0"
                style="border-color: #e08a7a66; color: #e08a7a"
                title="清空嵌入服务配置与旧版通道引用，所有语义检索立即停用（索引文件保留）"
                @click="clearEmbedding"
              >
                停用向量化
              </button>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-20 text-sm shrink-0">接口地址</span>
              <input v-model="es.baseUrl" class="ink-input flex-1" placeholder="https://api.siliconflow.cn/v1" />
            </div>
            <div class="flex flex-wrap items-center gap-1.5 pl-[88px] -mt-1">
              <button
                v-for="p in EMBED_PRESETS"
                :key="p.name"
                class="text-[11px] px-2 py-0.5 rounded-full cursor-pointer border border-[var(--border)] transition-colors"
                :class="es.baseUrl === p.baseUrl ? 'text-[var(--accent)]' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-[var(--hover)]'"
                :style="es.baseUrl === p.baseUrl ? { borderColor: 'var(--accent)' } : {}"
                :title="`填入 ${p.name} 接口地址${p.models.length ? '，推荐模型：' + p.models.join(' / ') : ''}`"
                @click="pickEmbPreset(p)"
              >
                {{ p.name }}
              </button>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-20 text-sm shrink-0">API Key</span>
              <input v-model="es.apiKey" class="ink-input flex-1" placeholder="sk-…（Ollama 本地可留空）" autocomplete="off" />
            </div>
            <div class="flex items-center gap-2">
              <span class="w-20 text-sm shrink-0">模型名</span>
              <input v-model="es.model" class="ink-input flex-1" :list="'emb-models'" placeholder="嵌入模型名，如 BAAI/bge-m3" />
              <datalist id="emb-models">
                <option v-for="m in embModels" :key="m" :value="m" />
              </datalist>
              <button
                class="text-[11.5px] px-2.5 py-1.5 rounded-lg cursor-pointer border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1"
                :disabled="embFetching"
                @click="fetchEmbModels"
              >
                <LoaderCircle v-if="embFetching" :size="12" class="animate-spin" /> 获取模型
              </button>
              <button
                class="text-[11.5px] px-2.5 py-1.5 rounded-lg cursor-pointer border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1"
                :disabled="embTesting"
                @click="testEmb"
              >
                <LoaderCircle v-if="embTesting" :size="12" class="animate-spin" /> 测试连接
              </button>
            </div>
            <div v-if="embPreset" class="flex flex-wrap items-center gap-1.5 pl-[88px] -mt-1">
              <span class="text-[11px] text-[var(--text-faint)] shrink-0">推荐模型</span>
              <button
                v-for="m in embPreset.models"
                :key="m"
                class="text-[11px] px-2 py-0.5 rounded-full cursor-pointer border transition-colors max-w-[240px] truncate"
                :class="es.model === m ? 'text-[var(--accent)]' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-[var(--hover)]'"
                :style="es.model === m ? { borderColor: 'var(--accent)' } : { borderColor: 'var(--border)' }"
                @click="es.model = m"
              >
                {{ m }}
              </button>
            </div>
            <div v-if="embErr" class="text-[11.5px]" style="color: #e08a7a">{{ embErr }}</div>
            <div v-else-if="embTest" class="text-[11.5px]" :style="{ color: embTest.ok ? 'var(--accent)' : '#e08a7a' }">
              {{ embTest.ok ? `连接成功 · ${embTest.latencyMs}ms · 向量维度 ${embTest.dim}` : `连接失败：${embTest.error}` }}
            </div>
            <div class="text-[11px] text-[var(--text-faint)] leading-5">
              嵌入模型只负责把文字转成向量，不能用来聊天，与对话模型互不通用；常用如硅基流动 BAAI/bge-m3、智谱 embedding-3、通义 text-embedding-v4。
              换模型后已有索引不兼容，需要到写作台「检索」面板重建。
            </div>
          </div>

          <!-- 索引范围与切块 -->
          <div class="text-xs text-[var(--text-dim)] tracking-wider mt-4 mb-2">索引范围与切块</div>
          <div class="space-y-2.5 mb-2">
            <div class="flex items-center gap-3">
              <InkToggle v-model="vo.includeLib" label="索引资源库" />
              <span class="text-[11px] text-[var(--text-faint)]">技能库 / 素材库 / 灵感便签也纳入语义检索；关闭后增量同步自动清掉已嵌的库块</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-40 text-sm shrink-0">整章一块上限</span>
              <InkSelect v-model="vo.chunkFull" class="w-40 shrink-0" :options="CHUNK_FULL_OPTS" />
              <span class="text-[11px] text-[var(--text-faint)]">不超过该字数的文件整篇作为一块，检索粒度最完整</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-40 text-sm shrink-0">滑窗大小</span>
              <InkSelect v-model="vo.winSize" class="w-40 shrink-0" :options="WIN_OPTS" />
              <span class="text-[11px] text-[var(--text-faint)]">超过整章上限的长文按此窗口切块（自动带 15% 重叠、贴齐段落边界）</span>
            </div>
          </div>

          <!-- 检索行为 -->
          <div class="text-xs text-[var(--text-dim)] tracking-wider mt-4 mb-2">检索行为</div>
          <div class="flex items-center gap-2 mb-2.5">
            <span class="w-40 text-sm shrink-0">相似度阈值</span>
            <InkSelect v-model="vo.minScore" class="w-40 shrink-0" :options="MIN_SCORE_OPTS" />
            <span class="text-[11px] text-[var(--text-faint)]">低于阈值的检索结果直接丢弃</span>
          </div>

          <!-- 三个注入点 -->
          <div class="text-xs text-[var(--text-dim)] tracking-wider mt-4 mb-2">三个注入点（可单独开关）</div>
          <div class="space-y-2.5">
            <div class="flex items-center gap-3">
              <InkToggle v-model="vo.injectBeat" label="逐章生文 · 细纲前注入" />
              <InkSelect v-model="vo.topKBeat" class="w-28 shrink-0" :options="TOPK_OPTS" :disabled="!vo.injectBeat" />
              <span class="text-[11px] text-[var(--text-faint)]">构思细纲前检索全书相关前文，跨章伏笔与设定更一致</span>
            </div>
            <div class="flex items-center gap-3">
              <InkToggle v-model="vo.injectAgent" label="妙笔对话 · 自动注入" />
              <InkSelect v-model="vo.topKAgent" class="w-28 shrink-0" :options="TOPK_OPTS" :disabled="!vo.injectAgent" />
              <span class="text-[11px] text-[var(--text-faint)]">按作者本轮的话检索，相关片段带来源进系统提示词</span>
            </div>
            <div class="flex items-center gap-3">
              <InkToggle v-model="vo.injectSearch" label="Ctrl+K · 语义混合检索" />
              <InkSelect v-model="vo.topKSearch" class="w-28 shrink-0" :options="TOPK_OPTS" :disabled="!vo.injectSearch" />
              <span class="text-[11px] text-[var(--text-faint)]">关键词命中之外补充语义相关结果（带「语义」徽标）</span>
            </div>
          </div>

          <div class="text-[11px] text-[var(--text-faint)] leading-5 mt-4">
            索引与维护入口在写作台右栏「检索」标签：状态一览、增量更新、重建（含 token 成本确认）。
            <span style="color: var(--accent)">配置好嵌入服务后，第一次使用语义功能会自动建立全书索引</span>（一次性嵌入成本，体量见「检索」面板的估算）；之后增删章节与资源库条目无需手动维护——每次检索自动增量同步。
            改动切块参数后需重建索引才对已有块生效。每次向量化调用都会记入「数据」页的 AI 成本统计。
          </div>
        </div>

        <!-- 联网搜索 -->
        <div v-show="aiTab === 'search'" class="space-y-1">
          <div class="text-sm text-[var(--text-dim)] mb-1">联网搜索</div>
          <div class="text-[11px] text-[var(--text-faint)] leading-5 mb-2">
            智能体有两种联网方式：<b>① 服务商自带搜索</b>——在各服务商卡片上启用，由厂商平台执行（Kimi / 智谱 / MiMo / 通义）；<b>② DAWO 自带搜索工具</b>——在智能体库给智能体安装，走下面的搜索源。
            <span style="color: var(--accent)">两种同时可用时优先用服务商自带搜索</span>，此时不会触发 DAWO 的搜索工具。
          </div>
          <div class="flex items-center gap-2 mb-3 flex-wrap">
            <span class="text-[11.5px] text-[var(--text-dim)]">已启用自带搜索：</span>
            <template v-if="searchEnabledProviders.length">
              <span
                v-for="p in searchEnabledProviders"
                :key="p.id"
                class="text-[11px] px-2 py-0.5 rounded-full cursor-pointer"
                :style="{ background: 'var(--panel-2)', color: 'var(--accent)' }"
                :title="`${p.name}：${p.baseUrl}（点此关闭）`"
                @click="toggleProviderSearch(p.id)"
              >
                {{ p.name }} ✕
              </span>
            </template>
            <span v-else class="text-[11px] text-[var(--text-faint)]">暂无——到上方服务商卡片启用</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="w-28 text-sm shrink-0 text-[var(--text-dim)]">搜索源</span>
            <InkSegmented
              v-model="cfg.search.provider"
              :options="[
                { value: 'auto', label: '免费源' },
                { value: 'bocha', label: '博查' },
                { value: 'tavily', label: 'Tavily' }
              ]"
            />
            <input
              v-if="cfg.search.provider !== 'auto'"
              v-model="cfg.search.apiKey"
              class="ink-input flex-1"
              :placeholder="cfg.search.provider === 'bocha' ? '博查 API Key（bochaai.com 申请）' : 'Tavily API Key（tavily.com 申请）'"
            />
            <span class="text-[10.5px] text-[var(--text-faint)] shrink-0">仅用于 DAWO 自带的 web_search 工具</span>
          </div>
        </div>

        <!-- 智能体行为 -->
        <div v-show="aiTab === 'behavior'" class="space-y-1">
          <div class="text-sm text-[var(--text-dim)] mb-4">智能体行为</div>

          <div class="flex items-center gap-3 mb-4">
            <span class="w-28 text-sm shrink-0 text-[var(--text-dim)]">修改怎么算数</span>
            <InkSegmented v-model="cfg.approvalMode" :options="APPROVAL_OPTIONS" />
          </div>

          <div class="flex items-center gap-3 mb-4">
            <span class="w-28 text-sm shrink-0 text-[var(--text-dim)]">思考程度</span>
            <InkSegmented v-model="thinkingLevel" :options="THINKING_LEVELS" />
          </div>

          <div class="flex items-center gap-3">
            <span class="w-28 text-sm shrink-0 text-[var(--text-dim)]">创意程度</span>
            <InkSegmented v-model="creativeLevel" :options="CREATIVE_LEVELS" />
          </div>

          <div class="mt-4 text-[11px] text-[var(--text-faint)] leading-5">
            技能与素材的默认引用可在「资源库 → 智能体默认引用」中按智能体分别配置。
          </div>
        </div>
      </div>

      <!-- 外观 -->
      <div v-if="tab === 'appearance'" class="space-y-5">
        <div>
          <div class="text-sm text-[var(--text-dim)] mb-2">主题（切换即时生效）</div>
          <div class="flex gap-2 flex-wrap">
            <button
              v-for="t in THEME_OPTIONS"
              :key="t.value"
              class="text-[12.5px] px-3.5 py-1.5 rounded-lg cursor-pointer transition-colors"
              :class="themeValue === t.value ? 'bg-[var(--panel-2)] font-medium' : 'bg-[var(--bg-soft)] text-[var(--text-dim)] hover:text-[var(--text)]'"
              :style="themeValue === t.value ? { color: 'var(--accent)' } : {}"
              @click="themeValue = t.value"
            >
              {{ themeValue === t.value ? '✓ ' : '' }}{{ t.label }}
            </button>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="w-28 text-sm shrink-0 text-[var(--text-dim)]">强调色</span>
          <input v-model="cfg.appearance.accent" type="color" class="w-10 h-8 rounded-lg bg-transparent cursor-pointer" />
          <span class="text-xs text-[var(--text-faint)]">{{ cfg.appearance.accent }}</span>
          <button
            class="text-[11px] text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer"
            title="恢复书墨金默认强调色"
            @click="cfg.appearance.accent = '#c9a15f'"
          >
            恢复默认
          </button>
        </div>
        <div class="flex items-center gap-3">
          <span class="w-28 text-sm shrink-0 text-[var(--text-dim)]">界面圆角</span>
          <InkSegmented v-model="radiusValue" :options="RADIUS_OPTIONS" />
        </div>
        <div class="flex items-center gap-3">
          <span class="w-28 text-sm shrink-0 text-[var(--text-dim)]">界面字号</span>
          <InkSegmented v-model="fontScaleValue" :options="FONT_SCALE_OPTIONS" />
        </div>
        <div class="flex items-center gap-3">
          <span class="w-28 text-sm shrink-0 text-[var(--text-dim)]">背景图片</span>
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <!-- 当前背景预览缩略图 -->
            <div
              v-if="cfg.appearance.backgroundImage"
              class="w-24 h-14 rounded-lg border border-[var(--border)] bg-cover bg-center shrink-0"
              :style="bgPreviewStyle"
              :title="cfg.appearance.backgroundImage"
            />
            <InkButton variant="ghost" @click="pickBg"><ImagePlus :size="14" /> 选择图片</InkButton>
            <InkButton v-if="cfg.appearance.backgroundImage" variant="ghost" @click="cfg.appearance.backgroundImage = ''">清除</InkButton>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="w-28 text-sm shrink-0 text-[var(--text-dim)]">背景浓度</span>
          <input v-model.number="cfg.appearance.bgOpacity" type="range" min="0.05" max="0.8" step="0.05" class="w-48 accent-[var(--accent)]" />
          <span class="w-10 text-xs tabular-nums text-[var(--text-faint)]">{{ Math.round(cfg.appearance.bgOpacity * 100) }}%</span>
        </div>
        <div class="flex items-center gap-6 pt-2 flex-wrap">
          <InkToggle v-model="cfg.appearance.glow" label="鼠标跟随光晕" />
          <InkToggle v-model="cfg.appearance.orbs" label="背景浮动球体" />
          <InkToggle v-model="cfg.appearance.particles" label="光标粒子（简约）" />
        </div>
        <div class="border-t border-[var(--border)] pt-4 mt-2">
          <div class="text-[11px] text-[var(--text-faint)] tracking-wider mb-3">交互动效</div>
          <div class="flex items-center gap-6 flex-wrap">
            <InkToggle v-model="cfg.appearance.press" label="按钮按压反馈" />
            <InkToggle v-model="cfg.appearance.pageFade" label="页面切换过渡" />
            <InkToggle v-model="cfg.appearance.cardRise" label="卡片入场动画" />
          </div>
          <p class="text-[11px] text-[var(--text-faint)] mt-2.5">
            按压反馈：所有按钮点下轻微下沉弹回；页面过渡：切换功能页时淡入上移；卡片入场：首页等页面元素错落浮现。
          </p>
        </div>
        <p class="text-xs text-[var(--text-faint)]">外观改动即时生效并自动保存</p>
      </div>

      <!-- 记忆 -->
      <div v-if="tab === 'memory'" class="space-y-5">
        <div class="text-[11.5px] text-[var(--text-faint)] leading-5">
          记忆分两层：<b>全局记忆</b>跨书生效（写作偏好 / 常用套路 / 个人禁区），<b>书籍记忆</b>只对当前书生效（剧情决策 / 口述要求）。
          每条记忆独立编辑互不影响；内容自动注入所有智能体的对话，智能体也会通过 read_memory / write_memory 单条读写（书籍记忆写入需你审阅）。
        </div>

        <!-- 全局记忆 -->
        <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-3">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="text-sm text-[var(--text-dim)]">全局记忆（跨书通用） · {{ memGEntries.length }} 条</div>
            <button class="text-[11px] text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer" @click="openMemFile('global')">打开文件</button>
          </div>
          <div class="flex gap-2">
            <input v-model="newGText" class="ink-input flex-1" placeholder="一句话记忆，如：喜欢「先扬后抑」的开局节奏" @keydown.enter="addMemoryEntry('global')" />
            <input v-model="newGCat" class="ink-input w-24 shrink-0" placeholder="分类，可选" @keydown.enter="addMemoryEntry('global')" />
            <InkButton :disabled="!newGText.trim()" @click="addMemoryEntry('global')">添加</InkButton>
          </div>
          <div v-for="e in memGEntries" :key="e.id" class="flex gap-2 items-center group">
            <input v-model="e.category" class="ink-input w-20 shrink-0 text-[12px]" placeholder="分类" @change="persistMemory('global')" />
            <input v-model="e.text" class="ink-input flex-1 text-[13px]" @change="persistMemory('global')" />
            <button class="text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" title="删除此条" @click="removeMemoryEntry('global', e.id)">
              <Trash2 :size="13" />
            </button>
          </div>
          <div v-if="!memGEntries.length" class="text-[12px] text-[var(--text-faint)] py-4 text-center rounded-lg border border-dashed border-[var(--border)]">
            还没有全局记忆——上方输入框添加第一条，或在对话里对智能体说「记住……」
          </div>
          <InkButton variant="ghost" :disabled="memBusy || memGEntries.length < 3" @click="organizeMemory('global')">
            {{ memBusy ? '整理中…' : 'AI 整理（去重合并）' }}
          </InkButton>
        </div>

        <!-- 书籍记忆 -->
        <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-3">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="text-sm text-[var(--text-dim)]">书籍记忆{{ lib.current ? `（《${lib.current.title}》）` : '' }} · {{ memBEntries.length }} 条</div>
            <button v-if="lib.current && memBEntries.length" class="text-[11px] text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer" @click="openMemFile('book')">打开文件</button>
          </div>
          <template v-if="lib.current">
            <div class="flex gap-2">
              <input v-model="newBText" class="ink-input flex-1" placeholder="一句话记忆，如：女主绝对不能死" @keydown.enter="addMemoryEntry('book')" />
              <input v-model="newBCat" class="ink-input w-24 shrink-0" placeholder="分类，可选" @keydown.enter="addMemoryEntry('book')" />
              <InkButton :disabled="!newBText.trim()" @click="addMemoryEntry('book')">添加</InkButton>
            </div>
            <div v-for="e in memBEntries" :key="e.id" class="flex gap-2 items-center group">
              <input v-model="e.category" class="ink-input w-20 shrink-0 text-[12px]" placeholder="分类" @change="persistMemory('book')" />
              <input v-model="e.text" class="ink-input flex-1 text-[13px]" @change="persistMemory('book')" />
              <button class="text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" title="删除此条" @click="removeMemoryEntry('book', e.id)">
                <Trash2 :size="13" />
              </button>
            </div>
            <div v-if="!memBEntries.length" class="text-[12px] text-[var(--text-faint)] py-4 text-center rounded-lg border border-dashed border-[var(--border)]">
              还没有本书记忆——在对话里对智能体说「记住……」，或上方手动添加
            </div>
            <InkButton variant="ghost" :disabled="memBusy || memBEntries.length < 3" @click="organizeMemory('book')">
              {{ memBusy ? '整理中…' : 'AI 整理（去重合并）' }}
            </InkButton>
          </template>
          <div v-else class="text-[12px] text-[var(--text-faint)] py-4 text-center rounded-lg border border-dashed border-[var(--border)]">
            先到书架打开一部作品，书籍记忆才会显示
          </div>
        </div>

        <div v-if="memTip" class="text-[12.5px]" style="color: var(--accent)">{{ memTip }}</div>
      </div>

      <!-- 提示词 -->
      <div v-if="tab === 'prompts'" class="space-y-4">
        <div class="flex gap-2 items-center">
          <InkSelect v-model="promptActive" class="w-64" :options="promptList.map((id) => ({ label: id, value: id }))" />
          <InkButton @click="savePrompt">保存修改</InkButton>
          <span v-if="promptSavedTip" class="text-sm" style="color: var(--accent)">已保存</span>
        </div>
        <textarea v-model="promptContent" class="ink-textarea h-[440px] font-mono text-[13px]" />
        <p class="text-xs text-[var(--text-faint)]">提示词存放于本机：<span class="select-text">{{ promptsDir }}</span> ，使用 <code>{{ '\{\{变量\}\}' }}</code> 占位</p>
      </div>

      <!-- 数据 -->
      <div v-if="tab === 'data'" class="space-y-4">
        <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-2">
          <div class="text-sm text-[var(--text-dim)]">书架根目录</div>
          <div class="text-sm select-text">{{ cfg.libraryRoot }}</div>
          <div class="text-xs text-[var(--text-faint)]">每本书是一个文件夹，正文与资料均为 UTF-8 Markdown，可用 Git 或任意编辑器管理</div>
        </div>
        <div class="flex gap-2">
          <InkButton variant="ghost" @click="changeLibraryRoot">修改书架目录</InkButton>
          <InkButton variant="ghost" @click="openLibrary"><FolderOpen :size="14" /> 在资源管理器中打开</InkButton>
        </div>
      </div>

      <!-- 敏感词库 -->
      <div v-if="tab === 'sensitive'" class="space-y-4">
        <div class="text-sm text-[var(--text-dim)]">写作规避词（每行一个，共 {{ sensitiveCount }} 个）</div>
        <textarea
          v-model="sensitiveText"
          class="ink-textarea h-[360px] font-mono text-[13px]"
          placeholder="每行一个词语，例如：&#10;突然&#10;瞬间&#10;仿佛"
          @change="saveSensitive"
        />
        <p class="text-xs text-[var(--text-faint)]">
          这些词会被注入所有 AI 产出任务的提示词：正文、续写、润色、去 AI 味以及智能体修改都会规避它们。留空表示不启用。
        </p>
      </div>

      <!-- AI 调用记录 -->
      <div v-if="tab === 'ailog'" class="space-y-5">
        <!-- 统计卡 -->
        <div class="grid grid-cols-5 gap-3">
          <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5">
            <div class="text-[11px] text-[var(--text-faint)] mb-1">总调用</div>
            <div class="text-xl font-semibold">{{ logStats?.total ?? '—' }}</div>
          </div>
          <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5">
            <div class="text-[11px] text-[var(--text-faint)] mb-1">成功</div>
            <div class="text-xl font-semibold" style="color: var(--accent)">{{ logStats?.success ?? '—' }}</div>
          </div>
          <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5">
            <div class="text-[11px] text-[var(--text-faint)] mb-1">失败</div>
            <div class="text-xl font-semibold text-[#e08a7a]">{{ logStats?.failed ?? '—' }}</div>
          </div>
          <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5">
            <div class="text-[11px] text-[var(--text-faint)] mb-1">Token 用量（估）</div>
            <div class="text-xl font-semibold">{{ logStats ? logStats.tokens.toLocaleString() : '—' }}</div>
          </div>
          <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5">
            <div class="text-[11px] text-[var(--text-faint)] mb-1">平均耗时</div>
            <div class="text-xl font-semibold">{{ logStats ? `${(logStats.avgMs / 1000).toFixed(1)}s` : '—' }}</div>
          </div>
        </div>

        <!-- 筛选 -->
        <div class="flex gap-2 items-center flex-wrap">
          <InkSelect
            v-model="logKind"
            class="w-28"
            :options="[
              { label: '全部类型', value: 'all' },
              { label: '文字 AI', value: 'text' },
              { label: '智能体', value: 'agent' }
            ]"
          />
          <InkSelect
            v-model="logStatus"
            class="w-28"
            :options="[
              { label: '全部状态', value: 'all' },
              { label: '成功', value: 'success' },
              { label: '失败', value: 'failed' },
              { label: '中止', value: 'aborted' }
            ]"
          />
          <InkSelect
            v-model="logFeature"
            class="w-40"
            :options="[{ label: '全部功能', value: 'all' }, ...logFeatures.map((f) => ({ label: f.label, value: f.key }))]"
          />
          <div class="relative flex-1 min-w-40">
            <Search :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input v-model="logKeyword" class="ink-input pl-8" placeholder="搜索模型 / 服务商 / 错误信息" @keyup.enter="refreshLog" />
          </div>
          <InkButton variant="ghost" :disabled="logBusy" @click="refreshLog"><RefreshCw :size="13" /> 刷新</InkButton>
          <InkButton variant="ghost" @click="clearLog"><Trash2 :size="13" /> 清空</InkButton>
        </div>

        <!-- 记录表格 -->
        <div class="rounded-xl border border-[var(--border)] overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-[var(--panel)] text-[var(--text-dim)] text-xs">
                <th class="text-left font-normal px-3 py-2">时间</th>
                <th class="text-left font-normal px-3 py-2">类型</th>
                <th class="text-left font-normal px-3 py-2">功能</th>
                <th class="text-left font-normal px-3 py-2">模型</th>
                <th class="text-left font-normal px-3 py-2">状态</th>
                <th class="text-right font-normal px-3 py-2">耗时</th>
                <th class="text-right font-normal px-3 py-2">Token</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in logList" :key="r.id" class="border-t border-[var(--border)] align-top">
                <td class="px-3 py-2 text-xs text-[var(--text-dim)] whitespace-nowrap">{{ fmtTime(r.at) }}</td>
                <td class="px-3 py-2 text-xs">{{ r.kind === 'agent' ? '智能体' : '文字 AI' }}</td>
                <td class="px-3 py-2">
                  {{ r.featureLabel }}
                  <div v-if="r.error" class="text-xs text-[#e08a7a] mt-0.5 max-w-96 truncate" :title="r.error">{{ r.error }}</div>
                </td>
                <td class="px-3 py-2 text-xs text-[var(--text-dim)]">{{ r.model }}</td>
                <td class="px-3 py-2 text-xs" :class="r.status === 'success' ? '' : r.status === 'failed' ? 'text-[#e08a7a]' : 'text-[var(--text-faint)]'">
                  {{ LOG_STATUS_LABEL[r.status] }}
                </td>
                <td class="px-3 py-2 text-xs text-right text-[var(--text-dim)] whitespace-nowrap">{{ (r.durationMs / 1000).toFixed(1) }}s</td>
                <td class="px-3 py-2 text-xs text-right text-[var(--text-dim)]">{{ r.tokens.toLocaleString() }}</td>
              </tr>
              <tr v-if="!logList.length">
                <td colspan="7" class="px-3 py-10 text-center text-sm text-[var(--text-faint)]">
                  {{ logStats?.total ? '没有符合筛选条件的记录' : '还没有调用记录——配置好 AI 服务后，这里的每一次调用都会留痕' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-[var(--text-faint)]">仅保留最近 2000 条；Token 按字符数估算（≈1.4 字/token），仅作用量参考。</p>
      </div>

      <!-- 保存与备份 -->
      <div v-if="tab === 'backup'" class="space-y-5">
        <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-3">
          <div class="text-sm text-[var(--text-dim)]">备份目录</div>
          <input v-model="cfg.backup.dir" class="ink-input" placeholder="留空使用默认：书架旁的「DAWO 备份」" @change="save" />
          <div class="text-xs text-[var(--text-faint)]">备份是整本书的完整副本（含正文、资料、会话与历史），以文件夹形式存放。</div>
        </div>

        <div class="flex items-center gap-4 flex-wrap">
          <InkToggle v-model="cfg.backup.autoOnExit" label="退出应用时自动备份当前作品" @update:model-value="save" />
          <InkToggle v-model="cfg.backup.backupOnUpdate" label="安装更新前自动备份当前作品" @update:model-value="save" />
        </div>

        <div class="flex gap-2 items-center flex-wrap">
          <InkButton :disabled="backupBusy" @click="createBackupNow"><CloudUpload :size="14" /> 立即备份当前作品</InkButton>
          <InkButton variant="ghost" @click="refreshBackups"><RefreshCw :size="13" /> 刷新列表</InkButton>
          <InkButton variant="ghost" @click="openBackupDir"><FolderOpen :size="14" /> 打开备份目录</InkButton>
          <span v-if="backupTip" class="text-sm" style="color: var(--accent)">{{ backupTip }}</span>
        </div>

        <div class="rounded-xl border border-[var(--border)] overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-[var(--panel)] text-[var(--text-dim)] text-xs">
                <th class="text-left font-normal px-3 py-2">作品</th>
                <th class="text-left font-normal px-3 py-2">备份时间</th>
                <th class="text-right font-normal px-3 py-2">大小</th>
                <th class="text-right font-normal px-3 py-2 w-36">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in backups" :key="b.dir" class="border-t border-[var(--border)]">
                <td class="px-3 py-2">{{ b.book }}</td>
                <td class="px-3 py-2 text-xs text-[var(--text-dim)]">{{ fmtTime(b.at) }}</td>
                <td class="px-3 py-2 text-xs text-right text-[var(--text-dim)]">{{ fmtBytes(b.sizeBytes) }}</td>
                <td class="px-3 py-2 text-right">
                  <button class="text-xs text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer px-1.5 inline-flex items-center gap-1" @click="restoreOne(b.dir, b.book)">
                    <ArchiveRestore :size="13" /> 恢复
                  </button>
                  <button class="text-xs text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer px-1.5 inline-flex items-center gap-1" @click="deleteOne(b.dir, b.book)">
                    <Trash2 :size="13" /> 删除
                  </button>
                </td>
              </tr>
              <tr v-if="!backups.length">
                <td colspan="4" class="px-3 py-10 text-center text-sm text-[var(--text-faint)]">还没有备份。写作是长跑，建议开书后随手备份一份。</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-[var(--text-faint)]">恢复前会自动给当前版本做一次「恢复前快照」，放心操作。</p>
      </div>

      <!-- 关于 / 检查更新 -->
      <div v-if="tab === 'about'" class="space-y-5 max-w-xl">
        <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 flex items-center gap-4">
          <img :src="logoUrl" alt="DAWO" class="w-12 h-12 rounded-lg" />
          <div class="flex-1">
            <div class="text-sm font-medium">DAWO · AI 小说工作台</div>
            <div class="text-xs text-[var(--text-faint)] mt-0.5">当前版本 v{{ appVersion }} · 免费 · 本地优先</div>
          </div>
        </div>

        <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-3">
          <div class="text-sm text-[var(--text-dim)]">软件更新</div>
          <div class="text-xs text-[var(--text-faint)] leading-5">
            更新源是 GitHub Releases。检查到新版本后先下载，重启即完成安装；书稿与配置不受影响。仓库私有期间可能拉不到更新信息，可点「打开 Releases 页」手动下载。
          </div>
          <div class="flex items-center gap-3 flex-wrap">
            <InkToggle v-model="updConf.autoCheck" label="自动检查更新" @update:model-value="save" />
            <InkSelect v-model="updConf.frequency" class="w-36" :options="CHECK_FREQ_OPTS" :disabled="!updConf.autoCheck" @update:model-value="save" />
            <span class="text-[11px] text-[var(--text-faint)]">每天最多一次时，距上次检查不足 24 小时则本次启动跳过</span>
          </div>
          <div class="flex gap-2 items-center flex-wrap">
            <InkButton :disabled="upd.state === 'checking' || upd.state === 'downloading'" @click="checkUpdate">
              <RefreshCw :size="13" /> {{ upd.state === 'checking' ? '正在检查…' : '检查更新' }}
            </InkButton>
            <InkButton v-if="upd.state === 'available'" @click="doDownload">下载 v{{ upd.version }}</InkButton>
            <InkButton v-if="upd.state === 'downloaded'" @click="doInstall">重启安装 v{{ upd.version }}</InkButton>
            <InkButton variant="ghost" @click="openReleasePage"><Github :size="13" /> 打开 Releases 页</InkButton>
          </div>
          <div v-if="upd.state === 'downloading'" class="space-y-1.5">
            <div class="h-1.5 rounded-full overflow-hidden" style="background: var(--bg-soft)">
              <div class="h-full rounded-full transition-all" :style="{ width: `${upd.percent}%`, background: 'var(--accent)' }" />
            </div>
            <div class="flex items-center justify-between text-xs" style="color: var(--accent)">
              <span>下载中 {{ upd.percent }}%</span>
              <span v-if="upd.total" class="text-[var(--text-faint)]">
                {{ fmtBytes(upd.transferred) }} / {{ fmtBytes(upd.total) }}<template v-if="upd.bps"> · {{ fmtBytes(upd.bps) }}/s</template>
              </span>
            </div>
          </div>
          <div v-if="upd.state === 'downloaded'" class="text-xs" style="color: var(--accent)">下载完成，点「重启安装」即升级（也可直接退出，下次启动前自动装；安装前会按下方开关自动备份当前作品）。</div>
          <div v-if="upd.state === 'none'" class="text-xs text-[var(--text-faint)]">已是最新版本（远端 v{{ upd.version }}）。</div>
          <div v-if="upd.state === 'error'" class="flex items-center gap-3 flex-wrap">
            <span class="text-xs" style="color: #e08a7a">{{ upd.message }}</span>
            <InkButton v-if="upd.lastAction === 'download'" variant="ghost" @click="doDownload"><RefreshCw :size="13" /> 重试下载</InkButton>
          </div>

          <!-- 更新日志：发现新版本 / 已下载时展示最新 Release 说明 -->
          <div
            v-if="(upd.state === 'available' || upd.state === 'downloaded') && (updNotes || updNotesErr || updNotesBusy)"
            class="rounded-lg border border-[var(--border)] bg-[var(--bg-soft)]/40 p-3.5"
          >
            <div class="flex items-center gap-2 mb-2">
              <span class="text-xs tracking-wider" style="color: var(--accent)">更新日志</span>
              <span v-if="updMeta" class="text-[11px] text-[var(--text-faint)]">
                v{{ updMeta.tag || upd.version }}
                <template v-if="updMeta.date"> · {{ new Date(updMeta.date).toLocaleDateString('zh-CN') }}</template>
                <template v-if="updMeta.sizeBytes"> · 安装包 {{ fmtBytes(updMeta.sizeBytes) }}</template>
              </span>
              <div class="flex-1" />
              <button
                class="text-[11px] text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer flex items-center gap-1"
                :disabled="updNotesBusy"
                @click="fetchNotes"
              >
                <LoaderCircle v-if="updNotesBusy" :size="11" class="animate-spin" />
                <RefreshCw v-else :size="11" /> 刷新
              </button>
            </div>
            <div v-if="updNotesErr" class="text-[11.5px]" style="color: #e08a7a">{{ updNotesErr }}</div>
            <div v-else class="text-[12px] prose-peek max-h-64 overflow-y-auto" v-html="updNotesHtml" />
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>
