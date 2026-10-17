<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useAppStore, type ViewName } from '../store/app'
import { useLibraryStore } from '../store/library'
import { useLibrariesStore } from '../store/libraries'
import { usePanelDrag } from './usePanelDrag'
import dawoLogo from '../assets/dawo-logo.png'
import type { LibKind } from '../types'
import {
  BookOpen,
  BookMarked,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  FileSearch,
  FolderTree,
  House,
  Layers,
  LayoutGrid,
  Lightbulb,
  Network,
  PenLine,
  Settings,
  Sparkles,
  UserRound,
  Users,
  Workflow,
  GitBranch,
  BarChart3,
  Footprints,
  ListChecks,
  Map
} from 'lucide-vue-next'

const app = useAppStore()
const lib = useLibraryStore()
const libs = useLibrariesStore()

/** 本书自定义面板（阶段二）：左栏「自定义面板」折叠组动态列出 */
const customPanels = ref<string[]>([])

async function refreshCustomPanels() {
  if (!lib.current) {
    customPanels.value = []
    return
  }
  try {
    const list = (await window.api.panelsList(lib.current.title)) as { name: string; board?: string; hidden?: boolean }[]
    customPanels.value = list.filter((p) => !p.board && !p.hidden).map((p) => p.name)
  } catch {
    customPanels.value = []
  }
}

watch(() => lib.current?.title, () => void refreshCustomPanels(), { immediate: true })
// 资料区新建/删除面板后广播事件，常驻左栏实时同步
function onPanelsChanged() {
  void refreshCustomPanels()
}
onMounted(() => {
  void refreshCustomPanels()
  window.addEventListener('inkdesk:panels-changed', onPanelsChanged)
})

/** 侧栏可拖拽调宽（范围限制，防止挤没主区域） */
const navDrag = usePanelDrag('nav', 228, 180, 360)

/** 资料板块（与 MaterialsView 的 SECTIONS 对应），按组折叠：只资料分组可收起 */
const MAT_GROUPS: { key: string; label: string; tabs: { key: string; label: string; icon: unknown }[] }[] = [
  {
    key: 'mat-text',
    label: '文本',
    tabs: [
      { key: '大纲', label: '大纲', icon: FolderTree },
      { key: '角色', label: '角色', icon: Users },
      { key: '设定', label: '设定', icon: Layers }
    ]
  },
  {
    key: 'mat-struct',
    label: '结构',
    tabs: [
      { key: '时间线', label: '时间线', icon: Clock },
      { key: '故事线', label: '故事线', icon: Network },
      { key: '细纲', label: '细纲', icon: ListChecks }
    ]
  },
  {
    key: 'mat-world',
    label: '设定工具',
    tabs: [
      { key: '词典', label: '词典', icon: BookMarked },
      { key: '伏笔', label: '伏笔', icon: GitBranch },
      { key: '境界', label: '境界', icon: BarChart3 },
      { key: '出场', label: '出场', icon: Footprints },
      { key: '地图', label: '地图', icon: Map }
    ]
  }
]

/** 自定义面板折叠组：有自定义面板时追加在「设定工具」之后 */
const matGroups = computed(() => {
  if (!customPanels.value.length) return MAT_GROUPS
  return [
    ...MAT_GROUPS,
    {
      key: 'mat-custom',
      label: '自定义面板',
      tabs: customPanels.value.map((name) => ({ key: name, label: name, icon: LayoutGrid as unknown }))
    }
  ]
})

/** 创作类页面 */
const PAGES: { key: string; label: string; icon: unknown; view: ViewName }[] = [
  { key: 'bookshelf', label: '书架', icon: BookOpen, view: 'bookshelf' },
  { key: 'writing', label: '写作台', icon: PenLine, view: 'writing' },
  { key: 'workflow', label: '工作流', icon: Workflow, view: 'workflow' },
  { key: 'deconstruct', label: '拆书', icon: FileSearch, view: 'deconstruct' },
  { key: 'agentlab', label: '智能体库', icon: Bot, view: 'agentlab' },
  { key: 'stats', label: '数据', icon: BarChart3, view: 'stats' }
]

/** 资源库三个库 */
const LIB_TABS: { k: LibKind; l: string; icon: unknown }[] = [
  { k: 'skills', l: '技能库', icon: Sparkles },
  { k: 'materials', l: '素材库', icon: BookOpen },
  { k: 'notes', l: '灵感便签', icon: Lightbulb }
]

const libTreeKind = ref<LibKind>('skills')
// 条目树是数据列表（可能很长），默认收起，避免把功能入口挤出可视区
const libTreeOpen = ref(false)

const libTreeGroups = computed(() =>
  libTreeKind.value === 'skills'
    ? libs.groups('skills')
    : libTreeKind.value === 'notes'
      ? libs.groups('notes')
      : libs.groups('materials')
)

function bookTree(): { name: string; path: string; dir: boolean; depth: number }[] {
  const out: { name: string; path: string; dir: boolean; depth: number }[] = []
  const walk = (nodes: typeof lib.tree, depth: number): void => {
    for (const n of nodes) {
      out.push({ name: n.name, path: n.path, dir: n.dir, depth })
      if (n.dir) walk(n.children || [], depth + 1)
    }
  }
  walk(lib.tree, 0)
  return out
}

const bookNodes = computed(() => bookTree())

onMounted(() => void libs.refresh())
</script>

<template>
  <aside
    v-if="app.navOpen"
    class="app-chrome relative shrink-0 flex flex-col border-r border-[var(--border)] bg-[var(--bg-soft)]/70 backdrop-blur-[8px]"
    :class="{ 'focus-dim': app.focusMode }"
    :style="{ width: navDrag.width.value + 'px' }"
  >
    <!-- 右缘拖拽分割线：可左右拖动调宽（180–360px） -->
    <div class="panel-resizer right-0" :class="{ 'is-dragging': navDrag.dragging.value }" @mousedown="navDrag.onDown($event, 1)" />
    <!-- 品牌 -->
    <div class="px-3.5 pt-4 pb-3 flex items-center gap-2.5">
      <img :src="dawoLogo" alt="DAWO" class="w-10 h-10 rounded-[var(--r-md)] shrink-0" draggable="false" />
      <div>
        <div class="font-serif-ink text-title leading-6" style="color: var(--accent)">DAWO</div>
        <div class="text-micro text-[var(--text-faint)] tracking-[0.14em]">AI 小说工作台</div>
      </div>
    </div>

    <div class="px-2 pb-2 space-y-0.5">
      <!-- 首页：工作台总览 -->
      <button class="nav-item" :class="app.view === 'home' ? 'nav-item-on' : 'nav-item-off'" @click="app.go('home')">
        <House :size="15" class="shrink-0" />
        <span class="flex-1 text-left">首页</span>
      </button>

      <!-- 妙笔是高频入口，常驻顶部，不参与滚动 -->
      <button class="nav-item" :class="app.view === 'assistant' ? 'nav-item-on' : 'nav-item-off'" @click="app.go('assistant')">
        <UserRound :size="15" class="shrink-0" />
        <span class="flex-1 text-left">妙笔</span>
        <span class="text-micro text-[var(--text-faint)]">AI 助手</span>
      </button>
    </div>

    <nav class="flex-1 min-h-0 overflow-y-auto px-2 pb-4 text-[13px]">
      <!-- 创作（入口全部常显，分组仅作静态归类标题） -->
      <div class="nav-label">创作</div>
      <button
        v-for="p in PAGES"
        :key="p.key"
        class="nav-item"
        :class="app.view === p.view ? 'nav-item-on' : 'nav-item-off'"
        @click="app.go(p.view)"
      >
        <component :is="p.icon" :size="15" class="shrink-0" />
        <span class="flex-1 text-left">{{ p.label }}</span>
      </button>

      <!-- 当前作品文件树（长列表，可收起） -->
      <template v-if="lib.current">
        <button class="nav-item nav-item-off mt-0.5" @click="app.toggleGroup('bookTree', false)">
          <component :is="app.isGroupOpen('bookTree', false) ? ChevronDown : ChevronRight" :size="13" class="shrink-0" />
          <span class="flex-1 text-left truncate text-[12px]">{{ lib.current.title }}</span>
        </button>
        <div v-if="app.isGroupOpen('bookTree', false)" class="mt-0.5">
          <div
            v-for="n in bookNodes"
            :key="n.path"
            class="flex items-center gap-1 pr-2 py-[3px] rounded-[var(--r-sm)] text-label transition-colors"
            :class="n.dir ? 'text-[var(--text-faint)]' : 'text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)] cursor-pointer'"
            :style="{ paddingLeft: 14 + n.depth * 12 + 'px' }"
            @click="!n.dir && app.requestOpenFile(n.path)"
          >
            <span class="truncate">{{ n.name }}</span>
          </div>
        </div>
      </template>

      <!-- 资料：分组可折叠（其他分组不折叠） -->
      <template v-for="g in matGroups" :key="g.key">
        <div class="nav-item nav-item-off cursor-pointer mt-0.5" @click="app.toggleGroup(g.key)">
          <component :is="app.isGroupOpen(g.key) ? ChevronDown : ChevronRight" :size="13" class="shrink-0" />
          <span class="flex-1 text-left text-[12px]">{{ g.label }}</span>
        </div>
        <template v-if="app.isGroupOpen(g.key)">
          <button
            v-for="t in g.tabs"
            :key="t.key"
            class="nav-item"
            :class="app.view === 'materials' && app.materialsTab === t.key ? 'nav-item-on' : 'nav-item-off'"
            @click="app.goMaterials(t.key)"
          >
            <component :is="t.icon" :size="15" class="shrink-0" />
            <span class="flex-1 text-left">{{ t.label }}</span>
          </button>
        </template>
      </template>

      <!-- 资源库 -->
      <div class="nav-label">资源库</div>
      <button
        v-for="t in LIB_TABS"
        :key="t.k"
        class="nav-item"
        :class="app.view === 'library' && app.libraryTab === t.k ? 'nav-item-on' : 'nav-item-off'"
        @click="app.goLibrary(t.k)"
      >
        <component :is="t.icon" :size="15" class="shrink-0" />
        <span class="flex-1 text-left">{{ t.l }}</span>
      </button>

      <!-- 资源库条目树（长列表，可收起） -->
      <div class="mt-1 pl-4">
        <div class="flex items-center gap-1 mb-1">
          <button
            v-for="t in LIB_TABS"
            :key="t.k"
            class="text-meta px-1.5 py-0.5 rounded-[var(--r-xs)] cursor-pointer transition-colors"
            :class="libTreeKind === t.k ? 'bg-[var(--panel-2)]' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'"
            :style="libTreeKind === t.k ? { color: 'var(--accent)' } : {}"
            @click="libTreeKind = t.k"
          >
            {{ t.l.replace('库', '').replace('灵感', '') }}
          </button>
          <button class="ml-auto text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer" title="展开/收起条目" @click="libTreeOpen = !libTreeOpen">
            <component :is="libTreeOpen ? ChevronDown : ChevronRight" :size="12" />
          </button>
        </div>
        <div v-if="libTreeOpen" class="space-y-1.5">
          <div v-for="g in libTreeGroups" :key="g.name">
            <div class="text-[11px] text-[var(--text-faint)] pl-1 truncate">{{ g.name }}</div>
            <button
              v-for="e in g.entries"
              :key="e.name"
              class="w-full text-left pl-3 pr-1 py-[3px] rounded-[var(--r-sm)] text-label text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)] truncate cursor-pointer transition-colors"
              @click="app.requestOpenLibraryEntry(e.kind, e.group, e.name)"
            >
              {{ e.name }}
            </button>
          </div>
          <div v-if="!libTreeGroups.length" class="text-[11px] text-[var(--text-faint)] pl-1">暂无条目</div>
        </div>
      </div>
    </nav>

    <!-- 底部常驻：设置固定在这里，不随滚动消失 -->
    <div class="shrink-0 px-2 py-2 border-t border-[var(--border)] space-y-0.5">
      <button class="nav-item" :class="app.view === 'settings' ? 'nav-item-on' : 'nav-item-off'" @click="app.go('settings')">
        <Settings :size="15" class="shrink-0" />
        <span class="flex-1 text-left">设置</span>
      </button>
      <div class="px-3 pt-1 text-micro text-[var(--text-faint)] leading-relaxed">
        <template v-if="lib.current">当前作品 · <span class="text-[var(--text-dim)]">{{ lib.current.title }}</span></template>
        <template v-else>未打开作品</template>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* 导航归类小标题：纯静态，不可点击，也不折叠 */
.nav-label {
  font-size: var(--fs-micro);
  letter-spacing: 0.1em;
  color: var(--text-faint);
  padding: 10px 10px 4px;
}
.nav-label:first-child {
  padding-top: 2px;
}

/* 导航条目：30px 行高（图标 15px 由模板指定） */
.nav-item {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 30px;
  padding: 4px 8px 4px 12px;
  border-radius: var(--r-sm);
  cursor: pointer;
  font-size: var(--fs-label);
  transition: background-color var(--dur-2), color var(--dur-2);
}
/* 选中态：左缘 2px 强调色标记条 + 极淡强调底。
   用标记条而非整块底色表达选中，视觉更安静。 */
.nav-item-on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.nav-item-on::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 2px;
  height: 14px;
  margin-top: -7px;
  border-radius: 1px;
  background: var(--accent);
  animation: nav-mark-in var(--dur-2) var(--ease-out) both;
}
.nav-item-off {
  color: var(--text-dim);
}
.nav-item-off:hover {
  background: var(--hover);
  color: var(--text);
}
</style>