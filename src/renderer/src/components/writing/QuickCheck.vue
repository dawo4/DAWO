<script setup lang="ts">
// 随写随查速检：当前章正文对照词典 / 出场追踪 / 境界体系 / 伏笔板 / 本章细纲，本地匹配零 AI
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { BookOpenCheck, RefreshCw, ScanSearch } from 'lucide-vue-next'
import { analyzeHumanSignal } from '../../lib/human-signal'
import FullCheck from './FullCheck.vue'

const props = defineProps<{ book: string; file: string; chapterText: string }>()

interface DictEntry { id: string; term: string; category: string; aliases: string[]; desc: string; firstChapter: string }
interface TrackingEntry { id: string; name: string; status: string; lastChapter: string; location: string; note: string }
interface PowerChar { name: string; realm: string }
interface PowerData { realms: { name: string; sortKey?: number }[]; rules: string; chars: PowerChar[] }
interface ForeshadowEntry { id: string; content: string; plantChapter: string; planRecycle: string; status: string; note: string }
interface OutlineLite { no: number; beat: string; beatFull?: string }
interface CharacterFile { path: string; name: string; content: string }
interface Voiceprint { name: string; catchphrases: string[]; forbidden: string[] }

const dict = ref<DictEntry[]>([])
const tracking = ref<TrackingEntry[]>([])
const power = ref<PowerData>({ realms: [], rules: '', chars: [] })
const foreshadow = ref<ForeshadowEntry[]>([])
const outline = ref<OutlineLite[]>([])
const voices = ref<Voiceprint[]>([])
const loading = ref(false)
const fullOpen = ref(false)

/** 从角色卡文本解析声纹两行：口头禅 / 禁语（顿号或分号分隔，「无」视为空） */
function parseVoiceprint(name: string, content: string): Voiceprint {
  const vp: Voiceprint = { name, catchphrases: [], forbidden: [] }
  for (const raw of content.split('\n')) {
    const t = raw.trim().replace(/^[-*]\s*/, '')
    let m = /^(?:声纹[——\-\s]*)?口头禅[：:](.+)$/.exec(t)
    if (m) {
      vp.catchphrases = m[1].split(/[;；、]/).map((s) => s.trim()).filter((s) => s && s !== '无')
      continue
    }
    m = /^(?:声纹[——\-\s]*)?禁语[：:](.+)$/.exec(t)
    if (m) vp.forbidden = m[1].split(/[;；、]/).map((s) => s.trim()).filter((s) => s && s !== '无')
  }
  return vp
}

const STATUS_COLOR: Record<string, string> = {
  健康: 'var(--ok)',
  受伤: 'var(--warn)',
  闭关: 'var(--info)',
  离场: 'var(--text-dim)',
  死亡: 'var(--danger)'
}

async function load() {
  if (!props.book) return
  loading.value = true
  try {
    const [d, t, p, f, o, c] = await Promise.all([
      window.api.dictRead(props.book),
      window.api.trackingRead(props.book),
      window.api.powerRead(props.book),
      window.api.foreshadowRead(props.book),
      window.api.outlineRead(props.book),
      window.api.charactersReadAll(props.book) as Promise<{ files?: CharacterFile[] }>
    ])
    dict.value = (d as DictEntry[]) || []
    tracking.value = (t as TrackingEntry[]) || []
    power.value = (p as PowerData) || { realms: [], rules: '', chars: [] }
    foreshadow.value = (f as ForeshadowEntry[]) || []
    outline.value = (o as OutlineLite[]) || []
    voices.value = ((c.files || []) as CharacterFile[]).map((f2) => parseVoiceprint(f2.name, f2.content))
  } catch {
    /* 读失败静默，保留旧数据 */
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
watch(() => props.book, () => void load())
// AI 提案落盘后重载（词典/伏笔/出场/细纲被更新时）
function onFileChanged() {
  void load()
}
onMounted(() => window.addEventListener('inkdesk:file-changed', onFileChanged))
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))

const isChapter = computed(() => props.file.startsWith('正文/'))
const text = computed(() => props.chapterText || '')
const chapterNo = computed(() => {
  const m = props.file.match(/第(\d+)章/)
  return m ? Number(m[1]) : 0
})

/** 命中的登记角色：名字出现在本章正文 */
const hitChars = computed(() => {
  if (!isChapter.value || !text.value) return []
  return tracking.value
    .filter((t) => t.name && t.name.length >= 2 && text.value.includes(t.name))
    .map((t) => ({ ...t, realm: power.value.chars.find((c) => c.name === t.name)?.realm || '' }))
})
/** 警告：已死亡/离场的角色在本章出现（若为回忆/闪回可忽略） */
const ghostWarnings = computed(() => hitChars.value.filter((c) => c.status === '死亡' || c.status === '离场'))
/** 提醒：受伤/闭关的角色现身，行文里需要交代状态 */
const statusWarns = computed(() => hitChars.value.filter((c) => c.status === '受伤' || c.status === '闭关'))
/** 声纹提醒：命中角色的禁语出现在本章文字中（台词可能出戏） */
const voiceWarns = computed(() => {
  if (!isChapter.value || !text.value) return []
  const out: { name: string; word: string }[] = []
  for (const c of hitChars.value) {
    const vp = voices.value.find((v) => v.name === c.name)
    for (const w of vp?.forbidden || []) {
      if (w.length >= 2 && text.value.includes(w)) out.push({ name: c.name, word: w })
    }
  }
  return out
})
const voiceOf = (name: string): Voiceprint | undefined => voices.value.find((v) => v.name === name)
/** 命中的非人物专名 */
const hitTerms = computed(() => {
  if (!isChapter.value || !text.value) return []
  const people = new Set(dict.value.filter((d) => d.category === '人物').map((d) => d.term))
  return dict.value.filter((d) => {
    if (!d.term || d.term.length < 2 || people.has(d.term)) return false
    if (text.value.includes(d.term)) return true
    return (d.aliases || []).some((a) => a && a.length >= 2 && text.value.includes(a))
  })
})
/** 悬置伏笔，标记本章是否提到、是否久悬（埋设章号与当前章差 ≥15） */
const openForeshadows = computed(() => {
  if (!props.book) return []
  return foreshadow.value
    .filter((f) => f.status === '悬置')
    .map((f) => {
      const m = f.plantChapter?.match(/(\d+)/)
      const plantedAt = m ? Number(m[1]) : 0
      const longPending = !!(chapterNo.value && plantedAt && chapterNo.value - plantedAt >= 15)
      return { ...f, mentioned: isChapter.value && !!text.value && text.value.includes(f.content.slice(0, 6)), longPending }
    })
})
/** 本章细纲规划的出场角色：细纲（含全文存档）里提到的登记角色名 */
const planCheck = computed(() => {
  const empty = { planned: [] as string[], missing: [] as string[], hasPlan: false }
  if (!chapterNo.value || !isChapter.value || !text.value) return empty
  const entry = outline.value.find((e) => e.no === chapterNo.value)
  if (!entry) return empty
  const src = `${entry.beat || ''}\n${entry.beatFull || ''}`
  if (!src.trim()) return empty
  const allNames = new Set<string>()
  tracking.value.forEach((t) => t.name && t.name.length >= 2 && allNames.add(t.name))
  dict.value.filter((d) => d.category === '人物').forEach((d) => d.term && d.term.length >= 2 && allNames.add(d.term))
  const planned = [...allNames].filter((n) => src.includes(n))
  const missing = planned.filter((n) => !text.value.includes(n))
  return { planned, missing, hasPlan: planned.length > 0 }
})
/** 境界越级参考：本章文本出现比命中角色当前境界高两阶以上的境界名（提及不等于突破，仅供参考） */
const realmWarns = computed(() => {
  const order = new Map<string, number>()
  power.value.realms.forEach((r, i) => order.set(r.name, typeof r.sortKey === 'number' ? r.sortKey : i))
  if (!order.size || !isChapter.value || !text.value) return []
  const mentioned = [...order.entries()].filter(([name]) => name.length >= 2 && text.value.includes(name))
  if (!mentioned.length) return []
  const out: { name: string; realm: string; higher: string }[] = []
  for (const c of hitChars.value) {
    const cur = c.realm ? order.get(c.realm) : undefined
    if (cur === undefined) continue
    const higher = mentioned.filter(([name, sk]) => name !== c.realm && sk >= cur + 2).map(([name]) => name)
    if (higher.length) out.push({ name: c.name, realm: c.realm, higher: higher.join('、') })
  }
  return out
})
/** AI 毒句式红牌快扫（与去 AI 味面板同款本地规则） */
const redCards = computed(() => {
  if (!isChapter.value || !text.value) return []
  return analyzeHumanSignal(text.value, 'fiction').redCards
})

function reload() {
  void load()
}
defineExpose({ reload })
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-1.5">
      <BookOpenCheck :size="13" style="color: var(--accent)" />
      <span class="text-xs text-[var(--text-faint)] tracking-wider">本章速检</span>
      <div class="flex-1" />
      <button
        class="text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer"
        title="全书一致性体检：跑遍所有章节汇总问题清单"
        @click="fullOpen = true"
      >
        <ScanSearch :size="12" />
      </button>
      <button
        class="text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer"
        title="重新读取词典 / 出场 / 境界 / 伏笔 / 细纲"
        @click="reload"
      >
        <RefreshCw :size="12" :class="{ 'animate-spin': loading }" />
      </button>
    </div>

    <FullCheck :book="props.book" :open="fullOpen" @close="fullOpen = false" />

    <p v-if="!isChapter" class="text-xs text-[var(--text-faint)] leading-5">
      打开一个章节文件后自动对照：登记角色（状态/所在地/境界，死亡离场现身标红）、细纲出场规划、专名词条、悬置伏笔与久悬提醒、境界越级参考、AI 毒句式红牌、角色声纹（口头禅与禁语，写进角色卡末两行即生效）。全程本地匹配，零 AI 成本。
    </p>

    <template v-else>
      <!-- 死亡/离场角色现身警告 -->
      <div v-if="ghostWarnings.length" class="space-y-1.5">
        <div
          v-for="g in ghostWarnings"
          :key="g.id"
          class="rounded-lg border p-2.5 text-[11.5px] leading-5"
          style="border-color: #e08a7a55; background: color-mix(in srgb, #e08a7a 10%, transparent)"
        >
          <span style="color: #e08a7a">疑似吃书</span>　「{{ g.name }}」登记状态是<b>{{ g.status }}</b>，却出现在本章。若为回忆 / 闪回 / 遗言可忽略，否则需要处理。
        </div>
      </div>

      <!-- 声纹提醒：禁语出戏 -->
      <div v-if="voiceWarns.length" class="space-y-1.5">
        <div
          v-for="(w, i) in voiceWarns"
          :key="'v' + i"
          class="rounded-lg border p-2.5 text-[11.5px] leading-5"
          style="border-color: #d9a44155; background: color-mix(in srgb, #d9a441 8%, transparent)"
        >
          <span style="color: #d9a441">声纹出戏</span>　「{{ w.word }}」是<b>{{ w.name }}</b>的禁语，却出现在本章文字中——检查说话者是否为此角色，或措辞是否出戏。
        </div>
      </div>

      <!-- 细纲出场对照 -->
      <div v-if="planCheck.hasPlan" class="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2.5 text-[11.5px] leading-5">
        <div class="text-[var(--text-dim)]">细纲规划出场：{{ planCheck.planned.join('、') }}</div>
        <div v-if="planCheck.missing.length" class="mt-1" style="color: #d9a441">正文还没写到：{{ planCheck.missing.join('、') }}（可能在本章后半，或被遗漏）</div>
      </div>

      <!-- 受伤/闭关现身提醒 -->
      <div v-if="statusWarns.length" class="space-y-1.5">
        <div
          v-for="s in statusWarns"
          :key="s.id"
          class="rounded-lg border p-2.5 text-[11.5px] leading-5"
          style="border-color: #d9a44155; background: color-mix(in srgb, #d9a441 8%, transparent)"
        >
          「{{ s.name }}」登记状态是<b>{{ s.status }}</b>——文中出现时记得交代（伤势恢复 / 出关缘由），或先去出场追踪更新状态。
        </div>
      </div>

      <!-- 境界越级参考 -->
      <div v-if="realmWarns.length" class="space-y-1.5">
        <div
          v-for="w in realmWarns"
          :key="w.name"
          class="rounded-lg border border-dashed border-[var(--border)] px-2.5 py-2 text-[11.5px] leading-5 text-[var(--text-dim)]"
        >
          战力参考：「{{ w.name }}」当前登记 {{ w.realm || '（未登记）' }}，本章出现了更高阶的 {{ w.higher }}。若非突破 / 回忆 / 旁人，留意越级。
        </div>
      </div>

      <!-- 命中角色 -->
      <div>
        <div class="text-[11px] text-[var(--text-faint)] tracking-wider mb-1.5">登记角色（{{ hitChars.length }}）</div>
        <p v-if="!hitChars.length" class="text-[11px] text-[var(--text-faint)]">本章没命中任何出场追踪登记的角色——角色还没登记，或这章确实没有老角色。</p>
        <div v-else class="space-y-1.5">
          <div v-for="c in hitChars" :key="c.id" class="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2.5">
            <div class="flex items-center gap-2 text-[12px]">
              <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: STATUS_COLOR[c.status] || '#999' }" />
              <b>{{ c.name }}</b>
              <span class="text-[10.5px] px-1 rounded" :style="{ color: STATUS_COLOR[c.status] || 'var(--text-dim)' }">{{ c.status }}</span>
              <span v-if="c.realm" class="text-[10.5px] text-[var(--text-dim)]">{{ c.realm }}</span>
            </div>
            <div class="text-[10.5px] text-[var(--text-faint)] mt-1 leading-4">
              <span v-if="c.location">所在地：{{ c.location }}</span>
              <span v-if="c.lastChapter"> · 最近出场：{{ c.lastChapter }}</span>
            </div>
            <div v-if="voiceOf(c.name)?.catchphrases?.length" class="text-[10.5px] text-[var(--text-faint)] mt-0.5 leading-4">
              口头禅：{{ voiceOf(c.name)!.catchphrases.join('、') }}
            </div>
            <div v-if="c.note" class="text-[10.5px] text-[var(--text-faint)] mt-0.5 leading-4">{{ c.note }}</div>
          </div>
        </div>
      </div>

      <!-- 命中专名 -->
      <div>
        <div class="text-[11px] text-[var(--text-faint)] tracking-wider mb-1.5">专名词条（{{ hitTerms.length }}）</div>
        <p v-if="!hitTerms.length" class="text-[11px] text-[var(--text-faint)]">本章没有命中词典里的非人物词条。</p>
        <div v-else class="space-y-1">
          <div v-for="d in hitTerms" :key="d.id" class="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2">
            <div class="text-[12px] flex items-center gap-2 flex-wrap">
              <b>{{ d.term }}</b>
              <span class="text-[10px] px-1 rounded border border-[var(--border)] text-[var(--text-dim)]">{{ d.category }}</span>
              <span v-if="d.aliases?.length" class="text-[10px] text-[var(--text-faint)]">别名：{{ d.aliases.join('、') }}</span>
            </div>
            <div v-if="d.desc" class="text-[10.5px] text-[var(--text-faint)] mt-0.5 leading-4">{{ d.desc }}</div>
          </div>
        </div>
      </div>

      <!-- 悬置伏笔 -->
      <div>
        <div class="text-[11px] text-[var(--text-faint)] tracking-wider mb-1.5">悬置伏笔（{{ openForeshadows.length }}）</div>
        <p v-if="!openForeshadows.length" class="text-[11px] text-[var(--text-faint)]">没有悬置中的伏笔，不欠读者。</p>
        <div v-else class="space-y-1">
          <div
            v-for="f in openForeshadows"
            :key="f.id"
            class="rounded-lg border px-2.5 py-2 text-[11.5px] leading-5"
            :class="f.mentioned ? 'border-[var(--border)] bg-[var(--panel)]' : 'border-dashed border-[var(--border)]'"
          >
            <div class="flex items-start gap-1.5 flex-wrap">
              <span v-if="f.mentioned" class="shrink-0 text-[10px] px-1 rounded mt-0.5" style="background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent)">本章提及</span>
              <span v-if="f.longPending" class="shrink-0 text-[10px] px-1 rounded mt-0.5" style="background: color-mix(in srgb, #d9a441 18%, transparent); color: #d9a441">已悬置 15+ 章</span>
              <span class="flex-1">{{ f.content }}</span>
            </div>
            <div class="text-[10.5px] text-[var(--text-faint)] mt-0.5">
              埋于{{ f.plantChapter || '?' }}<span v-if="f.planRecycle"> · 计划回收：{{ f.planRecycle }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- AI 毒句式红牌快扫 -->
      <div>
        <div class="text-[11px] text-[var(--text-faint)] tracking-wider mb-1.5">毒句式红牌（{{ redCards.length }}）</div>
        <p v-if="!redCards.length" class="text-[11px] text-[var(--text-faint)]">未扫到红牌句式。完整六维打分去「去 AI 味」面板看。</p>
        <div v-else class="space-y-1">
          <div
            v-for="(r, i) in redCards"
            :key="i"
            class="rounded-lg border p-2.5 text-[11.5px] leading-5"
            style="border-color: #e08a7a55; background: color-mix(in srgb, #e08a7a 8%, transparent)"
          >
            <b>{{ r.label }}</b>　<span class="text-[var(--text-faint)]">{{ r.sample }}…</span>
            <div class="text-[10.5px] text-[var(--text-faint)] mt-0.5">{{ r.hint }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
