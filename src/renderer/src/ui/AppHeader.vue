<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import { headerActionsFor, dispatchHeaderAction } from './headerActions'
import GlobalSearch from './GlobalSearch.vue'
import { Menu, ArrowLeft, ArrowRight, CircleCheck, LoaderCircle, Minus, Square, Copy, X } from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()

const actions = computed(() => headerActionsFor(app.view))

const subtitle = computed(() => {
  if (app.view === 'bookshelf') return ''
  return lib.current?.title || ''
})

// 任何页面的保存反馈都走顶栏（设置页保存、写作台自动保存共用）
const showSave = computed(() => !!app.saveText)

// ============ 无边框窗口：自绘窗口按钮 ============
const maximized = ref(false)
let offWinState: (() => void) | null = null

onMounted(async () => {
  maximized.value = await window.api.winIsMaximized()
  offWinState = window.api.winOnState((s) => (maximized.value = s.maximized))
})

onUnmounted(() => {
  offWinState?.()
  offWinState = null
})

// 模板里取不到 window，必须在这里转成组件作用域内的函数
function winMinimize(): void {
  void window.api.winMinimize()
}
function winMaximizeToggle(): void {
  void window.api.winMaximizeToggle()
}
function winClose(): void {
  void window.api.winClose()
}
</script>

<template>
  <!-- 全局顶部栏：所有页面共用，高度与字号固定；整条可拖动窗口 -->
  <header
    class="app-chrome app-drag shrink-0 h-14 flex items-center gap-3 pl-4 pr-0 border-b border-[var(--border)] bg-[var(--bg-soft)]/70 backdrop-blur"
    :class="{ 'focus-dim': app.focusMode }"
  >
    <!-- 左侧：导航 -->
    <div class="flex items-center gap-1 shrink-0">
      <button
        class="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] cursor-pointer"
        :title="app.navOpen ? '收起侧栏' : '展开侧栏'"
        @click="app.toggleNav()"
      >
        <Menu :size="16" />
      </button>
      <button
        class="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer"
        :class="app.canBack ? 'text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)]' : 'text-[var(--text-faint)] opacity-40 cursor-default'"
        :disabled="!app.canBack"
        title="后退"
        @click="app.back()"
      >
        <ArrowLeft :size="15" />
      </button>
      <button
        class="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer"
        :class="app.canForward ? 'text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)]' : 'text-[var(--text-faint)] opacity-40 cursor-default'"
        :disabled="!app.canForward"
        title="前进"
        @click="app.forward()"
      >
        <ArrowRight :size="15" />
      </button>
      <div class="w-px h-5 bg-[var(--border)] mx-1.5" />
    </div>

    <!-- 标题 -->
    <div class="shrink-0 min-w-0 flex items-baseline gap-2">
      <span class="font-serif-ink text-[15px] whitespace-nowrap">{{ app.viewTitle }}</span>
      <span v-if="subtitle" class="text-[11px] text-[var(--text-faint)] truncate max-w-[200px]">{{ subtitle }}</span>
    </div>

    <!-- 全局搜索 -->
    <div class="flex-1 min-w-0 flex justify-center px-2">
      <GlobalSearch />
    </div>

    <!-- 保存状态 -->
    <div v-if="showSave" class="shrink-0 flex items-center gap-1.5 text-[11.5px] whitespace-nowrap">
      <LoaderCircle v-if="app.saveBusy" :size="12" class="animate-spin text-[var(--text-faint)]" />
      <CircleCheck v-else :size="12" style="color: #7fae7a" />
      <span :class="app.saveBusy ? 'text-[var(--text-faint)]' : 'text-[var(--text-dim)]'">{{ app.saveText }}</span>
    </div>

    <!-- 本页主操作 -->
    <div v-if="actions.length" class="shrink-0 flex items-center gap-2">
      <button
        v-for="a in actions"
        :key="a.key"
        class="text-[12.5px] rounded-full cursor-pointer transition-colors whitespace-nowrap"
        :class="
          a.kind === 'primary'
            ? 'px-3.5 py-1.5 font-medium'
            : 'px-2.5 py-1.5 text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)]'
        "
        :style="a.kind === 'primary' ? { background: 'var(--accent)', color: '#1b1712' } : {}"
        @click="dispatchHeaderAction(a.key)"
      >
        {{ a.label }}
      </button>
    </div>

    <!-- 无边框窗口按钮 -->
    <div class="shrink-0 flex items-center self-stretch ml-1">
      <button
        class="w-11 h-full flex items-center justify-center text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)] cursor-pointer"
        title="最小化"
        @click="winMinimize"
      >
        <Minus :size="14" />
      </button>
      <button
        class="w-11 h-full flex items-center justify-center text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)] cursor-pointer"
        :title="maximized ? '向下还原' : '最大化'"
        @click="winMaximizeToggle"
      >
        <component :is="maximized ? Copy : Square" :size="12" />
      </button>
      <button
        class="w-11 h-full flex items-center justify-center text-[var(--text-dim)] hover:bg-[#c0392b] hover:text-white cursor-pointer"
        title="关闭"
        @click="winClose"
      >
        <X :size="15" />
      </button>
    </div>
  </header>
</template>