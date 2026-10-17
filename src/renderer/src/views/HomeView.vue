<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import InkButton from '../ui/InkButton.vue'
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
  // 「AI 一键建书」要连同跳转一起做：只置一个 request 而不跳页，会让它悬着，
  // 等下次进书架时才突然弹出新建表单
  { key: 'new', title: 'AI 一键建书', desc: '定位 + 灵感生成', icon: SquarePen, run: () => { app.requestBookshelf('new'); app.go('bookshelf') } },
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
  <div class="page relative h-full overflow-y-auto">
    <!-- 背景装饰：淡金「墨」字水印（纯装饰，不可交互） -->
    <div aria-hidden="true" class="pointer-events-none absolute -top-10 right-0 font-serif-ink text-[13.75rem] leading-none select-none" style="color: var(--accent); opacity: 0.04">墨</div>

    <!-- 问候区：眉线 + 大宋体 + 引文，右侧作品入口 -->
    <div class="rise-in relative page-head items-end">
      <div class="min-w-0">
        <div class="flex items-center gap-2.5 mb-2">
          <span class="h-px w-7" style="background: var(--accent)" />
          <span class="section-title tracking-[0.14em]">{{ today }}</span>
        </div>
        <h1 class="font-serif-ink text-display leading-tight mb-1.5">{{ greeting }}</h1>
        <p class="text-label text-[var(--text-faint)]">
          <span style="color: var(--accent)">「</span> {{ quote }}
          <span style="color: var(--accent)">」</span>
        </p>
      </div>
      <button class="home-link" @click="app.go('bookshelf')">
        全部作品 <ChevronRight :size="12" />
      </button>
    </div>

    <!-- 卡片组：不对称三栏，灵感卡下沉半格打破齐平 -->
    <div class="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr_0.85fr] gap-3.5 items-start">
      <!-- 我的书架：封面为主，信息压到右下角 -->
      <div class="rise-in ink-card p-4" style="box-shadow: var(--sh-1); animation-delay: 60ms">
        <div class="card-head">
          <BookOpen :size="13" class="text-[var(--accent)]" />
          <span class="card-head-title">我的书架</span>
          <span class="card-head-line" />
          <span class="card-head-meta">最近 {{ recentBooks.length }} 本</span>
        </div>

        <!-- 高度上限：书架随书数增长会把首页撑出视口，超过两本在卡内滚动（滚动条悬停浮现） -->
        <div v-if="recentBooks.length" class="panel-rail-scroll space-y-1 max-h-[152px] overflow-y-auto">
          <div
            v-for="b in recentBooks"
            :key="b.title"
            class="group flex items-stretch gap-3 p-2 rounded-[var(--r-sm)] cursor-pointer border border-transparent hover:border-[var(--border)] hover:bg-[var(--bg-soft)] transition-colors"
            @click="openBook(b.title)"
          >
            <!-- 书封：竖排宋体书名 + 金色书脊 -->
            <div class="home-cover">
              <span class="font-serif-ink" style="writing-mode: vertical-rl">{{ b.title.slice(0, 6) }}</span>
            </div>
            <div class="flex-1 min-w-0 flex flex-col">
              <div class="text-label truncate transition-colors group-hover:text-[var(--accent)]">{{ b.title }}</div>
              <div class="mt-auto flex items-end gap-2">
                <span class="text-meta text-[var(--text-faint)] truncate min-w-0">
                  {{ b.genre }}<template v-if="b.audience"> · {{ b.audience }}</template>
                </span>
                <span class="ml-auto text-meta text-[var(--text-dim)] tnum shrink-0">{{ fmtWords(b.words) }}</span>
              </div>
              <div class="text-micro text-[var(--text-faint)] truncate mt-0.5">
                {{ b.idea ? b.idea.replace(/\s+/g, ' ').slice(0, 24) : '上次编辑 ' + relTime(b.updatedAt) }}
              </div>
            </div>
          </div>
        </div>
        <div v-else class="home-empty">还没有作品，从下面开始你的第一部</div>

        <button class="home-dashed mt-3" @click="app.requestBookshelf('new')">
          <Plus :size="13" /> 创建新作品
        </button>
      </div>

      <!-- 码字进度：大号宋体数字，主按钮压轴 -->
      <div class="rise-in ink-card p-4 flex flex-col" style="box-shadow: var(--sh-1); animation-delay: 140ms">
        <div class="card-head">
          <Feather :size="13" class="text-[var(--accent)]" />
          <span class="card-head-title">码字进度</span>
          <span class="card-head-line" />
          <span class="card-head-meta">目标 {{ goal }}</span>
        </div>

        <div class="space-y-3.5 flex-1">
          <div>
            <div class="flex items-baseline gap-1.5">
              <span class="font-serif-ink text-display leading-none text-[var(--accent)] tnum">{{ todayHand }}</span>
              <span class="text-meta text-[var(--text-faint)]">字 · 手写</span>
              <span class="ml-auto text-meta text-[var(--text-dim)] tnum">{{ handPct }}%</span>
            </div>
            <div class="home-bar mt-2">
              <div
                class="home-bar-fill"
                :style="{
                  transform: `scaleX(${barReady ? handPct / 100 : 0})`,
                  background: 'linear-gradient(to right, color-mix(in srgb, var(--accent) 55%, transparent), var(--accent))'
                }"
              />
            </div>
          </div>
          <div>
            <div class="flex items-baseline gap-1.5">
              <span class="font-serif-ink text-display leading-none text-[var(--accent)] tnum opacity-60">{{ todayAi }}</span>
              <span class="text-meta text-[var(--text-faint)]">字 · AI 辅助</span>
              <span class="ml-auto text-meta text-[var(--text-dim)] tnum">{{ aiPct }}%</span>
            </div>
            <div class="home-bar mt-2">
              <div
                class="home-bar-fill"
                :style="{
                  transform: `scaleX(${barReady ? aiPct / 100 : 0})`,
                  background:
                    'linear-gradient(to right, color-mix(in srgb, var(--accent) 30%, transparent), color-mix(in srgb, var(--accent) 62%, transparent))'
                }"
              />
            </div>
          </div>
          <div v-if="streak > 0" class="ok-pulse ink-chip ink-chip-accent self-start">
            <Check :size="11" /> 连续创作 {{ streak }} 天
          </div>
        </div>

        <InkButton class="mt-3.5" variant="primary" block @click="enterWriting">
          <SquarePen :size="14" /> 进入写作模式
        </InkButton>
      </div>

      <!-- 灵感速记：下沉半格，打破三卡齐平 -->
      <div class="rise-in ink-card p-4 flex flex-col lg:mt-5" style="box-shadow: var(--sh-1); animation-delay: 220ms">
        <div class="card-head">
          <Lightbulb :size="13" class="text-[var(--accent)]" />
          <span class="card-head-title">灵感速记</span>
          <span class="card-head-line" />
          <button class="card-head-meta cursor-pointer transition-colors hover:text-[var(--accent)]" title="打开灵感便签库" @click="openNotes">
            便签库
          </button>
        </div>
        <textarea v-model="note" class="ink-textarea flex-1 text-label resize-none min-h-[96px]" placeholder="点击记录灵感…自动存进灵感便签" />
        <InkButton class="mt-2.5" variant="ghost" block :disabled="!note.trim()" @click="saveNote">
          <Check v-if="noteSaved" :size="13" class="ok-pulse text-[var(--accent)]" />
          {{ noteSaved ? '已存入灵感便签' : '记下来' }}
        </InkButton>
      </div>
      </div>

    <!-- 创作看板：最近 14 天趋势 + 作品字数排行 -->
    <div class="rise-in grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3.5" style="animation-delay: 240ms">
      <div class="ink-card p-4" style="box-shadow: var(--sh-1)">
        <div class="card-head">
          <TrendingUp :size="13" class="text-[var(--accent)]" />
          <span class="card-head-title">最近 14 天</span>
          <span class="card-head-line" />
          <span class="card-head-meta">
            合计 <span class="font-serif-ink text-meta text-[var(--accent)] tnum">{{ fmtWords(trend14Total) }}</span>
          </span>
        </div>
        <!-- 柱高用 scaleY 而非 height：只动 transform，不触发布局重排 -->
        <div class="flex items-end gap-[3px] h-[68px]">
          <div
            v-for="t in trend14"
            :key="t.date"
            class="group relative flex-1 h-full flex items-end cursor-default"
            :title="`${t.label}：${t.total} 字`"
          >
            <div
              class="home-col"
              :style="{
                transform: `scaleY(${barReady ? Math.max(0.045, t.total / trendMax) : 0.045})`,
                background:
                  t.total > 0 ? 'linear-gradient(to top, color-mix(in srgb, var(--accent) 32%, transparent), var(--accent))' : 'var(--bg-soft)',
                opacity: t.total > 0 ? (t.date === trend14[trend14.length - 1]?.date ? 1 : 0.55) : 1
              }"
            />
            <span class="home-col-tip tnum">{{ t.total }} 字</span>
          </div>
        </div>
        <div class="flex justify-between mt-2 text-micro text-[var(--text-faint)]">
          <span>{{ trend14[0]?.label }}</span>
          <span>{{ trend14[6]?.label }}</span>
          <span class="text-[var(--accent)]">今天</span>
        </div>
      </div>
      <div class="ink-card p-4" style="box-shadow: var(--sh-1)">
        <div class="card-head">
          <BarChart3 :size="13" class="text-[var(--accent)]" />
          <span class="card-head-title">作品字数排行</span>
          <span class="card-head-line" />
        </div>
        <p v-if="!bookRanking.length" class="text-label text-[var(--text-faint)]">还没有作品数据。</p>
        <div v-else class="space-y-2.5">
          <div v-for="(b, idx) in bookRanking" :key="b.title" class="group cursor-pointer" @click="openBook(b.title)">
            <div class="flex items-baseline gap-2 text-label">
              <span
                class="font-serif-ink w-5 shrink-0 tnum"
                :class="idx === 0 ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'"
              >
                {{ String(idx + 1).padStart(2, '0') }}
              </span>
              <span class="truncate max-w-[50%] transition-colors group-hover:text-[var(--accent)]">{{ b.title }}</span>
              <span class="text-micro text-[var(--text-faint)] truncate">{{ b.genre }}</span>
              <span class="ml-auto text-meta text-[var(--text-dim)] tnum">{{ fmtWords(b.words) }}</span>
            </div>
            <div class="home-bar mt-1.5 ml-7">
              <div
                class="home-bar-fill"
                :style="{
                  background: 'var(--accent)',
                  opacity: idx === 0 ? 0.95 : 0.55,
                  transform: `scaleX(${barReady ? b.words / rankMax : 0})`
                }"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 常用工具：安静的图标格，全部同权重，悬停抬起 -->
    <div class="rise-in" style="animation-delay: 300ms">
      <div class="card-head">
        <House :size="13" class="text-[var(--accent)]" />
        <span class="card-head-title">常用工具</span>
        <span class="card-head-line" />
      </div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button v-for="t in TOOLS" :key="t.key" class="home-tool" @click="t.run()">
          <span class="home-tool-icon">
            <component :is="t.icon" :size="16" />
          </span>
          <span class="min-w-0">
            <span class="block text-label">{{ t.title }}</span>
            <span class="block text-micro text-[var(--text-faint)] mt-0.5 truncate">{{ t.desc }}</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 卡片头：图标 + 标题 + 渐隐 hairline + 右侧元信息，首页五张卡与区块共用 */
.card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 0.875rem;
}
.card-head-title {
  font-size: var(--text-label);
  font-weight: 500;
  letter-spacing: 0.02em;
}
.card-head-line {
  flex: 1;
  height: 1px;
  margin-left: 6px;
  background: linear-gradient(to right, var(--border), transparent);
}
.card-head-meta {
  font-size: var(--text-micro);
  color: var(--text-faint);
}

/* 右上「全部作品」入口：次态用文字按钮，hover 才显底 */
.home-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  height: 1.75rem;
  padding: 0 0.625rem;
  margin-bottom: 0.25rem;
  border-radius: var(--r-sm);
  font-size: var(--text-label);
  color: var(--text-dim);
  cursor: pointer;
  transition: background-color var(--dur-2), color var(--dur-2);
}
.home-link:hover {
  color: var(--accent);
  background: var(--hover);
}

/* 书封：竖排宋体书名 + 金色书脊 */
.home-cover {
  flex-shrink: 0;
  width: 2.5rem;
  height: 3.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: linear-gradient(165deg, var(--panel-2), var(--bg-soft));
  box-shadow: inset 2px 0 0 var(--accent);
  transition: transform var(--dur-2) var(--ease-out);
}
.home-cover > span {
  font-size: var(--text-micro);
  line-height: 1.15;
  text-align: center;
  padding: 0 2px;
  max-height: 2.875rem;
  overflow: hidden;
  color: var(--accent);
}
.group:hover .home-cover {
  transform: scale(1.03);
}

/* 空态与虚线占位按钮 */
.home-empty {
  padding: 1.75rem 0;
  text-align: center;
  border: 1px dashed var(--border);
  border-radius: var(--r-sm);
  font-size: var(--text-label);
  color: var(--text-faint);
}
.home-dashed {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 0.5rem 0;
  border: 1px dashed var(--border);
  border-radius: var(--r-sm);
  font-size: var(--text-label);
  color: var(--text-dim);
  cursor: pointer;
  transition: border-color var(--dur-2), color var(--dur-2);
}
.home-dashed:hover {
  color: var(--accent);
  border-color: var(--accent-line);
}

/* 进度条：填充用 scaleX —— 只动 transform，不做 width 动画 */
.home-bar {
  height: 5px;
  border-radius: var(--r-pill);
  overflow: hidden;
  background: var(--bg-soft);
}
.home-bar-fill {
  height: 100%;
  width: 100%;
  border-radius: var(--r-pill);
  transform-origin: left center;
  transition: transform 700ms var(--ease-out-quart);
}

/* 趋势柱：容器满高，用 scaleY 表现数值（不做 height 动画） */
.home-col {
  width: 100%;
  height: 100%;
  border-radius: var(--r-xs) var(--r-xs) 0 0;
  transform-origin: bottom center;
  transition: transform 500ms var(--ease-out-quart);
}
.home-col-tip {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  opacity: 0;
  pointer-events: none;
  white-space: nowrap;
  font-size: var(--text-micro);
  color: var(--text-dim);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: 0 6px;
  transition: opacity var(--dur-2);
}
.group:hover .home-col-tip {
  opacity: 1;
}

/* 工具格：安静的图标格，悬停抬起 2px */
.home-tool {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  text-align: left;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--panel);
  box-shadow: var(--sh-1);
  transition: transform var(--dur-2) var(--ease-out), border-color var(--dur-2), box-shadow var(--dur-2);
}
.home-tool:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--sh-2);
}
.home-tool-icon {
  flex-shrink: 0;
  width: 2.25rem;
  height: 2.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  background: var(--accent-soft);
  color: var(--accent);
}
</style>