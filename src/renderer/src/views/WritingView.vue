<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import { useConversationStore } from '../store/conversation'
import InkEditor from '../editor/InkEditor.vue'
import ChapterTree from '../components/ChapterTree.vue'
import SelectionAiModal from '../components/SelectionAiModal.vue'
import DeaiPanel from '../components/DeaiPanel.vue'
import QuickCheck from '../components/writing/QuickCheck.vue'
import AgentConversation from '../components/conversation/AgentConversation.vue'
import RightMaterialPeek from '../components/writing/RightMaterialPeek.vue'
import CustomListPanel from '../components/materials/CustomListPanel.vue'
import WritingAssistBar from '../components/writing/WritingAssistBar.vue'
import ChapterPeek from '../components/writing/ChapterPeek.vue'
import FindReplace from '../components/writing/FindReplace.vue'
import QuickName from '../components/writing/QuickName.vue'
import TypographyPanel from '../components/writing/TypographyPanel.vue'
import HistoryPanel from '../components/writing/HistoryPanel.vue'
import VectorPanel from '../components/writing/VectorPanel.vue'
import InkButton from '../ui/InkButton.vue'
import InkModal from '../ui/InkModal.vue'
import PageSubNav from '../ui/PageSubNav.vue'
import { usePanelDrag } from '../ui/usePanelDrag'
import EmptyHint from '../ui/EmptyHint.vue'
import { renderMarkdown } from '../ui/markdown'
import { onHeaderAction } from '../ui/headerActions'
import { inkConfirm } from '../ui/inkPrompt'
import { Maximize2, Minimize2, Eye, Columns2, PanelRight, Sparkles, Search, Type, History, Lightbulb, Check, Undo2, Redo2, FileText, ArrowUpRight, ChevronDown } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()
const conv = useConversationStore()

/** 三栏均可拖拽调宽（范围限制，防止互相挤没） */
const treeDrag = usePanelDrag('writing.tree', 224, 170, 420)
const paneDrag = usePanelDrag('writing.pane', 380, 300, 560)
const rightDrag = usePanelDrag('writing.right', 364, 300, 620)

const currentFile = ref('')
const content = ref('')
const savedLen = ref(0)
const aiTouched = ref(false)
const saving = ref(false)
const editorRef = ref<InstanceType<typeof InkEditor>>()
const treeRef = ref<InstanceType<typeof ChapterTree>>()
const stats = ref({ handwritten: 0, ai: 0 })

// 划词 AI
const selOpen = ref(false)
const selAction = ref('polish')
const selText = ref('')

// 右栏标签页：写作时随手查阅资料 / 与智能体对话
const rightTab = computed({
  get: () => app.writingRightTab,
  set: (v: string) => (app.writingRightTab = v)
})
const MATE_TABS = [
  { key: 'ai', label: '智能体' },
  { key: 'deai', label: '去 AI 味' },
  { key: '速检', label: '速检' },
  { key: '检索', label: '检索' },
  { key: '章节', label: '章节' },
  { key: '大纲', label: '大纲' },
  { key: '角色', label: '角色' },
  { key: '设定', label: '设定' },
  { key: '时间线', label: '时间线' },
  { key: '故事线', label: '故事线' },
  { key: '关系图', label: '关系图' },
  { key: '细纲', label: '细纲' },
  { key: '词典', label: '词典' },
  { key: '伏笔', label: '伏笔' },
  { key: '境界', label: '境界' },
  { key: '出场', label: '出场' },
  { key: '地图', label: '地图' }
]
// 自定义面板（阶段二）：标签动态追加在内置标签之后
const customPanels = ref<{ key: string; label: string }[]>([])

async function refreshCustomPanels() {
  if (!lib.current) {
    customPanels.value = []
    return
  }
  try {
    const list = (await window.api.panelsList(lib.current.title)) as { name: string; board?: string; hidden?: boolean }[]
    customPanels.value = list.filter((p) => !p.board && !p.hidden).map((p) => ({ key: p.name, label: p.name }))
  } catch {
    customPanels.value = []
  }
}

watch(() => lib.current?.title, () => void refreshCustomPanels(), { immediate: true })
// KeepAlive 缓存页面：切回写作台时重拉面板列表（资料区新建/删除的面板要同步出现）
onActivated(() => void refreshCustomPanels())
window.addEventListener('inkdesk:panels-changed', () => void refreshCustomPanels())

const mateTabs = computed(() => [...MATE_TABS, ...customPanels.value])
const customTabInst = computed(() => customPanels.value.find((p) => p.key === rightTab.value))

/**
 * 右栏标签条：自适应换行（最多 2 行），放不下的收进「更多」下拉。
 * 17+ 个标签在窄栏里既不折成三行、也不出现横向滚动条 —— 永远不要求用户滚标签。
 */
const moreWrap = ref<HTMLElement>()
const tabWrap = ref<HTMLElement>()
/** 被 2 行高度裁掉的标签 key */
const overflowKeys = ref<string[]>([])
const moreOpen = ref(false)
const tabOverflow = computed(() => overflowKeys.value.length > 0)
/** 当前选中项被收进「更多」时按钮高亮，避免用户以为标签丢了 */
const activeInMore = computed(() => overflowKeys.value.includes(rightTab.value))

/** 按「写作辅助 / 资料 / 自定义面板」分组，供「更多」下拉使用 */
const ASSIST_KEYS = ['ai', 'deai', '速检', '检索', '章节']
const tabGroups = computed(() => {
  const customKeys = customPanels.value.map((p) => p.key)
  const assist = mateTabs.value.filter((t) => ASSIST_KEYS.includes(t.key))
  const material = mateTabs.value.filter((t) => !ASSIST_KEYS.includes(t.key) && !customKeys.includes(t.key))
  const groups: { label: string; items: { key: string; label: string }[] }[] = []
  if (assist.length) groups.push({ label: '写作辅助', items: assist })
  if (material.length) groups.push({ label: '资料', items: material })
  if (customPanels.value.length) groups.push({ label: '自定义面板', items: customPanels.value })
  return groups
})

/**
 * 测量哪些标签被裁掉。用「标签底边 vs 容器内边距盒底边」判断，
 * 不依赖 offsetParent（标签条的定位祖先是外层容器，不是自身）。
 */
function measureTabs() {
  const wrap = tabWrap.value
  if (!wrap) return
  const box = wrap.getBoundingClientRect()
  const limit = box.bottom - parseFloat(getComputedStyle(wrap).paddingBottom)
  const hidden: string[] = []
  for (const el of Array.from(wrap.querySelectorAll<HTMLElement>('[data-tab]'))) {
    if (el.getBoundingClientRect().bottom > limit + 1) hidden.push(el.dataset.tab || '')
  }
  overflowKeys.value = hidden
  if (!hidden.length) moreOpen.value = false
}

function selectTab(key: string) {
  rightTab.value = key
  moreOpen.value = false
}

let tabRO: ResizeObserver | null = null
// 换书 / 换标签 / 面板增删都会改变标签宽度 → 重新测量
watch([rightTab, mateTabs], () => void nextTick(measureTabs))
// 标签条在 v-if 分支里，出现/消失时挂载与释放观察器
watch(tabWrap, (el, old) => {
  if (old) tabRO?.unobserve(old)
  if (!el) return
  tabRO = tabRO || new ResizeObserver(() => measureTabs())
  tabRO.observe(el)
  void nextTick(measureTabs)
})

function onMoreOutside(e: PointerEvent) {
  if (moreWrap.value?.contains(e.target as Node)) return
  moreOpen.value = false
}
watch(moreOpen, (v) => {
  if (v) window.addEventListener('pointerdown', onMoreOutside, true)
  else window.removeEventListener('pointerdown', onMoreOutside, true)
})
/** Markdown 资料按目录读取：目录下所有 .md 都可作为速览来源（此前写死单个文件，内容在别的文件里就误报「暂无资料」） */
const MATE_DIRS: Record<string, string> = {
  大纲: '大纲',
  角色: '角色',
  设定: '设定'
}
/**
 * 结构化资料：存在 各自的 .json 里，不走 Markdown 通道。
 */
const STRUCTURED_TABS = ['时间线', '故事线', '关系图', '细纲', '词典', '伏笔', '境界', '出场', '地图']
const mateText = ref('')
const mateMissing = ref(false)
/** 当前目录下可选的 .md 文件（chips 切换） */
const mateFiles = ref<string[]>([])
const mateFile = ref('')
/** 资料速览用 Markdown 渲染（裸文本会露出 # 标题记号，难看） */
const mateHtml = computed(() => renderMarkdown(mateText.value))

const threePane = computed(() => app.layoutMode === 'three-pane')
const isStructured = computed(() => STRUCTURED_TABS.includes(rightTab.value))

async function loadMateFile(path: string) {
  if (!lib.current || !path) {
    mateText.value = ''
    mateMissing.value = true
    return
  }
  const text = await window.api.fileRead(lib.current.title, path)
  mateText.value = text
  mateMissing.value = !text.trim()
}

/** 扫描当前资料目录，默认打开第一个非空文件（都不非空则第一个） */
async function loadMateTab(t: string) {
  if (t === 'ai' || t === 'deai' || t === '章节' || t === '检索' || !lib.current || STRUCTURED_TABS.includes(t)) return
  if (customPanels.value.some((p) => p.key === t)) return // 自定义面板自加载
  const dir = MATE_DIRS[t] || ''
  let files: string[] = []
  try {
    const tree = (await window.api.treeList(lib.current.title)) as { name: string; path: string; dir: boolean; children?: { name: string; path: string; dir: boolean; children?: unknown[] }[] }[]
    const node = tree.find((n) => n.dir && (n.path === dir || n.path === `${dir}/`))
    // 递归收集：设定目录有子分组（世界/体系/势力…），子目录里的文件同样算数
    const walk = (nodes: { name: string; path: string; dir: boolean; children?: unknown[] }[]) => {
      for (const c of nodes) {
        if (c.dir) walk((c.children || []) as typeof nodes)
        else if (/\.(md|txt)$/i.test(c.name)) files.push(c.path)
      }
    }
    if (node?.children) walk(node.children as typeof node.children)
  } catch {
    files = []
  }
  // 记住上次在这个板块看过的文件；否则依次找第一个有内容的
  let target = mateFile.value && files.includes(mateFile.value) ? mateFile.value : ''
  if (!target) {
    for (const f of files) {
      const text = await window.api.fileRead(lib.current.title, f)
      if (text.trim()) {
        target = f
        break
      }
    }
    if (!target && files.length) target = files[0]
  }
  mateFiles.value = files
  mateFile.value = target
  await loadMateFile(target)
}

watch(rightTab, (t) => void loadMateTab(t))
// 换书后即使停留在同一资料标签，也要重扫新书目录
watch(
  () => lib.current?.title,
  () => void loadMateTab(rightTab.value)
)

// ============ 查找替换 ============
const findOpen = ref(false)

// ============ 写作台工具：快速取名 / 排版 / 历史版本 / 灵感速记 ============
const nameOpen = ref(false)
const typoOpen = ref(false)
const historyOpen = ref(false)
const noteOpen = ref(false)

/** 排版：写作台持有，编辑器容器与设置面板共用同一份 */
interface TypoConf {
  fs: number
  lh: number
  measure: number
  font: string
  paraGap: boolean
  grid: string
}
const TYPO_KEY = 'inkdesk.typography'
function loadTypo(): TypoConf {
  const d: TypoConf = { fs: 16, lh: 2, measure: 720, font: 'default', paraGap: false, grid: 'none' }
  try {
    const raw = localStorage.getItem(TYPO_KEY)
    return raw ? { ...d, ...(JSON.parse(raw) as TypoConf) } : d
  } catch {
    return d
  }
}
const typo = ref<TypoConf>(loadTypo())
const typoVars = computed(() => ({
  '--ink-fs': `${typo.value.fs}px`,
  '--ink-lh': String(typo.value.lh),
  '--ink-measure': `${typo.value.measure}px`,
  '--ink-font':
    typo.value.font === 'serif'
      ? `'Songti SC', 'SimSun', 'Noto Serif SC', serif`
      : typo.value.font === 'sans'
        ? `'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif`
        : 'inherit',
  '--ink-para': typo.value.paraGap ? '1.6em' : '1em'
}))
const typoGrid = computed(() => (typo.value.grid === 'solid' ? 'ink-grid-solid' : typo.value.grid === 'dash' ? 'ink-grid-dash' : ''))

// ============ 灵感速记（写作台内随手记） ============
const noteText = ref('')
const noteSaved = ref(false)
async function saveNote() {
  const text = noteText.value.trim()
  if (!text) return
  const name = text.replace(/\s+/g, ' ').slice(0, 14) || '速记'
  const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ')
  await window.api.libWrite('notes', '通用', `${name} · ${stamp}`, '写作台速记', ['灵感'], text)
  noteText.value = ''
  noteSaved.value = true
  window.dispatchEvent(new CustomEvent('inkdesk:lib-changed'))
  setTimeout(() => (noteSaved.value = false), 2500)
}

/** 替换结果直接写回正文，走既有的 900ms 防抖自动保存 */
function applyFind(text: string) {
  content.value = text
  aiTouched.value = false
}

function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    if (!currentFile.value) return
    e.preventDefault()
    findOpen.value = true
  } else if (e.key === 'Escape' && findOpen.value) {
    findOpen.value = false
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let offHeader: (() => void) | null = null

const chapterTitle = computed(() => currentFile.value.split('/').pop()?.replace(/\.md$/, '') || '')

/** 当前编辑缓冲所属的书：换书后旧缓冲不许再往新书文件里写 */
const loadedBook = ref('')

async function flushSave() {
  if (!currentFile.value || !lib.current) return
  // 书已切换：缓冲属于旧书，不能写进新书（换书 watch 里会用旧书名补写）
  if (lib.current.title !== loadedBook.value) return
  const delta = content.value.length - savedLen.value
  saving.value = true
  app.setSaveState(true, '保存中…')
  try {
    await window.api.fileWrite(lib.current.title, currentFile.value, content.value)
    if (delta > 0) {
      await window.api.statsAdd(lib.current.title, aiTouched.value ? 0 : delta, aiTouched.value ? delta : 0)
      stats.value = await lib.todayStats()
    }
    savedLen.value = content.value.length
    aiTouched.value = false
    app.setSaveState(false, `已保存 · ${content.value.length} 字`)
  } catch (e) {
    // 保存失败必须显性反馈并复位状态，否则顶栏永远「保存中…」
    app.setSaveState(false, `保存失败：${(e as Error).message}`)
  } finally {
    saving.value = false
  }
}

let openSeq = 0
async function openFile(rel: string) {
  if (!lib.current) return
  const seq = ++openSeq
  if (currentFile.value) await flushSave()
  // 快速连点两章：过期的切换调用直接丢弃，防止旧章内容写进另一章
  if (seq !== openSeq) return
  const text = await window.api.fileRead(lib.current.title, rel)
  // 读取期间可能又被切走：过期响应不能落进编辑器（否则自动保存会把旧章内容写进新章文件）
  if (seq !== openSeq) return
  currentFile.value = rel
  conv.activeFile = rel
  content.value = text
  if (seq !== openSeq) return
  savedLen.value = content.value.length
  loadedBook.value = lib.current.title
  aiTouched.value = false
  await window.api.statsRecord(lib.current.title, rel, content.value.length)
}

/** 智能体接受修改提案并落盘后，若命中的是当前文件则重新载入 */
async function reloadCurrent() {
  if (!currentFile.value || !lib.current) return
  const saved = await window.api.fileRead(lib.current.title, currentFile.value)
  content.value = saved
  savedLen.value = saved.length
}

function onFileChanged(e: Event) {
  const p = (e as CustomEvent<{ path?: string }>).detail?.path
  if (!p || p !== currentFile.value) return
  void reloadCurrent()
}

/** 换书：挂起的缓冲按「切换前的书名」补写回旧书，再清空编辑器，防止旧书内容写进新书同名文件 */
watch(
  () => lib.current?.title,
  async (nv, ov) => {
    if (ov && nv && ov !== nv && currentFile.value) {
      const buf = content.value
      const file = currentFile.value
      if (buf && savedLen.value !== buf.length) {
        await window.api.fileWrite(ov, file, buf)
      }
    }
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    currentFile.value = ''
    content.value = ''
    savedLen.value = 0
    loadedBook.value = ''
    conv.activeFile = ''
  }
)

async function newChapter() {
  if (!lib.current) return
  const chs = lib.chapterList()
  let max = 0
  for (const c of chs) {
    const m = c.name.match(/第(\d+)章/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  const no = max + 1
  const rel = `正文/第${String(no).padStart(3, '0')}章.md`
  await window.api.fileWrite(lib.current.title, rel, `# 第${no}章 \n\n`)
  await lib.refreshTree()
  await openFile(rel)
}

async function deleteFile(rel: string) {
  const ok = await inkConfirm(`确定删除 ${rel} ？`, { confirmText: '删除', danger: true })
  if (!ok) return
  await window.api.fileDelete(lib.current!.title, rel)
  if (currentFile.value === rel) {
    currentFile.value = ''
    content.value = ''
  }
  await lib.refreshTree()
}

// 自动保存
watch(content, () => {
  if (!currentFile.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flushSave(), 900)
})

/**
 * AI 续写：把任务直接交给「分节写手」智能体。
 * 它会读大纲、设定与当前章全文，续写后以修改提案交作者审阅；
 * 比旧的幽灵字（只看尾部 800 字）上下文完整得多。
 */
const aiContinueBusy = computed(() => conv.running)

async function aiContinue() {
  if (!lib.current || !currentFile.value.startsWith('正文/') || conv.running) return
  await flushSave() // 先存盘，智能体读到的才是最新内容
  rightTab.value = 'ai'
  await conv.askWith(
    'section',
    `请从《${chapterTitle.value}》的结尾处自然续写 500-800 字：严格延续现有叙事视角、语气与人物声口，与大纲、设定保持一致，推进剧情并在结尾留下钩子。完成后用 propose_edit 对「${currentFile.value}」提交修改提案，不要另开新文件。`,
    currentFile.value
  )
}

function onSelectionAction(p: { action: string; text: string }) {
  if (!p.text.trim()) return
  selAction.value = p.action
  selText.value = p.text
  selOpen.value = true
}

function applySelection(text: string) {
  editorRef.value?.replaceSelection(text)
  aiTouched.value = true
}

function applyWholeText(text: string) {
  content.value = text
  aiTouched.value = true
}

onMounted(async () => {
  offHeader = onHeaderAction((key) => {
    if (key === 'writing:newChapter') void newChapter()
  })
  stats.value = await lib.todayStats()
  window.addEventListener('inkdesk:file-changed', onFileChanged)
  window.addEventListener('keydown', onGlobalKeydown)
})

/** 顶部栏全局搜索选中文件后，跳转过来打开它 */
watch(
  () => app.openFileRequest?.nonce,
  async () => {
    const path = app.openFileRequest?.path
    if (path && lib.current) await openFile(path)
  },
  { immediate: true }
)

onUnmounted(() => {
  offHeader?.()
  offHeader = null
  window.removeEventListener('inkdesk:file-changed', onFileChanged)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('pointerdown', onMoreOutside, true)
  tabRO?.disconnect()
  tabRO = null
})
</script>

<template>
  <!-- 未打开书籍 -->
  <div v-if="!lib.current" class="h-full flex flex-col items-center justify-center text-[var(--text-faint)] gap-4">
    <p>尚未打开作品</p>
    <InkButton @click="app.go('bookshelf')">去书架选择</InkButton>
  </div>

  <div v-else class="h-full flex">
    <!-- 左：文件树 -->
    <aside
      class="app-chrome relative shrink-0 border-r border-[var(--border)] bg-[var(--bg-soft)]/70 overflow-y-auto pt-1 pb-2"
      :class="{ 'focus-dim': app.focusMode }"
      :style="{ width: treeDrag.width.value + 'px' }"
    >
      <div class="panel-resizer right-0" :class="{ 'is-dragging': treeDrag.dragging.value }" @mousedown="treeDrag.onDown($event, 1)" />
      <ChapterTree ref="treeRef" :current-file="currentFile" @open="openFile" @new-chapter="newChapter" @delete="deleteFile" />
    </aside>

    <!-- 三栏布局：智能体对话居中（DeepWrite 式） -->
    <section
      v-if="threePane"
      class="app-chrome relative shrink-0 border-r border-[var(--border)] bg-[var(--bg-soft)]/60 flex flex-col min-h-0"
      :class="{ 'focus-dim': app.focusMode }"
      :style="{ width: paneDrag.width.value + 'px' }"
    >
      <div class="panel-resizer right-0" :class="{ 'is-dragging': paneDrag.dragging.value }" @mousedown="paneDrag.onDown($event, 1)" />
      <AgentConversation />
    </section>

    <!-- 编辑器 -->
    <section class="flex-1 min-w-0 flex flex-col">
      <PageSubNav dense>
        <template #left>
          <span class="font-serif-ink text-heading shrink-0 text-[var(--text)]">{{ chapterTitle || '未选择文件' }}</span>
          <span class="text-meta text-[var(--text-faint)] tnum shrink-0">{{ content.length }} 字</span>
          <WritingAssistBar
            v-if="currentFile && currentFile.startsWith('正文/')"
            :today-written="stats.handwritten + stats.ai"
            :content-len="content.length"
            :file-path="currentFile"
          />
        </template>
        <template #right>
          <button
            class="text-meta inline-flex items-center gap-1 px-2.5 h-7 rounded-[var(--r-sm)] cursor-pointer transition-colors whitespace-nowrap"
            :class="
              aiContinueBusy
                ? 'text-[var(--text-faint)] border border-[var(--border)]'
                : 'border border-[var(--accent-line)] text-[var(--accent)] hover:bg-[var(--accent-soft)]'
            "
            :disabled="aiContinueBusy"
            title="交给「分节写手」智能体续写当前章节：它会读大纲、设定与全文，续写后以修改提案交你审阅（需先在设置里配置智能体模型）"
            @click="aiContinue"
          >
            <Sparkles :size="13" /> {{ aiContinueBusy ? '续写中…' : 'AI 续写' }}
          </button>
          <button
            class="w-7 h-7 rounded-[var(--r-sm)] flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] cursor-pointer transition-colors ml-2"
            :title="threePane ? '切换为右栏标签页布局' : '切换为三栏布局（对话居中）'"
            @click="app.toggleLayout()"
          >
            <component :is="threePane ? PanelRight : Columns2" :size="16" />
          </button>
          <button
            class="w-7 h-7 rounded-[var(--r-sm)] flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] cursor-pointer transition-colors"
            :title="app.focusMode ? '退出专注模式' : '专注模式'"
            @click="app.focusMode = !app.focusMode"
          >
            <component :is="app.focusMode ? Minimize2 : Maximize2" :size="16" />
          </button>
        </template>
      </PageSubNav>

      <!-- 写作工具行：撤回 / 重做 / 快速取名 / 查找 / 排版 / 历史版本 / 灵感速记 -->
      <div class="shrink-0 flex items-center gap-0.5 px-3 h-9 border-b border-[var(--border)]">
        <button class="tool-btn" title="撤销（Ctrl+Z）" @click="editorRef?.undo()">
          <Undo2 :size="15" />
        </button>
        <button class="tool-btn" title="重做（Ctrl+Y）" @click="editorRef?.redo()">
          <Redo2 :size="15" />
        </button>
        <div class="w-px h-4 mx-1" style="background: var(--border)" />
        <button class="tool-btn" title="快速取名：人物 / 地点 / 势力 / 招式 / 装备 / 怪物 / 道具" @click="nameOpen = true">
          <Sparkles :size="15" />
        </button>
        <button class="tool-btn" :class="{ 'tool-btn-on': findOpen }" title="查找替换（Ctrl+F）" @click="findOpen = !findOpen">
          <Search :size="15" />
        </button>
        <button class="tool-btn" :class="{ 'tool-btn-on': typoOpen }" title="排版设置：字号 / 行高 / 页宽 / 网格线" @click="typoOpen = !typoOpen">
          <Type :size="15" />
        </button>
        <button class="tool-btn" :class="{ 'tool-btn-on': historyOpen }" title="历史版本：查看与恢复自动留档" @click="historyOpen = !historyOpen">
          <History :size="15" />
        </button>
        <button class="tool-btn" :class="{ 'tool-btn-on': noteOpen }" title="灵感速记：随手记一条" @click="noteOpen = !noteOpen">
          <Lightbulb :size="15" />
        </button>
        <div class="flex-1" />
        <span v-if="currentFile" class="text-micro text-[var(--text-faint)] pr-1">{{ chapterTitle }}</span>
      </div>

      <!-- 查找替换（Ctrl+F） -->
      <FindReplace v-if="findOpen" :text="content" @close="findOpen = false" @apply="applyFind" />

      <div class="flex-1 min-h-0 overflow-y-auto" @click="app.focusMode && (app.focusMode = false)">
        <EmptyHint v-if="!currentFile" :icon="FileText" title="从左侧选择章节或资料文件开始写作" desc="也可以新建一章，或让智能体按大纲生成" />
        <div v-else class="prose-ink" :class="typoGrid" :style="typoVars">
          <InkEditor
            ref="editorRef"
            v-model="content"
            :placeholder="chapterTitle ? '正文从此开始…' : '开始写作…'"
            @selection-action="onSelectionAction"
          />
        </div>
      </div>
    </section>

    <!-- 右（标签页布局）：智能体 / 去 AI 味 / 资料速览 -->
    <aside
      v-if="!threePane"
      class="app-chrome relative shrink-0 border-l border-[var(--border)] bg-[var(--bg-soft)]/70 flex flex-col min-h-0"
      :class="{ 'focus-dim': app.focusMode }"
      :style="{ width: rightDrag.width.value + 'px' }"
    >
      <div class="panel-resizer left-0" :class="{ 'is-dragging': rightDrag.dragging.value }" @mousedown="rightDrag.onDown($event, -1)" />
      <!-- 标签条：自适应换行（最多 2 行），放不下的收进「更多」下拉，永不出现滚动条 -->
      <div ref="moreWrap" class="relative shrink-0 border-b border-[var(--border)] flex items-start">
        <div ref="tabWrap" class="tab-wrap flex-1 min-w-0 flex flex-wrap items-center gap-0.5 px-2 py-1.5">
          <button
            v-for="t in mateTabs"
            :key="t.key"
            :data-tab="t.key"
            class="shrink-0 px-2 h-6 text-label rounded-[var(--r-sm)] cursor-pointer transition-colors whitespace-nowrap"
            :class="rightTab === t.key ? 'font-medium' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-[var(--hover)]'"
            :style="rightTab === t.key ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : {}"
            @click="selectTab(t.key)"
          >
            {{ t.label }}
          </button>
        </div>
        <button
          v-if="tabOverflow"
          class="tab-more"
          :class="{ 'tab-more-on': activeInMore }"
          :title="activeInMore ? '更多板块（当前查看的标签收在这里）' : '更多板块'"
          @click="moreOpen = !moreOpen"
        >
          更多
          <ChevronDown :size="12" :class="moreOpen ? 'rotate-180' : ''" class="transition-transform duration-200" />
        </button>

        <Transition name="pop">
          <div
            v-if="moreOpen"
            class="absolute right-2 top-full mt-1 w-56 max-h-[60vh] overflow-y-auto rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--panel-2)] shadow-[var(--sh-2)] p-1 z-[var(--z-popover)]"
          >
            <template v-for="g in tabGroups" :key="g.label">
              <div class="text-micro tracking-[0.1em] text-[var(--text-faint)] px-2 pt-2 pb-1">{{ g.label }}</div>
              <button
                v-for="t in g.items"
                :key="t.key"
                class="w-full text-left px-2 py-1.5 rounded-[var(--r-sm)] text-label cursor-pointer transition-colors truncate"
                :class="
                  rightTab === t.key
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]'
                "
                @click="selectTab(t.key)"
              >
                {{ t.label }}
              </button>
            </template>
          </div>
        </Transition>
      </div>

      <!-- 智能体对话 -->
      <div v-if="rightTab === 'ai'" class="flex-1 min-h-0">
        <AgentConversation />
      </div>

      <!-- 去 AI 味 -->
      <div v-else-if="rightTab === 'deai'" class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <div>
          <div class="text-meta tracking-[0.08em] text-[var(--text-faint)] mb-2 flex items-center gap-1.5">
            <Eye :size="13" /> 整章去 AI 味
          </div>
          <p class="text-meta text-[var(--text-faint)] leading-5 mb-3">
            对当前打开的章节做人类信号自检（六维密度+红牌警告）、红牌级诊断（含 OOC 角色对照）、L1-L4 四档注入式改写与 5 维评分，改写结果可编辑后一键应用。
          </p>
          <DeaiPanel v-if="currentFile.startsWith('正文/')" :chapter-text="content" :book="lib.current.title" :file="currentFile" @apply-text="applyWholeText" />
          <p v-else class="text-meta text-[var(--text-faint)]">打开一个章节文件后可使用整章诊断 / 改写 / 评分。</p>
        </div>
      </div>

      <!-- 随写随查速检：本章对照词典/出场/境界/伏笔 -->
      <div v-else-if="rightTab === '速检'" class="flex-1 min-h-0 overflow-y-auto p-4">
        <QuickCheck :book="lib.current.title" :file="currentFile" :chapter-text="content" />
      </div>

      <!-- 语义检索索引管理 -->
      <div v-else-if="rightTab === '检索'" class="flex-1 min-h-0 overflow-y-auto">
        <VectorPanel />
      </div>

      <!-- 章节字数与快速跳章 -->
      <div v-else-if="rightTab === '章节'" class="flex-1 min-h-0">
        <ChapterPeek :book="lib.current.title" :current-file="currentFile" @open="openFile" />
      </div>

      <!-- 自定义面板（列表型）：写作台内直接编辑 -->
      <div v-else-if="customTabInst" class="flex-1 min-h-0 overflow-y-auto">
        <CustomListPanel :key="rightTab" :panel-id="rightTab" @removed="refreshCustomPanels" />
      </div>

      <!-- 结构化资料速览（时间线 / 故事线 / 关系图） -->
      <div v-else-if="isStructured" class="flex-1 min-h-0">
        <RightMaterialPeek :book="lib.current.title" :tab="rightTab" />
      </div>

      <!-- 资料速览（Markdown）：目录下多文件用 chips 切换；空态与内容态统一风格 -->
      <div v-else class="flex-1 min-h-0 flex flex-col">
        <div v-if="mateFiles.length > 1" class="shrink-0 flex flex-wrap gap-1 px-3 pt-2.5 pb-1.5 border-b border-[var(--border)]">
          <button
            v-for="f in mateFiles"
            :key="f"
            class="ink-chip max-w-[45%] cursor-pointer transition-colors"
            :class="mateFile === f ? 'ink-chip-accent' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'"
            :title="f.split('/').pop()"
            @click="mateFile = f; void loadMateFile(f)"
          >
            <span class="truncate">{{ (f.split('/').pop() || '').replace(/\.(md|txt)$/i, '') }}</span>
          </button>
        </div>
        <EmptyHint
          v-if="mateMissing"
          class="flex-1 min-h-0 overflow-y-auto"
          :icon="FileText"
          :title="`暂无「${rightTab}」资料`"
          desc="可以到资料页手动添加，或让智能体帮你生成"
          action="去资料页生成"
          @action="app.goMaterials(rightTab)"
        />
        <template v-else>
          <div class="flex-1 min-h-0 overflow-y-auto p-4 text-label prose-peek" v-html="mateHtml" />
          <div class="shrink-0 px-3.5 py-2 border-t border-[var(--border)]">
            <button
              class="w-full flex items-center justify-center gap-1.5 text-label py-1.5 rounded-[var(--r-sm)] cursor-pointer text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] transition-colors"
              @click="app.goMaterials(rightTab)"
            >
              在资料区编辑<ArrowUpRight :size="13" />
            </button>
          </div>
        </template>
      </div>
    </aside>

    <SelectionAiModal :open="selOpen" :action="selAction" :text="selText" @close="selOpen = false" @apply="applySelection" />

    <!-- 快速取名 -->
    <InkModal :open="nameOpen" title="快速取名" wide @close="nameOpen = false">
      <QuickName @close="nameOpen = false" />
    </InkModal>

    <!-- 排版设置 -->
    <InkModal :open="typoOpen" title="排版设置" @close="typoOpen = false">
      <TypographyPanel :typo="typo" @close="typoOpen = false" />
    </InkModal>

    <!-- 历史版本 -->
    <InkModal :open="historyOpen" :title="`历史版本 · ${chapterTitle}`" wide @close="historyOpen = false">
      <HistoryPanel
        v-if="currentFile && lib.current"
        :book="lib.current.title"
        :rel="currentFile"
        @restored="reloadCurrent"
        @close="historyOpen = false"
      />
    </InkModal>

    <!-- 灵感速记 -->
    <InkModal :open="noteOpen" title="灵感速记" @close="noteOpen = false">
      <div class="space-y-3">
        <textarea v-model="noteText" rows="5" class="ink-textarea text-label" placeholder="随手记一条灵感…存进灵感便签库" />
        <div class="flex items-center justify-end gap-2">
          <span v-if="noteSaved" class="text-label ok-pulse inline-flex items-center gap-1" style="color: var(--accent)">
            <Check :size="12" /> 已存入灵感便签
          </span>
          <InkButton :disabled="!noteText.trim()" @click="saveNote">记下来</InkButton>
        </div>
      </div>
    </InkModal>
  </div>
</template>

<style scoped>
/* 标签条：最多 2 行，超出部分裁掉并由「更多」下拉承接（不做横向滚动） */
.tab-wrap {
  /* 2 × 1.5rem(h-6) + 0.125rem(gap) + 0.75rem(py-1.5) = 3.875rem */
  max-height: 3.875rem;
  overflow: hidden;
}
/* 「更多」：与标签同高，紧贴第一行右缘 */
.tab-more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 1.5rem;
  margin: 0.375rem 0.5rem 0 0;
  padding: 0 0.5rem;
  border-radius: var(--r-sm);
  font-size: var(--text-label);
  color: var(--text-faint);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--dur-2), color var(--dur-2);
}
.tab-more:hover {
  color: var(--text-dim);
  background: var(--hover);
}
.tab-more-on {
  color: var(--accent);
  background: var(--accent-soft);
}
</style>
