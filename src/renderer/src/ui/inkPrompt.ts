import { reactive } from 'vue'

/** Electron 渲染层不支持 window.prompt，用全局弹窗代替 */
interface PromptState {
  open: boolean
  title: string
  value: string
  resolve: ((v: string | null) => void) | null
}

export const promptState = reactive<PromptState>({
  open: false,
  title: '',
  value: '',
  resolve: null
})

export function inkPrompt(title: string, defaultValue = ''): Promise<string | null> {
  return new Promise((resolve) => {
    promptState.open = true
    promptState.title = title
    promptState.value = defaultValue
    promptState.resolve = resolve
  })
}

export function settle(result: string | null) {
  promptState.open = false
  promptState.resolve?.(result)
  promptState.resolve = null
}

// ============ 确认弹窗（无输入框，双按钮） ============
// window.confirm 会被 Electron 渲染成系统原生浅色模态，无法用 CSS 统一风格，故自绘。

export interface ConfirmOpts {
  /** 标题下方的弱化说明文字 */
  detail?: string
  /** 确定按钮文案，默认「确定」 */
  confirmText?: string
  /** 取消按钮文案，默认「取消」；传空串表示单按钮（纯提示语义） */
  cancelText?: string
  /** 危险操作：确定按钮用警示色 */
  danger?: boolean
}

interface ConfirmState {
  open: boolean
  title: string
  opts: ConfirmOpts
  resolve: ((v: boolean) => void) | null
}

export const confirmState = reactive<ConfirmState>({
  open: false,
  title: '',
  opts: {},
  resolve: null
})

export function inkConfirm(title: string, opts: ConfirmOpts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.open = true
    confirmState.title = title
    confirmState.opts = opts
    confirmState.resolve = resolve
  })
}

export function settleConfirm(result: boolean) {
  confirmState.open = false
  confirmState.resolve?.(result)
  confirmState.resolve = null
}