<script setup lang="ts">
// 引用资料选择器：从技能库 / 素材库 / 灵感便签挑选条目，chips 展示（工作流等场景共用）
import { computed, onMounted, ref } from 'vue'
import { useLibrariesStore } from '../store/libraries'
import InkModal from './InkModal.vue'
import type { LibKind } from '../types'
import { Plus, Search, Sparkles, BookOpen, Lightbulb } from 'lucide-vue-next'


export interface RefItem {
  kind: LibKind
  group: string
  name: string
}

const props = defineProps<{ modelValue: RefItem[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: RefItem[]): void }>()

const libs = useLibrariesStore()
const open = ref(false)
const tab = ref<LibKind>('skills')
const query = ref('')

const TABS: { k: LibKind; t: string; icon: unknown }[] = [
  { k: 'skills', t: '技能库', icon: Sparkles },
  { k: 'materials', t: '素材库', icon: BookOpen },
  { k: 'notes', t: '灵感便签', icon: Lightbulb }
]

const LIB_LABEL: Record<string, string> = { skills: '技能', materials: '素材', notes: '灵感' }

const items = computed(() => {
  const q = query.value.trim().toLowerCase()
  const out: { entry: { name: string; group: string; summary: string; tags: string[] } }[] = []
  for (const g of libs.groups(tab.value)) {
    for (const e of g.entries) {
      if (q && !`${e.name}${e.summary}${e.tags.join('')}`.toLowerCase().includes(q)) continue
      out.push({ entry: e })
    }
  }
  return out.slice(0, 80)
})

function isPicked(kind: LibKind, group: string, name: string): boolean {
  return props.modelValue.some((r) => r.kind === kind && r.group === group && r.name === name)
}

function toggle(kind: LibKind, group: string, name: string): void {
  if (isPicked(kind, group, name)) {
    emit('update:modelValue', props.modelValue.filter((r) => !(r.kind === kind && r.group === group && r.name === name)))
  } else {
    emit('update:modelValue', [...props.modelValue, { kind, group, name }])
  }
}

function remove(i: number): void {
  const next = [...props.modelValue]
  next.splice(i, 1)
  emit('update:modelValue', next)
}

onMounted(() => void libs.refresh())
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <span class="text-[11.5px] text-[var(--text-faint)] shrink-0">引用资料</span>
    <span
      v-for="(r, i) in modelValue"
      :key="r.kind + r.group + r.name"
      class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-[var(--bg-soft)]"
      :title="`${LIB_LABEL[r.kind]} · ${r.group}/${r.name}`"
    >
      <span style="color: var(--accent)">{{ LIB_LABEL[r.kind] }}</span>{{ r.name }}
      <button class="text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer" @click="remove(i)">✕</button>
    </span>
    <button
      class="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full cursor-pointer transition-colors bg-[var(--bg-soft)] text-[var(--text-dim)] hover:text-[var(--accent)]"
      @click="open = true"
    >
      <Plus :size="11" /> 添加
    </button>
  </div>

  <InkModal :open="open" title="选择引用资料" wide @close="open = false">
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <div class="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-[var(--bg-soft)]">
          <button
            v-for="t in TABS"
            :key="t.k"
            class="px-3 py-1 rounded-full text-[12px] cursor-pointer transition-colors flex items-center gap-1"
            :class="tab === t.k ? 'bg-[var(--panel-2)] font-medium' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
            :style="tab === t.k ? { color: 'var(--accent)' } : {}"
            @click="tab = t.k"
          >
            <component :is="t.icon" :size="12" /> {{ t.t }}
          </button>
        </div>
        <div class="relative flex-1">
          <Search :size="13" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input v-model="query" class="ink-input pl-8 h-8 py-0 text-[12.5px]" placeholder="搜索名称 / 摘要 / 标签" />
        </div>
      </div>
      <div class="max-h-[360px] overflow-y-auto space-y-1">
        <button
          v-for="it in items"
          :key="tab + it.entry.group + it.entry.name"
          class="w-full text-left px-3 py-2 rounded-lg cursor-pointer transition-colors flex items-center gap-2"
          :class="isPicked(tab, it.entry.group, it.entry.name) ? 'bg-[var(--panel-2)]' : 'hover:bg-[var(--hover)]'"
          @click="toggle(tab, it.entry.group, it.entry.name)"
        >
          <div class="flex-1 min-w-0">
            <div class="text-[12.5px]" :style="isPicked(tab, it.entry.group, it.entry.name) ? { color: 'var(--accent)' } : {}">
              {{ it.entry.name }}
            </div>
            <div class="text-[11px] text-[var(--text-faint)] truncate">{{ it.entry.group }} · {{ it.entry.summary || '无摘要' }}</div>
          </div>
          <span v-if="isPicked(tab, it.entry.group, it.entry.name)" class="text-[11px] shrink-0" style="color: var(--accent)">✓ 已选</span>
        </button>
        <div v-if="!items.length" class="py-8 text-center text-[12px] text-[var(--text-faint)]">
          这个库还没有条目，可到「资源库」新建
        </div>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-[11px] text-[var(--text-faint)]">已选 {{ modelValue.length }} 项，内容将随每次生成注入提示词</span>
        <button class="text-label px-3 py-1.5 rounded-[var(--r-sm)] cursor-pointer" :style="{ background: 'var(--accent)', color: 'var(--accent-ink)' }" @click="open = false">完成</button>
      </div>
    </div>
  </InkModal>
</template>
