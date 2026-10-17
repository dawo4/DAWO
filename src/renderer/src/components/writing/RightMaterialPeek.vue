<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../../store/app'
import EmptyHint from '../../ui/EmptyHint.vue'
import { ArrowUpRight, BarChart3, Clock, Footprints, GitBranch, ListChecks, Map as MapIcon, Network, Users } from 'lucide-vue-next'

const props = defineProps<{ book: string; tab: string }>()
const app = useAppStore()

/** 支持速览的结构化板块：时间线 / 故事线 / 关系图 / 细纲 / 词典 / 伏笔 / 境界 / 出场 / 地图 */

interface TimelineNode {
  id: string
  title: string
  time: string
  sortKey: number
  line: 'main' | 'sub'
  chapters: string[]
}
interface StoryNode {
  id: string
  label: string
  kind: string
  main: boolean
}
interface CharNode {
  id: string
  name: string
  role: string
}
interface CharEdge {
  id: string
  source: string
  target: string
  relation: string
  label: string
}
interface OutlineEntry {
  id: string
  vol: string
  no: number
  title: string
  beat: string
  status: '待写' | '已写'
}
interface DictEntry {
  id: string
  term: string
  category: string
  aliases: string[]
  desc: string
  firstChapter: string
}
interface ForeshadowEntry {
  id: string
  content: string
  plantChapter: string
  planRecycle: string
  status: '悬置' | '已收' | '作废'
  note: string
}
interface PowerRealm {
  id: string
  name: string
  sortKey: number
}
interface PowerChar {
  id: string
  name: string
  realm: string
  note: string
}
interface PowerData {
  realms: PowerRealm[]
  rules: string
  chars: PowerChar[]
}
interface TrackingEntry {
  id: string
  name: string
  status: '健康' | '受伤' | '闭关' | '离场' | '死亡'
  lastChapter: string
  location: string
  note: string
}
interface MapNode {
  id: string
  label: string
  status: string
}
interface BookMapLite {
  id: string
  name: string
  nodes: MapNode[]
}

const timeline = ref<TimelineNode[]>([])
const story = ref<StoryNode[]>([])
const charNodes = ref<CharNode[]>([])
const charEdges = ref<CharEdge[]>([])
const outline = ref<OutlineEntry[]>([])
const dict = ref<DictEntry[]>([])
const foreshadow = ref<ForeshadowEntry[]>([])
const power = ref<PowerData>({ realms: [], rules: '', chars: [] })
const tracking = ref<TrackingEntry[]>([])
const maps = ref<BookMapLite[]>([])
const loading = ref(false)

const STORY_KIND_LABEL: Record<string, string> = {
  setup: '铺垫',
  conflict: '冲突',
  turn: '转折',
  climax: '高潮',
  ending: '收束',
  foreshadow: '伏笔',
  payoff: '回收'
}
const RELATION_LABEL: Record<string, string> = {
  family: '亲情',
  love: '爱情',
  friend: '友情',
  enemy: '敌对',
  other: '其他'
}
/** 伏笔状态色（与资料区 ForeshadowPanel 一致的语义） */
const FORESHADOW_COLOR: Record<string, string> = {
  悬置: 'var(--accent)',
  已收: 'var(--text-faint)',
  作废: 'var(--border)'
}
/** 出场状态色 */
const TRACKING_COLOR: Record<string, string> = {
  健康: 'var(--text-faint)',
  受伤: 'var(--warn)',
  闭关: 'var(--text-dim)',
  离场: 'var(--text-faint)',
  死亡: 'var(--danger)'
}

/** 时间线按 sortKey 升序，读起来就是故事发生的顺序 */
const sortedTimeline = computed(() => [...timeline.value].sort((a, b) => a.sortKey - b.sortKey))

/** 故事线按节点类型分组，同类归在一起更清楚 */
const storyGroups = computed(() => {
  const order = ['setup', 'conflict', 'turn', 'climax', 'foreshadow', 'payoff', 'ending']
  const map = new Map<string, StoryNode[]>()
  for (const n of story.value) {
    const k = STORY_KIND_LABEL[n.kind] ? n.kind : 'setup'
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(n)
  }
  return order.filter((k) => map.has(k)).map((k) => ({ kind: k, label: STORY_KIND_LABEL[k], nodes: map.get(k)! }))
})

/** 细纲按卷分组，卷内按章序 */
const outlineGroups = computed(() => {
  const map = new Map<string, OutlineEntry[]>()
  for (const e of outline.value) {
    const k = e.vol || '未分卷'
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(e)
  }
  return [...map.entries()].map(([vol, entries]) => ({ vol, entries: [...entries].sort((a, b) => a.no - b.no) }))
})

const charName = (id: string): string => charNodes.value.find((n) => n.id === id)?.name || '?'

/** 关系列表：把 name（role）⇄ name 的连线摊平成可读行 */
const relations = computed(() =>
  charEdges.value.map((e) => ({
    id: e.id,
    from: charName(e.source),
    to: charName(e.target),
    relation: RELATION_LABEL[e.relation] || e.relation,
    label: e.label
  }))
)

/** 词典按类别分组 */
const dictGroups = computed(() => {
  const map = new Map<string, DictEntry[]>()
  for (const e of dict.value) {
    const k = e.category || '其他'
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(e)
  }
  return [...map.entries()].map(([cat, entries]) => ({ cat, entries }))
})

/** 境界：低阶在前 */
const sortedRealms = computed(() => [...power.value.realms].sort((a, b) => a.sortKey - b.sortKey))

const isEmpty = computed(() => {
  switch (props.tab) {
    case '时间线': return !timeline.value.length
    case '故事线': return !story.value.length
    case '关系图': return !charNodes.value.length && !charEdges.value.length
    case '细纲': return !outline.value.length
    case '词典': return !dict.value.length
    case '伏笔': return !foreshadow.value.length
    case '境界': return !power.value.realms.length && !power.value.chars.length
    case '出场': return !tracking.value.length
    case '地图': return !maps.value.length
    default: return true
  }
})

const mainCount = computed(() => timeline.value.filter((n) => n.line === 'main').length)

async function load() {
  if (!props.book) return
  loading.value = true
  try {
    switch (props.tab) {
      case '时间线':
        timeline.value = ((await window.api.tlRead(props.book)) as TimelineNode[]) || []
        break
      case '故事线': {
        // storyRead 返回 { nodes, edges } 对象，取 nodes
        const s = (await window.api.storyRead(props.book)) as { nodes?: StoryNode[] } | null
        story.value = s?.nodes || []
        break
      }
      case '关系图': {
        const g = (await window.api.charGraphRead(props.book)) as { nodes: CharNode[]; edges: CharEdge[] }
        charNodes.value = g?.nodes || []
        charEdges.value = g?.edges || []
        break
      }
      case '细纲':
        outline.value = ((await window.api.outlineRead(props.book)) as OutlineEntry[]) || []
        break
      case '词典':
        dict.value = ((await window.api.dictRead(props.book)) as DictEntry[]) || []
        break
      case '伏笔':
        foreshadow.value = ((await window.api.foreshadowRead(props.book)) as ForeshadowEntry[]) || []
        break
      case '境界':
        power.value = ((await window.api.powerRead(props.book)) as PowerData) || { realms: [], rules: '', chars: [] }
        break
      case '出场':
        tracking.value = ((await window.api.trackingRead(props.book)) as TrackingEntry[]) || []
        break
      case '地图': {
        const all = ((await window.api.mapRead(props.book)) as BookMapLite[]) || []
        maps.value = all.map((m) => ({ id: m.id, name: m.name, nodes: m.nodes || [] }))
        break
      }
    }
  } catch {
    // 读取失败按空处理，避免整个右栏报错
  } finally {
    loading.value = false
  }
}

/** 资料区改了结构化数据后，速览要跟着更新 */
function onFileChanged() {
  void load()
}

onMounted(() => {
  window.addEventListener('inkdesk:file-changed', onFileChanged)
  void load()
})

onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))

watch(() => [props.book, props.tab], () => void load())
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div class="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3">
      <div v-if="loading" class="text-[12px] text-[var(--text-faint)] py-6 text-center">读取中…</div>

      <!-- 空态 -->
      <EmptyHint
        v-else-if="isEmpty"
        class="py-10"
        :icon="tab === '故事线' || tab === '关系图' ? Network : tab === '时间线' ? Clock : tab === '词典' ? Users : tab === '细纲' ? ListChecks : tab === '地图' ? MapIcon : tab === '境界' ? BarChart3 : tab === '出场' ? Footprints : GitBranch"
        :title="`还没有「${tab}」资料`"
        desc="可以到资料页手动添加，或让智能体帮你生成"
        action="去资料页生成"
        @action="app.goMaterials(tab)"
      />

      <!-- 时间线速览 -->
      <template v-else-if="tab === '时间线'">
        <div class="text-[11px] text-[var(--text-faint)]">
          共 {{ timeline.length }} 个节点 · 主线 {{ mainCount }} · 支线 {{ timeline.length - mainCount }}
        </div>
        <div class="space-y-0.5">
          <div v-for="n in sortedTimeline" :key="n.id" class="flex items-start gap-2 py-1.5 border-b border-[var(--border)] last:border-b-0">
            <span
              class="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
              :style="{ background: n.line === 'main' ? 'var(--accent)' : 'var(--text-faint)' }"
              :title="n.line === 'main' ? '主线' : '支线'"
            />
            <div class="flex-1 min-w-0">
              <div class="text-[12.5px] leading-5">{{ n.title }}</div>
              <div class="text-[10.5px] text-[var(--text-faint)] mt-0.5">
                <span v-if="n.time">{{ n.time }}</span>
                <span v-if="n.time && n.chapters.length"> · </span>
                <span v-if="n.chapters.length">{{ n.chapters.map((c) => c.split('/').pop()).join('、') }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 故事线速览 -->
      <template v-else-if="tab === '故事线'">
        <div class="text-[11px] text-[var(--text-faint)]">
          共 {{ story.length }} 个节点 · 主线 {{ story.filter((n) => n.main).length }}
        </div>
        <div v-for="g in storyGroups" :key="g.kind" class="space-y-1">
          <div class="text-[10.5px] tracking-wider text-[var(--text-faint)] flex items-center gap-1.5">
            {{ g.label }}
            <span class="text-[10px] opacity-70">{{ g.nodes.length }}</span>
          </div>
          <div
            v-for="n in g.nodes"
            :key="n.id"
            class="text-[12.5px] leading-5 pl-2 border-l-2 py-0.5"
            :style="{ borderColor: n.main ? 'var(--accent)' : 'var(--border)' }"
          >
            {{ n.label }}
          </div>
        </div>
      </template>

      <!-- 关系图速览 -->
      <template v-else-if="tab === '关系图'">
        <div class="text-[11px] text-[var(--text-faint)]">
          共 {{ charNodes.length }} 个角色 · {{ relations.length }} 条关系
        </div>
        <div class="space-y-1">
          <div v-for="r in relations" :key="r.id" class="text-[12px] leading-5 py-1 border-b border-[var(--border)] last:border-b-0">
            <span class="text-[var(--text-dim)]">{{ r.from }}</span>
            <span class="mx-1.5 text-[10.5px]" :style="{ color: 'var(--accent)' }">{{ r.relation }}</span>
            <span class="text-[var(--text-dim)]">{{ r.to }}</span>
            <div v-if="r.label" class="text-[10.5px] text-[var(--text-faint)] mt-0.5 pl-0.5">{{ r.label }}</div>
          </div>
          <div v-if="!relations.length && charNodes.length" class="text-[11.5px] text-[var(--text-faint)]">
            已有角色但还没有连线：{{ charNodes.map((n) => n.name).join('、') }}
          </div>
        </div>
      </template>

      <!-- 细纲速览 -->
      <template v-else-if="tab === '细纲'">
        <div class="text-[11px] text-[var(--text-faint)]">
          共 {{ outline.length }} 章 · 已写 {{ outline.filter((e) => e.status === '已写').length }}
        </div>
        <div v-for="g in outlineGroups" :key="g.vol" class="space-y-0.5">
          <div class="text-[10.5px] tracking-wider text-[var(--text-faint)] mt-1">{{ g.vol }}</div>
          <div v-for="e in g.entries" :key="e.id" class="py-1.5 border-b border-[var(--border)] last:border-b-0">
            <div class="flex items-center gap-1.5">
              <span class="text-[12px] font-medium">第{{ e.no }}章 {{ e.title }}</span>
              <span
                class="text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0"
                :style="e.status === '已写' ? { background: 'var(--panel-2)', color: 'var(--accent)' } : { background: 'var(--bg-soft)', color: 'var(--text-faint)' }"
              >{{ e.status }}</span>
            </div>
            <div v-if="e.beat" class="text-[11px] text-[var(--text-dim)] leading-5 mt-0.5">{{ e.beat }}</div>
          </div>
        </div>
      </template>

      <!-- 词典速览 -->
      <template v-else-if="tab === '词典'">
        <div class="text-[11px] text-[var(--text-faint)]">共 {{ dict.length }} 条</div>
        <div v-for="g in dictGroups" :key="g.cat" class="space-y-0.5">
          <div class="text-[10.5px] tracking-wider text-[var(--text-faint)] mt-1">{{ g.cat }}（{{ g.entries.length }}）</div>
          <div v-for="e in g.entries" :key="e.id" class="py-1.5 border-b border-[var(--border)] last:border-b-0">
            <div class="flex items-baseline gap-1.5 flex-wrap">
              <span class="text-[12.5px] font-medium">{{ e.term }}</span>
              <span v-if="e.aliases.length" class="text-[10px] text-[var(--text-faint)]">别名：{{ e.aliases.join('、') }}</span>
            </div>
            <div v-if="e.desc" class="text-[11px] text-[var(--text-dim)] leading-5 mt-0.5">{{ e.desc }}</div>
          </div>
        </div>
      </template>

      <!-- 伏笔速览 -->
      <template v-else-if="tab === '伏笔'">
        <div class="text-[11px] text-[var(--text-faint)]">
          共 {{ foreshadow.length }} 条 · 悬置 {{ foreshadow.filter((e) => e.status === '悬置').length }}
        </div>
        <div v-for="e in foreshadow" :key="e.id" class="py-1.5 border-b border-[var(--border)] last:border-b-0">
          <div class="flex items-start gap-1.5">
            <span class="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: FORESHADOW_COLOR[e.status] }" :title="e.status" />
            <div class="flex-1 min-w-0">
              <div class="text-[12.5px] leading-5">{{ e.content }}</div>
              <div class="text-[10.5px] text-[var(--text-faint)] mt-0.5">
                埋于{{ e.plantChapter || '?' }}<template v-if="e.planRecycle"> · 计划回收：{{ e.planRecycle }}</template> · {{ e.status }}
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 境界速览 -->
      <template v-else-if="tab === '境界'">
        <div v-if="sortedRealms.length" class="text-[11px] text-[var(--text-faint)]">
          {{ sortedRealms.map((r) => r.name).join(' → ') }}
        </div>
        <div v-if="power.rules" class="text-[11px] text-[var(--text-dim)] leading-5 pt-1 border-t border-[var(--border)]">{{ power.rules }}</div>
        <div v-if="power.chars.length" class="space-y-0.5">
          <div class="text-[10.5px] tracking-wider text-[var(--text-faint)]">角色境界</div>
          <div v-for="c in power.chars" :key="c.id" class="flex items-center gap-2 py-1 border-b border-[var(--border)] last:border-b-0">
            <span class="text-[12.5px]">{{ c.name }}</span>
            <div class="flex-1" />
            <span class="text-[11px]" :style="{ color: 'var(--accent)' }">{{ c.realm || '未定' }}</span>
          </div>
        </div>
      </template>

      <!-- 出场速览 -->
      <template v-else-if="tab === '出场'">
        <div class="text-[11px] text-[var(--text-faint)]">共 {{ tracking.length }} 人</div>
        <div class="space-y-0.5">
          <div v-for="e in tracking" :key="e.id" class="py-1.5 border-b border-[var(--border)] last:border-b-0">
            <div class="flex items-center gap-1.5">
              <span class="text-[12.5px]">{{ e.name }}</span>
              <span
                class="text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0"
                :style="{ background: 'var(--bg-soft)', color: TRACKING_COLOR[e.status] || 'var(--text-faint)' }"
              >{{ e.status }}</span>
            </div>
            <div class="text-[10.5px] text-[var(--text-faint)] mt-0.5">
              <span v-if="e.lastChapter">最近出场：{{ e.lastChapter }}</span>
              <span v-if="e.location"><template v-if="e.lastChapter"> · </template>在{{ e.location }}</span>
            </div>
          </div>
        </div>
      </template>

      <!-- 地图速览 -->
      <template v-else-if="tab === '地图'">
        <div v-for="m in maps" :key="m.id" class="space-y-0.5">
          <div class="text-[10.5px] tracking-wider text-[var(--text-faint)] mt-1">
            {{ m.name }}（{{ m.nodes.length }} 个地点）
          </div>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="n in m.nodes"
              :key="n.id"
              class="text-[11px] px-2 py-0.5 rounded-full"
              :style="n.status === '已写过' ? { background: 'var(--panel-2)', color: 'var(--accent)' } : { background: 'var(--bg-soft)', color: 'var(--text-dim)' }"
            >{{ n.label }}</span>
          </div>
        </div>
      </template>
    </div>

    <!-- 跳转资料区 -->
    <div class="shrink-0 px-3.5 py-2 border-t border-[var(--border)]">
      <button
        class="w-full flex items-center justify-center gap-1.5 text-[11.5px] py-1.5 rounded-lg cursor-pointer text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] transition-colors"
        @click="app.goMaterials(tab)"
      >
        在资料区编辑<ArrowUpRight :size="13" />
      </button>
    </div>
  </div>
</template>
