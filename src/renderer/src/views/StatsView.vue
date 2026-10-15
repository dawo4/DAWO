<script setup lang="ts">
// 数据页：写作热力图（全年日历）+ AI 成本统计 + 每日明细。
// 热力图数据来自各书 stats.json 聚合；成本基于 AI 调用记录（最近 2000 条）× 模型单价（元/百万 token）。
import { computed, onActivated, onMounted, ref } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import { CalendarDays, Coins, Info } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()

/** 日期 key 与写入口径对齐：stats.json（addStats）与 AI 调用记录的 at 都按 UTC 日期存，
 *  这里若用本地日期，UTC+8 深夜 0-8 点的写作/调用会错位到前一天的格子 */
const utcKey = (d: Date): string => d.toISOString().slice(0, 10)

// ============ 写作热力图 ============
const days = ref<Record<string, { hand: number; ai: number }>>({})
const loading = ref(false)

async function loadWords() {
  loading.value = true
  try {
    await lib.loadBooks()
    const agg: Record<string, { hand: number; ai: number }> = {}
    for (const b of lib.books) {
      const s = (await window.api.statsGet(b.title)) as { days?: Record<string, { handwritten: number; ai: number }> }
      for (const [d, v] of Object.entries(s.days || {})) {
        const cell = (agg[d] = agg[d] || { hand: 0, ai: 0 })
        cell.hand += v.handwritten || 0
        cell.ai += v.ai || 0
      }
    }
    days.value = agg
  } catch {
    /* 读取失败保持空数据，下次激活重试 */
  } finally {
    loading.value = false
  }
}

/** 近一年日历：列=周，行=周一到周日，最后一列对齐今天 */
const YEAR_DAYS = 364
const cells = computed(() => {
  const out: { date: string; total: number; col: number; row: number }[] = []
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - YEAR_DAYS)
  // 对齐到开始日的周一
  const dow = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - dow)
  const total = Math.ceil((today.getTime() - start.getTime()) / 86400000)
  for (let i = 0; i <= total; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const key = utcKey(d)
    const v = days.value[key]
    out.push({ date: key, total: (v?.hand || 0) + (v?.ai || 0), col: Math.floor(i / 7), row: (d.getDay() + 6) % 7 })
  }
  return out
})
const heatMax = computed(() => Math.max(1, ...cells.value.map((c) => c.total)))
const monthLabels = computed(() => {
  // 每列取该列第一天的月份，遇到新月份时打标签
  const labels: { col: number; text: string }[] = []
  let last = ''
  for (const c of cells.value) {
    if (c.row !== 0) continue
    const m = c.date.slice(0, 7)
    if (m !== last) {
      labels.push({ col: c.col, text: `${Number(m.slice(5))}月` })
      last = m
    }
  }
  return labels
})
function heatColor(total: number): string {
  if (!total) return 'var(--bg-soft)'
  const ratio = total / heatMax.value
  const pct = ratio > 0.66 ? 100 : ratio > 0.33 ? 66 : 32
  return `color-mix(in srgb, var(--accent) ${pct}%, var(--bg-soft))`
}
const yearTotal = computed(() => cells.value.reduce((a, c) => a + c.total, 0))
const activeDays = computed(() => cells.value.filter((c) => c.total > 0).length)

// ============ AI 成本统计 ============
interface CallRecord { id: string; at: string; feature: string; featureLabel: string; provider: string; model: string; ok: boolean; status: string; durationMs: number; tokens: number }
const calls = ref<CallRecord[]>([])
const prices = ref<Record<string, number>>({})
const newPrice = ref<Record<string, string>>({})

async function loadCalls() {
  // 记录上限 2000 条，全量拉取后前端聚合
  try {
    calls.value = (await window.api.aiLogQuery({})) as CallRecord[]
    prices.value = { ...(app.config?.modelPrices || {}) }
  } catch {
    /* 拉取失败保持空数据 */
  }
}

function priceOf(model: string): number {
  return prices.value[model] || 0
}
function costOf(rec: CallRecord): number {
  if (rec.status !== 'success') return 0
  return (rec.tokens / 1000000) * priceOf(rec.model)
}
const totalCost = computed(() => calls.value.reduce((a, r) => a + costOf(r), 0))
const totalTokens = computed(() => calls.value.filter((r) => r.status === 'success').reduce((a, r) => a + (r.tokens || 0), 0))

/** 按模型聚合：调用数、token、成本 */
const byModel = computed(() => {
  const map = new Map<string, { model: string; calls: number; tokens: number; cost: number }>()
  for (const r of calls.value) {
    if (r.status !== 'success') continue
    const row = map.get(r.model) || { model: r.model, calls: 0, tokens: 0, cost: 0 }
    row.calls++
    row.tokens += r.tokens || 0
    row.cost += costOf(r)
    map.set(r.model, row)
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
})

/** 按天聚合（最近 30 天）：字数 + AI 成本 */
const daily = computed(() => {
  const out: { date: string; hand: number; ai: number; calls: number; tokens: number; cost: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = utcKey(d)
    const w = days.value[key]
    out.push({ date: key, hand: w?.hand || 0, ai: w?.ai || 0, calls: 0, tokens: 0, cost: 0 })
  }
  const idx = new Map(out.map((r, i) => [r.date, i]))
  for (const r of calls.value) {
    const key = r.at.slice(0, 10)
    const row = idx.get(key)
    if (!row) continue
    out[row].calls++
    out[row].tokens += r.tokens || 0
    out[row].cost += costOf(r)
  }
  return out
})

const maxDayTokens = computed(() => Math.max(1, ...daily.value.map((d) => d.tokens)))

async function savePrice(model: string) {
  const v = Number(newPrice.value[model])
  const next = { ...prices.value }
  if (Number.isFinite(v) && v > 0) next[model] = v
  else delete next[model]
  prices.value = next
  await app.updateConfig({ modelPrices: next })
}

function fmtCost(n: number): string {
  if (n >= 1) return `¥${n.toFixed(2)}`
  if (n >= 0.01) return `¥${n.toFixed(3)}`
  return `¥${n.toFixed(4)}`
}
function fmtNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

onMounted(() => {
  void loadWords()
  void loadCalls()
})
// KeepAlive：切回时重算（写作几个小时后回来看数据）
onActivated(() => {
  void loadWords()
  void loadCalls()
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-[1120px] mx-auto px-8 py-8 space-y-8">
      <!-- 标题 -->
      <div class="rise-in flex items-end justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5 mb-2">
            <span class="h-px w-7" style="background: var(--accent)" />
            <span class="text-[10.5px] tracking-[0.22em] text-[var(--text-faint)]">数据</span>
          </div>
          <h1 class="font-serif-ink text-[26px] leading-tight">创作数据</h1>
        </div>
      </div>

      <!-- 写作热力图 -->
      <div class="rise-in rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5" style="box-shadow: var(--shadow); animation-delay: 60ms">
        <div class="flex items-center gap-1.5 mb-4">
          <CalendarDays :size="13" :style="{ color: 'var(--accent)' }" />
          <span class="text-[13px] font-medium tracking-wide">写作热力图</span>
          <span class="h-px flex-1 ml-1.5" style="background: linear-gradient(to right, var(--border), transparent)" />
          <span class="text-[10.5px] text-[var(--text-faint)]">近一年 · 合计 {{ yearTotal.toLocaleString() }} 字 · {{ activeDays }} 天动笔</span>
        </div>
        <div class="overflow-x-auto pb-1">
          <div class="inline-flex flex-col gap-[3px] min-w-full">
            <!-- 月份标签行 -->
            <div class="flex gap-[3px] text-[9px] text-[var(--text-faint)]" style="height: 14px">
              <template v-for="(m, i) in monthLabels" :key="i">
                <span :style="{ marginLeft: i === 0 ? `${m.col * 14}px` : `${(m.col - (monthLabels[i - 1]?.col ?? 0) - 1) * 14}px` }">{{ m.text }}</span>
              </template>
            </div>
            <div v-for="row in 7" :key="row" class="flex gap-[3px]">
              <div
                v-for="c in cells.filter((x) => x.row === row - 1)"
                :key="c.date"
                class="w-[11px] h-[11px] rounded-[2px] shrink-0"
                :style="{ background: heatColor(c.total) }"
                :title="`${c.date}：${c.total} 字`"
              />
            </div>
          </div>
        </div>
        <div class="flex items-center gap-1.5 mt-3 text-[10px] text-[var(--text-faint)] justify-end">
          <span>少</span>
          <span class="w-[11px] h-[11px] rounded-[2px]" style="background: var(--bg-soft)" />
          <span class="w-[11px] h-[11px] rounded-[2px]" style="background: color-mix(in srgb, var(--accent) 32%, var(--bg-soft))" />
          <span class="w-[11px] h-[11px] rounded-[2px]" style="background: color-mix(in srgb, var(--accent) 66%, var(--bg-soft))" />
          <span class="w-[11px] h-[11px] rounded-[2px]" style="background: var(--accent)" />
          <span>多</span>
        </div>
      </div>

      <!-- AI 成本统计 -->
      <div class="rise-in rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5" style="box-shadow: var(--shadow); animation-delay: 120ms">
        <div class="flex items-center gap-1.5 mb-4">
          <Coins :size="13" :style="{ color: 'var(--accent)' }" />
          <span class="text-[13px] font-medium tracking-wide">AI 成本统计</span>
          <span class="h-px flex-1 ml-1.5" style="background: linear-gradient(to right, var(--border), transparent)" />
          <span class="text-[10.5px] text-[var(--text-faint)]">基于最近 2000 条调用记录 · 合计 {{ fmtCost(totalCost) }} · {{ fmtNum(totalTokens) }} tokens</span>
        </div>

        <div class="flex items-start gap-2 mb-3 text-[11px] text-[var(--text-faint)] leading-5">
          <Info :size="12" class="shrink-0 mt-0.5" />
          <span>
            单价为「元 / 百万 token」混合口径（输入输出合并估算，与各厂商分档计费有出入，仅供量级参考）。
            token 数多为按字数估算值。填 0 或留空保存即删除该模型单价。
          </span>
        </div>

        <div v-if="!byModel.length" class="py-6 text-center text-[12px] text-[var(--text-faint)] rounded-lg border border-dashed border-[var(--border)]">
          还没有 AI 调用记录
        </div>
        <div v-else class="space-y-1.5">
          <div v-for="m in byModel" :key="m.model" class="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg-soft)]">
            <span class="text-[12px] flex-1 min-w-0 truncate" :title="m.model">{{ m.model }}</span>
            <span class="text-[11px] text-[var(--text-faint)] tabular-nums w-16 text-right">{{ m.calls }} 次</span>
            <span class="text-[11px] text-[var(--text-faint)] tabular-nums w-20 text-right">{{ fmtNum(m.tokens) }} tok</span>
            <span class="text-[12px] tabular-nums w-24 text-right" style="color: var(--accent)">{{ fmtCost(m.cost) }}</span>
            <span class="text-[10px] text-[var(--text-faint)] w-20 text-right">¥{{ priceOf(m.model) }}/M</span>
            <input
              v-model="newPrice[m.model]"
              class="ink-input w-20 py-0.5 text-[11px] text-center tabular-nums"
              placeholder="单价"
              :title="`填 ${m.model} 的单价（元/百万 token），回车或点保存`"
              @keydown.enter="savePrice(m.model)"
            />
            <button
              class="text-[11px] px-2 py-0.5 rounded-md cursor-pointer border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors shrink-0"
              @click="savePrice(m.model)"
            >
              存
            </button>
          </div>
        </div>
      </div>

      <!-- 每日明细（30 天） -->
      <div class="rise-in rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5" style="box-shadow: var(--shadow); animation-delay: 180ms">
        <div class="flex items-center gap-1.5 mb-4">
          <span class="text-[13px] font-medium tracking-wide">最近 30 天明细</span>
          <span class="h-px flex-1 ml-1.5" style="background: linear-gradient(to right, var(--border), transparent)" />
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-[12px] tabular-nums">
            <thead>
              <tr class="text-[var(--text-faint)] text-left">
                <th class="py-1.5 pr-4 font-normal">日期</th>
                <th class="py-1.5 pr-4 font-normal text-right">手写</th>
                <th class="py-1.5 pr-4 font-normal text-right">AI 辅助</th>
                <th class="py-1.5 pr-4 font-normal text-right">AI 调用</th>
                <th class="py-1.5 pr-4 font-normal text-right w-[30%]">tokens</th>
                <th class="py-1.5 font-normal text-right">成本</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in daily" :key="d.date" class="border-t border-[var(--border)]">
                <td class="py-1.5 pr-4 text-[var(--text-dim)]">{{ d.date.slice(5) }}</td>
                <td class="py-1.5 pr-4 text-right" :class="d.hand ? '' : 'text-[var(--text-faint)]'">{{ d.hand || '—' }}</td>
                <td class="py-1.5 pr-4 text-right" :class="d.ai ? '' : 'text-[var(--text-faint)]'">{{ d.ai || '—' }}</td>
                <td class="py-1.5 pr-4 text-right" :class="d.calls ? '' : 'text-[var(--text-faint)]'">{{ d.calls || '—' }}</td>
                <td class="py-1.5 pr-4 text-right">
                  <div class="flex items-center gap-2">
                    <div class="flex-1 h-[4px] rounded-full overflow-hidden" style="background: var(--bg-soft)">
                      <div class="h-full rounded-full" :style="{ width: (d.tokens / maxDayTokens) * 100 + '%', background: 'var(--accent)', opacity: 0.6 }" />
                    </div>
                    <span class="w-12 text-right" :class="d.tokens ? '' : 'text-[var(--text-faint)]'">{{ fmtNum(d.tokens) }}</span>
                  </div>
                </td>
                <td class="py-1.5 text-right" :class="d.cost ? '' : 'text-[var(--text-faint)]'">{{ d.cost ? fmtCost(d.cost) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
