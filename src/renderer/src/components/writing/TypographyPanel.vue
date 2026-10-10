<script setup lang="ts">
import { computed, ref } from 'vue'
import InkButton from '../../ui/InkButton.vue'
import InkSelect from '../../ui/InkSelect.vue'

/** 排版状态由写作台持有（编辑器容器要读同一份），面板直接改属性 + 通知持久化 */
const props = defineProps<{ typo: { fs: number; lh: number; measure: number; font: string; paraGap: boolean; grid: string } }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const KEY = 'inkdesk.typography'
const DEFAULTS = { fs: 16, lh: 2, measure: 720, font: 'default', paraGap: false, grid: 'none' }

const saved = ref(false)
function persist() {
  localStorage.setItem(KEY, JSON.stringify(props.typo))
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}

const FONTS = [
  { v: 'default', label: '默认' },
  { v: 'serif', label: '宋体 · 衬线' },
  { v: 'sans', label: '黑体 · 无衬线' }
]
const GRIDS = [
  { v: 'none', label: '无' },
  { v: 'solid', label: '实线' },
  { v: 'dash', label: '虚线' }
]

const fontStack = computed(() =>
  props.typo.font === 'serif'
    ? `'Songti SC', 'SimSun', 'Noto Serif SC', serif`
    : props.typo.font === 'sans'
      ? `'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif`
      : 'inherit'
)

/** 写作台消费的 CSS 变量集合 */
const vars = computed(() => ({
  '--ink-fs': `${props.typo.fs}px`,
  '--ink-lh': String(props.typo.lh),
  '--ink-measure': `${props.typo.measure}px`,
  '--ink-font': fontStack.value,
  '--ink-para': props.typo.paraGap ? '1.6em' : '1em'
}))
const gridClass = computed(() => (props.typo.grid === 'solid' ? 'ink-grid-solid' : props.typo.grid === 'dash' ? 'ink-grid-dash' : ''))

function reset() {
  Object.assign(props.typo, DEFAULTS)
  persist()
}

defineExpose({ vars, gridClass })
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-2 gap-x-6 gap-y-4">
      <div>
        <div class="text-[12px] text-[var(--text-dim)] mb-1.5 flex justify-between"><span>字号</span><span class="tabular-nums text-[var(--text-faint)]">{{ typo.fs }}</span></div>
        <input v-model.number="typo.fs" type="range" min="13" max="24" step="1" class="w-full accent-[var(--accent)]" @change="persist" />
      </div>
      <div>
        <div class="text-[12px] text-[var(--text-dim)] mb-1.5 flex justify-between"><span>行高</span><span class="tabular-nums text-[var(--text-faint)]">{{ typo.lh }}</span></div>
        <input v-model.number="typo.lh" type="range" min="1.5" max="2.6" step="0.1" class="w-full accent-[var(--accent)]" @change="persist" />
      </div>
      <div>
        <div class="text-[12px] text-[var(--text-dim)] mb-1.5 flex justify-between"><span>页宽</span><span class="tabular-nums text-[var(--text-faint)]">{{ typo.measure }}px</span></div>
        <input v-model.number="typo.measure" type="range" min="560" max="1040" step="40" class="w-full accent-[var(--accent)]" @change="persist" />
      </div>
      <div>
        <div class="text-[12px] text-[var(--text-dim)] mb-1.5">字体</div>
        <InkSelect v-model="typo.font" class="w-full" :options="FONTS.map((f) => ({ label: f.label, value: f.v }))" @change="persist" />
      </div>
    </div>

    <div class="flex items-center gap-6 flex-wrap">
      <label class="inline-flex items-center gap-2 cursor-pointer select-none text-[12.5px]">
        <input v-model="typo.paraGap" type="checkbox" class="accent-[var(--accent)]" @change="persist" />
        段间自动空一行
      </label>
      <div class="flex items-center gap-2">
        <span class="text-[12px] text-[var(--text-dim)]">稿纸网格</span>
        <button
          v-for="g in GRIDS"
          :key="g.v"
          class="text-[12px] px-3 py-1 rounded-full cursor-pointer transition-colors"
          :class="typo.grid === g.v ? 'font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
          :style="typo.grid === g.v ? { background: 'var(--panel-2)', color: 'var(--accent)' } : { background: 'var(--bg-soft)' }"
          @click="typo.grid = g.v; persist()"
        >
          {{ g.label }}
        </button>
      </div>
    </div>

    <div class="flex items-center justify-between pt-1">
      <InkButton variant="ghost" @click="reset">重置为默认</InkButton>
      <span v-if="saved" class="text-[11.5px] ok-pulse" style="color: var(--accent)">已应用</span>
    </div>
  </div>
</template>