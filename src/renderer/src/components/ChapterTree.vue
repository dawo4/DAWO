<script setup lang="ts">
import { useLibraryStore, type TreeNode } from '../store/library'
import { Plus, FileText, ChevronRight, ChevronDown, Trash2 } from 'lucide-vue-next'
import { ref } from 'vue'

const props = defineProps<{ currentFile: string }>()
const emit = defineEmits<{ (e: 'open', path: string): void; (e: 'new-chapter'): void; (e: 'delete', path: string): void }>()
const lib = useLibraryStore()
const collapsed = ref<Record<string, boolean>>({})
const keyword = ref('')

function toggle(path: string) {
  collapsed.value[path] = !collapsed.value[path]
}

function hit(name: string): boolean {
  return !keyword.value || name.toLowerCase().includes(keyword.value.toLowerCase())
}
</script>

<template>
  <div class="text-sm select-none">
    <div class="flex items-center justify-between px-3 py-2">
      <span class="text-xs text-[var(--text-faint)] tracking-wider">作品文件</span>
      <button class="text-[var(--text-dim)] hover:text-[var(--accent)] cursor-pointer p-1" title="新建章节" @click="emit('new-chapter')">
        <Plus :size="15" />
      </button>
    </div>
    <div class="px-3 pb-2">
      <input v-model="keyword" class="ink-input !py-1 !px-2.5 text-xs" placeholder="搜索全书文件…" />
    </div>
    <template v-for="n in lib.tree" :key="n.path">
      <!-- 目录 -->
      <template v-if="n.dir">
        <div
          class="flex items-center gap-1 px-3 py-1.5 cursor-pointer text-[var(--text-dim)] hover:bg-[var(--hover)]"
          @click="toggle(n.path)"
        >
          <component :is="collapsed[n.path] ? ChevronRight : ChevronDown" :size="13" />
          {{ n.name }}
        </div>
        <template v-if="!collapsed[n.path]">
          <div
            v-for="c in (n.children || []).filter((x) => hit(x.name))"
            :key="c.path"
            class="group flex items-center gap-2 pl-8 pr-2 py-1.5 cursor-pointer rounded-r-md"
            :class="props.currentFile === c.path ? 'bg-[var(--panel-2)] text-[var(--accent)]' : 'text-[var(--text-dim)] hover:bg-[var(--hover)]'"
            @click="!c.dir && emit('open', c.path)"
          >
            <FileText :size="13" class="shrink-0 opacity-60" />
            <span class="truncate flex-1">{{ c.name.replace(/\.md$/, '') }}</span>
            <button
              class="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[#e08a7a] cursor-pointer"
              @click.stop="emit('delete', c.path)"
            >
              <Trash2 :size="12" />
            </button>
          </div>
        </template>
      </template>
      <!-- 根级文件（如 时间线.md） -->
      <div
        v-else-if="hit(n.name)"
        class="group flex items-center gap-2 px-3 py-1.5 cursor-pointer"
        :class="props.currentFile === n.path ? 'bg-[var(--panel-2)] text-[var(--accent)]' : 'text-[var(--text-dim)] hover:bg-[var(--hover)]'"
        @click="emit('open', n.path)"
      >
        <FileText :size="13" class="opacity-60" />
        <span class="truncate">{{ n.name.replace(/\.md$/, '') }}</span>
      </div>
    </template>
  </div>
</template>
