<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useLibraryStore } from '../../store/library'
import InkButton from '../../ui/InkButton.vue'
import { inkConfirm } from '../../ui/inkPrompt'
import ProposalDiff from '../conversation/ProposalDiff.vue'
import { History, RotateCcw, FileText } from 'lucide-vue-next'
import type { DiffHunk } from '../../types'

const props = defineProps<{ book: string; rel: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'restored'): void }>()

const lib = useLibraryStore()

const versions = ref<{ file: string; at: string }[]>([])
const picked = ref('')
const diff = ref<{ hunks: DiffHunk[]; additions: number; deletions: number; truncated: boolean } | null>(null)
const loading = ref(false)
const diffLoading = ref(false)
const restoring = ref(false)

/** 底部说明：写库层现在的留档规则（有变化即留档，上限 20 份） */
const HINT = '章节每次保存有实际变化就自动留档，每章最多保留 20 份。'

function fmt(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const isChapter = computed(() => props.rel.startsWith('正文/'))

async function load() {
  loading.value = true
  try {
    versions.value = (await window.api.historyList(props.book, props.rel)) || []
    picked.value = ''
    diff.value = null
  } finally {
    loading.value = false
  }
}

/** 选中快照：加载「快照 → 当前稿」的差异（回滚前先看清会丢掉什么） */
async function pick(v: { file: string; at: string }) {
  if (picked.value === v.file) {
    picked.value = ''
    diff.value = null
    return
  }
  picked.value = v.file
  diff.value = null
  if (!isChapter.value) return
  diffLoading.value = true
  try {
    diff.value = (await window.api.historyDiff(props.book, props.rel, v.file)) as {
      hunks: DiffHunk[]
      additions: number
      deletions: number
      truncated: boolean
    }
  } catch {
    diff.value = null
  } finally {
    diffLoading.value = false
  }
}

async function restore() {
  if (!picked.value || restoring.value) return
  const ok = await inkConfirm('恢复这个历史版本？', {
    detail: '当前内容会先自动存一份快照，可随时再恢复回来。',
    confirmText: '恢复'
  })
  if (!ok) return
  restoring.value = true
  try {
    await window.api.historyRestore(props.book, props.rel, picked.value)
    emit('restored')
    emit('close')
  } finally {
    restoring.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="flex gap-4 h-[440px]">
    <!-- 左：版本列表 -->
    <div class="w-56 shrink-0 border-r border-[var(--border)] overflow-y-auto pr-1">
      <div v-if="loading" class="py-6 text-center text-[12px] text-[var(--text-faint)]">读取中…</div>
      <button
        v-for="v in versions"
        :key="v.file"
        class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left cursor-pointer transition-colors"
        :class="picked === v.file ? 'bg-[var(--panel-2)]' : 'hover:bg-[var(--hover)]'"
        @click="pick(v)"
      >
        <History :size="13" class="shrink-0" :style="{ color: picked === v.file ? 'var(--accent)' : 'var(--text-faint)' }" />
        <span class="text-[12px] tabular-nums">{{ fmt(v.at) }}</span>
      </button>
      <div v-if="!loading && !versions.length" class="py-8 text-center text-[12px] text-[var(--text-faint)] leading-6">
        暂无历史版本<br />章节保存过修改后自动留档
      </div>
    </div>

    <!-- 右：差异预览 + 恢复 -->
    <div class="flex-1 min-w-0 flex flex-col">
      <div class="flex items-center gap-2 mb-2">
        <span v-if="picked && diff" class="text-[11.5px] text-[var(--text-dim)]">
          相对当前稿：<span style="color: var(--accent)">+{{ diff.additions }}</span> / <span style="color: #e08a7a">−{{ diff.deletions }}</span>
        </span>
        <span v-else class="text-[12px] text-[var(--text-dim)]">版本差异</span>
        <div class="flex-1" />
        <InkButton :disabled="!picked || restoring" @click="restore">
          <RotateCcw :size="13" /> {{ restoring ? '恢复中…' : '恢复此版本' }}
        </InkButton>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto rounded-lg border border-[var(--border)]">
        <div v-if="diffLoading" class="h-full flex items-center justify-center text-[12px] text-[var(--text-faint)]">正在对比差异…</div>
        <template v-else-if="picked && diff">
          <ProposalDiff :hunks="diff.hunks" :truncated="diff.truncated" />
        </template>
        <div v-else class="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-faint)]">
          <FileText :size="22" class="opacity-50" />
          <span class="text-[12px]">选择一个历史版本，对比它和当前稿的差异</span>
        </div>
      </div>
      <p class="text-[11px] text-[var(--text-faint)] mt-2">{{ isChapter ? HINT : '非正文章节只留档变化较大的修改。' }}</p>
    </div>
  </div>
</template>
