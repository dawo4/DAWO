<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useLibraryStore } from '../store/library'
import { useAppStore } from '../store/app'
import { useConversationStore } from '../store/conversation'
import { aiRun } from '../ai'
import { renderMarkdown } from '../ui/markdown'
import InkButton from '../ui/InkButton.vue'
import { inkConfirm } from '../ui/inkPrompt'
import { FileSearch, Play, Square, Trash2, FileText, FileUp, Sparkles, CircleCheck } from 'lucide-vue-next'

const lib = useLibraryStore()
const app = useAppStore()
const conv = useConversationStore()

interface ReportItem {
  path: string
  name: string
}

/** treeList 返回嵌套树（目录挂 children），需要递归收集「拆书/」下的报告文件 */
interface TreeNodeLite {
  name: string
  path: string
  dir: boolean
  children?: TreeNodeLite[]
}

const reports = ref<ReportItem[]>([])
const activePath = ref('')
const reportText = ref('')
/** 拆书报告按 Markdown 渲染 */
const reportHtml = computed(() => renderMarkdown(reportText.value))
/** 存档 / 沉淀结果提示 */
const savedTip = ref('')

// ============ 新建拆解 ============
const DIMENSIONS = [
  { key: 'structure', label: '结构与卷章' },
  { key: 'golden', label: '黄金三章' },
  { key: 'pacing', label: '节奏与爽点' },
  { key: 'character', label: '人物设计' },
  { key: 'reusable', label: '可复用套路' }
]
const DIM_LABEL: Record<string, string> = {
  structure: '结构与卷章布局（分卷、关键节点位置）',
  golden: '黄金三章（前 300 字、冲突落地、金手指露面）',
  pacing: '节奏与爽点（间隔规律、压抑释放配比、断章）',
  character: '人物设计（欲望/需要/缺点、反派动机、工具化程度）',
  reusable: '可复用套路（3-5 条，具体到怎么用）'
}
/** 自定义维度：作者想拆什么就拆什么（localStorage 持久化） */
const CUSTOM_DIMS_KEY = 'inkdesk.deconstruct.dims'
const customDims = ref<string[]>((() => {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_DIMS_KEY) || '[]') as string[]
  } catch {
    return []
  }
})())
watch(customDims, (v) => localStorage.setItem(CUSTOM_DIMS_KEY, JSON.stringify(v)), { deep: true })
const newDim = ref('')
const customPicked = ref<string[]>([])

function addCustomDim() {
  const v = newDim.value.trim()
  if (!v) return
  if (!customDims.value.includes(v)) customDims.value.push(v)
  if (!customPicked.value.includes(v)) customPicked.value.push(v)
  newDim.value = ''
}

function toggleCustomDim(d: string) {
  const i = customPicked.value.indexOf(d)
  if (i >= 0) customPicked.value.splice(i, 1)
  else customPicked.value.push(d)
}

/** 补充要求：想特别叮嘱 AI 的内容，随维度一起注入 */
const extraReq = ref('')

const sourceText = ref('')
const picked = ref<string[]>(DIMENSIONS.map((d) => d.key))
const reportTitle = ref('')
const running = ref(false)
const error = ref('')

// ============ 拆解规模：章数越多拆得越简略，10 章以下最精细 ============
const chapterCount = ref(5)
const CHAPTER_PRESETS = [5, 10, 20, 30]
/** 按章数生成拆解精细度指令：注入提示词 {{scale}} */
const scaleText = computed(() => {
  const n = chapterCount.value
  if (n <= 5)
    return `约 ${n} 章（最精细模式）：逐章单独拆解，每章给出独立小节——前 300 字怎么写、冲突如何落地、钩子类型、可直接摘抄的原文证据，分析深度优先`
  if (n <= 10)
    return `约 ${n} 章（精细模式）：逐章拆解，每章聚焦开场钩子、冲突升级与断章位置，引用关键原文证据`
  if (n <= 20)
    return `约 ${n} 章（标准模式）：按情节块分组拆解，归纳节奏规律，只对最亮眼的 3-5 章给出逐章细拆与原文证据`
  return `约 ${n} 章（简略模式）：只拆整体结构、卷章布局与节奏规律，挑选最有代表性的 3 章精拆，其余章节一笔带过——广度优先，控制总篇幅`
})

async function importSource() {
  const r = await window.api.importPickText()
  if (!r || !r.text.trim()) return
  sourceText.value = r.text
  // 标题留空时用文件名自动补上，省一次手输
  if (!reportTitle.value.trim()) reportTitle.value = r.name
}

let aborter: { abort: () => void } | null = null

const sourceChars = computed(() => sourceText.value.length)
const pickedCount = computed(() => picked.value.length + customPicked.value.length)
const canStart = computed(() => !!lib.current && !!sourceText.value.trim() && pickedCount.value > 0 && !running.value)

function toggleDim(key: string) {
  const i = picked.value.indexOf(key)
  if (i >= 0) picked.value.splice(i, 1)
  else picked.value.push(key)
}

async function refreshReports() {
  if (!lib.current) {
    reports.value = []
    return
  }
  try {
    const tree = (await window.api.treeList(lib.current.title)) as TreeNodeLite[]
    const found: ReportItem[] = []
    const walk = (nodes: TreeNodeLite[]) => {
      for (const n of nodes) {
        if (n.dir) {
          // 只进「拆书」目录，别的目录（正文/大纲…）不用扫
          if ((n.path === '拆书' || n.path === '拆书/') && n.children) walk(n.children)
        } else if (n.path.startsWith('拆书/')) {
          found.push({ path: n.path, name: n.name.replace(/\.md$/, '') })
        }
      }
    }
    walk(tree)
    reports.value = found.sort((a, b) => b.name.localeCompare(a.name, 'zh'))
  } catch {
    reports.value = []
  }
}

async function openReport(item: ReportItem) {
  if (running.value) return
  const text = await window.api.fileRead(lib.current!.title, item.path)
  if (!text.trim()) return
  activePath.value = item.path
  reportText.value = text
  sourceText.value = ''
  savedTip.value = ''
}

async function removeReport(item: ReportItem) {
  const ok = await inkConfirm(`删除拆解报告「${item.name}」？`, { confirmText: '删除', danger: true })
  if (!ok) return
  await window.api.fileDelete(lib.current!.title, item.path)
  if (activePath.value === item.path) {
    activePath.value = ''
    reportText.value = ''
  }
  await refreshReports()
}

async function start() {
  if (!canStart.value || !lib.current) return
  running.value = true
  error.value = ''
  reportText.value = ''
  activePath.value = ''
  const dims = [
    ...picked.value.map((k) => DIM_LABEL[k] || k),
    ...customPicked.value
  ]
  const dimsText = dims.join('；') + (extraReq.value.trim() ? `；特别关注：${extraReq.value.trim()}` : '')
  let wasAborted = false
  aborter = aiRun('workflow', 'wf-deconstruct', { dimensions: dimsText, scale: scaleText.value, input: sourceText.value.slice(0, 80000) }, {
    onChunk: (c) => (reportText.value += c),
    onAborted: () => (wasAborted = true)
  })
  try {
    await aborter.promise
    // 中止（含半截输出）不存档，避免把残缺报告当完整结果
    if (wasAborted) {
      savedTip.value = '已中止，报告未存档'
      return
    }
    // 拆完自动存档到当前作品的「拆书/」目录，并沉淀进素材库
    const text = reportText.value.trim()
    if (text) {
      const title = (reportTitle.value.trim() || '拆解报告').replace(/[\\/:*?"<>|]/g, '')
      const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ')
      const path = `拆书/${title} · ${stamp.replace(':', '-')}.md`
      await window.api.fileWrite(lib.current.title, path, text)
      activePath.value = path
      await refreshReports()
      // 同时沉淀到素材库「拆书报告」分组，便于写作时引用与复用
      try {
        const summary = text.replace(/[#*\n\r]/g, ' ').trim().slice(0, 80)
        const tags = ['拆书', ...picked.value.map((k) => DIMENSIONS.find((d) => d.key === k)?.label || k)]
        await window.api.libWrite('materials', '拆书报告', title, summary, tags, text)
        savedTip.value = `已存档到作品，并沉淀进素材库 → 拆书报告`
      } catch (e) {
        savedTip.value = `已存档到作品；沉淀素材库失败：${(e as Error).message}`
      }
      setTimeout(() => (savedTip.value = ''), 6000)
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    running.value = false
    aborter = null
  }
}

function stop() {
  aborter?.abort()
}

/** 把这份报告里的可复用套路提炼成技能条目（交给资源管家，走入库提案） */
async function refineToSkills() {
  if (!lib.current || !activePath.value) return
  app.go('assistant')
  await conv.askWith(
    'librarian',
    `请阅读拆书报告「${activePath.value}」，把它「可复用套路」部分提炼成 3-5 个独立的写作技能条目——每个要有适用场景、可照做的操作步骤、自检清单。整理好后用 write_materials 批量提交到技能库的「拆书提炼」分组。`
  )
}

onMounted(() => {
  void refreshReports()
  void lib.refreshTree()
})

// KeepAlive 下切书不重挂载：换书时清掉上一本的报告状态并重扫历史
watch(
  () => lib.current?.title,
  () => {
    activePath.value = ''
    reportText.value = ''
    void refreshReports()
  }
)
</script>

<template>
  <div class="h-full flex">
    <!-- 左侧：历史拆解 -->
    <aside class="w-64 shrink-0 border-r border-[var(--border)] overflow-y-auto py-3">
      <div class="px-4 pb-2 text-[11px] tracking-widest text-[var(--text-faint)]">历史拆解</div>
      <div
        v-for="r in reports"
        :key="r.path"
        class="w-full text-left px-4 py-2 cursor-pointer transition-colors group flex items-center gap-2"
        :class="activePath === r.path ? 'bg-[var(--panel-2)]' : 'hover:bg-[var(--hover)]'"
        @click="openReport(r)"
      >
        <FileText :size="13" :style="{ color: 'var(--accent)' }" class="shrink-0" />
        <span class="text-[12.5px] truncate flex-1">{{ r.name }}</span>
        <button class="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer" @click.stop="removeReport(r)">
          <Trash2 :size="12" />
        </button>
      </div>
      <div v-if="!reports.length" class="px-4 py-8 text-center text-[12px] text-[var(--text-faint)] leading-6">
        还没有拆解存档<br />导入或粘贴竞品文本到右侧试试
      </div>
    </aside>

    <!-- 右侧：拆解工作区 -->
    <div class="flex-1 min-w-0 overflow-y-auto">
      <div v-if="!lib.current" class="h-full flex flex-col items-center justify-center gap-3 text-[var(--text-faint)]">
        <FileSearch :size="28" />
        <p class="text-[12.5px]">先到书架打开一部作品，拆解报告才会存进它的资料里</p>
      </div>

      <div v-else class="prose-ink max-w-[900px] mx-auto space-y-5 py-6">
        <!-- 新建拆解 -->
        <div class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium">新建拆解</div>
            <span class="text-[11px] text-[var(--text-faint)]">报告自动存入本书「拆书/」目录</span>
          </div>

          <div class="flex gap-2">
            <input v-model="reportTitle" class="ink-input flex-1" placeholder="报告标题，如《诡秘之主》开篇（留空自动命名）" />
          </div>

          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="d in DIMENSIONS"
              :key="d.key"
              class="px-3 py-1.5 text-[12px] rounded-full cursor-pointer transition-colors"
              :class="picked.includes(d.key) ? 'bg-[var(--panel-2)] font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
              :style="picked.includes(d.key) ? { color: 'var(--accent)' } : { background: 'var(--bg-soft)' }"
              @click="toggleDim(d.key)"
            >
              {{ picked.includes(d.key) ? '✓ ' : '' }}{{ d.label }}
            </button>
          </div>

          <!-- 自定义维度：想拆什么就加什么 -->
          <div class="space-y-1.5">
            <div class="text-[11px] text-[var(--text-faint)]">自定义维度（输入后回车添加，想拆什么拆什么）</div>
            <div class="flex gap-2">
              <input
                v-model="newDim"
                class="ink-input flex-1"
                placeholder="如：金句密度 / 情绪线走向 / 章末钩子类型 / 反派出场方式…"
                @keydown.enter="addCustomDim"
              />
              <InkButton variant="ghost" :disabled="!newDim.trim()" @click="addCustomDim">添加</InkButton>
            </div>
            <div v-if="customDims.length" class="flex flex-wrap gap-1.5">
              <span
                v-for="d in customDims"
                :key="d"
                class="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] rounded-full cursor-pointer transition-colors group"
                :class="customPicked.includes(d) ? 'bg-[var(--panel-2)] font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
                :style="customPicked.includes(d) ? { color: 'var(--accent)' } : { background: 'var(--bg-soft)' }"
                :title="customPicked.includes(d) ? '点击取消勾选，按住 ✕ 删除' : '点击勾选'"
                @click="toggleCustomDim(d)"
              >
                {{ customPicked.includes(d) ? '✓ ' : '' }}{{ d }}
                <button
                  class="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer"
                  @click.stop="customDims = customDims.filter((x) => x !== d); customPicked = customPicked.filter((x) => x !== d)"
                >✕</button>
              </span>
            </div>
          </div>

          <!-- 补充要求 -->
          <div class="space-y-1.5">
            <div class="text-[11px] text-[var(--text-faint)]">补充要求（可选，随维度一起交给 AI）</div>
            <textarea v-model="extraReq" class="ink-textarea h-16 text-[12.5px]" placeholder="例如：重点对比我的第一章和它的差距；只拆打斗场面的写法；用表格输出…" />
          </div>

          <!-- 拆解规模：章数越多越简略，10 章以下最精细 -->
          <div class="space-y-1.5">
            <div class="text-[11px] text-[var(--text-faint)]">拆解规模（章数越多拆得越简略，5 章以下逐章精拆）</div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <button
                v-for="n in CHAPTER_PRESETS"
                :key="n"
                class="px-3 py-1.5 text-[12px] rounded-full cursor-pointer transition-colors"
                :class="chapterCount === n ? 'bg-[var(--panel-2)] font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
                :style="chapterCount === n ? { color: 'var(--accent)' } : { background: 'var(--bg-soft)' }"
                @click="chapterCount = n"
              >
                {{ chapterCount === n ? '✓ ' : '' }}{{ n }} 章
              </button>
              <span class="text-[11px] text-[var(--text-faint)] ml-1">自定义</span>
              <input v-model.number="chapterCount" type="number" min="1" max="100" class="ink-input w-16 text-center py-1" />
              <span class="text-[11px] text-[var(--text-faint)]">{{ scaleText.split('：')[1] || '' }}</span>
            </div>
          </div>

          <textarea
            v-model="sourceText"
            class="ink-textarea h-56 text-[13px]"
            placeholder="粘贴竞品文本，或点上方「导入文件」直接选 TXT/MD（自动识别 GBK 编码）。报告只依据这段文本，结论会附原文证据。"
          />
          <div class="flex items-center gap-3 flex-wrap">
            <InkButton variant="ghost" :disabled="running" @click="importSource"><FileUp :size="13" /> 导入文件</InkButton>
            <InkButton :disabled="!canStart" @click="start"><Play :size="13" /> 开始拆解</InkButton>
            <InkButton v-if="running" variant="ghost" @click="stop"><Square :size="12" /> 停止</InkButton>
            <span class="text-[11px] text-[var(--text-faint)]">已载入 {{ sourceChars }} 字 · 拆 {{ chapterCount }} 章 · 已选 {{ pickedCount }} 个维度</span>
          </div>
          <div v-if="error" class="text-sm text-[#e08a7a]">{{ error }}</div>
        </div>

        <!-- 报告区 -->
        <div v-if="reportText || running" class="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div class="text-sm font-medium">
              {{ activePath ? `存档：${activePath}` : running ? '拆解中…' : '拆解报告' }}
            </div>
            <div class="flex items-center gap-2">
              <button
                v-if="activePath && !running"
                class="text-[11.5px] text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer inline-flex items-center gap-1"
                title="让资源管家把「可复用套路」提炼成写作技能条目，存进技能库"
                @click="refineToSkills"
              >
                <Sparkles :size="12" /> 提炼为写作技巧
              </button>
              <span v-if="running" class="text-[11px] text-[var(--text-faint)]">流式生成中，完成后自动存档</span>
            </div>
          </div>
          <div class="markdown-body text-[13px] leading-7 select-text" v-html="reportHtml" /><span v-if="running" class="animate-pulse">▍</span>
          <div v-if="savedTip" class="mt-3 pt-3 border-t border-[var(--border)] text-[11.5px] inline-flex items-center gap-1.5" style="color: var(--accent)">
            <CircleCheck :size="13" /> {{ savedTip }}
            <button class="underline hover:opacity-80 cursor-pointer" @click="app.goLibrary('materials')">去看素材库</button>
          </div>
        </div>

        <p class="text-[11px] text-[var(--text-faint)] leading-5">
          拆解完成会自动存进本书「拆书/」目录，并同步沉淀到素材库的「拆书报告」分组；点报告上方的「提炼为写作技巧」可让资源管家把可复用套路抽成技能条目。
          想要更深入的交互式拆解（追问、对照自己的大纲），可以在「妙笔」里找拆书智能体，把同样的文本粘贴给它。
        </p>
      </div>
    </div>
  </div>
</template>
