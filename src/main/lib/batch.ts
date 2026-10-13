// 批量修订管道：多章套用同一条修订指令，逐章调「润色」模型出全文改写，
// 每章生成一个标准 EditProposal（复用智能体提案存储与审阅 IPC），由作者逐个接受/拒绝。
import type { BrowserWindow } from 'electron'
import { readTextFile } from './library'
import { createManualProposal } from '../agent'
import { llmComplete } from './customAgents'

export interface BatchChapter {
  path: string
  title: string
}

export interface BatchParams {
  runId: string
  book: string
  chapters: BatchChapter[]
  instruction: string
}

const runs = new Map<string, { aborted: boolean }>()

export function batchAbort(runId: string): void {
  const r = runs.get(runId)
  if (r) r.aborted = true
}

function send(win: BrowserWindow, runId: string, type: string, payload?: unknown): void {
  if (!win.isDestroyed()) win.webContents.send('agent:event', { runId, type, payload })
}

/** 剥掉 ``` 围栏与前后空话，取正文 */
function cleanOutput(text: string): string {
  let t = text.trim()
  const fenced = /```(?:markdown|md|text)?\s*\n([\s\S]*?)```/.exec(t)
  if (fenced && fenced[1].trim().length > t.replace(/```[\s\S]*?```/g, '').trim().length / 2) t = fenced[1].trim()
  // 去掉模型常见的开场白（第一行如果是「以下是/好的/修订后」这类引导句且下一行还有内容，删掉）
  const firstLineBreak = t.indexOf('\n')
  if (firstLineBreak > 0) {
    const head = t.slice(0, firstLineBreak).trim()
    if (/^(好的|以下是|这是|修订后|修改后|当然)/.test(head) && head.length < 40) t = t.slice(firstLineBreak + 1).trim()
  }
  return t
}

const SYSTEM = `你是资深网文修订编辑。作者会给你一章正文和一条修订指令，你的任务是按指令忠实改写这一章。

硬性要求：
1. 只做指令要求的修订，指令之外的内容一律保持原样（措辞、情节、人设都不要动）。
2. 保持章节字数量级不变（除非指令明确要求增删篇幅）。
3. 保持原文的段落划分、章节结构；不要添加标题、序号、作者注或任何解释。
4. 直接输出修订后的全文，从第一个字到最后一个字，不要输出任何说明、前言或结语。`

export async function startBatchRevise(win: BrowserWindow, params: BatchParams): Promise<void> {
  const { runId, book, chapters, instruction } = params
  if (!instruction.trim()) {
    send(win, runId, 'batch-error', { error: '修订指令不能为空' })
    return
  }
  if (!chapters.length) {
    send(win, runId, 'batch-error', { error: '请先选择要修订的章节' })
    return
  }
  runs.set(runId, { aborted: false })
  send(win, runId, 'batch-start', { total: chapters.length })

  let done = 0
  let failed = 0
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    if (runs.get(runId)?.aborted) {
      send(win, runId, 'batch-done', { done, failed, aborted: true, total: chapters.length })
      runs.delete(runId)
      return
    }
    send(win, runId, 'chapter-start', { index: i, path: ch.path, title: ch.title })
    try {
      const base = readTextFile(book, ch.path)
      if (!base.trim()) throw new Error('章节内容为空')
      const user = `【修订指令】\n${instruction.trim()}\n\n【原文（${ch.title}）】\n${base}`
      // 封面 tokens 估算放兜底；任务模型走「润色 / 扩写 / 纠错」
      const out = await llmComplete(SYSTEM, user, 'batch-revise', `批量修订 · ${ch.title}`, 'polish')
      const revised = cleanOutput(out)
      if (!revised.trim()) throw new Error('模型返回了空内容')
      if (Math.abs(revised.length - base.length) > base.length * 0.7) {
        throw new Error(`改写结果与原文篇幅差异过大（${base.length} → ${revised.length} 字），疑似模型未按指令执行，已拦截不生成提案`)
      }
      const proposal = createManualProposal(win, runId, book, ch.path, base, revised, `批量修订：${instruction.trim().slice(0, 60)}`)
      done++
      send(win, runId, 'chapter-proposal', { index: i, path: ch.path, title: ch.title, proposal })
    } catch (e) {
      failed++
      send(win, runId, 'chapter-error', { index: i, path: ch.path, title: ch.title, error: (e as Error).message })
    }
  }
  send(win, runId, 'batch-done', { done, failed, aborted: false, total: chapters.length })
  runs.delete(runId)
}
