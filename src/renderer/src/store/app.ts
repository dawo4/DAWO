import { defineStore } from 'pinia'
import type { AppConfig } from '../types'

export type ViewName = 'home' | 'bookshelf' | 'writing' | 'workflow' | 'deconstruct' | 'materials' | 'library' | 'agentlab' | 'assistant' | 'settings'

/** 写作台布局：右栏标签页 / DeepWrite 式中栏三栏 */
export type LayoutMode = 'tabs' | 'three-pane'

export const VIEW_TITLES: Record<ViewName, string> = {
  home: '首页',
  bookshelf: '书架',
  writing: '写作台',
  workflow: '工作流',
  deconstruct: '拆书',
  materials: '资料',
  library: '资源库',
  agentlab: '智能体库',
  assistant: '妙笔',
  settings: '设置'
}

const GROUP_STATE_KEY = 'inkdesk.navGroups'

/** 背景图 data URL 缓存（键为图片路径；选图时主进程生成唯一文件名，换图不会命中旧缓存） */
const bgDataCache = new Map<string, string>()

/** 本地背景图 → data URL（dev 模式页面是 http 源，file:// 图片会被 Chromium 安全策略拦截） */
export async function bgDataUrl(p: string): Promise<string> {
  const hit = bgDataCache.get(p)
  if (hit) return hit
  const u = String(await window.api.bgDataUrl(p) || '')
  if (u) bgDataCache.set(p, u)
  return u
}

function readGroupState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(GROUP_STATE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

interface State {
  view: ViewName
  config: AppConfig | null
  focusMode: boolean
  layoutMode: LayoutMode
  navOpen: boolean
  history: ViewName[]
  historyIndex: number
  /** 顶部栏展示的保存状态 */
  saveBusy: boolean
  saveText: string
  /** 由顶部栏全局搜索发起的「打开某文件」请求 */
  openFileRequest: { path: string; nonce: number } | null
  /** 由顶部栏全局搜索发起的「打开资源库某条目」请求 */
  openLibRequest: { kind: string; group: string; name: string; nonce: number } | null
  /** 侧栏分组展开状态（持久化到 localStorage） */
  navGroups: Record<string, boolean>
  /** 侧栏指定要打开的「资料」板块与「资源库」标签 */
  materialsTab: string | null
  /** 资料区「角色」板块的子视图（资料 / 关系图）：goMaterials('关系图') 时指定 */
  charSubView: string
  libraryTab: string | null
  /** 写作台右栏当前标签（智能体 / 去 AI 味 / 资料速览），供其他页面跳转时指定 */
  writingRightTab: string
  /** 设置页当前分组（记忆库等快捷入口可直达指定分组） */
  settingsTab: string
  /** 由首页发起的「书架页动作」请求（new = 打开新建作品表单，import = 导入文件） */
  bookshelfRequest: { action: 'new' | 'import'; nonce: number } | null
  /** 首页「添加面板」快捷入口：切到资料区后自动弹新建面板向导 */
  materialsAddOpen: boolean
}

export const useAppStore = defineStore('app', {
  state: (): State => ({
    view: 'home',
    config: null,
    focusMode: false,
    layoutMode: 'tabs',
    navOpen: true,
    history: ['home'],
    historyIndex: 0,
    saveBusy: false,
    saveText: '',
    openFileRequest: null,
    openLibRequest: null,
    navGroups: readGroupState(),
    materialsTab: null,
    charSubView: '',
    libraryTab: null,
    writingRightTab: 'ai',
    settingsTab: 'ai',
    bookshelfRequest: null,
    materialsAddOpen: false
  }),
  getters: {
    appearance: (s) =>
      s.config?.appearance || {
        theme: 'dark' as const,
        accent: '#c9a15f',
        backgroundImage: '',
        bgOpacity: 0.08,
        glow: true,
        orbs: true,
        particles: false,
        press: true,
        pageFade: true,
        cardRise: true
      },
    viewTitle: (s) => VIEW_TITLES[s.view],
    canBack: (s) => s.historyIndex > 0,
    canForward: (s) => s.historyIndex < s.history.length - 1
  },
  actions: {
    async loadConfig() {
      this.config = (await window.api.configGet()) as unknown as AppConfig
      this.applyAppearance()
    },
    async updateConfig(patch: Record<string, unknown>) {
      // IPC 走结构化克隆，响应式代理无法传递，先降级为普通对象
      const plain = JSON.parse(JSON.stringify(patch)) as Record<string, unknown>
      this.config = (await window.api.configUpdate(plain)) as unknown as AppConfig
      this.applyAppearance()
    },
    async applyAppearance() {
      const a = this.appearance
      document.documentElement.dataset.theme = a.theme
      document.documentElement.style.setProperty('--accent', a.accent)
      // 圆角档位与界面字号缩放
      const radiusMap: Record<string, string> = { sm: '6px', md: '10px', lg: '14px' }
      document.documentElement.style.setProperty('--radius', radiusMap[a.radius || 'md'] || '10px')
      document.documentElement.style.fontSize = `${Math.round(16 * (a.fontScale || 1))}px`
      // 动效开关映射为 body 类，样式层据此启用/停用对应动效
      document.body.classList.toggle('fx-press', a.press !== false)
      document.body.classList.toggle('fx-rise', a.cardRise !== false)
      document.body.classList.toggle('fx-fade', a.pageFade !== false)
      if (a.backgroundImage) {
        const u = await bgDataUrl(a.backgroundImage)
        if (!u) {
          document.body.style.backgroundImage = ''
          return
        }
        // 浓度 = 图片可见度：用主题底色遮罩压住图片，浓度越高遮罩越透（遮罩色随主题走）
        const rgb = getComputedStyle(document.documentElement).getPropertyValue('--overlay-rgb').trim() || '20, 17, 13'
        const alpha = Math.min(Math.max(1 - a.bgOpacity, 0), 1)
        document.body.style.backgroundImage = `linear-gradient(rgba(${rgb}, ${alpha}), rgba(${rgb}, ${alpha})), url("${u}")`
        document.body.style.backgroundSize = 'cover'
        document.body.style.backgroundPosition = 'center'
        document.body.style.backgroundAttachment = 'fixed'
      } else {
        document.body.style.backgroundImage = ''
      }
    },
    go(view: ViewName) {
      if (view === this.view) return
      this.view = view
      this.history = this.history.slice(0, this.historyIndex + 1)
      this.history.push(view)
      this.historyIndex = this.history.length - 1
      this.saveText = ''
    },
    back() {
      if (!this.canBack) return
      this.historyIndex--
      this.view = this.history[this.historyIndex]
    },
    forward() {
      if (!this.canForward) return
      this.historyIndex++
      this.view = this.history[this.historyIndex]
    },
    toggleNav() {
      this.navOpen = !this.navOpen
    },
    toggleLayout() {
      this.layoutMode = this.layoutMode === 'tabs' ? 'three-pane' : 'tabs'
    },
    setSaveState(busy: boolean, text: string) {
      this.saveBusy = busy
      this.saveText = text
    },
    /** 搜索命中文件后：切到写作台并请求打开该文件 */
    requestOpenFile(path: string) {
      this.openFileRequest = { path, nonce: Date.now() }
      this.go('writing')
    },
    /** 搜索命中技能/素材条目后：切到资源库并打开该条目 */
    requestOpenLibraryEntry(kind: string, group: string, name: string) {
      this.openLibRequest = { kind, group, name, nonce: Date.now() }
      this.go('library')
    },
    /** 首页等页面请求书架页执行动作（打开新建表单 / 导入文件） */
    requestBookshelf(action: 'new' | 'import') {
      this.bookshelfRequest = { action, nonce: Date.now() }
      this.go('bookshelf')
    },

    // ============ 侧栏分组 ============
    isGroupOpen(key: string, fallback = true): boolean {
      const v = this.navGroups[key]
      return v === undefined ? fallback : v
    },
    toggleGroup(key: string, fallback = true) {
      this.navGroups = { ...this.navGroups, [key]: !this.isGroupOpen(key, fallback) }
      try {
        localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(this.navGroups))
      } catch {
        /* 存储不可用时忽略 */
      }
    },

    /** 侧栏 → 资料区某个板块（「关系图」是角色板块的子视图，没有独立板块） */
    goMaterials(tab: string) {
      if (tab === '关系图') {
        this.materialsTab = '角色'
        this.charSubView = '关系图'
      } else {
        this.materialsTab = tab
        this.charSubView = ''
      }
      this.go('materials')
    },
    /** 侧栏 → 资源库某个标签 */
    goLibrary(tab: string) {
      this.libraryTab = tab
      this.go('library')
    },

    /** 从其他页面把一项任务交给智能体：切到妙笔页（AI 工作台） */
    goAskAgent() {
      this.go('assistant')
    }
  }
})