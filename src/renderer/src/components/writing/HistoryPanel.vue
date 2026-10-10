<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useLibraryStore } from '../../store/library'
import InkButton from '../../ui/InkButton.vue'
import { inkConfirm } from '../../ui/inkPrompt'
import { History, RotateCcw, FileText } from 'lucide-vue-next'

const props = defineProps<{ book: string; rel: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'restored'): void }>()

const lib = useLibraryStore()

const versions = ref<{ file: string; at: string }[]>([])
const picked = ref('')
const preview = ref('')
const loading = ref(false)
const restoring = ref(false)

function fmt(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function load() {
  loading.value = true
  try {
    versions.value = (await window.api.historyList(props.book, props.rel)) || []
    picked.value = ''
    preview.value = ''
  } finally {
    loading.value = false
  }
}

async function pick(v: { file: string; at: string }) {
  picked.value = v.file
  preview.value = await window.api.historyRead(props.book, props.rel, v.file)
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
        暂无历史版本<br />对章节做较大修改后会自动留档
      </div>
    </div>

    <!-- 右：预览 + 恢复 -->
    <div class="flex-1 min-w-0 flex flex-col">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-[12px] text-[var(--text-dim)]">版本预览</span>
        <div class="flex-1" />
        <InkButton :disabled="!picked || restoring" @click="restore">
          <RotateCcw :size="13" /> {{ restoring ? '恢复中…' : '恢复此版本' }}
        </InkButton>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto rounded-lg border border-[var(--border)] p-3.5">
        <template v-if="picked">
          <div class="text-[13px] leading-[1.9] whitespace-pre-wrap select-text">{{ preview }}</div>
        </template>
        <div v-else class="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-faint)]">
          <FileText :size="22" class="opacity-50" />
          <span class="text-[12px]">选择一个历史版本查看</span>
        </div>
      </div>
      <p class="text-[11px] text-[var(--text-faint)] mt-2">章节内容改动超过 800 字时自动留档，每章最多保留 10 份。</p>
    </div>
  </div>
</template>