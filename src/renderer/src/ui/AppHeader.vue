<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from '../store/app'
import { useLibraryStore } from '../store/library'
import { headerActionsFor, dispatchHeaderAction } from './headerActions'
import GlobalSearch from './GlobalSearch.vue'
import { Menu, ArrowLeft, ArrowRight, CircleCheck, LoaderCircle, Minus, Square, Copy, X, Sparkles } from 'lucide-vue-next'

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

/** 顶栏「新版本」轻提示：点击清掉提示并直达「关于」页看更新日志 */
function goUpdate() {
  app.updateVersion = ''
  app.settingsTab = 'about'
  app.go('settings')
}
</script>

<template>
  <!-- 全局顶部栏：所有页面共用，高度与字号固定；整条可拖动窗口
       高度 48px：压缩顶栏换取内容区高度；分隔只用 1px hairline，不用厚重底色 -->
  <header
    class="app-chrome app-drag shrink-0 h-12 flex items-center gap-3 pl-3 pr-0 border-b border-[var(--border)] bg-[var(--bg-soft)]/60 backdrop-blur-[8px]"
    :class="{ 'focus-dim': app.focusMode }"
  >
    <!-- 左侧：导航 -->
    <div class="flex items-center gap-0.5 shrink-0">
      <button
        class="w-7 h-7 rounded-[var(--r-sm)] flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)] cursor-pointer transition-colors"
        :title="app.navOpen ? '收起侧栏' : '展开侧栏'"
        @click="app.toggleNav()"
      >
        <Menu :size="15" />
      </button>
      <button
        class="w-7 h-7 rounded-[var(--r-sm)] flex items-center justify-center cursor-pointer transition-colors"
        :class="app.canBack ? 'text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)]' : 'text-[var(--text-faint)] opacity-40 cursor-default'"
        :disabled="!app.canBack"
        title="后退"
        @click="app.back()"
      >
        <ArrowLeft :size="14" />
      </button>
      <button
        class="w-7 h-7 rounded-[var(--r-sm)] flex items-center justify-center cursor-pointer transition-colors"
        :class="app.canForward ? 'text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--hover)]' : 'text-[var(--text-faint)] opacity-40 cursor-default'"
        :disabled="!app.canForward"
        title="前进"
        @click="app.forward()"
      >
        <ArrowRight :size="14" />
      </button>
      <div class="w-px h-5 bg-[var(--border)] mx-1" />
    </div>

    <!-- 标题：衬线页名 + 极淡作品名 -->
    <div class="shrink-0 min-w-0 flex items-baseline gap-2">
      <span class="font-serif-ink text-heading whitespace-nowrap text-[var(--text)]">{{ app.viewTitle }}</span>
      <span v-if="subtitle" class="text-micro tracking-[0.08em] text-[var(--text-faint)] truncate max-w-[180px]">{{ subtitle }}</span>
    </div>

    <!-- 全局搜索（窄屏时自动收窄，仍保持单实例以免重复注册快捷键） -->
    <div class="flex-1 min-w-0 flex justify-center px-2">
      <GlobalSearch />
    </div>

    <!-- 保存状态 -->
    <div v-if="showSave" class="shrink-0 flex items-center gap-1.5 text-meta whitespace-nowrap">
      <LoaderCircle v-if="app.saveBusy" :size="12" class="animate-spin text-[var(--text-faint)]" />
      <CircleCheck v-else :size="12" :style="{ color: 'var(--ok)' }" />
      <span :class="app.saveBusy ? 'text-[var(--text-faint)]' : 'text-[var(--text-dim)]'">{{ app.saveText }}</span>
    </div>

    <!-- 新版本轻提示：启动静默检查发现更新时出现，点击直达关于页 -->
    <button
      v-if="app.updateVersion && !showSave"
      class="app-nodrag shrink-0 ink-ripple flex items-center gap-1.5 text-meta px-2.5 py-1 rounded-[var(--r-pill)] cursor-pointer transition-colors whitespace-nowrap"
      :style="{
        border: '1px solid var(--accent-line)',
        background: 'var(--accent-soft)',
        color: 'var(--accent)'
      }"
      title="发现新版本，点击查看更新日志与下载"
      @click="goUpdate"
    >
      <Sparkles :size="12" /> 新版本 v{{ app.updateVersion }}
    </button>

    <!-- 本页主操作：主态＝强调色实底，次态＝纯文字（hover 才显底） -->
    <div v-if="actions.length" class="shrink-0 flex items-center gap-1.5">
      <button
        v-for="a in actions"
        :key="a.key"
        class="h-7 rounded-[var(--r-sm)] cursor-pointer transition-colors whitespace-nowrap text-label"
        :class="
          a.kind === 'primary'
            ? 'px-3 font-medium hover:brightness-105'
            : 'px-2.5 text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--hover)]'
        "
        :style="a.kind === 'primary' ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : {}"
        @click="dispatchHeaderAction(a.key)"
      >
        {{ a.label }}
      </button>
    </div>

    <!-- 无边框窗口按钮 -->
    <div class="shrink-0 flex items-center self-stretch ml-1.5">
      <button
        class="w-11 h-full flex items-center justify-center text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)] cursor-pointer transition-colors"
        title="最小化"
        @click="winMinimize"
      >
        <Minus :size="14" />
      </button>
      <button
        class="w-11 h-full flex items-center justify-center text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)] cursor-pointer transition-colors"
        :title="maximized ? '向下还原' : '最大化'"
        @click="winMaximizeToggle"
      >
        <component :is="maximized ? Copy : Square" :size="12" />
      </button>
      <button
        class="win-close w-11 h-full flex items-center justify-center text-[var(--text-dim)] cursor-pointer transition-colors"
        title="关闭"
        @click="winClose"
      >
        <X :size="15" />
      </button>
    </div>
  </header>
</template>

<style scoped>
/* 关闭按钮：hover 用危险色（唯一使用状态色的地方） */
.win-close:hover {
  background: var(--danger);
  color: #fff;
}
</style>