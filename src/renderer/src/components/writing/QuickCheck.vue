<script setup lang="ts">
// 随写随查速检：当前章正文对照词典 / 出场追踪 / 境界体系 / 伏笔板，本地匹配零 AI
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { BookOpenCheck, RefreshCw } from 'lucide-vue-next'

const props = defineProps<{ book: string; file: string; chapterText: string }>()

interface DictEntry { id: string; term: string; category: string; aliases: string[]; desc: string; firstChapter: string }
interface TrackingEntry { id: string; name: string; status: string; lastChapter: string; location: string; note: string }
interface PowerChar { name: string; realm: string }
interface PowerData { realms: unknown[]; rules: string; chars: PowerChar[] }
interface ForeshadowEntry { id: string; content: string; plantChapter: string; planRecycle: string; status: string; note: string }

const dict = ref<DictEntry[]>([])
const tracking = ref<TrackingEntry[]>([])
const power = ref<PowerData>({ realms: [], rules: '', chars: [] })
const foreshadow = ref<ForeshadowEntry[]>([])
const loading = ref(false)

const STATUS_COLOR: Record<string, string> = {
  健康: '#6fae6f',
  受伤: '#d9a441',
  闭关: '#7a92b8',
  离场: '#9a917e',
  死亡: '#e08a7a'
}

async function load() {
  if (!props.book) return
  loading.value = true
  try {
    const [d, t, p, f] = await Promise.all([
      window.api.dictRead(props.book),
      window.api.trackingRead(props.book),
      window.api.powerRead(props.book),
      window.api.foreshadowRead(props.book)
    ])
    dict.value = (d as DictEntry[]) || []
    tracking.value = (t as TrackingEntry[]) || []
    power.value = (p as PowerData) || { realms: [], rules: '', chars: [] }
    foreshadow.value = (f as ForeshadowEntry[]) || []
  } catch {
    /* 读失败静默，保留旧数据 */
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
watch(() => props.book, () => void load())
// AI 提案落盘后重载（词典/伏笔/出场被更新时）
function onFileChanged() {
  void load()
}
onMounted(() => window.addEventListener('inkdesk:file-changed', onFileChanged))
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))

const isChapter = computed(() => props.file.startsWith('正文/'))
const text = computed(() => props.chapterText || '')

/** 命中的登记角色：名字出现在本章正文 */
const hitChars = computed(() => {
  if (!isChapter.value || !text.value) return []
  return tracking.value
    .filter((t) => t.name && t.name.length >= 2 && text.value.includes(t.name))
    .map((t) => ({ ...t, realm: power.value.chars.find((c) => c.name === t.name)?.realm || '' }))
})
/** 警告：已死亡/离场的角色在本章出现（若为回忆/闪回可忽略） */
const ghostWarnings = computed(() => hitChars.value.filter((c) => c.status === '死亡' || c.status === '离场'))
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
/** 悬置伏笔，标记本章是否提到 */
const openForeshadows = computed(() => {
  if (!props.book) return []
  return foreshadow.value
    .filter((f) => f.status === '悬置')
    .map((f) => ({ ...f, mentioned: isChapter.value && !!text.value && text.value.includes(f.content.slice(0, 6)) }))
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
        title="重新读取词典 / 出场 / 境界 / 伏笔"
        @click="reload"
      >
        <RefreshCw :size="12" :class="{ 'animate-spin': loading }" />
      </button>
    </div>

    <p v-if="!isChapter" class="text-xs text-[var(--text-faint)] leading-5">
      打开一个章节文件后自动对照：命中的登记角色（状态/所在地/境界）、专名词条、悬置伏笔，死亡离场角色现身会标红提醒。全程本地匹配，零 AI 成本。
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
            <div class="flex items-start gap-1.5">
              <span v-if="f.mentioned" class="shrink-0 text-[10px] px-1 rounded mt-0.5" style="background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent)">本章提及</span>
              <span class="flex-1">{{ f.content }}</span>
            </div>
            <div class="text-[10.5px] text-[var(--text-faint)] mt-0.5">
              埋于{{ f.plantChapter || '?' }}<span v-if="f.planRecycle"> · 计划回收：{{ f.planRecycle }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
