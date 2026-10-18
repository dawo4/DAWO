<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EditProposal, ProposalStatus } from '../../types'
import ProposalDiff from './ProposalDiff.vue'
import InkButton from '../../ui/InkButton.vue'
import { useConversationStore } from '../../store/conversation'
import { Check, X, ChevronDown, ChevronRight, FileText, LoaderCircle } from 'lucide-vue-next'

const props = defineProps<{ proposal: EditProposal }>()
const conv = useConversationStore()
const open = ref(true)

const LABELS: Record<ProposalStatus, string> = {
  pending: '待审阅',
  accepting: '正在应用',
  accepted: '已接受',
  rejected: '已拒绝',
  conflict: '变更冲突',
  error: '应用失败'
}

const COLORS: Record<ProposalStatus, string> = {
  pending: 'var(--accent)',
  accepting: 'var(--text-dim)',
  accepted: 'var(--ok)',
  rejected: 'var(--text-faint)',
  conflict: 'var(--warn)',
  error: 'var(--danger)'
}

const status = computed(() => props.proposal.status)
const busy = computed(() => status.value === 'accepting')
const decided = computed(() => status.value === 'accepted' || status.value === 'rejected')
const disabled = computed(() => busy.value || status.value === 'accepted' || status.value === 'conflict')

const autoApplied = computed(() => props.proposal.approvalMode === 'auto-approve' && status.value !== 'pending')
</script>

<template>
  <div class="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--border)]">
      <button class="ink-icon-btn is-muted" @click="open = !open">
        <component :is="open ? ChevronDown : ChevronRight" :size="15" />
      </button>
      <FileText :size="14" class="shrink-0 text-[var(--accent)]" />
      <div class="min-w-0 flex-1">
        <div class="text-label truncate">{{ proposal.target }}</div>
        <div class="text-meta text-[var(--text-faint)] truncate">{{ proposal.summary }}</div>
      </div>
      <div class="flex items-center gap-2 shrink-0 text-meta">
        <span class="ink-text-ok tnum">+{{ proposal.additions }}</span>
        <span class="ink-text-danger tnum">−{{ proposal.deletions }}</span>
        <span
          class="ink-chip"
          :style="{ color: COLORS[status], borderColor: COLORS[status] }"
        >
          {{ LABELS[status] }}
        </span>
      </div>
    </div>

    <!-- 差异内容 -->
    <div v-if="open" class="p-3">
      <ProposalDiff :hunks="proposal.hunks" :truncated="proposal.truncated" />
    </div>

    <!-- 状态说明 -->
    <div v-if="proposal.message" class="px-3.5 pb-2 text-meta" :style="{ color: COLORS[status] }">
      {{ proposal.message }}
    </div>

    <!-- 操作区 -->
    <div class="flex items-center justify-between px-3.5 py-2.5 border-t border-[var(--border)] bg-[var(--bg-soft)]">
      <div class="text-meta text-[var(--text-faint)]">
        {{ autoApplied ? '自动批准模式' : '需人工审阅' }}
      </div>
      <div class="flex items-center gap-2">
        <template v-if="busy">
          <LoaderCircle :size="14" class="animate-spin text-[var(--text-dim)]" />
          <span class="text-meta text-[var(--text-dim)]">正在写入…</span>
        </template>
        <template v-else-if="!decided">
          <InkButton variant="ghost" size="sm" :disabled="disabled" @click="conv.rejectProposal(proposal.id)">
            <X :size="12" /> 拒绝
          </InkButton>
          <InkButton size="sm" :disabled="disabled" @click="conv.acceptProposal(proposal.id)">
            <Check :size="12" /> 接受变更
          </InkButton>
        </template>
        <span v-else class="text-meta text-[var(--text-faint)]">
          {{ status === 'accepted' ? '已写入本机文稿' : '已保留原稿' }}
        </span>
      </div>
    </div>
  </div>
</template>