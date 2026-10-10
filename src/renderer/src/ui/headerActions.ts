import type { ViewName } from '../store/app'

export interface HeaderActionDef {
  /** 全局唯一的动作键（形如 bookshelf:new），页面按此键响应 */
  key: string
  label: string
  /** primary 为主操作（填充色），ghost 为次要操作（纯文字） */
  kind: 'primary' | 'ghost'
}

/**
 * 页面主操作统一登记在顶部栏里，避免每个页面各写一套右上角按钮。
 * 这里只放「文案」，真正的执行由各页面监听 inkdesk:header-action 事件处理，
 * 这样顶部栏与页面之间不依赖组件实例，也没有响应式时序问题。
 */
export const HEADER_ACTIONS: Partial<Record<ViewName, HeaderActionDef[]>> = {
  bookshelf: [
    { key: 'bookshelf:import', label: '导入 TXT/MD', kind: 'ghost' },
    { key: 'bookshelf:new', label: '新建作品', kind: 'primary' }
  ],
  writing: [{ key: 'writing:newChapter', label: '新建章节', kind: 'primary' }],
  assistant: [{ key: 'assistant:new', label: '新建会话', kind: 'primary' }],
  library: [
    { key: 'library:importSkill', label: '导入技能', kind: 'ghost' },
    { key: 'library:newEntry', label: '新建条目', kind: 'primary' }
  ],
  settings: [{ key: 'settings:save', label: '保存设置', kind: 'primary' }]
}

export function headerActionsFor(view: ViewName): HeaderActionDef[] {
  return HEADER_ACTIONS[view] || []
}

export function dispatchHeaderAction(key: string): void {
  window.dispatchEvent(new CustomEvent('inkdesk:header-action', { detail: { key } }))
}

/** 页面侧：订阅顶部栏动作。返回取消订阅函数 */
export function onHeaderAction(handler: (key: string) => void): () => void {
  const listener = (e: Event) => {
    const key = (e as CustomEvent<{ key?: string }>).detail?.key
    if (key) handler(key)
  }
  window.addEventListener('inkdesk:header-action', listener)
  return () => window.removeEventListener('inkdesk:header-action', listener)
}