<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { inkPrompt } from '../../ui/inkPrompt'

const props = defineProps<{
  /** 今日已写的字数（手写 + AI） */
  todayWritten: number
  /** 当前章节的字符数，用于推算本次写作量与速度 */
  contentLen: number
  /** 当前文件路径；切换文件即开启新的一次计时 */
  filePath: string
}>()

const GOAL_KEY = 'inkdesk.dailyGoal'
const goal = ref(Number(localStorage.getItem(GOAL_KEY)) || 3000)

const sessionStart = ref(Date.now())
const baseLen = ref(props.contentLen)
const lastActivity = ref(Date.now())
/** 每秒自增，用来驱动时长与速度重算 */
const tick = ref(0)

let timer: ReturnType<typeof setInterval> | null = null
timer = setInterval(() => (tick.value++), 1000)
onUnmounted(() => {
  if (timer) clearInterval(timer)
  timer = null
})

// 换章节 → 重新开始计时，避免把上一章的字数算进来
watch(
  () => props.filePath,
  () => {
    sessionStart.value = Date.now()
    baseLen.value = props.contentLen
    lastActivity.value = Date.now()
  }
)

// 有输入才算「在写」；超过 3 分钟没动就暂停计时，避免挂机把时长灌虚
watch(
  () => props.contentLen,
  (n, o) => {
    if (n !== o) lastActivity.value = Date.now()
  }
)

const live = computed(() => {
  tick.value
  return Date.now() - lastActivity.value < 3 * 60 * 1000
})

const elapsedMs = computed(() => {
  tick.value
  return Math.max(0, lastActivity.value - sessionStart.value)
})

const elapsedMin = computed(() => Math.floor(elapsedMs.value / 60000))

const typed = computed(() => Math.max(0, props.contentLen - baseLen.value))

const speed = computed(() => {
  const min = elapsedMs.value / 60000
  return min >= 1 ? Math.round(typed.value / min) : 0
})

const pct = computed(() => (goal.value > 0 ? Math.min(100, Math.round((props.todayWritten / goal.value) * 100)) : 0))
const reached = computed(() => props.todayWritten >= goal.value)

async function editGoal() {
  const v = await inkPrompt('每日字数目标（只存在本机，不影响作品）', String(goal.value))
  if (v === null) return
  const n = Math.max(100, Math.min(100000, Number(v) || goal.value))
  goal.value = n
  localStorage.setItem(GOAL_KEY, String(n))
}
</script>

<template>
  <div class="flex items-center gap-2.5 shrink-0">
    <!-- 今日进度 -->
    <button
      class="flex items-center gap-1.5 cursor-pointer group"
      title="点击修改每日目标"
      @click="editGoal"
    >
      <span class="text-[11px] text-[var(--text-faint)]">今日</span>
      <span class="text-[11.5px] tabular-nums" :style="{ color: reached ? 'var(--accent)' : 'var(--text-dim)' }">
        {{ todayWritten }}
      </span>
      <span class="text-[11px] text-[var(--text-faint)] tabular-nums group-hover:text-[var(--accent)]">/ {{ goal }}</span>
    </button>
    <span class="w-16 h-1 rounded-full overflow-hidden" style="background: var(--border)" :title="`${pct}%`">
      <span
        class="block h-full rounded-full transition-all"
        :style="{ width: pct + '%', background: 'var(--accent)' }"
      />
    </span>

    <!-- 本次写作 -->
    <span v-if="elapsedMin >= 1 || typed > 0" class="flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
      <span class="flex items-center gap-1">
        <span
          class="w-1.5 h-1.5 rounded-full"
          :style="{ background: live ? 'var(--accent)' : 'var(--border)' }"
          :title="live ? '正在计时' : '已暂停计时（3 分钟无输入）'"
        />
        本次 {{ elapsedMin }} 分钟
      </span>
      <span>·</span>
      <span class="tabular-nums">{{ typed }} 字</span>
      <span v-if="speed > 0">·</span>
      <span v-if="speed > 0" class="tabular-nums">{{ speed }} 字/分</span>
    </span>
  </div>
</template>