<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from './store/app'
import { useLibraryStore } from './store/library'
import GlowCursor from './ui/GlowCursor.vue'
import FloatingOrbs from './ui/FloatingOrbs.vue'
import CursorParticles from './ui/CursorParticles.vue'
import InkPromptHost from './ui/InkPromptHost.vue'
import AppHeader from './ui/AppHeader.vue'
import AppNav from './ui/AppNav.vue'
import HomeView from './views/HomeView.vue'
import StatsView from './views/StatsView.vue'
import BookshelfView from './views/BookshelfView.vue'
import WritingView from './views/WritingView.vue'
import WorkflowView from './views/WorkflowView.vue'
import DeconstructView from './views/DeconstructView.vue'
import MaterialsView from './views/MaterialsView.vue'
import LibraryView from './views/LibraryView.vue'
import AgentLabView from './views/AgentLabView.vue'
import AssistantView from './views/AssistantView.vue'
import SettingsView from './views/SettingsView.vue'
import { setupInkUi } from './ui/inkTooltip'

const app = useAppStore()
const lib = useLibraryStore()

/** 视图表：:is 需要直接指向组件，故从模板里提到脚本中定义 */
const VIEWS = {
  home: HomeView,
  bookshelf: BookshelfView,
  writing: WritingView,
  workflow: WorkflowView,
  deconstruct: DeconstructView,
  materials: MaterialsView,
  library: LibraryView,
  agentlab: AgentLabView,
  assistant: AssistantView,
  stats: StatsView,
  settings: SettingsView
} as const

/**
 * 视图缓存现状（备忘）：
 * App 里的 <KeepAlive> 包的是一层普通 <div>，而 KeepAlive 只缓存「组件」vnode
 * （Vue 源码：`!(shapeFlag & 4) && !(shapeFlag & 128)` 时直接 return，不做缓存），
 * 所以视图实际是每次切换重新挂载，onActivated / onDeactivated 形同虚设。
 * 真正的修法需要把每个视图收敛为单根（或把这层外壳换成组件）；
 * 实测换成组件会让同一视图在一次切换里出现重复挂载/卸载，故留待专项处理，不在本次重构里动。
 */

onMounted(async () => {
  setupInkUi()
  await app.loadConfig()
  await lib.loadBooks()
  if (app.config?.activeBook) {
    const b = lib.books.find((x) => x.title === app.config!.activeBook)
    if (b) await lib.openBook(b.title)
  }
})

// 全局订阅更新状态：启动静默检查发现新版本时顶栏冒轻提示（设置页另有自己的订阅驱动面板）
let offUpdateStatus: (() => void) | null = null
onMounted(() => {
  offUpdateStatus = window.api.onUpdateStatus((s) => {
    if (s.status === 'available') app.updateVersion = s.version || ''
    else if (s.status === 'none' || s.status === 'error') app.updateVersion = ''
    // downloading / downloaded 保持提示，直到安装完成（quitAndInstall 会重启，重启后自然消失）
  })
})
onUnmounted(() => offUpdateStatus?.())
</script>

<template>
  <FloatingOrbs />
  <GlowCursor />
  <CursorParticles />
  <InkPromptHost />

  <div class="relative z-10 flex flex-col h-full">
    <!-- 全局顶部栏 -->
    <AppHeader />

    <div class="flex-1 min-h-0 flex">
      <!-- 分组可折叠侧栏 -->
      <AppNav />

      <!-- 主区域 -->
      <main class="flex-1 min-w-0 relative">
        <!-- 页面切换过渡：单根容器承载过渡（Transition 要求单根，书架/写作台等视图带 Teleport 是多根）；
             :key 让切换可被感知；fx-fade 关闭时用无动画名（无对应类 = 直切）。
             视图缓存现状见文件上方「视图缓存现状（备忘）」。 -->
        <Transition :name="app.appearance.pageFade !== false ? 'page-fade' : 'p'" mode="out-in">
          <KeepAlive>
            <div :key="app.view" class="h-full min-h-0">
              <component :is="VIEWS[app.view]" />
            </div>
          </KeepAlive>
        </Transition>
      </main>
    </div>
  </div>
</template>
