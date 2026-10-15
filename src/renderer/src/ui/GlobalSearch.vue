<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore, VIEW_TITLES, type ViewName } from '../store/app'
import { useLibraryStore } from '../store/library'
import { Search, CornerDownLeft } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()

interface Hit {
  kind: 'file' | 'page' | 'lib' | 'book' | 'board'
  view?: ViewName
  path?: string
  line?: number
  text?: string
  libKind?: string
  group?: string
  name?: string
  /** kind 为 book 时的作品名 */
  book?: string
  /** kind 为 board 时的板块名（时间线/词典/伏笔…，点击跳转到对应资料板块） */
  board?: string
  /** 语义检索命中（混合检索：关键词命中之外补充语义相关性结果） */
  semantic?: boolean
}

const q = ref('')
const open = ref(false)
const hits = ref<Hit[]>([])
const semHits = ref<Hit[]>([])
const semLoading = ref(false)
const cursor = ref(0)
const inputEl = ref<HTMLInputElement>()
const rootEl = ref<HTMLElement>()

/**
 * 结果面板用 Teleport 挂到 body 上。
 * 原因：顶部栏整体是窗口拖动区（app-drag），面板若留在栏内，Windows 下点击会被拖动区吞掉，
 * 且会被顶栏的半透明毛玻璃层影响观感。挂到 body 后既脱离拖动区也脱离其层叠上下文。
 */
const PANEL_ID = 'ink-search-panel'
const panelStyle = ref<Record<string, string>>({})

function updatePanelPos() {
  const r = rootEl.value?.getBoundingClientRect()
  if (!r) return
  const w = Math.min(440, window.innerWidth - 24)
  const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12))
  panelStyle.value = { left: `${left}px`, top: `${r.bottom + 6}px`, width: `${w}px` }
}

/** 搜索索引：文稿按路径，技能/素材按「名称+摘要+标签+正文」 */
interface BookDoc {
  path: string
  body: string
}
interface LibDoc {
  kind: string
  group: string
  name: string
  summary: string
  meta: string
  body: string
}

/** 作品索引：书名 / 分类 / 标签 / 简介 */
interface BookItem {
  title: string
  genre: string
  tags: string[]
  idea: string
}
let bookList: BookItem[] = []

/** 每次搜索都刷新作品列表：一个 IPC 成本很低，能保证新建或改名后立刻搜得到 */
async function refreshBooks() {
  try {
    const books = (await window.api.booksList()) as {
      title: string
      genre?: string
      idea?: string
      styleTags?: string[]
    }[]
    bookList = books.map((b) => ({
      title: b.title,
      genre: b.genre || '',
      tags: Array.isArray(b.styleTags) ? b.styleTags : [],
      idea: b.idea || ''
    }))
  } catch {
    bookList = []
  }
}

let bookDocs: BookDoc[] = []
let libDocs: LibDoc[] = []
/** 结构化板块条目（时间线/词典/伏笔…）：板块名 + 条目名 + 摘要文本 */
interface BoardDoc {
  board: string
  name: string
  text: string
}
let boardDocs: BoardDoc[] = []
/** 已建索引对应的作品名；用 null 做哨兵，避免「未打开作品」时 '' === '' 导致永不建索引 */
let indexBook: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let semTimer: ReturnType<typeof setTimeout> | null = null

const book = computed(() => lib.current?.title || '')
const canSearch = computed(() => q.value.trim().length > 0)

const LIB_LABEL: Record<string, string> = { skills: '技能库', materials: '素材库', notes: '灵感便签' }

const MAX_HITS = 40

async function loadIndex() {
  if (indexBook === book.value) return
  bookDocs = []
  libDocs = []
  boardDocs = []
  indexBook = book.value

  if (book.value) {
    const files = (await window.api.agentBookFiles(book.value)) as { path: string }[]
    for (const f of files) {
      // 结构化板块数据（.json）单独建索引，避免搜到原始 JSON 乱码行
      if (/\.json$/i.test(f.path)) continue
      try {
        bookDocs.push({ path: f.path, body: await window.api.fileRead(book.value, f.path) })
      } catch {
        /* 单文件读取失败不影响其余文件 */
      }
    }
  }

  // 结构化板块：时间线 / 故事线 / 关系图 / 词典 / 伏笔 / 境界 / 出场 / 细纲 / 地图
  if (book.value) {
    const push = (board: string, name: string, text: unknown) => {
      const t = String(text || '').trim()
      if (name.trim()) boardDocs.push({ board, name: name.trim().slice(0, 60), text: t.slice(0, 120) })
    }
    try {
      for (const n of (await window.api.tlRead(book.value)) || []) {
        const d = n as { title: string; time: string; desc: string; chapters?: string[] }
        push('时间线', d.title, [d.time, d.desc, ...(d.chapters || [])].filter(Boolean).join(' · '))
      }
    } catch { /* 忽略 */ }
    try {
      const s = (await window.api.storyRead(book.value)) as { nodes?: { label: string; desc: string; chapter?: string }[] } | null
      for (const n of s?.nodes || []) push('故事线', n.label, n.desc)
    } catch { /* 忽略 */ }
    try {
      const g = (await window.api.charGraphRead(book.value)) as { nodes?: { name: string; role: string }[]; edges?: { source: string; target: string; label: string }[] }
      const nameOf = (id: string) => g.nodes?.find((n) => n.id === id)?.name || id
      for (const n of g.nodes || []) push('关系图', n.name, n.role)
      for (const e of g.edges || []) push('关系图', `${nameOf(e.source)} ⇄ ${nameOf(e.target)}`, e.label)
    } catch { /* 忽略 */ }
    try {
      for (const e of (await window.api.dictRead(book.value)) || []) {
        const d = e as { term: string; aliases: string[]; desc: string }
        push('词典', d.term, [d.aliases?.length ? `别名：${d.aliases.join('、')}` : '', d.desc].filter(Boolean).join(' · '))
      }
    } catch { /* 忽略 */ }
    try {
      for (const e of (await window.api.foreshadowRead(book.value)) || []) {
        const d = e as { content: string; plantChapter: string; status: string }
        push('伏笔', d.content.slice(0, 40), [d.plantChapter, d.status].filter(Boolean).join(' · '))
      }
    } catch { /* 忽略 */ }
    try {
      const p = (await window.api.powerRead(book.value)) as { realms?: { name: string }[]; rules?: string; chars?: { name: string; realm: string }[] }
      for (const r of p.realms || []) push('境界', r.name, '境界阶')
      for (const c of p.chars || []) push('境界', c.name, c.realm)
      if (p.rules) push('境界', '越级规则', p.rules)
    } catch { /* 忽略 */ }
    try {
      for (const e of (await window.api.trackingRead(book.value)) || []) {
        const d = e as { name: string; status: string; lastChapter: string; location: string }
        push('出场', d.name, [d.status, d.lastChapter, d.location].filter(Boolean).join(' · '))
      }
    } catch { /* 忽略 */ }
    try {
      for (const e of (await window.api.outlineRead(book.value)) || []) {
        const d = e as { vol: string; no: number; title: string; beat: string; status: string }
        push('细纲', `第${d.no}章 ${d.title}`, [d.vol, d.beat, d.status].filter(Boolean).join(' · '))
      }
    } catch { /* 忽略 */ }
    try {
      const maps = (await window.api.mapRead(book.value)) as { name: string; nodes?: { label: string; status: string }[] }[]
      for (const m of maps) for (const n of m.nodes || []) push('地图', n.label, `${m.name} · ${n.status}`)
    } catch { /* 忽略 */ }
    // 自定义面板（阶段二）：条目标题取第一个非空字段值，其余字段拼摘要
    try {
      const list = (await window.api.panelsList(book.value)) as { id: string; name: string; board?: string }[]
      for (const p of list.filter((x) => !x.board)) {
        const data = (await window.api.panelsRead(book.value, p.id)) as { entries?: Record<string, unknown>[] }
        for (const e of data.entries || []) {
          const vals = Object.entries(e)
            .filter(([k, v]) => k !== 'id' && String(v ?? '').trim())
            .map(([, v]) => String(v))
          if (!vals.length) continue
          push(p.name, vals[0].slice(0, 40), vals.slice(1).join(' · ').slice(0, 120))
        }
      }
    } catch { /* 忽略 */ }
  }

  // 技能库 / 素材库 / 灵感便签独立于作品目录，同样要能搜到（按名称即可命中）
  for (const kind of ['skills', 'materials', 'notes'] as const) {
    try {
      const groups = (await window.api.libList(kind)) as {
        name: string
        entries: { name: string; summary: string; tags: string[] }[]
      }[]
      for (const g of groups) {
        for (const e of g.entries) {
          try {
            const raw = await window.api.libRead(kind, g.name, e.name)
            libDocs.push({
              kind,
              group: g.name,
              name: e.name,
              summary: e.summary,
              meta: e.tags.join(' '),
              body: raw.body
            })
          } catch {
            /* 单条目读取失败跳过 */
          }
        }
      }
    } catch {
      /* 库读取失败不影响文稿搜索 */
    }
  }
}

/** 取正文里第一行有内容的文字，作为「按标题命中」时的摘要 */
function firstLine(body: string): string {
  for (const line of body.split('\n')) {
    const t = line.replace(/^#+\s*/, '').trim()
    if (t) return t.slice(0, 80)
  }
  return ''
}

async function run() {
  const kw = q.value.trim()
  cursor.value = 0
  if (!kw) {
    hits.value = []
    return
  }
  const lower = kw.toLowerCase()
  const out: Hit[] = []

  // 功能：匹配页面名
  for (const [view, title] of Object.entries(VIEW_TITLES) as [ViewName, string][]) {
    if (title.includes(kw)) out.push({ kind: 'page', view })
  }

  // 作品：按书名 / 分类 / 标签 / 简介命中（最常用，排在文稿之前）
  await refreshBooks()
  for (const b of bookList) {
    if (out.length >= MAX_HITS) break
    const meta = [b.genre, ...b.tags].filter(Boolean).join(' · ')
    if (`${b.title} ${meta}`.toLowerCase().includes(lower)) {
      out.push({ kind: 'book', book: b.title, text: meta })
      continue
    }
    if (b.idea && b.idea.toLowerCase().includes(lower)) {
      const at = b.idea.toLowerCase().indexOf(lower)
      out.push({ kind: 'book', book: b.title, text: b.idea.slice(Math.max(0, at - 20), at + 60).replace(/\n/g, ' ') })
    }
  }

  try {
    await loadIndex()
  } catch (e) {
    // 索引失败不应让整次搜索返回空：至少保留「功能」「作品」命中
    console.warn('[ink-search] 建立索引失败', (e as Error)?.message || e)
  }

  // 结构化板块：按板块名 / 条目名 / 摘要命中
  for (const d of boardDocs) {
    if (out.length >= MAX_HITS) break
    if (`${d.board} ${d.name}`.toLowerCase().includes(lower) || d.text.toLowerCase().includes(lower)) {
      out.push({ kind: 'board', board: d.board, name: d.name, text: d.text })
    }
  }

  // 技能 / 素材：先按名称与摘要命中，再看正文
  for (const d of libDocs) {
    if (out.length >= MAX_HITS) break
    if (`${d.name} ${d.summary} ${d.meta}`.toLowerCase().includes(lower)) {
      out.push({ kind: 'lib', libKind: d.kind, group: d.group, name: d.name, text: d.summary || firstLine(d.body) })
      continue
    }
    const lines = d.body.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(lower)) continue
      out.push({ kind: 'lib', libKind: d.kind, group: d.group, name: d.name, text: lines[i].trim().slice(0, 80) })
      break
    }
  }

  // 作品文稿：先按文件名命中，再看逐行内容
  for (const d of bookDocs) {
    if (out.length >= MAX_HITS) break
    if (d.path.toLowerCase().includes(lower)) {
      const lines = d.body.split('\n')
      const idx = lines.findIndex((l) => l.trim())
      out.push({ kind: 'file', path: d.path, line: idx >= 0 ? idx + 1 : undefined, text: idx >= 0 ? lines[idx].replace(/^#+\s*/, '').trim().slice(0, 80) : '' })
      continue
    }
    const lines = d.body.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(lower)) continue
      out.push({ kind: 'file', path: d.path, line: i + 1, text: lines[i].trim().slice(0, 80) })
      break
    }
  }

  hits.value = out
}

watch(q, () => {
  // 清空关键词意味着关闭（否则 close() 清空 q 会立刻把面板重新打开）
  if (!q.value.trim()) {
    open.value = false
    hits.value = []
    semHits.value = []
    return
  }
  open.value = true
  semHits.value = []
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void run(), 220)
  // 语义检索（混合）：输入停顿更久才发一次嵌入请求，避免逐键烧 token
  if (semTimer) clearTimeout(semTimer)
  semTimer = setTimeout(() => void runSemantic(), 900)
})

/** 语义检索：配置了「向量化检索」且当前有打开的作品时，补一批语义相关结果（可单独关闭；未配置时静默跳过） */
async function runSemantic() {
  const kw = q.value.trim()
  const book = lib.current?.title || ''
  const vo = app.config?.embeddingOpts
  if (!kw || !book || vo?.injectSearch === false) return
  // 新版独立嵌入服务 / 未迁移完的老版服务商绑定，两者任一可用即可
  const es = app.config?.embeddingService
  const legacy = app.config?.tasks?.embedding
  if (!(es?.baseUrl && es?.model) && !(legacy?.providerId && legacy?.model)) return
  semLoading.value = true
  try {
    const r = (await window.api.vectorSearch(book, kw, vo?.topKSearch || 6)) as {
      hits: { title: string; path: string; text: string; score: number; src: 'book' | 'lib' }[]
    }
    // 输入已经变了就丢弃过期结果
    if (q.value.trim() !== kw) return
    const out: Hit[] = []
    for (const h of r.hits || []) {
      if (h.src === 'lib') {
        // path 是 `kind:组/文件.md`，但打开条目要按显示名（frontmatter name）匹配——从 title（「素材库 · 显示名」）里取
        const m = /^([^:]+):(.+)\/([^/]+)\.md$/.exec(h.path)
        const displayName = (h.title || '').split(' · ').slice(1).join(' · ') || m?.[3] || ''
        if (m) out.push({ kind: 'lib', libKind: m[1], group: m[2], name: displayName, text: h.text.slice(0, 80), semantic: true })
      } else {
        out.push({ kind: 'file', path: h.path, text: h.text.slice(0, 80), semantic: true })
      }
    }
    semHits.value = out
  } catch {
    /* 语义检索失败不影响关键词结果 */
  } finally {
    semLoading.value = false
  }
}

/** 关键词命中在前，语义补充在后（同一文件/库条目只出现一次） */
const mergedHits = computed<Hit[]>(() => {
  if (!semHits.value.length) return hits.value
  const keyOf = (h: Hit) => (h.kind === 'lib' ? `l:${h.libKind}:${h.group}/${h.name}` : h.path || '')
  const seen = new Set(hits.value.map(keyOf))
  return [...hits.value, ...semHits.value.filter((h) => !seen.has(keyOf(h)))]
})

watch(open, (v) => {
  if (v) void nextTick(updatePanelPos)
})

async function pick(h: Hit) {
  close()
  if (h.kind === 'page' && h.view) app.go(h.view)
  else if (h.kind === 'board' && h.board) app.goMaterials(h.board)
  else if (h.kind === 'book' && h.book) {
    await lib.openBook(h.book)
    app.go('writing')
  } else if (h.kind === 'lib' && h.libKind && h.group && h.name) app.requestOpenLibraryEntry(h.libKind, h.group, h.name)
  else if (h.path) app.requestOpenFile(h.path)
}

function close() {
  open.value = false
  q.value = ''
  hits.value = []
}

/** 点击面板与搜索框之外的地方收起结果 */
function onDocMousedown(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (rootEl.value?.contains(t)) return
  if (document.getElementById(PANEL_ID)?.contains(t)) return
  open.value = false
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') return close()
  if (!mergedHits.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    cursor.value = (cursor.value + 1) % mergedHits.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    cursor.value = (cursor.value - 1 + mergedHits.value.length) % mergedHits.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    pick(mergedHits.value[cursor.value])
  }
}

function onHotkey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    inputEl.value?.focus()
    inputEl.value?.select()
    open.value = true
  }
}

function onFileChanged() {
  indexBook = null
}

onMounted(() => {
  window.addEventListener('keydown', onHotkey)
  window.addEventListener('inkdesk:file-changed', onFileChanged)
  window.addEventListener('resize', updatePanelPos)
  document.addEventListener('mousedown', onDocMousedown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onHotkey)
  window.removeEventListener('inkdesk:file-changed', onFileChanged)
  window.removeEventListener('resize', updatePanelPos)
  document.removeEventListener('mousedown', onDocMousedown)
  if (semTimer) clearTimeout(semTimer)
})
</script>

<template>
  <!-- app-nodrag：搜索框必须排除在窗口拖动区之外，否则点击与输入会被拖动吞掉 -->
  <div ref="rootEl" class="relative w-full max-w-[380px] app-nodrag">
    <div
      class="flex items-center gap-2 h-8 px-3 rounded-full bg-[var(--bg)] border transition-colors"
      :class="open ? 'border-[var(--accent)]' : 'border-[var(--border)]'"
    >
      <Search :size="13" class="text-[var(--text-faint)] shrink-0" />
      <input
        ref="inputEl"
        v-model="q"
        class="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] placeholder:text-[var(--text-faint)]"
        placeholder="搜索作品、章节、资料或功能…"
        @focus="q.trim() && (open = true)"
        @keydown="onKey"
      />
      <kbd
        v-if="!q"
        class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-faint)]"
      >
        Ctrl K
      </kbd>
    </div>
  </div>

  <!-- 结果面板挂到 body：脱离顶栏拖动区与层叠上下文，点击才不会被吞、也不会被毛玻璃影响 -->
  <Teleport to="body">
    <div
      v-if="open && canSearch"
      :id="PANEL_ID"
      :style="panelStyle"
      class="fixed rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow)] overflow-hidden z-[70]"
    >
      <div v-if="!mergedHits.length" class="px-4 py-5 text-center text-[12px] text-[var(--text-faint)]">
        {{ semLoading ? `正在语义检索「${q}」…` : `「${q}」没有找到匹配的作品、文稿、资料或功能` }}
      </div>
      <div v-else class="max-h-80 overflow-y-auto">
        <button
          v-for="(h, i) in mergedHits"
          :key="h.kind + (h.book || h.path || h.view || h.name || '') + (h.line || '')"
          class="w-full text-left px-3.5 py-2 cursor-pointer border-b border-[var(--border)] last:border-b-0"
          :class="i === cursor ? 'bg-[var(--panel-2)]' : 'hover:bg-[var(--hover)]'"
          @mouseenter="cursor = i"
          @click="pick(h)"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-soft)] text-[var(--text-faint)] shrink-0">
              {{ h.kind === 'page' ? '功能' : h.kind === 'book' ? '作品' : h.kind === 'board' ? '板块' : h.kind === 'lib' ? '资料' : '文稿' }}
            </span>
            <span
              v-if="h.semantic"
              class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
              :style="{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }"
            >
              语义
            </span>
            <span class="text-[12.5px] truncate" :style="{ color: 'var(--accent)' }">
              {{
                h.kind === 'page'
                  ? VIEW_TITLES[h.view!]
                  : h.kind === 'book'
                    ? h.book
                    : h.kind === 'board'
                      ? `${h.board} / ${h.name}`
                      : h.kind === 'lib'
                        ? `${LIB_LABEL[h.libKind!]} / ${h.group} / ${h.name}`
                        : h.path
              }}
            </span>
            <span v-if="h.line" class="text-[11px] text-[var(--text-faint)] shrink-0">第 {{ h.line }} 行</span>
          </div>
          <div v-if="h.text" class="text-[11.5px] text-[var(--text-dim)] truncate mt-0.5">{{ h.text }}</div>
        </button>
      </div>
      <div class="flex items-center gap-3 px-3.5 py-1.5 border-t border-[var(--border)] text-[10px] text-[var(--text-faint)]">
        <span class="flex items-center gap-1"><CornerDownLeft :size="10" /> 打开</span>
        <span>↑ ↓ 选择</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  </Teleport>
</template>