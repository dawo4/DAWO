<script setup lang="ts">
/**
 * 写作台左栏：作品文件树。
 * 视觉改版要点：
 * - 选中态改为「左缘 2px 强调标记条 + 淡强调底」，与全局导航选中态一致
 * - 行高与字号统一到设计令牌；目录/文件区分靠颜色不靠装饰
 * - 删除按钮走 --danger（原先硬编码 #e08a7a）
 * 逻辑与 props / emits 与旧版完全一致。
 */
import { useLibraryStore } from '../store/library'
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
  <div class="tree-root text-label select-none">
    <!-- 栏头 -->
    <div class="flex items-center justify-between pl-3.5 pr-2.5 h-9 shrink-0">
      <span class="section-title">作品文件</span>
      <button
        class="w-6 h-6 rounded-[var(--r-sm)] flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--hover)] cursor-pointer transition-colors"
        title="新建章节"
        @click="emit('new-chapter')"
      >
        <Plus :size="15" />
      </button>
    </div>
    <div class="px-3 pb-2 shrink-0">
      <input v-model="keyword" class="ink-input !py-1 !px-2.5 text-label" placeholder="搜索全书文件…" />
    </div>

    <template v-for="n in lib.tree" :key="n.path">
      <!-- 目录 -->
      <template v-if="n.dir">
        <button
          class="tree-row mx-1 text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-[var(--hover)]"
          @click="toggle(n.path)"
        >
          <component :is="collapsed[n.path] ? ChevronRight : ChevronDown" :size="13" class="shrink-0 transition-transform" />
          <span class="truncate">{{ n.name }}</span>
        </button>
        <template v-if="!collapsed[n.path]">
          <div
            v-for="c in (n.children || []).filter((x) => hit(x.name))"
            :key="c.path"
            class="tree-row group indent-1 mx-1 pr-1.5"
            :class="
              props.currentFile === c.path
                ? 'tree-row-on'
                : 'text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]'
            "
            @click="!c.dir && emit('open', c.path)"
          >
            <FileText :size="13" class="shrink-0 opacity-55" />
            <span class="truncate flex-1">{{ c.name.replace(/\.md$/, '') }}</span>
            <button
              class="del opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer transition-opacity"
              title="删除"
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
        class="tree-row mx-1"
        :class="
          props.currentFile === n.path
            ? 'tree-row-on'
            : 'text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]'
        "
        @click="emit('open', n.path)"
      >
        <FileText :size="13" class="shrink-0 opacity-55" />
        <span class="truncate">{{ n.name.replace(/\.md$/, '') }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tree-root {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 行基线：统一高度与圆角，缩进由缩进类单独给 */
.tree-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  padding: 3px 8px 3px 12px;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background-color var(--dur-2), color var(--dur-2);
}
/* 子级缩进（目录内文件） */
.tree-row.indent-1 {
  padding-left: 28px;
}
/* 选中态：与侧栏导航一致的「标记条 + 淡强调底」 */
.tree-row-on {
  background: var(--accent-soft);
  color: var(--accent);
}
.tree-row-on::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 2px;
  height: 13px;
  margin-top: -6.5px;
  border-radius: 1px;
  background: var(--accent);
  animation: nav-mark-in var(--dur-2) var(--ease-out) both;
}
.del {
  color: var(--text-faint);
}
.del:hover {
  color: var(--danger);
}
</style>
