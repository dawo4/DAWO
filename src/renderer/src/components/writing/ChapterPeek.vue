<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLibraryStore } from '../../store/library'
import { FileText, SquareCheckBig } from 'lucide-vue-next'
import BatchRevise from './BatchRevise.vue'

const props = defineProps<{ book: string; currentFile: string }>()
const emit = defineEmits<{ (e: 'open', path: string): void }>()

const lib = useLibraryStore()
const batchOpen = ref(false)

/** prevCounts 是每次打开文件时记录的字数，正好当章节字数总览用，无需额外读文件 */
const counts = ref<Record<string, number>>({})

const chapters = computed(() =>
  lib.chapterList().map((c) => {
    const saved = counts.value[c.path]
    return {
      path: c.path,
      name: c.name.replace(/\.md$/, ''),
      // 未打开过的章节没有记录，显示 —
      words: typeof saved === 'number' ? saved : null,
      isCurrent: c.path === props.currentFile
    }
  })
)

const total = computed(() => chapters.value.reduce((a, c) => a + (c.words || 0), 0))
const knownCount = computed(() => chapters.value.filter((c) => c.words !== null).length)

async function load() {
  if (!props.book) return
  // 切书时 watch(book) 与 watch(currentFile) 会各触发一次，且旧书响应可能后到——过期结果直接丢弃
  const seq = ++loadSeq
  try {
    const s = (await window.api.statsGet(props.book)) as { prevCounts?: Record<string, number> }
    if (seq !== loadSeq) return
    counts.value = s?.prevCounts || {}
  } catch {
    if (seq === loadSeq) counts.value = {}
  }
}

let loadSeq = 0

onMounted(() => void load())
watch(() => props.book, () => void load())
// 当前章节保存后字数会变，切章时刷新一下
watch(() => props.currentFile, () => void load())

function onFileChanged() {
  void load()
}
onMounted(() => window.addEventListener('inkdesk:file-changed', onFileChanged))
onUnmounted(() => window.removeEventListener('inkdesk:file-changed', onFileChanged))
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div class="shrink-0 px-3.5 py-2.5 border-b border-[var(--border)]">
      <div class="text-[11px] text-[var(--text-faint)] flex items-center gap-1.5">
        <span>共 {{ chapters.length }} 章 · 已统计 {{ knownCount }} 章</span>
        <div class="flex-1" />
        <button
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full cursor-pointer text-[10.5px] transition-colors"
          :style="{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }"
          title="多章套用同一条修订指令，逐章出差异审阅"
          @click="batchOpen = true"
        >
          <SquareCheckBig :size="10" /> 批量修订
        </button>
      </div>
      <div class="text-[12px] mt-0.5">
        合计 <span class="tabular-nums" :style="{ color: 'var(--accent)' }">{{ total.toLocaleString() }}</span> 字
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto py-1">
      <button
        v-for="c in chapters"
        :key="c.path"
        class="w-full flex items-center gap-2 px-3.5 py-1.5 cursor-pointer text-left transition-colors border-l-2"
        :class="c.isCurrent ? 'bg-[var(--panel-2)]' : 'border-transparent hover:bg-[var(--hover)]'"
        :style="c.isCurrent ? { borderColor: 'var(--accent)' } : {}"
        @click="emit('open', c.path)"
      >
        <FileText :size="12" class="shrink-0" :style="{ color: c.isCurrent ? 'var(--accent)' : 'var(--text-faint)' }" />
        <span class="flex-1 min-w-0 text-[12px] truncate">{{ c.name }}</span>
        <span class="text-[11px] tabular-nums shrink-0" :class="c.words === null ? 'text-[var(--text-faint)]' : 'text-[var(--text-dim)]'">
          {{ c.words === null ? '—' : c.words.toLocaleString() }}
        </span>
      </button>

      <div v-if="!chapters.length" class="px-3.5 py-8 text-center text-[12px] text-[var(--text-faint)] leading-6">
        还没有章节<br />点顶部「新建章节」开始
      </div>
    </div>

    <div class="shrink-0 px-3.5 py-2 border-t border-[var(--border)] text-[10.5px] text-[var(--text-faint)] leading-4">
      字数在打开章节时记录，未打开过的显示「—」
    </div>

    <BatchRevise :book="props.book" :current-file="props.currentFile" :open="batchOpen" @close="batchOpen = false" />
  </div>
</template>