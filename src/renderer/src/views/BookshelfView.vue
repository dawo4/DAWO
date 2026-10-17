<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import { onHeaderAction } from '../ui/headerActions'
import { inkConfirm, inkPrompt } from '../ui/inkPrompt'
import InkSelect from '../ui/InkSelect.vue'
import InkButton from '../ui/InkButton.vue'
import InkModal from '../ui/InkModal.vue'
import EmptyHint from '../ui/EmptyHint.vue'
import { aiRun } from '../ai'
import {
  BookOpen,
  ChevronDown,
  Clock,
  EllipsisVertical,
  LoaderCircle,
  PenLine,
  Plus,
  Sparkles,
  Trash2,
  WandSparkles,
  X
} from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()

// ============ 问候与今日概览 ============
const greeting = ref('')
const todayTotal = ref({ handwritten: 0, ai: 0 })
const streak = ref(0)
/** 每本书的字数合计（来自各章保存时的字数记录） */
const wordCounts = ref<Record<string, number>>({})

function makeGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了，创作者。灵感正清醒着。'
  if (h < 9) return '早安，文字与晨光都别辜负。'
  if (h < 12) return '上午好，写一点什么再忙别的。'
  if (h < 14) return '午安，午后的章节刚刚好。'
  if (h < 18) return '下午好，故事还在等你。'
  if (h < 23) return '晚上好，正是码字的好时候。'
  return '夜深了，创作者。灵感正清醒着。'
}

async function loadOverview() {
  greeting.value = makeGreeting()
  const daysAll: Record<string, number> = {}
  const day = new Date().toISOString().slice(0, 10)
  todayTotal.value = { handwritten: 0, ai: 0 }
  const counts: Record<string, number> = {}
  for (const b of lib.books) {
    const s = await window.api.statsGet(b.title)
    for (const [d, v] of Object.entries(s.days || {})) {
      daysAll[d] = (daysAll[d] || 0) + (v.handwritten || 0) + (v.ai || 0)
    }
    const v = s.days?.[day]
    if (v) {
      todayTotal.value.handwritten += v.handwritten || 0
      todayTotal.value.ai += v.ai || 0
    }
    counts[b.title] = Object.values(s.prevCounts || {}).reduce((a, n) => a + n, 0)
  }
  wordCounts.value = counts
  // 连续创作天数（含今天或从昨天起算）
  streak.value = 0
  const cur = new Date()
  if (!(day in daysAll)) cur.setDate(cur.getDate() - 1)
  for (;;) {
    const key = cur.toISOString().slice(0, 10)
    if ((daysAll[key] || 0) > 0) {
      streak.value++
      cur.setDate(cur.getDate() - 1)
    } else break
  }
}

// ============ 书架视图：封面色 / 筛选 / 排序 ============
const PALETTE = ['#c9a15f', '#8c6f4e', '#5e7d6a', '#7a5c8e', '#a15b5b', '#4e6e8c']
function coverColor(title: string): string {
  let h = 0
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 997
  return PALETTE[h % PALETTE.length]
}

type Filter = 'all' | 'ungrouped' | string
const filter = ref<Filter>('all')
const sortBy = ref<'updated' | 'name'>('updated')

/** 全部出现过的分组名 */
const groupNames = computed(() => [...new Set(lib.books.map((b) => b.group).filter(Boolean))])

const filteredBooks = computed(() => {
  const list =
    filter.value === 'all'
      ? lib.books
      : filter.value === 'ungrouped'
        ? lib.books.filter((b) => !b.group)
        : lib.books.filter((b) => b.group === filter.value)
  const sorted = [...list]
  if (sortBy.value === 'name') sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  else sorted.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return sorted
})

/** 按分组切成若干段显示（未分组的排在最后） */
const sections = computed(() => {
  if (filter.value !== 'all') return [{ label: '', books: filteredBooks.value }]
  const map = new Map<string, typeof lib.books>()
  for (const b of filteredBooks.value) {
    const k = b.group || ''
    if (!map.has(k)) map.set(k, [] as typeof lib.books)
    map.get(k)!.push(b)
  }
  const named = [...map.entries()].filter(([k]) => k).map(([k, v]) => ({ label: k, books: v }))
  const rest = map.get('') || []
  return rest.length ? [...named, { label: '未分组', books: rest }] : named
})

/** 卡片上的「...」菜单 */
const menuFor = ref('')
function toggleMenu(title: string) {
  menuFor.value = menuFor.value === title ? '' : title
}

function fmtWords(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万字` : `${n} 字`
}

function fmtTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ============ 新建作品 ============
const showCreate = ref(false)
/** 非空 = 编辑模式（值为原书名），保存走 meta 更新而非新建 */
const editingBook = ref('')
const newTitle = ref('')
const newGenre = ref('玄幻')
const GENRES = ['玄幻', '仙侠', '都市', '历史', '科幻', '悬疑', '游戏', '言情', '现言', '古言', '短篇']
const PLATFORM_OPTS = ['起点', '番茄', '晋江', '七猫', '飞卢', '长佩', '盐选', '其他']
const VIEWPOINTS = ['第一人称', '第三人称']
const AUDIENCES = ['男频', '女频', '出版 · 全频']
const TAG_SUGGEST = ['升级流', '无敌流', '系统', '重生', '穿越', '苟系', '争霸', '无限流', '种田', '群像']

const newPlatform = ref('起点')
const newViewpoint = ref('第三人称')
const newAudience = ref('男频')
const newGroup = ref('')
const newTags = ref<string[]>([])
const tagInput = ref('')
const newIdea = ref('')
const ideaBusy = ref(false)
const polishBusy = ref(false)
const ideaAborter = ref<{ abort: () => void } | null>(null)
const error = ref('')

const IDEA_MAX = 500

function resetCreate() {
  newTitle.value = ''
  newGenre.value = '玄幻'
  newPlatform.value = '起点'
  newViewpoint.value = '第三人称'
  newAudience.value = '男频'
  newGroup.value = ''
  newTags.value = []
  tagInput.value = ''
  newIdea.value = ''
  error.value = ''
}

function openCreate() {
  resetCreate()
  editingBook.value = ''
  showCreate.value = true
}

/** 编辑已有作品信息：读回元数据填进同一张表单 */
async function openEdit(title: string) {
  menuFor.value = ''
  error.value = ''
  try {
    const m = (await window.api.bookMetaRead(title)) as Record<string, unknown>
    resetCreate()
    editingBook.value = title
    newTitle.value = String(m.title || title)
    newGenre.value = String(m.genre || '玄幻')
    newPlatform.value = String(m.platform || '起点')
    newViewpoint.value = String(m.viewpoint || '第三人称')
    newAudience.value = String(m.audience || '男频')
    newGroup.value = String(m.group || '')
    newTags.value = Array.isArray(m.styleTags) ? [...(m.styleTags as string[])] : []
    newIdea.value = String(m.idea || '')
    showCreate.value = true
  } catch (e) {
    error.value = `读取作品信息失败：${(e as Error).message}`
  }
}

function addTag(t: string) {
  const v = t.trim()
  if (!v || newTags.value.includes(v)) return
  newTags.value.push(v)
  tagInput.value = ''
}

function onTagKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    addTag(tagInput.value)
  } else if (e.key === 'Backspace' && !tagInput.value && newTags.value.length) {
    newTags.value.pop()
  }
}

async function create() {
  error.value = ''
  if (!newTitle.value.trim()) {
    error.value = '请填写书名'
    return
  }
  const title = newTitle.value.trim()
  try {
    if (editingBook.value) {
      // 编辑模式：书名变了先重命名目录，再写其余元数据
      if (title !== editingBook.value) {
        await window.api.bookRename(editingBook.value, title)
        // 改的是当前打开的书：同步写作台的书引用，防止章节树悬空
        if (lib.current?.title === editingBook.value) await lib.openBook(title)
      }
      await window.api.bookMetaWrite(title, {
        genre: newGenre.value || '未分类',
        platform: newPlatform.value,
        styleTags: [...newTags.value],
        idea: newIdea.value.trim(),
        viewpoint: newViewpoint.value,
        audience: newAudience.value,
        group: newGroup.value.trim()
      })
    } else {
      await window.api.bookCreate({
        title,
        genre: newGenre.value || '未分类',
        platform: newPlatform.value,
        styleTags: [...newTags.value],
        idea: newIdea.value.trim(),
        viewpoint: newViewpoint.value,
        audience: newAudience.value,
        group: newGroup.value.trim()
      })
    }
    showCreate.value = false
    await lib.loadBooks()
    await loadOverview()
  } catch (e) {
    error.value = (e as Error).message.replace('Error invoking remote method', '操作失败')
  }
}

/** 按当前定位让 AI 生成作品简介 */
async function genIdea(polish = false) {
  if (ideaBusy.value || polishBusy.value) return
  const tagText = newTags.value.length ? newTags.value.join('、') : '不限'
  const own = newIdea.value.trim()
  const titleText = newTitle.value.trim() ? `书名：《${newTitle.value.trim()}》` : '书名：未定（不要擅自另起书名）'
  const input = polish
    ? `${titleText}\n题材：${newGenre.value}\n风格标签：${tagText}\n平台：${newPlatform.value}｜目标读者：${newAudience.value}｜视角：${newViewpoint.value}\n请把下面这段简介润色得更抓人、更贴合平台读者口味，控制在 ${IDEA_MAX} 字内，只输出润色后的简介：\n\n${own}`
    : `${titleText}\n题材：${newGenre.value}\n风格标签：${tagText}\n平台：${newPlatform.value}｜目标读者：${newAudience.value}｜视角：${newViewpoint.value}\n作者自己的想法：${own || '（暂无，请你来定）'}`
  if (polish) polishBusy.value = true
  else ideaBusy.value = true
  // 生成与润色都是「替换」语义：清空后再流式写入；润色失败时还原原文
  const prevIdea = newIdea.value
  newIdea.value = ''
  try {
    ideaAborter.value = aiRun('draft', 'wf-idea', { input }, {
      onChunk: (c) => {
        newIdea.value += c
        if (newIdea.value.length > IDEA_MAX * 2) ideaAborter.value?.abort()
      }
    })
    await ideaAborter.value.promise
    newIdea.value = newIdea.value.slice(0, IDEA_MAX)
  } catch (e) {
    error.value = `${polish ? '润色' : '生成'}失败：${(e as Error).message}`
    if (polish) newIdea.value = prevIdea
  } finally {
    ideaBusy.value = false
    polishBusy.value = false
    ideaAborter.value = null
  }
}

// ============ 打开 / 删除 / 导入 ============
async function open(title: string) {
  menuFor.value = ''
  await lib.openBook(title)
  app.go('writing')
}

async function remove(title: string) {
  menuFor.value = ''
  const ok = await inkConfirm(`确定删除《${title}》？`, {
    detail: '书籍文件夹将被移除，此操作不可恢复。',
    confirmText: '删除',
    danger: true
  })
  if (!ok) return
  await window.api.bookDelete(title)
  if (lib.current?.title === title) lib.current = null
  await lib.loadBooks()
  await loadOverview()
}

/** 给某本书改名（标题即目录名，会同步重命名目录） */
async function rename(title: string) {
  menuFor.value = ''
  const v = await inkPrompt('新的书名', title)
  if (!v || v === title) return
  error.value = ''
  try {
    await window.api.bookRename(title, v)
    await lib.loadBooks()
  } catch (e) {
    error.value = `改名失败：${(e as Error).message}`
  }
}

async function setGroup(title: string) {
  menuFor.value = ''
  const v = await inkPrompt('移动到分组（留空表示未分组）', '')
  if (v === null) return
  await window.api.bookMetaWrite(title, { group: v.trim() })
  await lib.loadBooks()
}

// ============ 迁移向导：散落书稿（txt/md/docx 多选）归类成书 ============
const showMigrate = ref(false)
const migrating = ref(false)
const migrateMode = ref<'each' | 'merge'>('each')
const mergeTitle = ref('')
const migrateResult = ref<{ books: string[]; chapters: number; errors: string[] } | null>(null)

async function runMigrate() {
  migrating.value = true
  migrateResult.value = null
  try {
    const r = await window.api.importMigrate(migrateMode.value, mergeTitle.value.trim())
    migrateResult.value = r
    if (r.books.length) {
      await lib.loadBooks()
      await loadOverview()
    }
  } catch (e) {
    migrateResult.value = { books: [], chapters: 0, errors: [(e as Error).message.replace('Error invoking remote method', '').trim()] }
  } finally {
    migrating.value = false
  }
}

let offHeader: (() => void) | null = null

function onDocClick() {
  if (menuFor.value) menuFor.value = ''
}

onMounted(async () => {
  offHeader = onHeaderAction((key) => {
    if (key === 'bookshelf:new') openCreate()
    else if (key === 'bookshelf:import') { migrateResult.value = null; showMigrate.value = true }
  })
  await lib.loadBooks()
  await loadOverview()
  document.addEventListener('click', onDocClick)
})

// KeepAlive 缓存页：从写作台写了几个小时字回来，今日字数/连续创作/各书字数要重算
onActivated(() => {
  void lib.loadBooks()
  void loadOverview()
})

/** 首页等页面请求书架页执行动作（跨视图，KeepAlive 下也能收到）；
 *  immediate：首次挂载时若请求已先于挂载到达（如应用启动后从首页直接点创建），也要补执行 */
watch(
  () => app.bookshelfRequest?.nonce,
  () => {
    const req = app.bookshelfRequest
    if (!req) return
    if (req.action === 'new') openCreate()
    else if (req.action === 'import') {
      // 原本调用了一个并不存在的 importFile()，会在运行时抛 ReferenceError；改走既有的迁移向导
      migrateResult.value = null
      showMigrate.value = true
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  offHeader?.()
  offHeader = null
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <div class="page h-full overflow-y-auto">
    <!-- 问候与概览 -->
    <div class="page-head items-start">
      <div class="min-w-0">
        <div class="flex items-center gap-2.5 mb-2">
          <span class="h-px w-7" style="background: var(--accent)" />
          <span class="section-title tracking-[0.14em]">书架</span>
        </div>
        <h1 class="font-serif-ink text-display mb-1.5">{{ greeting }}</h1>
        <div class="flex flex-wrap gap-x-5 gap-y-1 text-label text-[var(--text-dim)]">
          <span>作品 <b class="tnum text-[var(--accent)]">{{ lib.books.length }}</b></span>
          <span>今日手写 <b class="tnum text-[var(--accent)]">{{ todayTotal.handwritten }}</b> 字</span>
          <span>今日 AI <b class="tnum text-[var(--accent)]">{{ todayTotal.ai }}</b> 字</span>
          <span v-if="streak > 0">连续创作 <b class="tnum text-[var(--accent)]">{{ streak }}</b> 天</span>
        </div>
      </div>
    </div>

    <!-- 筛选与排序 -->
    <div class="flex items-center gap-2 flex-wrap">
      <button class="shelf-chip" :class="{ 'shelf-chip-on': filter === 'all' }" @click="filter = 'all'">
        全部作品 <span class="tnum opacity-70">{{ lib.books.length }}</span>
      </button>
      <button class="shelf-chip" :class="{ 'shelf-chip-on': filter === 'ungrouped' }" @click="filter = 'ungrouped'">
        未分组 <span class="tnum opacity-70">{{ lib.books.filter((b) => !b.group).length }}</span>
      </button>
      <button
        v-for="g in groupNames"
        :key="g"
        class="shelf-chip"
        :class="{ 'shelf-chip-on': filter === g }"
        @click="filter = g"
      >
        {{ g }}
      </button>

      <div class="flex-1" />

      <button class="shelf-sort" @click="sortBy = sortBy === 'updated' ? 'name' : 'updated'">
        {{ sortBy === 'updated' ? '最近更新' : '按名称' }}
        <ChevronDown :size="12" />
      </button>
    </div>

    <!-- 空书架 -->
    <div v-if="!lib.books.length" class="flex-1 min-h-[320px]">
      <EmptyHint
        :icon="BookOpen"
        title="书架空空如也"
        desc="创建第一部作品；若书稿散落在外面（TXT / Markdown / Word），也可以在顶栏用「迁移书稿」一次性归类成书"
        action="创建第一部作品"
        @action="openCreate"
      />
    </div>

    <!-- 分组段落 + 卡片网格 -->
    <div v-for="sec in sections" :key="sec.label" class="space-y-3">
      <div v-if="sec.label" class="flex items-center gap-2">
        <span class="w-0.5 h-3.5 rounded-full" :style="{ background: 'var(--accent)' }" />
        <span class="text-label">{{ sec.label }}</span>
        <span class="text-micro text-[var(--text-faint)] tnum">{{ sec.books.length }}</span>
      </div>

      <div class="grid gap-6" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))">
        <div v-for="b in sec.books" :key="b.title" class="shelf-card group" @click="open(b.title)">
          <!-- 竖版封面：由书名生成配色 -->
          <div class="shelf-cover" :style="{ background: `linear-gradient(150deg, ${coverColor(b.title)}, ${coverColor(b.title)}99)` }">
            <span class="font-serif-ink" style="writing-mode: vertical-rl">{{ b.title }}</span>
          </div>

          <!-- 信息 -->
          <div class="flex-1 min-w-0 flex flex-col">
            <div class="font-serif-ink text-heading truncate">{{ b.title }}</div>
            <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span class="ink-chip">{{ b.genre }}</span>
              <span v-if="b.audience" class="text-micro text-[var(--text-faint)]">{{ b.audience }}</span>
              <span v-if="b.viewpoint" class="text-micro text-[var(--text-faint)]">{{ b.viewpoint }}</span>
            </div>
            <div class="mt-auto space-y-0.5 pt-2">
              <div class="text-label text-[var(--text-dim)] tnum">{{ fmtWords(wordCounts[b.title] || 0) }}</div>
              <div class="text-micro text-[var(--text-faint)] flex items-center gap-1 tnum">
                <Clock :size="10" />{{ fmtTime(b.updatedAt) }}
              </div>
            </div>
          </div>

          <!-- 「...」菜单 -->
          <button
            class="shelf-more"
            :class="{ 'opacity-100': menuFor === b.title }"
            title="更多操作"
            @click.stop="toggleMenu(b.title)"
          >
            <EllipsisVertical :size="15" />
          </button>
          <div v-if="menuFor === b.title" class="shelf-menu" @click.stop>
            <button @click="openEdit(b.title)">编辑信息</button>
            <button @click="rename(b.title)">重命名</button>
            <button @click="setGroup(b.title)">移动到分组</button>
            <button @click="open(b.title)">开始写作</button>
            <button class="is-danger" @click="remove(b.title)"><Trash2 :size="12" /> 删除</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="error && !showCreate" class="text-label ink-text-danger">{{ error }}</div>

    <!-- ============ 新建作品：全屏表单页 ============ -->
    <Teleport to="body">
      <div v-if="showCreate" class="fixed inset-0 z-[calc(var(--z-modal)-10)] flex flex-col bg-[var(--bg)]">
        <!-- 表单页头部 -->
        <div class="shrink-0 flex items-center gap-3 px-[var(--sp-page)] h-12 border-b border-[var(--border)]">
          <span class="w-0.5 h-3.5 rounded-full" :style="{ background: 'var(--accent)' }" />
          <span class="font-serif-ink text-title">{{ editingBook ? '编辑作品信息' : '新建作品' }}</span>
          <div class="flex-1" />
          <button class="shelf-icon-btn" title="关闭" @click="showCreate = false">
            <X :size="17" />
          </button>
        </div>

        <!-- 表单主体 -->
        <div class="flex-1 min-h-0 overflow-y-auto">
          <div class="mx-auto flex gap-8 px-[var(--sp-page)] py-[var(--sp-page)]" style="max-width: 1080px">
            <!-- 左：封面预览 -->
            <div class="w-[210px] shrink-0">
              <div
                class="shelf-preview"
                :style="
                  newTitle.trim()
                    ? { background: `linear-gradient(150deg, ${coverColor(newTitle)}, ${coverColor(newTitle)}99)`, borderStyle: 'solid' }
                    : {}
                "
              >
                <template v-if="newTitle.trim()">
                  <span class="font-serif-ink shelf-cover-title" style="writing-mode: vertical-rl">{{ newTitle }}</span>
                </template>
                <template v-else>
                  <Plus :size="22" class="text-[var(--text-faint)]" />
                  <span class="text-label text-[var(--text-faint)]">封面预览</span>
                  <span class="text-micro text-[var(--text-faint)] opacity-70">填写书名后自动生成</span>
                </template>
              </div>
              <p class="text-micro text-[var(--text-faint)] text-center mt-3 leading-5">
                封面配色由书名生成<br />后续可在作品设置中替换
              </p>
            </div>

            <!-- 右：表单（label 左 + 控件右 的对齐网格） -->
            <div class="flex-1 min-w-0 space-y-4">
              <div class="ink-field">
                <span class="ink-field-label">书名 <span class="text-[var(--accent)]">*</span></span>
                <input v-model="newTitle" class="ink-input text-heading" placeholder="请输入作品名称" @keyup.enter="create" />
              </div>

              <div class="ink-field">
                <span class="ink-field-label">首发平台</span>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="p in PLATFORM_OPTS"
                    :key="p"
                    class="shelf-pill"
                    :class="{ 'shelf-pill-on': newPlatform === p }"
                    @click="newPlatform = p"
                  >
                    {{ p }}
                  </button>
                </div>
              </div>

              <div class="ink-field">
                <span class="ink-field-label">作品视角</span>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="v in VIEWPOINTS"
                    :key="v"
                    class="shelf-pill"
                    :class="{ 'shelf-pill-on': newViewpoint === v }"
                    @click="newViewpoint = v"
                  >
                    {{ v }}
                  </button>
                </div>
              </div>

              <div class="ink-field">
                <span class="ink-field-label">目标读者</span>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="a in AUDIENCES"
                    :key="a"
                    class="shelf-pill"
                    :class="{ 'shelf-pill-on': newAudience === a }"
                    @click="newAudience = a"
                  >
                    {{ a }}
                  </button>
                </div>
              </div>

              <div class="ink-field">
                <span class="ink-field-label">分类</span>
                <InkSelect v-model="newGenre" class="w-full" :options="GENRES.map((g) => ({ label: g, value: g }))" />
              </div>

              <div class="ink-field">
                <span class="ink-field-label">作品分组</span>
                <input v-model="newGroup" class="ink-input" placeholder="未分组" :list="'grp-list'" />
                <datalist id="grp-list">
                  <option v-for="g in groupNames" :key="g" :value="g" />
                </datalist>
              </div>

              <div class="ink-field field-top">
                <span class="ink-field-label">标签</span>
                <div>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span v-for="t in newTags" :key="t" class="ink-chip ink-chip-accent">
                      {{ t }}
                      <button class="cursor-pointer hover:text-[var(--danger)]" @click="newTags = newTags.filter((x) => x !== t)">
                        <X :size="11" />
                      </button>
                    </span>
                    <input v-model="tagInput" class="shelf-tag-input" placeholder="+ 添加标签（回车）" @keydown="onTagKey" />
                  </div>
                  <div class="flex flex-wrap gap-1.5 mt-2">
                    <button
                      v-for="t in TAG_SUGGEST.filter((x) => !newTags.includes(x))"
                      :key="t"
                      class="shelf-suggest"
                      @click="addTag(t)"
                    >
                      + {{ t }}
                    </button>
                  </div>
                </div>
              </div>

              <div class="ink-field field-top">
                <span class="ink-field-label">作品简介</span>
                <div>
                  <div class="flex items-center justify-end gap-2 mb-1.5">
                    <button class="shelf-ai-btn" :disabled="ideaBusy || polishBusy" @click="genIdea(false)">
                      <LoaderCircle v-if="ideaBusy" :size="12" class="animate-spin" />
                      <Sparkles v-else :size="12" />
                      {{ ideaBusy ? '生成中…' : '生成' }}
                    </button>
                    <button class="shelf-ai-btn" :disabled="ideaBusy || polishBusy || !newIdea.trim()" @click="genIdea(true)">
                      <LoaderCircle v-if="polishBusy" :size="12" class="animate-spin" />
                      <WandSparkles v-else :size="12" />
                      {{ polishBusy ? '润色中…' : 'AI 润色' }}
                    </button>
                  </div>
                  <textarea
                    v-model="newIdea"
                    rows="6"
                    class="ink-textarea text-label"
                    :placeholder="`写下故事核、卖点、主角设定……越具体，智能体越能理解你的想法。也可以点上方「生成」让 AI 按当前定位先出一版。`"
                  />
                  <div class="text-right text-micro text-[var(--text-faint)] mt-1 tnum">{{ newIdea.length }}/{{ IDEA_MAX }}</div>
                </div>
              </div>

              <div v-if="error" class="text-label ink-text-danger pl-[152px]">{{ error }}</div>
            </div>
          </div>
        </div>

        <!-- 底部操作 -->
        <div class="shrink-0 flex items-center justify-end gap-2 px-[var(--sp-page)] h-14 border-t border-[var(--border)]">
          <InkButton variant="quiet" @click="showCreate = false">取消</InkButton>
          <InkButton variant="primary" @click="create">
            <PenLine :size="14" /> {{ editingBook ? '保存' : '落笔' }}
          </InkButton>
        </div>
      </div>

      <!-- 迁移向导：散落书稿（txt/md/docx 多选）归类成书 -->
      <InkModal :open="showMigrate" title="迁移书稿" @close="showMigrate = false">
        <p class="text-label text-[var(--text-dim)] leading-5 mb-4">
          把散落在外面的书稿（TXT / Markdown / Word docx，可多选）归类成书。支持 GBK 等编码自动探测；大文件按「第N章」标题自动拆章。
        </p>
        <div class="ink-field-label mb-1.5">归类方式</div>
        <div class="space-y-2">
          <label class="shelf-radio" :class="{ 'is-on': migrateMode === 'each' }">
            <input v-model="migrateMode" type="radio" value="each" class="mt-0.5" />
            <span class="text-label leading-5">
              <b>每个文件一本书</b><br />
              <span class="text-[var(--text-faint)]">书名取文件名，适合多部作品散着存的情况</span>
            </span>
          </label>
          <label class="shelf-radio" :class="{ 'is-on': migrateMode === 'merge' }">
            <input v-model="migrateMode" type="radio" value="merge" class="mt-0.5" />
            <span class="text-label leading-5">
              <b>全部并入一本书</b><br />
              <span class="text-[var(--text-faint)]">适合一部书分成多个文件存的；内容按文件名顺序拼接</span>
            </span>
          </label>
        </div>
        <div v-if="migrateMode === 'merge'" class="mt-4">
          <div class="ink-field-label mb-1.5">目标书名</div>
          <input v-model="mergeTitle" class="ink-input" placeholder="如：旧稿合集" />
        </div>
        <div v-if="migrateResult" class="mt-4 text-label leading-5 rounded-[var(--r-sm)] border border-[var(--border)] p-3">
          <div class="text-[var(--accent)]">
            完成：建成 {{ migrateResult.books.length }} 本{{ migrateResult.chapters ? `，拆出 ${migrateResult.chapters} 章` : '' }}
          </div>
          <div v-if="migrateResult.books.length" class="text-[var(--text-faint)] mt-0.5">{{ migrateResult.books.join('、') }}</div>
          <div v-if="migrateResult.errors.length" class="mt-1 ink-text-danger">{{ migrateResult.errors.join('；') }}</div>
        </div>
        <template #footer>
          <InkButton variant="quiet" @click="showMigrate = false">关闭</InkButton>
          <InkButton
            variant="primary"
            :disabled="migrating || (migrateMode === 'merge' && !mergeTitle.trim())"
            @click="runMigrate"
          >
            {{ migrating ? '迁移中…' : '选择文件并迁移' }}
          </InkButton>
        </template>
      </InkModal>
    </Teleport>
  </div>
</template>

<style scoped>
/* 表单页头部 / 卡片上的图标按钮 */
.shelf-icon-btn {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  color: var(--text-dim);
  cursor: pointer;
  transition: background-color var(--dur-2), color var(--dur-2);
}
.shelf-icon-btn:hover {
  color: var(--text);
  background: var(--hover);
}

/* 筛选 chip：选中态与全站统一（淡强调底 + 强调色 + 强调描边） */
.shelf-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 1.75rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  font-size: var(--text-label);
  color: var(--text-dim);
  cursor: pointer;
  transition: background-color var(--dur-2), color var(--dur-2), border-color var(--dur-2);
}
.shelf-chip:hover {
  color: var(--text);
  background: var(--hover);
}
.shelf-chip-on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent);
  font-weight: 500;
}

/* 排序：次态用文字按钮 */
.shelf-sort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 1.75rem;
  padding: 0 0.625rem;
  border-radius: var(--r-sm);
  font-size: var(--text-label);
  color: var(--text-dim);
  cursor: pointer;
  transition: background-color var(--dur-2), color var(--dur-2);
}
.shelf-sort:hover {
  color: var(--accent);
  background: var(--hover);
}

/* 作品卡：悬停抬起 2px + 阴影加深（只动 transform 与阴影） */
.shelf-card {
  position: relative;
  display: flex;
  gap: 0.875rem;
  padding: 0.875rem;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--panel);
  box-shadow: var(--sh-1);
  transition: transform var(--dur-2) var(--ease-out), box-shadow var(--dur-2), border-color var(--dur-2);
}
.shelf-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--sh-2);
}
.shelf-cover {
  flex-shrink: 0;
  width: 4rem;
  height: 5.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--r-sm);
}
.shelf-cover > span {
  font-size: var(--text-label);
  line-height: 1.15;
  letter-spacing: 0.02em;
  text-align: center;
  padding: 0 0.25rem;
  max-height: 4.75rem;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.9);
}

/* 卡片「...」菜单 */
.shelf-more {
  position: absolute;
  right: 0.625rem;
  bottom: 0.625rem;
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  color: var(--text-faint);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur-2), background-color var(--dur-2), color var(--dur-2);
}
.shelf-card:hover .shelf-more {
  opacity: 1;
}
.shelf-more:hover {
  color: var(--text);
  background: var(--hover);
}
.shelf-menu {
  position: absolute;
  right: 0.625rem;
  bottom: 2.75rem;
  width: 8rem;
  padding: 0.25rem 0;
  z-index: var(--z-popover);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--panel-2);
  box-shadow: var(--sh-2);
}
.shelf-menu > button {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0.375rem 0.75rem;
  text-align: left;
  font-size: var(--text-label);
  color: var(--text-dim);
  cursor: pointer;
  transition: background-color var(--dur-1), color var(--dur-1);
}
.shelf-menu > button:hover {
  background: var(--hover);
  color: var(--text);
}
.shelf-menu > button.is-danger {
  color: var(--danger);
}
.shelf-menu > button.is-danger:hover {
  color: var(--danger);
}

/* 新建表单：封面预览 */
.shelf-preview {
  width: 13.125rem;
  height: 18.75rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  overflow: hidden;
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
  background: var(--bg-soft);
}
.shelf-cover-title {
  font-size: var(--text-title);
  line-height: 1.2;
  letter-spacing: 0.02em;
  text-align: center;
  padding: 0 0.75rem;
  max-height: 15.625rem;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.9);
}

/* 新建表单：选择 pill */
.shelf-pill {
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  font-size: var(--text-label);
  color: var(--text-dim);
  background: var(--bg-soft);
  cursor: pointer;
  transition: background-color var(--dur-2), color var(--dur-2), border-color var(--dur-2);
}
.shelf-pill:hover {
  color: var(--text);
  border-color: var(--accent-line);
}
.shelf-pill-on {
  background: var(--accent);
  border-color: transparent;
  color: var(--accent-ink);
  font-weight: 500;
}

/* 新建表单：标签输入与建议 */
.shelf-tag-input {
  width: 9rem;
  padding: 0.125rem 0;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-label);
  color: var(--text);
  outline: none;
  transition: border-color var(--dur-2);
}
.shelf-tag-input:focus {
  border-color: var(--accent);
}
.shelf-suggest {
  padding: 0.125rem 0.5rem;
  border-radius: var(--r-pill);
  font-size: var(--text-micro);
  color: var(--text-faint);
  cursor: pointer;
  transition: background-color var(--dur-2), color var(--dur-2);
}
.shelf-suggest:hover {
  color: var(--accent);
  background: var(--hover);
}

/* 新建表单：AI 生成 / 润色 */
.shelf-ai-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0.25rem 0.625rem;
  border-radius: var(--r-pill);
  font-size: var(--text-label);
  color: var(--accent);
  cursor: pointer;
  transition: background-color var(--dur-2);
}
.shelf-ai-btn:hover:not(:disabled) {
  background: var(--hover);
}
.shelf-ai-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 迁移向导：归类方式选项 */
.shelf-radio {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: border-color var(--dur-2), background-color var(--dur-2);
}
.shelf-radio:hover {
  background: var(--hover);
}
.shelf-radio.is-on {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
/* 原生单选钮跟随强调色，避免系统蓝 */
.shelf-radio input[type='radio'] {
  accent-color: var(--accent);
}

/* 表单行：控件是多行内容时顶端对齐（.ink-field 默认居中） */
.field-top {
  align-items: start;
}
.field-top .ink-field-label {
  padding-top: 0.5rem;
}
</style>