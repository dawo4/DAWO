/**
 * 全局 UI 增强（App.vue 挂载一次）：
 * 1. 暗色悬浮提示——替换原生 title 的白底黑字系统框：hover 带 title 的元素 350ms 后
 *    显示自绘提示；原 title 暂存到 data-ink-tip，移开时还原，元素离开 DOM 也安全。
 * 2. 滑条填充——监听所有 input[type=range]，把当前值写成 --fill 百分比，
 *    CSS 据此把轨道左侧染成强调色（纯 CSS 无法按值填充）。
 */

let tipEl: HTMLDivElement | null = null
let curEl: Element | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null

function ensureTipEl(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement('div')
    tipEl.id = 'ink-tip'
    tipEl.style.cssText = [
      'position: fixed',
      'z-index: 95',
      'max-width: 340px',
      'padding: 6px 10px',
      'border-radius: 8px',
      'border: 1px solid var(--border)',
      'background: var(--panel-2)',
      'color: var(--text)',
      'font-size: 11.5px',
      'line-height: 1.6',
      'white-space: pre-wrap',
      'box-shadow: var(--shadow)',
      'pointer-events: none',
      'opacity: 0',
      'transition: opacity 0.15s, transform 0.15s',
      'transform: translateY(2px)'
    ].join(';')
    document.body.appendChild(tipEl)
  }
  return tipEl
}

function placeTip(el: Element) {
  const tip = ensureTipEl()
  const r = el.getBoundingClientRect()
  tip.style.left = '0px'
  tip.style.top = '0px'
  const w = tip.offsetWidth
  const h = tip.offsetHeight
  let left = r.left + r.width / 2 - w / 2
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
  let top = r.bottom + 6
  if (top + h > window.innerHeight - 8) top = r.top - h - 6 // 底部放不下就放上方
  tip.style.left = `${left}px`
  tip.style.top = `${Math.max(8, top)}px`
}

function showTip(el: Element) {
  const tip = ensureTipEl()
  tip.textContent = el.getAttribute('data-ink-tip') || ''
  placeTip(el)
  tip.style.opacity = '1'
  tip.style.transform = 'translateY(0)'
}

function hideTip() {
  if (tipEl) {
    tipEl.style.opacity = '0'
    tipEl.style.transform = 'translateY(2px)'
  }
}

function onMouseOver(e: MouseEvent) {
  const t = e.target as Element
  const el = t && 'closest' in t ? (t.closest('[title]') as Element | null) : null
  if (el === curEl) return
  // 换目标：先还原上一个的 title
  hideTip()
  if (curEl) {
    const back = curEl.getAttribute('data-ink-tip')
    if (back !== null) {
      curEl.setAttribute('title', back)
      curEl.removeAttribute('data-ink-tip')
    }
  }
  curEl = null
  if (showTimer) clearTimeout(showTimer)
  if (!el) return
  curEl = el
  const title = el.getAttribute('title')
  if (title === null || !title.trim()) return
  el.setAttribute('data-ink-tip', title)
  el.removeAttribute('title')
  showTimer = setTimeout(() => {
    if (curEl === el) showTip(el)
  }, 350)
}

function onUnhover() {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  hideTip()
  if (curEl) {
    const back = curEl.getAttribute('data-ink-tip')
    if (back !== null) {
      curEl.setAttribute('title', back)
      curEl.removeAttribute('data-ink-tip')
    }
    curEl = null
  }
}

function updateRangeFill(el: HTMLInputElement) {
  const min = Number(el.min) || 0
  const max = Number(el.max) || 100
  const val = Number(el.value)
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0
  el.style.setProperty('--fill', `${pct}%`)
}

function onInput(e: Event) {
  const t = e.target as HTMLInputElement
  if (t.tagName === 'INPUT' && t.type === 'range') updateRangeFill(t)
}

export function setupInkUi(): void {
  // 悬浮提示委托
  document.addEventListener('mouseover', onMouseOver, true)
  document.addEventListener('mouseout', onUnhover, true)
  window.addEventListener('blur', onUnhover)
  // 滑条填充
  document.addEventListener('input', onInput, true)
  // 初始扫一遍已有滑条（视图可能挂载在前）
  const scan = () => document.querySelectorAll('input[type=range]').forEach((r) => updateRangeFill(r as HTMLInputElement))
  scan()
  // KeepAlive 视图切换后会冒出新的滑条， MutationObserver 兜底
  const mo = new MutationObserver(() => scan())
  window.addEventListener('load', scan)
  try {
    mo.observe(document.body, { childList: true, subtree: true })
  } catch {
    /* 观察失败不影响功能，仅填充色可能滞后 */
  }
}