<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, X, Replace, ReplaceAll } from 'lucide-vue-next'

const props = defineProps<{ text: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'apply', text: string): void }>()

const find = ref('')
const replace = ref('')
const current = ref(0)
const findEl = ref<HTMLInputElement>()

/** 当前章节内所有命中位置（字符串索引） */
const hits = computed<number[]>(() => {
  const f = find.value
  if (!f) return []
  const out: number[] = []
  let i = props.text.indexOf(f)
  while (i >= 0) {
    out.push(i)
    i = props.text.indexOf(f, i + f.length)
  }
  return out
})

const countText = computed(() => {
  if (!find.value) return ''
  if (!hits.value.length) return '无匹配'
  return `第 ${Math.min(current.value + 1, hits.value.length)} / ${hits.value.length} 处`
})

watch(find, () => (current.value = 0))

/** 命中数变化后（例如替换过），把游标收进有效范围 */
watch(
  () => hits.value.length,
  (n) => {
    if (current.value >= n) current.value = 0
  }
)

function step(delta: number) {
  const n = hits.value.length
  if (!n) return
  current.value = (current.value + delta + n) % n
}

/** 替换当前这一处（父组件更新文本后，命中会自动重算） */
function replaceOne() {
  const at = hits.value[current.value]
  if (at === undefined) return
  const next = props.text.slice(0, at) + replace.value + props.text.slice(at + find.value.length)
  emit('apply', next)
}

function replaceAll() {
  if (!hits.value.length) return
  emit('apply', props.text.split(find.value).join(replace.value))
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  } else if (e.key === 'Enter') {
    e.preventDefault()
    step(e.shiftKey ? -1 : 1)
  }
}

onMounted(() => void nextTick(() => findEl.value?.focus()))
</script>

<template>
  <div class="shrink-0 flex items-center gap-2 px-3.5 py-2 border-b border-[var(--border)] bg-[var(--panel)]">
    <input
      ref="findEl"
      v-model="find"
      class="ink-input w-44 text-[12.5px]"
      placeholder="查找"
      @keydown="onKeydown"
    />
    <span class="text-[11px] text-[var(--text-faint)] w-24 shrink-0 tabular-nums">{{ countText }}</span>
    <button
      class="p-1 rounded cursor-pointer text-[var(--text-dim)] hover:text-[var(--accent)] disabled:opacity-35"
      :disabled="!hits.length"
      title="上一处（Shift+Enter）"
      @click="step(-1)"
    >
      <ChevronUp :size="14" />
    </button>
    <button
      class="p-1 rounded cursor-pointer text-[var(--text-dim)] hover:text-[var(--accent)] disabled:opacity-35"
      :disabled="!hits.length"
      title="下一处（Enter）"
      @click="step(1)"
    >
      <ChevronDown :size="14" />
    </button>

    <input v-model="replace" class="ink-input w-44 text-[12.5px] ml-2" placeholder="替换为" @keydown="onKeydown" />

    <button
      class="text-[11.5px] px-2 py-1 rounded cursor-pointer inline-flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] disabled:opacity-35"
      :disabled="!hits.length"
      @click="replaceOne"
    >
      <Replace :size="13" /> 替换
    </button>
    <button
      class="text-[11.5px] px-2 py-1 rounded cursor-pointer inline-flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] disabled:opacity-35"
      :disabled="!hits.length"
      @click="replaceAll"
    >
      <ReplaceAll :size="13" /> 全部替换
    </button>

    <div class="flex-1" />
    <span class="text-[10.5px] text-[var(--text-faint)]">替换后自动保存</span>
    <button class="p-1 rounded cursor-pointer text-[var(--text-faint)] hover:text-[var(--text)]" title="关闭（Esc）" @click="emit('close')">
      <X :size="14" />
    </button>
  </div>
</template>