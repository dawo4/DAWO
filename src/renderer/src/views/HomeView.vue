<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import { BookOpen, Brain, Check, ChevronRight, Feather, FileSearch, House, LayoutGrid, Lightbulb, Plus, SquarePen, UserRound, Wand2, Workflow, BarChart3, TrendingUp } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()

// ============ 问候 ============
const greeting = ref('')
const QUOTES = [
  '路漫漫其修远兮，吾将上下而求索。',
  '文章千古事，得失寸心知。',
  '笔落惊风雨，诗成泣鬼神。',
  '为人性僻耽佳句，语不惊人死不休。',
  '读书破万卷，下笔如有神。'
]
const quote = ref(QUOTES[0])

function makeGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了，创作者。'
  if (h < 9) return '早安，文字与晨光都别辜负。'
  if (h < 12) return '上午好，写一点什么再忙别的。'
  if (h < 14) return '午安，午后的章节刚刚好。'
  if (h < 18) return '下午好，故事还在等你。'
  return '晚上好，正是码字的好时候。'
}

const today = computed(() => {
  const d = new Date()
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${week}`
})

// ============ 数据 ============
interface BookCard {
  title: string
  genre: string
  audience: string
  idea: string
  words: number
  updatedAt: string
}
const recentBooks = ref<BookCard[]>([])
const todayHand = ref(0)
const todayAi = ref(0)
const streak = ref(0)
const goal = ref(Number(localStorage.getItem('inkdesk.dailyGoal')) || 3000)
/** 进度条挂载后再涨到目标值，形成增长动画 */
const barReady = ref(false)

const totalToday = computed(() => todayHand.value + todayAi.value)
const goalPct = computed(() => (goal.value > 0 ? Math.min(100, Math.round((totalToday.value / goal.value) * 100)) : 0))
const handPct = computed(() => (goal.value > 0 ? Math.min(100, Math.round((todayHand.value / goal.value) * 100)) : 0))
const aiPct = computed(() => (goal.value > 0 ? Math.min(100, Math.round((todayAi.value / goal.value) * 100)) : 0))

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 */
function relTime(iso: string): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return ''
  const min = Math.floor(ms / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return `${d} 天前`
}

function fmtWords(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万字` : `${n} 字`
}

async function load() {
  greeting.value = makeGreeting()
  quote.value = QUOTES[Math.floor(Math.random() * QUOTES.length)]
  await lib.loadBooks()
  const day = new Date().toISOString().slice(0, 10)
  const daysAll: Record<string, number> = {}
  todayHand.value = 0
  todayAi.value = 0
  const cards: BookCard[] = []
  for (const b of lib.books) {
    const s = await window.api.statsGet(b.title)
    for (const [d, v] of Object.entries(s.days || {})) {
      daysAll[d] = (daysAll[d] || 0) + (v.handwritten || 0) + (v.ai || 0)
    }
    const t = s.days?.[day]
    if (t) {
      todayHand.value += t.handwritten || 0
      todayAi.value += t.ai || 0
    }
    const words = Object.values(s.prevCounts || {}).reduce((a, n) => a + n, 0)
    cards.push({
      title: b.title,
      genre: b.genre || '',
      audience: b.audience || '',
      idea: b.idea || '',
      words,
      updatedAt: b.updatedAt || ''
    })
  }
  recentBooks.value = cards.slice(0, 3)
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
  // 看板：最近 14 天趋势 + 全部作品字数排行
  const trend: { date: string; label: string; total: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    trend.push({ date: key, label: `${d.getMonth() + 1}/${d.getDate()}`, total: daysAll[key] || 0 })
  }
  trend14.value = trend
  bookRanking.value = [...cards].sort((a, b) => b.words - a.words).slice(0, 5)
  // 数据到位后，让进度条从 0 涨上去
  void nextTick(() => requestAnimationFrame(() => (barReady.value = true)))
}

// ============ 看板 ============
const trend14 = ref<{ date: string; label: string; total: number }[]>([])
const bookRanking = ref<BookCard[]>([])
const trendMax = computed(() => Math.max(1, ...trend14.value.map((t) => t.total)))
const trend14Total = computed(() => trend14.value.reduce((a, t) => a + t.total, 0))
const rankMax = computed(() => Math.max(1, ...bookRanking.value.map((b) => b.words)))

// ============ 动作 ============
function openBook(title: string) {
  void (async () => {
    await lib.openBook(title)
    app.go('writing')
  })()
}

function enterWriting() {
  if (lib.current) app.go('writing')
  else app.requestBookshelf('new')
}

// ============ 灵感速记 ============
const note = ref('')
const noteSaved = ref(false)

async function saveNote() {
  const text = note.value.trim()
  if (!text) return
  const name = text.replace(/\s+/g, ' ').slice(0, 14) || '速记'
  const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ')
  await window.api.libWrite('notes', '通用', `${name} · ${stamp}`, '首页速记', ['灵感'], text)
  note.value = ''
  noteSaved.value = true
  window.dispatchEvent(new CustomEvent('inkdesk:lib-changed'))
  setTimeout(() => (noteSaved.value = false), 2500)
}

function openNotes() {
  app.goLibrary('notes')
}

// ============ 常用工具 ============
const TOOLS = [
  { key: 'new', title: 'AI 一键建书', desc: '定位 + 灵感生成', icon: SquarePen, run: () => app.requestBookshelf('new') },
  { key: 'workflow', title: '逐章生文工作流', desc: '细纲到正文一条龙', icon: Workflow, run: () => app.go('workflow') },
  { key: 'deai', title: '整章去 AI 味', desc: '六维信号 + 注入改写', icon: Wand2, run: () => { app.writingRightTab = 'deai'; app.go('writing') } },
  { key: 'assistant', title: '妙笔', desc: '智能体工作台', icon: UserRound, run: () => app.go('assistant') },
  { key: 'memory', title: '记忆库', desc: '全局与本书记忆', icon: Brain, run: () => { app.settingsTab = 'memory'; app.go('settings') } },
  { key: 'panels', title: '添加面板', desc: '新建自定义面板', icon: LayoutGrid, run: () => { app.materialsAddOpen = true; app.go('materials') } },
  { key: 'deconstruct', title: '竞品拆书', desc: '分析节奏与爽点', icon: FileSearch, run: () => app.go('deconstruct') },
  { key: 'notes', title: '灵感便签', desc: '随手记录灵感', icon: Lightbulb, run: openNotes }
]

onMounted(() => void load())
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="relative max-w-[1120px] mx-auto px-8 py-9">
      <!-- 背景装饰：淡金「墨」字水印（纯装饰，不可交互） -->
      <div aria-hidden="true" class="pointer-events-none absolute -top-8 right-0 font-serif-ink text-[220px] leading-none select-none" style="color: var(--accent); opacity: 0.04">墨</div>

      <!-- 问候区：眉线 + 大宋体 + 引文，右侧作品入口胶囊 -->
      <div class="rise-in relative mb-9 flex items-end justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5 mb-2.5">
            <span class="h-px w-7" style="background: var(--accent)" />
            <span class="text-[10.5px] tracking-[0.22em] text-[var(--text-faint)]">{{ today }}</span>
          </div>
          <h1 class="font-serif-ink text-[30px] leading-tight mb-2">{{ greeting }}</h1>
          <p class="text-[12px] text-[var(--text-faint)]">
            <span style="color: var(--accent)">「</span> {{ quote }}
            <span style="color: var(--accent)">」</span>
          </p>
        </div>
        <button
          class="shrink-0 mb-1 inline-flex items-center gap-1.5 text-[12px] px-4 py-1.5 rounded-full border border-[var(--border)] bg-[var(--panel)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)] cursor-pointer transition-colors"
          @click="app.go('bookshelf')"
        >
          全部作品 <ChevronRight :size="12" />
        </button>
      </div>

      <!-- 卡片组：不对称三栏，灵感卡下沉半格打破齐平 -->
      <div class="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr_0.85fr] gap-4 mb-9 items-start">
        <!-- 我的书架 -->
        <div class="rise-in rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4" style="box-shadow: var(--shadow); animation-delay: 60ms">
          <div class="flex items-center gap-1.5 mb-3.5">
            <BookOpen :size="13" :style="{ color: 'var(--accent)' }" />
            <span class="text-[13px] font-medium tracking-wide">我的书架</span>
            <span class="h-px flex-1 ml-1.5" style="background: linear-gradient(to right, var(--border), transparent)" />
            <span class="text-[10.5px] text-[var(--text-faint)]">最近 {{ recentBooks.length }} 本</span>
          </div>

          <div v-if="recentBooks.length" class="space-y-1">
            <div
              v-for="b in recentBooks"
              :key="b.title"
              class="group flex items-center gap-3 p-2 rounded-lg cursor-pointer border border-transparent hover:border-[var(--border)] hover:bg-[var(--bg-soft)] transition-colors"
              @click="openBook(b.title)"
            >
              <!-- 书封：竖排宋体书名 + 金色书脊 -->
              <div
                class="shrink-0 w-10 h-[56px] rounded-md flex items-center justify-center overflow-hidden border transition-transform duration-200 group-hover:scale-[1.03]"
                style="background: linear-gradient(165deg, var(--panel-2), var(--bg-soft)); border-color: var(--border); box-shadow: inset 2px 0 0 var(--accent)"
              >
                <span class="font-serif-ink text-[10px] leading-tight text-center px-0.5" style="writing-mode: vertical-rl; color: var(--accent); max-height: 46px; overflow: hidden">
                  {{ b.title.slice(0, 6) }}
                </span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-[13px] truncate transition-colors group-hover:text-[var(--accent)]">{{ b.title }}</div>
                <div class="text-[11px] text-[var(--text-faint)] truncate mt-0.5">
                  {{ b.genre }}<template v-if="b.audience"> · {{ b.audience }}</template> · {{ fmtWords(b.words) }}
                </div>
                <div class="text-[10.5px] text-[var(--text-faint)] truncate mt-0.5">
                  {{ b.idea ? b.idea.replace(/\s+/g, ' ').slice(0, 24) : '上次编辑：' + relTime(b.updatedAt) }}
                </div>
              </div>
            </div>
          </div>
          <div v-else class="py-7 text-center rounded-lg border border-dashed border-[var(--border)] text-[12px] text-[var(--text-faint)]">
            还没有作品，从下面开始你的第一部
          </div>

          <button
            class="mt-3 w-full flex items-center justify-center gap-1.5 text-[12px] py-2 rounded-lg border border-dashed border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)] cursor-pointer transition-colors"
            @click="app.requestBookshelf('new')"
          >
            <Plus :size="13" /> 创建新作品
          </button>
        </div>

        <!-- 码字进度：大号宋体数字，主按钮压轴 -->
        <div class="rise-in rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 flex flex-col" style="box-shadow: var(--shadow); animation-delay: 140ms">
          <div class="flex items-center gap-1.5 mb-4">
            <Feather :size="13" :style="{ color: 'var(--accent)' }" />
            <span class="text-[13px] font-medium tracking-wide">码字进度</span>
            <span class="h-px flex-1 ml-1.5" style="background: linear-gradient(to right, var(--border), transparent)" />
            <span class="text-[10.5px] text-[var(--text-faint)]">目标 {{ goal }}</span>
          </div>

          <div class="space-y-4 flex-1">
            <div>
              <div class="flex items-baseline gap-1.5">
                <span class="font-serif-ink text-[27px] leading-none" :style="{ color: 'var(--accent)' }">{{ todayHand }}</span>
                <span class="text-[11px] text-[var(--text-faint)]">字 · 手写</span>
                <span class="ml-auto text-[10.5px] text-[var(--text-dim)] tabular-nums">{{ handPct }}%</span>
              </div>
              <div class="h-[5px] rounded-full mt-2 overflow-hidden" style="background: var(--bg-soft)">
                <div
                  class="h-full rounded-full transition-[width] duration-700"
                  style="transition-timing-function: var(--ease-out-quart); background: linear-gradient(to right, color-mix(in srgb, var(--accent) 55%, transparent), var(--accent))"
                  :style="{ width: barReady ? handPct + '%' : '0%' }"
                />
              </div>
            </div>
            <div>
              <div class="flex items-baseline gap-1.5">
                <span class="font-serif-ink text-[27px] leading-none" :style="{ color: 'var(--accent)', opacity: 0.62 }">{{ todayAi }}</span>
                <span class="text-[11px] text-[var(--text-faint)]">字 · AI 辅助</span>
                <span class="ml-auto text-[10.5px] text-[var(--text-dim)] tabular-nums">{{ aiPct }}%</span>
              </div>
              <div class="h-[5px] rounded-full mt-2 overflow-hidden" style="background: var(--bg-soft)">
                <div
                  class="h-full rounded-full transition-[width] duration-700"
                  style="transition-timing-function: var(--ease-out-quart); background: linear-gradient(to right, color-mix(in srgb, var(--accent) 30%, transparent), color-mix(in srgb, var(--accent) 62%, transparent))"
                  :style="{ width: barReady ? aiPct + '%' : '0%' }"
                />
              </div>
            </div>
            <div
              v-if="streak > 0"
              class="ok-pulse inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full self-start"
              style="background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent)"
            >
              <Check :size="11" /> 连续创作 {{ streak }} 天
            </div>
          </div>

          <button
            class="mt-4 w-full flex items-center justify-center gap-1.5 text-[13px] py-2.5 rounded-lg cursor-pointer font-medium text-[#1b1712] transition-[filter,box-shadow] hover:brightness-110"
            style="background: var(--accent); box-shadow: 0 4px 16px color-mix(in srgb, var(--accent) 22%, transparent)"
            @click="enterWriting"
          >
            <SquarePen :size="14" /> 进入写作模式
          </button>
        </div>

        <!-- 灵感速记：下沉半格，打破三卡齐平 -->
        <div
          class="rise-in rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 flex flex-col lg:mt-7"
          style="box-shadow: var(--shadow); animation-delay: 220ms"
        >
          <div class="flex items-center gap-1.5 mb-3">
            <Lightbulb :size="13" :style="{ color: 'var(--accent)' }" />
            <span class="text-[13px] font-medium tracking-wide">灵感速记</span>
            <span class="h-px flex-1 ml-1.5" style="background: linear-gradient(to right, var(--border), transparent)" />
            <button class="text-[11.5px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer transition-colors" title="打开灵感便签库" @click="openNotes">
              便签库
            </button>
          </div>
          <textarea v-model="note" class="ink-textarea flex-1 text-[12.5px] resize-none min-h-[120px]" placeholder="点击记录灵感…自动存进灵感便签" />
          <button
            class="mt-2.5 w-full flex items-center justify-center gap-1.5 text-[12px] py-2 rounded-lg border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)] cursor-pointer transition-colors disabled:opacity-40"
            :disabled="!note.trim()"
            @click="saveNote"
          >
            <Check v-if="noteSaved" :size="13" style="color: var(--accent)" class="ok-pulse" />
            {{ noteSaved ? '已存入灵感便签' : '记下来' }}
          </button>
        </div>
      </div>

      <!-- 创作看板：最近 14 天趋势 + 作品字数排行 -->
      <div class="rise-in grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 mb-9" style="animation-delay: 240ms">
        <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4" style="box-shadow: var(--shadow)">
          <div class="flex items-center gap-1.5 mb-4">
            <TrendingUp :size="13" :style="{ color: 'var(--accent)' }" />
            <span class="text-[13px] font-medium tracking-wide">最近 14 天</span>
            <span class="h-px flex-1 ml-1.5" style="background: linear-gradient(to right, var(--border), transparent)" />
            <span class="text-[10.5px] text-[var(--text-faint)]">合计 <span class="font-serif-ink text-[12px]" style="color: var(--accent)">{{ fmtWords(trend14Total) }}</span></span>
          </div>
          <div class="flex items-end gap-[3px] h-[84px]">
            <div
              v-for="t in trend14"
              :key="t.date"
              class="flex-1 rounded-t-[3px] transition-all duration-500 relative group cursor-default hover:brightness-125"
              :style="{
                height: barReady ? Math.max(3, (t.total / trendMax) * 100) + '%' : '3%',
                background: t.total > 0 ? 'linear-gradient(to top, color-mix(in srgb, var(--accent) 32%, transparent), var(--accent))' : 'var(--bg-soft)',
                opacity: t.total > 0 ? (t.date === trend14[trend14.length - 1]?.date ? 1 : 0.55) : 1
              }"
              :title="`${t.label}：${t.total} 字`"
            >
              <span class="absolute -top-5 left-1/2 -translate-x-1/2 text-[9.5px] text-[var(--text-dim)] opacity-0 group-hover:opacity-100 whitespace-nowrap tabular-nums">{{ t.total }} 字</span>
            </div>
          </div>
          <div class="flex justify-between mt-2 text-[9.5px] text-[var(--text-faint)]">
            <span>{{ trend14[0]?.label }}</span>
            <span>{{ trend14[6]?.label }}</span>
            <span style="color: var(--accent)">今天</span>
          </div>
        </div>
        <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4" style="box-shadow: var(--shadow)">
          <div class="flex items-center gap-1.5 mb-4">
            <BarChart3 :size="13" :style="{ color: 'var(--accent)' }" />
            <span class="text-[13px] font-medium tracking-wide">作品字数排行</span>
            <span class="h-px flex-1 ml-1.5" style="background: linear-gradient(to right, var(--border), transparent)" />
          </div>
          <p v-if="!bookRanking.length" class="text-[11.5px] text-[var(--text-faint)]">还没有作品数据。</p>
          <div v-else class="space-y-3">
            <div v-for="(b, idx) in bookRanking" :key="b.title" class="cursor-pointer group" @click="openBook(b.title)">
              <div class="flex items-baseline gap-2 text-[12px]">
                <span class="font-serif-ink text-[13px] w-5 shrink-0" :style="{ color: idx === 0 ? 'var(--accent)' : 'var(--text-faint)' }">{{ String(idx + 1).padStart(2, '0') }}</span>
                <span class="truncate max-w-[50%] group-hover:text-[var(--accent)] transition-colors">{{ b.title }}</span>
                <span class="text-[10px] text-[var(--text-faint)] truncate">{{ b.genre }}</span>
                <span class="ml-auto text-[10.5px] text-[var(--text-dim)] tabular-nums">{{ fmtWords(b.words) }}</span>
              </div>
              <div class="h-[4px] rounded-full mt-1.5 ml-7 overflow-hidden" style="background: var(--bg-soft)">
                <div
                  class="h-full rounded-full transition-all duration-700"
                  :style="{ background: 'var(--accent)', opacity: idx === 0 ? 0.95 : 0.55, width: barReady ? (b.words / rankMax) * 100 + '%' : '0%' }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 常用工具：不做等分卡；首项主推（accent 填充），其余轻量条目，悬停浮起 -->
      <div class="rise-in" style="animation-delay: 300ms">
        <div class="flex items-center gap-1.5 mb-3.5">
          <House :size="13" :style="{ color: 'var(--accent)' }" />
          <span class="text-[13px] font-medium tracking-wide">常用工具</span>
          <span class="h-px flex-1 ml-1.5" style="background: linear-gradient(to right, var(--border), transparent)" />
        </div>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            v-for="(t, i) in TOOLS"
            :key="t.key"
            class="group flex items-center gap-3 p-3.5 rounded-xl text-left cursor-pointer transition-all duration-200 border hover:-translate-y-[2px]"
            :class="
              i === 0
                ? 'text-[#1b1712] font-medium border-transparent hover:brightness-110'
                : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--accent)] hover:bg-[var(--bg-soft)] hover:shadow-[var(--shadow)]'
            "
            :style="i === 0 ? { background: 'var(--accent)', boxShadow: '0 4px 16px color-mix(in srgb, var(--accent) 22%, transparent)' } : {}"
            @click="t.run()"
          >
            <span
              class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105"
              :style="i === 0 ? { background: 'rgba(0,0,0,0.14)' } : { background: 'var(--bg-soft)' }"
            >
              <component :is="t.icon" :size="16" :style="i === 0 ? {} : { color: 'var(--accent)' }" />
            </span>
            <span class="min-w-0">
              <span class="block text-[13px]">{{ t.title }}</span>
              <span class="block text-[11px] mt-0.5" :class="i === 0 ? 'text-[#1b1712]/70' : 'text-[var(--text-faint)]'">{{ t.desc }}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>