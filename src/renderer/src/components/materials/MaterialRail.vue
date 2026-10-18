<script setup lang="ts">
/** 资料区右侧竖排图标栏：切换资料板块（内置 11 项 + 本书自定义面板） */
import { computed } from 'vue'
import { useAppStore } from '../../store/app'
import { Clock, FolderTree, GitBranch, Layers, Network, PenLine, Plus, Sparkles, Users, BookMarked, BarChart3, Footprints, ListChecks, Map as MapIcon, LayoutGrid } from 'lucide-vue-next'

const app = useAppStore()

const props = defineProps<{ extra?: { key: string; label: string }[] }>()
const emit = defineEmits<{ (e: 'switch', section: string): void; (e: 'add'): void }>()

const ITEMS: { key: string; label: string; icon: unknown }[] = [
  { key: '大纲', label: '大纲', icon: FolderTree },
  { key: '角色', label: '角色', icon: Users },
  { key: '设定', label: '设定', icon: Layers },
  { key: '时间线', label: '时间线', icon: Clock },
  { key: '故事线', label: '故事线', icon: Network },
  { key: '细纲', label: '细纲', icon: ListChecks },
  { key: '词典', label: '词典', icon: BookMarked },
  { key: '伏笔', label: '伏笔', icon: GitBranch },
  { key: '境界', label: '境界', icon: BarChart3 },
  { key: '出场', label: '出场', icon: Footprints },
  { key: '地图', label: '地图', icon: MapIcon }
]

const section = computed(() => app.materialsTab || '大纲')
</script>

<template>
  <aside class="w-[68px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-soft)]/60 flex flex-col items-center py-2 gap-0.5">
    <!-- 妙笔：跳到写作台的智能体 -->
    <button
      class="w-full flex flex-col items-center gap-1 py-2.5 cursor-pointer transition-colors rounded-[var(--r-sm)]"
      :style="{ color: 'var(--accent)' }"
      title="妙笔 · AI 助手"
      @click="app.goAskAgent()"
    >
      <Sparkles :size="17" />
      <span class="text-micro">妙笔</span>
    </button>

    <div class="w-8 h-px bg-[var(--border)] my-1 shrink-0" />

    <!-- 导航区：面板多时内部滚动，保证底部的「添加 / 写作台」始终可见 -->
    <nav class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col items-center gap-0.5 py-0.5 panel-rail-scroll">
      <button
        v-for="it in ITEMS"
        :key="it.key"
        class="w-full shrink-0 flex flex-col items-center gap-1 py-2.5 cursor-pointer transition-colors rounded-[var(--r-sm)]"
        :class="section === it.key ? 'bg-[var(--accent-soft)]' : 'text-[var(--text-dim)] hover:bg-[var(--hover)]'"
        :style="section === it.key ? { color: 'var(--accent)' } : {}"
        @click="emit('switch', it.key)"
      >
        <component :is="it.icon" :size="17" />
        <span class="text-micro">{{ it.label }}</span>
      </button>

      <!-- 自定义面板 -->
      <template v-for="p in props.extra || []" :key="p.key">
        <button
          class="w-full shrink-0 flex flex-col items-center gap-1 py-2.5 cursor-pointer transition-colors rounded-[var(--r-sm)]"
          :class="section === p.key ? 'bg-[var(--accent-soft)]' : 'text-[var(--text-dim)] hover:bg-[var(--hover)]'"
          :style="section === p.key ? { color: 'var(--accent)' } : {}"
          :title="`${p.label} · 自定义面板`"
          @click="emit('switch', p.key)"
        >
          <LayoutGrid :size="17" />
          <span class="text-micro truncate max-w-full px-1">{{ p.label }}</span>
        </button>
      </template>

      <button
        class="w-full shrink-0 flex flex-col items-center gap-1 py-2 cursor-pointer text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--hover)] rounded-[var(--r-sm)]"
        title="新建自定义面板"
        @click="emit('add')"
      >
        <Plus :size="16" />
        <span class="text-micro">添加</span>
      </button>
    </nav>

    <button
      class="w-full shrink-0 flex flex-col items-center gap-1 py-2.5 cursor-pointer text-[var(--text-dim)] hover:bg-[var(--hover)] rounded-[var(--r-sm)]"
      title="回到写作台"
      @click="app.go('writing')"
    >
      <PenLine :size="17" />
      <span class="text-micro">写作台</span>
    </button>
  </aside>
</template>
