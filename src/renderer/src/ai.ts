/** AI 网关渲染层客户端：流式订阅 + 中断 */
let seq = 0
type ChunkCb = (text: string) => void

let subscribed = false
const listeners = new Map<string, { onChunk?: ChunkCb; onAborted?: () => void; onReason?: () => void; resolve?: (s: string) => void; reject?: (e: Error) => void }>()

function ensureSubscribe() {
  if (subscribed) return
  subscribed = true
  window.api.aiOnEvent((evt) => {
    const l = listeners.get(evt.runId)
    if (!l) return
    if (evt.type === 'chunk') l.onChunk?.(evt.payload as string)
    else if (evt.type === 'reason') l.onReason?.()
    else if (evt.type === 'done') {
      listeners.delete(evt.runId)
      l.resolve?.((evt.payload as string) || '')
    } else if (evt.type === 'error') {
      listeners.delete(evt.runId)
      l.reject?.(new Error((evt.payload as string) || 'AI 请求失败'))
    } else if (evt.type === 'aborted') {
      listeners.delete(evt.runId)
      l.onAborted?.()
      l.resolve?.('')
    }
  })
}

export function aiRun(
  task: string,
  promptId: string,
  vars: Record<string, string>,
  opts?: { onChunk?: ChunkCb; onAborted?: () => void; onReason?: () => void; deaiLevel?: string }
): { promise: Promise<string>; abort: () => void } {
  ensureSubscribe()
  const runId = `run-${++seq}-${Date.now()}`
  const l = listeners.set(runId, { onChunk: opts?.onChunk, onAborted: opts?.onAborted, onReason: opts?.onReason })!.get(runId)!
  const promise = new Promise<string>((resolve, reject) => {
    l.resolve = resolve
    l.reject = reject
  })
  void window.api.aiRun({ runId, task, promptId, vars, deaiLevel: opts?.deaiLevel })
  return { promise, abort: () => void window.api.aiAbort(runId) }
}
