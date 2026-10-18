<script setup lang="ts">
import type { DiffHunk, DiffLineType } from '../../types'

defineProps<{ hunks: DiffHunk[]; truncated?: boolean }>()

function sign(t: DiffLineType): string {
  return t === 'addition' ? '+' : t === 'deletion' ? '-' : ' '
}
</script>

<template>
  <div class="rounded-[var(--r-sm)] border border-[var(--border)] overflow-hidden">
    <div v-for="(h, hi) in hunks" :key="hi" class="border-b border-[var(--border)] last:border-b-0">
      <div class="px-3 py-1 text-meta text-[var(--text-faint)] bg-[var(--bg-soft)] font-mono">
        @@ -{{ h.oldStart }},{{ h.oldLines }} +{{ h.newStart }},{{ h.newLines }} @@
      </div>
      <div
        v-for="(l, li) in h.lines"
        :key="li"
        class="flex font-mono text-label leading-[1.75]"
        :class="l.type === 'addition' ? 'diff-add' : l.type === 'deletion' ? 'diff-del' : ''"
      >
        <span class="w-9 shrink-0 text-right pr-2 select-none text-[var(--text-faint)] tnum">{{ l.oldLineNumber ?? '' }}</span>
        <span class="w-9 shrink-0 text-right pr-2 select-none text-[var(--text-faint)] tnum">{{ l.newLineNumber ?? '' }}</span>
        <span class="w-4 shrink-0 select-none opacity-60">{{ sign(l.type) }}</span>
        <span class="flex-1 min-w-0 whitespace-pre-wrap break-words pr-3">{{ l.text || ' ' }}</span>
      </div>
    </div>
    <div v-if="truncated" class="px-3 py-2 text-meta text-[var(--text-faint)] bg-[var(--bg-soft)] border-t border-[var(--border)]">
      改动过大，差异已截断显示，接受后仍会写入完整内容。
    </div>
  </div>
</template>