<script setup lang="ts">
import { onMounted } from 'vue'
import { useAppStore } from './store/app'
import { useLibraryStore } from './store/library'
import GlowCursor from './ui/GlowCursor.vue'
import FloatingOrbs from './ui/FloatingOrbs.vue'
import CursorParticles from './ui/CursorParticles.vue'
import InkPromptHost from './ui/InkPromptHost.vue'
import AppHeader from './ui/AppHeader.vue'
import AppNav from './ui/AppNav.vue'
import HomeView from './views/HomeView.vue'
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

onMounted(async () => {
  setupInkUi()
  await app.loadConfig()
  await lib.loadBooks()
  if (app.config?.activeBook) {
    const b = lib.books.find((x) => x.title === app.config!.activeBook)
    if (b) await lib.openBook(b.title)
  }
})
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
             :key 让切换可被感知；fx-fade 关闭时用无动画名（无对应类 = 直切） -->
        <Transition :name="app.appearance.pageFade !== false ? 'page-fade' : 'p'" mode="out-in">
          <KeepAlive>
            <div :key="app.view" class="h-full min-h-0">
              <component :is="{ home: HomeView, bookshelf: BookshelfView, writing: WritingView, workflow: WorkflowView, deconstruct: DeconstructView, materials: MaterialsView, library: LibraryView, agentlab: AgentLabView, assistant: AssistantView, settings: SettingsView }[app.view]" />
            </div>
          </KeepAlive>
        </Transition>
      </main>
    </div>
  </div>
</template>
