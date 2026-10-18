<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '../../types'
import { useConversationStore } from '../../store/conversation'
import { renderMarkdown } from '../../ui/markdown'
import ProcessingTimeline from './ProcessingTimeline.vue'
import ProposalCard from './ProposalCard.vue'
import LibraryProposalCard from './LibraryProposalCard.vue'
import InkButton from '../../ui/InkButton.vue'
import { Paperclip, Sparkles, BookOpen, CircleAlert, Users } from 'lucide-vue-next'

const props = defineProps<{ message: ChatMessage; agentId: string }>()

const conv = useConversationStore()
const agentName = computed(
  () => conv.allAgents.find((a) => a.id === (props.message.agentId || props.agentId))?.name || '写作助手'
)
const html = computed(() => renderMarkdown(props.message.content))
const streaming = computed(() => props.message.status === 'streaming')
const pendingApproval = computed(
  () => props.message.proposals.length > 0 && props.message.proposals.some((p) => p.status === 'pending')
)
</script>

<template>
  <!-- 用户消息 -->
  <div v-if="message.role === 'user'" class="flex justify-end">
    <div class="max-w-[85%] space-y-1.5">
      <div
        v-if="message.skillRefs?.length || message.materialRefs?.length || message.attachments?.length"
        class="flex flex-wrap gap-1.5 justify-end"
      >
        <span
          v-for="s in message.skillRefs || []"
          :key="'s' + s.group + s.name"
          class="ink-chip-btn"
        >
          <Sparkles :size="10" :style="{ color: 'var(--accent)' }" />技能 · {{ s.name }}
        </span>
        <span
          v-for="m in message.materialRefs || []"
          :key="'m' + m.group + m.name"
          class="ink-chip-btn"
        >
          <BookOpen :size="10" :style="{ color: 'var(--accent)' }" />素材 · {{ m.name }}
        </span>
        <span
          v-for="a in message.attachments || []"
          :key="'a' + a.name"
          class="ink-chip-btn"
        >
          <Paperclip :size="10" />{{ a.name }} · {{ a.size }} 字
        </span>
      </div>
      <div
        class="rounded-[var(--r-lg)] px-4 py-2.5 text-body leading-[1.85] whitespace-pre-wrap break-words"
        style="background: var(--panel-2)"
      >
        {{ message.content }}
      </div>
    </div>
  </div>

  <!-- 助手消息 -->
  <div v-else class="space-y-2.5">
    <div class="flex items-center gap-2 text-meta text-[var(--text-faint)]">
      <span class="font-serif-ink text-label" :style="{ color: 'var(--accent)' }">{{ agentName }}</span>
      <span v-if="streaming" class="ink-dots"><span /><span /><span /></span>
      <span v-else-if="message.status === 'aborted'">已停止</span>
      <span v-else-if="message.status === 'error'" class="ink-text-danger">运行失败</span>
    </div>

    <ProcessingTimeline :message="message" />

    <div
      v-if="html"
      class="markdown-body text-body leading-[1.9] break-words"
      v-html="html"
    />

    <div v-if="pendingApproval" class="flex items-center gap-1.5 text-meta" :style="{ color: 'var(--accent)' }">
      <CircleAlert :size="12" /> 有 {{ message.proposals.filter((p) => p.status === 'pending').length }} 处修改待你审阅
    </div>
    <div v-for="p in message.proposals" :key="p.id">
      <ProposalCard :proposal="p" />
    </div>
    <div v-for="lp in message.libProposals || []" :key="lp.id">
      <LibraryProposalCard :proposal="lp" />
    </div>

    <!-- 分配模式：子智能体调用询问卡 -->
    <div
      v-for="r in message.subagentRequests || []"
      :key="r.id"
      class="rounded-[var(--r-md)] border p-3.5 space-y-2"
      :class="r.status === 'pending' ? 'border-[var(--accent-line)]' : 'border-[var(--border)]'"
    >
      <div class="flex items-center gap-2 text-label flex-wrap">
        <Users :size="13" class="text-[var(--accent)]" />
        <span class="font-medium">分配请求 → {{ r.agentName }}</span>
        <span class="ink-chip" :class="r.status === 'pending' ? 'ink-chip-accent' : ''">
          {{ r.status === 'pending' ? '等待你确认' : r.status === 'running' ? '执行中…' : r.status === 'done' ? '已完成' : r.status === 'rejected' ? '已拒绝' : '执行失败' }}
        </span>
      </div>
      <div class="text-label text-[var(--text-dim)] leading-5">任务：{{ r.task }}</div>
      <details v-if="r.output" class="text-label">
        <summary class="cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-dim)] select-none">{{ r.status === 'running' ? '实时输出' : '子智能体汇报' }}（点击展开）</summary>
        <div class="mt-1.5 p-2.5 rounded-[var(--r-sm)] bg-[var(--bg-soft)] whitespace-pre-wrap break-words max-h-56 overflow-y-auto leading-6">{{ r.output }}</div>
      </details>
      <div v-if="r.status === 'pending'" class="flex items-center gap-2 pt-1 flex-wrap">
        <InkButton size="sm" @click="conv.decideSubagent(r.id, true)">允许执行</InkButton>
        <InkButton variant="ghost" size="sm" @click="conv.decideSubagent(r.id, false)">拒绝</InkButton>
        <span class="text-meta text-[var(--text-faint)]">子智能体将独立完成任务，结果作为汇报交回主智能体</span>
      </div>
    </div>

    <div
      v-if="message.error"
      class="flex items-start gap-2 rounded-[var(--r-sm)] border px-3 py-2 text-label ink-soft-danger ink-text-danger"
    >
      <CircleAlert :size="13" class="shrink-0 mt-0.5" />
      <span class="break-words">{{ message.error }}</span>
    </div>
  </div>
</template>