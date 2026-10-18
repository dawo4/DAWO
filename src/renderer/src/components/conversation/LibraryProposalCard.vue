<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LibProposal, LibProposalItem } from '../../types'
import { useConversationStore } from '../../store/conversation'
import InkButton from '../../ui/InkButton.vue'
import { Library, ChevronDown, ChevronRight, CircleCheck, PackageCheck, CircleAlert } from 'lucide-vue-next'

const props = defineProps<{ proposal: LibProposal }>()
const conv = useConversationStore()

const LIB_LABEL: Record<string, string> = { materials: '素材库', skills: '技能库', notes: '灵感便签' }

function keyOf(i: LibProposalItem): string {
  return `${i.library}/${i.group}/${i.name}`
}

/** 已入库的 key；兼容缺字段的旧数据 */
const applied = computed(() => props.proposal.appliedKeys || [])

const picked = ref<string[]>(props.proposal.items.map(keyOf))
const expanded = ref<string>('')
const busy = ref(false)

/** 尚未入库的条目 */
const pending = computed(() => props.proposal.items.filter((i) => !applied.value.includes(keyOf(i))))
const pickedPending = computed(() => pending.value.filter((i) => picked.value.includes(keyOf(i))))
const settled = computed(() => props.proposal.status === 'applied' || props.proposal.status === 'rejected')

function toggle(i: LibProposalItem) {
  const k = keyOf(i)
  const at = picked.value.indexOf(k)
  if (at >= 0) picked.value.splice(at, 1)
  else picked.value.push(k)
}

function toggleAll() {
  picked.value = picked.value.length === pending.value.length ? [] : pending.value.map(keyOf)
}

function togglePreview(i: LibProposalItem) {
  const k = keyOf(i)
  expanded.value = expanded.value === k ? '' : k
}

async function doApply() {
  if (!pickedPending.value.length || busy.value) return
  busy.value = true
  try {
    await conv.acceptLibProposal(
      props.proposal.id,
      pickedPending.value.map(keyOf)
    )
    picked.value = picked.value.filter((k) => !pickedPending.value.some((i) => keyOf(i) === k))
  } finally {
    busy.value = false
  }
}

async function doReject() {
  if (busy.value) return
  busy.value = true
  try {
    await conv.rejectLibProposal(props.proposal.id)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--border)]">
      <Library :size="13" class="text-[var(--accent)]" />
      <span class="text-label font-medium">资源库入库提案</span>
      <span class="text-meta text-[var(--text-faint)]">{{ proposal.summary }}</span>
      <div class="flex-1" />
      <span v-if="proposal.status === 'applied'" class="text-meta inline-flex items-center gap-1 text-[var(--accent)]">
        <CircleCheck :size="12" /> 已入库
      </span>
      <span v-else-if="proposal.status === 'rejected'" class="text-meta text-[var(--text-faint)]">已丢弃</span>
      <span v-else class="text-meta text-[var(--text-faint)]">{{ pending.length }} 条待确认</span>
    </div>

    <!-- 条目清单 -->
    <div v-if="!settled" class="max-h-[340px] overflow-y-auto">
      <div
        v-for="i in proposal.items"
        :key="keyOf(i)"
        class="border-b border-[var(--border)] last:border-b-0"
        :class="applied.includes(keyOf(i)) ? 'opacity-45' : ''"
      >
        <div class="flex items-start gap-2.5 px-3.5 py-2.5">
          <!-- 复选框 -->
          <button
            v-if="!applied.includes(keyOf(i))"
            class="mt-0.5 w-4 h-4 rounded-[4px] border shrink-0 cursor-pointer flex items-center justify-center transition-colors"
            :style="picked.includes(keyOf(i)) ? { background: 'var(--accent)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border)' }"
            @click="toggle(i)"
          >
            <CircleCheck v-if="picked.includes(keyOf(i))" :size="11" class="text-[var(--accent-ink)]" />
          </button>
          <PackageCheck v-else :size="16" class="mt-0.5 shrink-0 text-[var(--accent)]" />

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="ink-chip shrink-0">
                {{ LIB_LABEL[i.library] || i.library }}
              </span>
              <span class="text-micro text-[var(--text-faint)] shrink-0">{{ i.group }}</span>
              <span class="text-label truncate">{{ i.name }}</span>
              <span
                v-if="i.exists && !applied.includes(keyOf(i))"
                class="text-micro shrink-0 inline-flex items-center gap-0.5 ink-text-warn"
                title="库中已有同名条目，入库会覆盖它"
              >
                <CircleAlert :size="10" /> 将覆盖
              </span>
            </div>
            <div v-if="i.summary" class="text-meta text-[var(--text-dim)] mt-0.5">{{ i.summary }}</div>
            <div v-if="i.tags.length" class="flex gap-1 mt-1 flex-wrap">
              <span v-for="t in i.tags" :key="t" class="text-micro text-[var(--text-faint)]">#{{ t }}</span>
            </div>

            <!-- 正文预览 -->
            <button
              class="mt-1.5 text-meta text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer inline-flex items-center gap-0.5"
              @click="togglePreview(i)"
            >
              <component :is="expanded === keyOf(i) ? ChevronDown : ChevronRight" :size="11" />
              {{ expanded === keyOf(i) ? '收起正文' : `查看正文（${i.content.length} 字）` }}
            </button>
            <pre
              v-if="expanded === keyOf(i)"
              class="mt-1.5 p-2.5 rounded-[var(--r-sm)] bg-[var(--bg-soft)] text-label leading-6 whitespace-pre-wrap break-words max-h-56 overflow-y-auto select-text font-sans"
            >{{ i.content }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- 操作 -->
    <div v-if="!settled && pending.length" class="flex items-center gap-2 px-3.5 py-2.5 bg-[var(--bg-soft)]">
      <button class="text-meta text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer" @click="toggleAll">
        {{ picked.length === pending.length ? '全不选' : '全选' }}
      </button>
      <div class="flex-1" />
      <InkButton variant="ghost" size="sm" :disabled="busy" @click="doReject">全部丢弃</InkButton>
      <InkButton size="sm" :disabled="busy || !pickedPending.length" @click="doApply">
        入库 {{ pickedPending.length }} 条
      </InkButton>
    </div>
    <div v-else-if="settled && proposal.message" class="px-3.5 py-2 text-meta text-[var(--text-faint)]">
      {{ proposal.message }}
    </div>
  </div>
</template>