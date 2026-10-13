<script setup lang="ts">
// 全书一致性体检：把单章速检的规则跑遍全部正文章节，汇总成一份可跳转的问题清单。
// 纯本地匹配零 AI；大书逐章顺序读取，随时可取消。
import { computed, ref, watch } from 'vue'
import { useAppStore } from '../../store/app'
import { useLibraryStore } from '../../store/library'
import { analyzeHumanSignal } from '../../lib/human-signal'
import { ScanSearch, LoaderCircle, X, ChevronRight, CircleX, CircleAlert, Info } from 'lucide-vue-next'

const props = defineProps<{ book: string; open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const app = useAppStore()
const lib = useLibraryStore()

interface DictEntry { id: string; term: string; category: string; aliases: string[]; desc: string; firstChapter: string }
interface TrackingEntry { id: string; name: string; status: string; lastChapter: string; location: string; note: string }
interface PowerData { realms: { name: string; sortKey?: number }[]; rules: string; chars: { name: string; realm: string }[] }
interface ForeshadowEntry { id: string; content: string; plantChapter: string; planRecycle: string; status: string; note: string }
interface OutlineLite { no: number; beat: string; beatFull?: string }

interface Finding {
  level: 'red' | 'yellow' | 'info'
  path: string
  no: number
  kind: string
  text: string
}

const scanning = ref(false)
const progress = ref(0)
const total = ref(0)
const findings = ref<Finding[]>([])
const stopFlag = ref(false)
/** 已扫描章节数与毒句总数，给完成摘要用 */
const scannedCount = ref(0)
const redCardTotal = ref(0)

const done = computed(() => !scanning.value && findings.value !== null && scannedCount.value > 0)
const redCount = computed(() => findings.value.filter((f) => f.level === 'red').length)
const yellowCount = computed(() => findings.value.filter((f) => f.level === 'yellow').length)

const LEVEL_ICON = { red: CircleX, yellow: CircleAlert, info: Info }
const LEVEL_COLOR = { red: '#e08a7a', yellow: '#d9a441', info: 'var(--accent)' }

async function scan() {
  if (scanning.value || !props.book) return
  // 锁定开扫时的书：扫描中途切书也不许拿旧章节路径读新书文件
  const book = props.book
  const chapters = lib
    .chapterList()
    .map((c) => ({ path: c.path, no: Number(c.name.match(/第(\d+)章/)?.[1] || 0) }))
    .filter((c) => c.path.startsWith('正文/') && c.no > 0)
  findings.value = []
  scannedCount.value = 0
  redCardTotal.value = 0
  if (!chapters.length) return

  scanning.value = true
  stopFlag.value = false
  progress.value = 0
  total.value = chapters.length

  try {
    const [d, t, p, f, o] = await Promise.all([
      window.api.dictRead(book),
      window.api.trackingRead(book),
      window.api.powerRead(book),
      window.api.foreshadowRead(book),
      window.api.outlineRead(book)
    ])
    const dict = (d as DictEntry[]) || []
    const tracking = (t as TrackingEntry[]) || []
    const power = (p as PowerData) || { realms: [], rules: '', chars: [] }
    const foreshadow = (f as ForeshadowEntry[]) || []
    const outline = (o as OutlineLite[]) || []

    const ghosts = tracking.filter((t2) => t2.name && t2.name.length >= 2 && (t2.status === '死亡' || t2.status === '离场'))
    const warns = tracking.filter((t2) => t2.name && t2.name.length >= 2 && (t2.status === '受伤' || t2.status === '闭关'))
    const peopleSet = new Set<string>()
    tracking.forEach((t2) => t2.name && t2.name.length >= 2 && peopleSet.add(t2.name))
    dict.filter((x) => x.category === '人物').forEach((x) => x.term && x.term.length >= 2 && peopleSet.add(x.term))
    const openFs = foreshadow.filter((x) => x.status === '悬置' && x.content)
    const maxNo = Math.max(...chapters.map((c) => c.no))
    /** 伏笔关键字在全书文本里的出现记录 */
    const fsMention = new Map<string, boolean>()
    for (const x of openFs) fsMention.set(x.id, false)

    const out: Finding[] = []

    for (let i = 0; i < chapters.length; i++) {
      if (stopFlag.value) break
      const ch = chapters[i]
      let text = ''
      try {
        text = (await window.api.fileRead(book, ch.path)) as string
      } catch {
        continue
      }
      if (!text) continue
      scannedCount.value++
      progress.value = i + 1

      // 1. 死亡/离场角色现身（疑似吃书）
      for (const g of ghosts) {
        if (text.includes(g.name)) {
          out.push({ level: 'red', path: ch.path, no: ch.no, kind: '疑似吃书', text: `「${g.name}」登记状态是${g.status}，却出现在本章。若为回忆 / 闪回 / 遗言可忽略。` })
        }
      }
      // 2. 受伤/闭关角色现身
      for (const s of warns) {
        if (text.includes(s.name)) {
          out.push({ level: 'yellow', path: ch.path, no: ch.no, kind: '状态未交代', text: `「${s.name}」登记状态是${s.status}——文中出现时记得交代伤势恢复 / 出关缘由。` })
        }
      }
      // 3. 细纲规划出场但正文没写到
      const entry = outline.find((e) => e.no === ch.no)
      if (entry) {
        const src = `${entry.beat || ''}\n${entry.beatFull || ''}`
        if (src.trim()) {
          const planned = [...peopleSet].filter((n) => src.includes(n) && !text.includes(n))
          if (planned.length) {
            out.push({ level: 'yellow', path: ch.path, no: ch.no, kind: '细纲未落地', text: `细纲规划出场：${planned.join('、')}——正文没写到（可能在后半或被遗漏）。` })
          }
        }
      }
      // 4. AI 毒句红牌
      const rc = analyzeHumanSignal(text, 'fiction').redCards
      redCardTotal.value += rc.length
      for (const r of rc.slice(0, 3)) {
        out.push({ level: 'red', path: ch.path, no: ch.no, kind: `毒句·${r.label}`, text: `${r.sample}…（${r.hint}）` })
      }
      // 记录伏笔关键字是否在任何章出现（扫完后判定久悬）
      for (const x of openFs) {
        if (!fsMention.get(x.id) && text.includes(x.content.slice(0, 6))) fsMention.set(x.id, true)
      }
    }

    // 5. 久悬伏笔（悬置 + 距最新章 15+ 章 + 全书再没提过）
    for (const x of openFs) {
      const m = x.plantChapter?.match(/(\d+)/)
      const plantedAt = m ? Number(m[1]) : 0
      if (plantedAt && maxNo - plantedAt >= 15 && !fsMention.get(x.id)) {
        out.push({
          level: 'info',
          path: '',
          no: plantedAt,
          kind: '伏笔久悬',
          text: `${x.content}——埋于第 ${plantedAt} 章，已悬置 ${maxNo - plantedAt} 章且全书未再提及。`
        })
      }
    }

    findings.value = out.sort((a, b) => a.no - b.no || a.kind.localeCompare(b.kind))
  } finally {
    scanning.value = false
  }
}

/** 点击问题跳到对应章节 */
function jump(f: Finding) {
  if (!f.path) return
  app.openFileRequest = { path: f.path, nonce: Date.now() }
  app.go('writing')
  emit('close')
}

watch(
  () => props.open,
  (v) => {
    if (v) stopFlag.value = false
    else stopFlag.value = true // 关窗即停：后台扫描没有意义还占资源
  }
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" @click.self="emit('close')">
      <div class="w-[640px] max-w-[92vw] h-[80vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)]" style="box-shadow: var(--shadow)">
        <!-- 头部 -->
        <div class="shrink-0 flex items-center gap-2 px-5 py-3.5 border-b border-[var(--border)]">
          <ScanSearch :size="15" :style="{ color: 'var(--accent)' }" />
          <span class="font-serif-ink text-[16px]">全书一致性体检</span>
          <div class="flex-1" />
          <button class="text-[var(--text-faint)] hover:text-[var(--text)] cursor-pointer" @click="emit('close')"><X :size="16" /></button>
        </div>

        <!-- 操作区 -->
        <div class="shrink-0 px-5 py-3 border-b border-[var(--border)] flex items-center gap-3">
          <p class="text-[11.5px] text-[var(--text-faint)] leading-5 flex-1">
            跑遍全部正文章节：死亡/离场角色现身、状态未交代、细纲未落地、AI 毒句红牌、久悬伏笔。纯本地匹配零 AI 成本。
          </p>
          <button
            v-if="!scanning"
            class="shrink-0 text-[12.5px] px-4 py-1.5 rounded-lg cursor-pointer font-medium text-[#1b1712] transition-[filter] hover:brightness-110"
            style="background: var(--accent)"
            @click="scan"
          >
            开始体检
          </button>
          <button
            v-else
            class="shrink-0 text-[12.5px] px-4 py-1.5 rounded-lg cursor-pointer border border-[var(--border)] text-[var(--text-dim)] hover:text-[#e08a7a]"
            @click="stopFlag = true"
          >
            停止
          </button>
        </div>

        <!-- 扫描中进度 -->
        <div v-if="scanning" class="shrink-0 px-5 py-2 flex items-center gap-2 text-[12px] text-[var(--text-dim)]">
          <LoaderCircle :size="13" class="animate-spin" style="color: var(--accent)" />
          正在扫描 {{ progress }}/{{ total }} 章…
          <div class="flex-1 h-1 rounded-full overflow-hidden" style="background: var(--bg-soft)">
            <div class="h-full rounded-full transition-all" :style="{ width: (progress / Math.max(total, 1)) * 100 + '%', background: 'var(--accent)' }" />
          </div>
        </div>

        <!-- 完成摘要 -->
        <div v-if="done && !scanning" class="shrink-0 px-5 py-2 border-b border-[var(--border)] text-[12px] flex items-center gap-3 flex-wrap">
          <span>已扫 {{ scannedCount }} 章</span>
          <span :style="{ color: LEVEL_COLOR.red }">红 {{ redCount }}</span>
          <span :style="{ color: LEVEL_COLOR.yellow }">黄 {{ yellowCount }}</span>
          <span style="color: var(--accent)">毒句共 {{ redCardTotal }} 处</span>
          <span v-if="!findings.length" class="ml-auto" style="color: var(--accent)">全书零问题，很干净</span>
        </div>

        <!-- 清单 -->
        <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-1.5">
          <p v-if="!done && !scanning" class="text-[12px] text-[var(--text-faint)] text-center py-10">点「开始体检」跑一遍全书。</p>
          <button
            v-for="(f, i) in findings"
            :key="i"
            class="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] text-left cursor-pointer hover:border-[var(--accent)] transition-colors"
            @click="jump(f)"
          >
            <component :is="LEVEL_ICON[f.level]" :size="14" class="shrink-0 mt-0.5" :style="{ color: LEVEL_COLOR[f.level] }" />
            <span class="flex-1 min-w-0">
              <span class="flex items-center gap-1.5 flex-wrap text-[11.5px]">
                <b>{{ f.no ? `第 ${f.no} 章` : '全书' }}</b>
                <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-dim)]">{{ f.kind }}</span>
              </span>
              <span class="block text-[11.5px] leading-5 mt-0.5 text-[var(--text-dim)]">{{ f.text }}</span>
            </span>
            <ChevronRight v-if="f.path" :size="13" class="shrink-0 mt-0.5 text-[var(--text-faint)]" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
