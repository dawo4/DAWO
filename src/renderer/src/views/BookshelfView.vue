<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import { onHeaderAction } from '../ui/headerActions'
import { inkConfirm, inkPrompt } from '../ui/inkPrompt'
import InkSelect from '../ui/InkSelect.vue'
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

/** 首页等页面请求书架页执行动作（跨视图，KeepAlive 下也能收到）；
 *  immediate：首次挂载时若请求已先于挂载到达（如应用启动后从首页直接点创建），也要补执行 */
watch(
  () => app.bookshelfRequest?.nonce,
  () => {
    const req = app.bookshelfRequest
    if (!req) return
    if (req.action === 'new') openCreate()
    else if (req.action === 'import') void importFile()
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
  <div class="h-full overflow-y-auto">
    <div class="max-w-[1120px] mx-auto px-8 py-7">
      <!-- 问候与概览 -->
      <div class="mb-7 flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5 mb-2">
            <span class="h-px w-7" style="background: var(--accent)" />
            <span class="text-[10.5px] tracking-[0.22em] text-[var(--text-faint)]">书架</span>
          </div>
          <h1 class="font-serif-ink text-2xl mb-1.5">{{ greeting }}</h1>
          <div class="flex gap-6 text-[12.5px] text-[var(--text-dim)]">
            <span>作品 <b style="color: var(--accent)">{{ lib.books.length }}</b></span>
            <span>今日手写 <b style="color: var(--accent)">{{ todayTotal.handwritten }}</b> 字</span>
            <span>今日 AI <b style="color: var(--accent)">{{ todayTotal.ai }}</b> 字</span>
            <span v-if="streak > 0">连续创作 <b style="color: var(--accent)">{{ streak }}</b> 天</span>
          </div>
        </div>
      </div>

      <!-- 筛选与排序 -->
      <div class="flex items-center gap-2 mb-5 flex-wrap">
        <button
          class="text-[12.5px] px-3 py-1.5 rounded-full cursor-pointer transition-colors inline-flex items-center gap-1.5"
          :class="filter === 'all' ? 'font-medium' : 'text-[var(--text-dim)] hover:bg-[var(--hover)]'"
          :style="filter === 'all' ? { background: 'var(--panel-2)', color: 'var(--accent)' } : {}"
          @click="filter = 'all'"
        >
          全部作品 <span class="opacity-70">{{ lib.books.length }}</span>
        </button>
        <button
          class="text-[12.5px] px-3 py-1.5 rounded-full cursor-pointer transition-colors inline-flex items-center gap-1.5"
          :class="filter === 'ungrouped' ? 'font-medium' : 'text-[var(--text-dim)] hover:bg-[var(--hover)]'"
          :style="filter === 'ungrouped' ? { background: 'var(--panel-2)', color: 'var(--accent)' } : {}"
          @click="filter = 'ungrouped'"
        >
          未分组 <span class="opacity-70">{{ lib.books.filter((b) => !b.group).length }}</span>
        </button>
        <button
          v-for="g in groupNames"
          :key="g"
          class="text-[12.5px] px-3 py-1.5 rounded-full cursor-pointer transition-colors"
          :class="filter === g ? 'font-medium' : 'text-[var(--text-dim)] hover:bg-[var(--hover)]'"
          :style="filter === g ? { background: 'var(--panel-2)', color: 'var(--accent)' } : {}"
          @click="filter = g"
        >
          {{ g }}
        </button>

        <div class="flex-1" />

        <button
          class="text-[12px] px-3 py-1.5 rounded-full cursor-pointer text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)]"
          @click="sortBy = sortBy === 'updated' ? 'name' : 'updated'"
        >
          {{ sortBy === 'updated' ? '最近更新' : '按名称' }}
          <ChevronDown :size="12" class="inline ml-0.5" />
        </button>
      </div>

      <!-- 空书架 -->
      <div v-if="!lib.books.length" class="text-center py-24 text-[var(--text-faint)]">
        <BookOpen :size="40" class="mx-auto mb-4 opacity-40" />
        <p class="text-[13px]">书架空空如也</p>
        <button
          class="mt-4 text-[13px] px-4 py-2 rounded-lg cursor-pointer text-[#1b1712] font-medium transition-[filter,box-shadow] hover:brightness-110"
          style="background: var(--accent); box-shadow: 0 3px 12px color-mix(in srgb, var(--accent) 20%, transparent)"
          @click="openCreate"
        >
          <Plus :size="13" class="inline -mt-0.5 mr-1" />创建第一部作品
        </button>
      </div>

      <!-- 分组段落 + 卡片网格 -->
      <div v-for="sec in sections" :key="sec.label" class="mb-7">
        <div v-if="sec.label" class="flex items-center gap-2 mb-3">
          <span class="w-0.5 h-3.5 rounded-full" :style="{ background: 'var(--accent)' }" />
          <span class="text-[13px]">{{ sec.label }}</span>
          <span class="text-[11px] text-[var(--text-faint)]">{{ sec.books.length }}</span>
        </div>

        <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))">
          <div
            v-for="b in sec.books"
            :key="b.title"
            class="group relative flex gap-3.5 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--panel)] cursor-pointer transition-all hover:-translate-y-0.5"
            style="box-shadow: var(--shadow)"
            @click="open(b.title)"
          >
            <!-- 竖版封面：由书名生成配色 -->
            <div
              class="shrink-0 w-[64px] h-[92px] rounded-lg flex items-center justify-center overflow-hidden"
              :style="{ background: `linear-gradient(150deg, ${coverColor(b.title)}, ${coverColor(b.title)}99)` }"
            >
              <span
                class="font-serif-ink text-white/90 text-[13px] leading-[1.15] tracking-wide px-1 text-center"
                style="writing-mode: vertical-rl; max-height: 76px; overflow: hidden"
              >
                {{ b.title }}
              </span>
            </div>

            <!-- 信息 -->
            <div class="flex-1 min-w-0 flex flex-col">
              <div class="font-serif-ink text-[16px] truncate">{{ b.title }}</div>
              <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span class="text-[10.5px] px-1.5 py-0.5 rounded-md bg-[var(--bg-soft)] text-[var(--text-dim)]">
                  {{ b.genre }}
                </span>
                <span v-if="b.audience" class="text-[10.5px] text-[var(--text-faint)]">{{ b.audience }}</span>
                <span v-if="b.viewpoint" class="text-[10.5px] text-[var(--text-faint)]">{{ b.viewpoint }}</span>
              </div>
              <div class="mt-auto space-y-0.5 pt-2">
                <div class="text-[11.5px] text-[var(--text-dim)]">{{ fmtWords(wordCounts[b.title] || 0) }}</div>
                <div class="text-[11px] text-[var(--text-faint)] flex items-center gap-1">
                  <Clock :size="10" />{{ fmtTime(b.updatedAt) }}
                </div>
              </div>
            </div>

            <!-- 「...」菜单 -->
            <button
              class="absolute right-2.5 bottom-2.5 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--hover)] cursor-pointer opacity-0 group-hover:opacity-100"
              :class="{ 'opacity-100': menuFor === b.title }"
              @click.stop="toggleMenu(b.title)"
            >
              <EllipsisVertical :size="15" />
            </button>
            <div
              v-if="menuFor === b.title"
              class="absolute right-2.5 bottom-11 w-32 rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 z-20"
              style="box-shadow: var(--shadow)"
              @click.stop
            >
              <button class="w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--hover)] cursor-pointer" @click="openEdit(b.title)">
                编辑信息
              </button>
              <button class="w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--hover)] cursor-pointer" @click="rename(b.title)">
                重命名
              </button>
              <button class="w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--hover)] cursor-pointer" @click="setGroup(b.title)">
                移动到分组
              </button>
              <button class="w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-dim)] hover:bg-[var(--hover)] cursor-pointer" @click="open(b.title)">
                开始写作
              </button>
              <button
                class="w-full text-left px-3 py-1.5 text-[12px] text-[#e08a7a] hover:bg-[var(--hover)] cursor-pointer inline-flex items-center gap-1.5"
                @click="remove(b.title)"
              >
                <Trash2 :size="12" /> 删除
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="error && !showCreate" class="mt-4 text-[12.5px] text-[#e08a7a]">{{ error }}</div>
    </div>

    <!-- ============ 新建作品：全屏表单页 ============ -->
    <Teleport to="body">
      <div v-if="showCreate" class="fixed inset-0 z-[75] flex flex-col bg-[var(--bg)]">
        <!-- 表单页头部 -->
        <div class="shrink-0 flex items-center gap-3 px-8 h-14 border-b border-[var(--border)]">
          <span class="w-0.5 h-4 rounded-full" :style="{ background: 'var(--accent)' }" />
          <span class="font-serif-ink text-[17px]">{{ editingBook ? '编辑作品信息' : '新建作品' }}</span>
          <div class="flex-1" />
          <button
            class="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--hover)] cursor-pointer"
            title="关闭"
            @click="showCreate = false"
          >
            <X :size="17" />
          </button>
        </div>

        <!-- 表单主体 -->
        <div class="flex-1 min-h-0 overflow-y-auto">
          <div class="max-w-[1080px] mx-auto px-8 py-7 flex gap-8">
            <!-- 左：封面预览 -->
            <div class="w-[210px] shrink-0">
              <div
                class="w-[210px] h-[300px] rounded-xl border border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-2 overflow-hidden"
                :style="
                  newTitle.trim()
                    ? { background: `linear-gradient(150deg, ${coverColor(newTitle)}, ${coverColor(newTitle)}99)`, borderStyle: 'solid' }
                    : { background: 'var(--bg-soft)' }
                "
              >
                <template v-if="newTitle.trim()">
                  <span
                    class="font-serif-ink text-white/90 text-[20px] leading-[1.2] tracking-wide px-3 text-center"
                    style="writing-mode: vertical-rl; max-height: 250px; overflow: hidden"
                  >
                    {{ newTitle }}
                  </span>
                </template>
                <template v-else>
                  <Plus :size="22" class="text-[var(--text-faint)]" />
                  <span class="text-[12px] text-[var(--text-faint)]">封面预览</span>
                  <span class="text-[10.5px] text-[var(--text-faint)] opacity-70">填写书名后自动生成</span>
                </template>
              </div>
              <p class="text-[11px] text-[var(--text-faint)] text-center mt-3 leading-5">
                封面配色由书名生成<br />后续可在作品设置中替换
              </p>
            </div>

            <!-- 右：表单 -->
            <div class="flex-1 min-w-0 space-y-5">
              <!-- 书名 -->
              <div>
                <div class="field-label">书名 <span style="color: var(--accent)">*</span></div>
                <input v-model="newTitle" class="ink-input text-[15px]" placeholder="请输入作品名称" @keyup.enter="create" />
              </div>

              <!-- 首发平台 -->
              <div>
                <div class="field-label">首发平台</div>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="p in PLATFORM_OPTS"
                    :key="p"
                    class="pill"
                    :class="newPlatform === p ? 'pill-on' : 'pill-off'"
                    @click="newPlatform = p"
                  >
                    {{ p }}
                  </button>
                </div>
              </div>

              <!-- 作品视角 / 目标读者 -->
              <div class="flex gap-8 flex-wrap">
                <div>
                  <div class="field-label">作品视角</div>
                  <div class="flex flex-wrap gap-1.5">
                    <button
                      v-for="v in VIEWPOINTS"
                      :key="v"
                      class="pill"
                      :class="newViewpoint === v ? 'pill-on' : 'pill-off'"
                      @click="newViewpoint = v"
                    >
                      {{ v }}
                    </button>
                  </div>
                </div>
                <div>
                  <div class="field-label">目标读者</div>
                  <div class="flex flex-wrap gap-1.5">
                    <button
                      v-for="a in AUDIENCES"
                      :key="a"
                      class="pill"
                      :class="newAudience === a ? 'pill-on' : 'pill-off'"
                      @click="newAudience = a"
                    >
                      {{ a }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- 分类 / 分组 -->
              <div class="flex gap-4">
                <div class="w-52 shrink-0">
                  <div class="field-label">分类</div>
                  <InkSelect v-model="newGenre" class="w-full" :options="GENRES.map((g) => ({ label: g, value: g }))" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="field-label">作品分组</div>
                  <input v-model="newGroup" class="ink-input" placeholder="未分组" :list="'grp-list'" />
                  <datalist id="grp-list">
                    <option v-for="g in groupNames" :key="g" :value="g" />
                  </datalist>
                </div>
              </div>

              <!-- 标签 -->
              <div>
                <div class="field-label">标签</div>
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    v-for="t in newTags"
                    :key="t"
                    class="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-full"
                    :style="{ background: 'var(--panel-2)', color: 'var(--accent)' }"
                  >
                    {{ t }}
                    <button class="hover:text-[#e08a7a] cursor-pointer" @click="newTags = newTags.filter((x) => x !== t)">
                      <X :size="11" />
                    </button>
                  </span>
                  <input
                    v-model="tagInput"
                    class="bg-transparent outline-none text-[12.5px] w-36 border-b border-[var(--border)] focus:border-[var(--accent)] py-0.5"
                    placeholder="+ 添加标签（回车）"
                    @keydown="onTagKey"
                  />
                </div>
                <div class="flex flex-wrap gap-1.5 mt-2">
                  <button
                    v-for="t in TAG_SUGGEST.filter((x) => !newTags.includes(x))"
                    :key="t"
                    class="text-[11px] px-2 py-0.5 rounded-full text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--hover)] cursor-pointer"
                    @click="addTag(t)"
                  >
                    + {{ t }}
                  </button>
                </div>
              </div>

              <!-- 作品简介 -->
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <span class="field-label mb-0">作品简介</span>
                  <div class="flex items-center gap-2">
                    <button
                      class="text-[12px] inline-flex items-center gap-1 px-2.5 py-1 rounded-full cursor-pointer hover:bg-[var(--hover)] disabled:opacity-50"
                      :style="{ color: 'var(--accent)' }"
                      :disabled="ideaBusy || polishBusy"
                      @click="genIdea(false)"
                    >
                      <LoaderCircle v-if="ideaBusy" :size="12" class="animate-spin" />
                      <Sparkles v-else :size="12" />
                      {{ ideaBusy ? '生成中…' : '生成' }}
                    </button>
                    <button
                      class="text-[12px] inline-flex items-center gap-1 px-2.5 py-1 rounded-full cursor-pointer hover:bg-[var(--hover)] disabled:opacity-50"
                      :style="{ color: 'var(--accent)' }"
                      :disabled="ideaBusy || polishBusy || !newIdea.trim()"
                      @click="genIdea(true)"
                    >
                      <LoaderCircle v-if="polishBusy" :size="12" class="animate-spin" />
                      <WandSparkles v-else :size="12" />
                      {{ polishBusy ? '润色中…' : 'AI 润色' }}
                    </button>
                  </div>
                </div>
                <textarea
                  v-model="newIdea"
                  rows="6"
                  class="ink-textarea text-[13px]"
                  :placeholder="`写下故事核、卖点、主角设定……越具体，智能体越能理解你的想法。也可以点上方「生成」让 AI 按当前定位先出一版。`"
                />
                <div class="text-right text-[11px] text-[var(--text-faint)] mt-1">
                  {{ newIdea.length }}/{{ IDEA_MAX }}
                </div>
              </div>

              <div v-if="error" class="text-[12.5px] text-[#e08a7a]">{{ error }}</div>
            </div>
          </div>
        </div>

        <!-- 底部操作 -->
        <div class="shrink-0 flex items-center justify-end gap-3 px-8 h-16 border-t border-[var(--border)]">
          <button
            class="text-[13px] px-5 py-2 rounded-lg cursor-pointer text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
            @click="showCreate = false"
          >
            取消
          </button>
          <button
            class="text-[13px] px-6 py-2 rounded-lg cursor-pointer font-medium inline-flex items-center gap-1.5 text-[#1b1712] transition-[filter,box-shadow] hover:brightness-110"
            style="background: var(--accent); box-shadow: 0 3px 12px color-mix(in srgb, var(--accent) 20%, transparent)"
            @click="create"
          >
            <PenLine :size="14" /> {{ editingBook ? '保存' : '落笔' }}
          </button>
        </div>
      </div>

      <!-- 迁移向导：散落书稿（txt/md/docx 多选）归类成书 -->
      <div v-if="showMigrate" class="fixed inset-0 z-[76] flex items-center justify-center bg-black/50" @click.self="showMigrate = false">
        <div class="w-[440px] rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 space-y-4" style="box-shadow: var(--shadow)">
          <div class="font-serif-ink text-lg">迁移书稿</div>
          <p class="text-xs text-[var(--text-faint)] leading-5">
            把散落在外面的书稿（TXT / Markdown / Word docx，可多选）归类成书。支持 GBK 等编码自动探测；大文件按「第N章」标题自动拆章。
          </p>
          <div>
            <div class="field-label">归类方式</div>
            <div class="space-y-2">
              <label class="flex items-start gap-2 cursor-pointer rounded-lg border border-[var(--border)] p-3" :class="{ 'border-[var(--accent)]': migrateMode === 'each' }">
                <input v-model="migrateMode" type="radio" value="each" class="mt-0.5" />
                <span class="text-[12.5px] leading-5"><b>每个文件一本书</b><br /><span class="text-[var(--text-faint)]">书名取文件名，适合多部作品散着存的情况</span></span>
              </label>
              <label class="flex items-start gap-2 cursor-pointer rounded-lg border border-[var(--border)] p-3" :class="{ 'border-[var(--accent)]': migrateMode === 'merge' }">
                <input v-model="migrateMode" type="radio" value="merge" class="mt-0.5" />
                <span class="text-[12.5px] leading-5"><b>全部并入一本书</b><br /><span class="text-[var(--text-faint)]">适合一部书分成多个文件存的；内容按文件名顺序拼接</span></span>
              </label>
            </div>
          </div>
          <div v-if="migrateMode === 'merge'">
            <div class="field-label">目标书名</div>
            <input v-model="mergeTitle" class="ink-input" placeholder="如：旧稿合集" />
          </div>
          <div v-if="migrateResult" class="text-[12px] leading-5 rounded-lg border border-[var(--border)] p-3">
            <div style="color: var(--accent)">完成：建成 {{ migrateResult.books.length }} 本{{ migrateResult.chapters ? `，拆出 ${migrateResult.chapters} 章` : '' }}</div>
            <div v-if="migrateResult.books.length" class="text-[var(--text-faint)] mt-0.5">{{ migrateResult.books.join('、') }}</div>
            <div v-if="migrateResult.errors.length" class="mt-1" style="color: #e08a7a">{{ migrateResult.errors.join('；') }}</div>
          </div>
          <div class="flex justify-end gap-2 pt-1">
            <button class="text-[13px] px-5 py-2 rounded-lg cursor-pointer text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--hover)]" @click="showMigrate = false">关闭</button>
            <button
              class="text-[13px] px-6 py-2 rounded-lg cursor-pointer font-medium inline-flex items-center gap-1.5 text-[#1b1712] disabled:opacity-50"
              :style="{ background: 'var(--accent)' }"
              :disabled="migrating || (migrateMode === 'merge' && !mergeTitle.trim())"
              @click="runMigrate"
            >
              {{ migrating ? '迁移中…' : '选择文件并迁移' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.field-label {
  font-size: 12.5px;
  color: var(--text-dim);
  margin-bottom: 7px;
}
.pill {
  font-size: 12.5px;
  padding: 5px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid var(--border);
}
.pill-on {
  background: var(--accent);
  color: #1b1712;
  border-color: transparent;
  font-weight: 500;
}
.pill-off {
  color: var(--text-dim);
  background: var(--bg-soft);
}
.pill-off:hover {
  color: var(--text);
  border-color: var(--accent);
}
</style>