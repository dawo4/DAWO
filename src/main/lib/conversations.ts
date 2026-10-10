import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { getLibraryRoot } from './library'

/** 智能体会话持久化：存于作品目录 .inkdesk/conversations/ 下（不随书架列表展示） */

export interface ConversationSummary {
  id: string
  title: string
  agentId: string
  updatedAt: string
  messageCount: number
}

export interface StoredConversation {
  id: string
  title: string
  agentId: string
  approvalMode: 'manual' | 'auto-approve'
  createdAt: string
  updatedAt: string
  messages: unknown[]
  proposals: unknown[]
  /** 早期对话的压缩摘要 */
  contextSummary?: string
}

function dirFor(book: string): string {
  const dir = join(getLibraryRoot(), book, '.inkdesk', 'conversations')
  mkdirSync(dir, { recursive: true })
  return dir
}

function fileFor(book: string, id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('非法会话 ID')
  return join(dirFor(book), `${id}.json`)
}

export function listConversations(book: string): ConversationSummary[] {
  const dir = dirFor(book)
  const out: ConversationSummary[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const c = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as StoredConversation
      out.push({
        id: c.id,
        title: c.title || '未命名会话',
        agentId: c.agentId || 'general',
        updatedAt: c.updatedAt || statSync(join(dir, f)).mtime.toISOString(),
        messageCount: Array.isArray(c.messages) ? c.messages.length : 0
      })
    } catch {
      /* 跳过损坏会话 */
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function loadConversation(book: string, id: string): StoredConversation | null {
  const p = fileFor(book, id)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as StoredConversation
  } catch {
    return null
  }
}

export function saveConversation(book: string, conv: StoredConversation): void {
  const p = fileFor(book, conv.id)
  const out: StoredConversation = { ...conv, updatedAt: new Date().toISOString() }
  writeFileSync(p, JSON.stringify(out, null, 2), 'utf-8')
}

export function deleteConversation(book: string, id: string): void {
  const p = fileFor(book, id)
  if (existsSync(p)) rmSync(p)
}

interface ExportMessage {
  role: string
  content: string
  thinking?: string
  toolCalls?: { name: string; ok: boolean; result: string }[]
  proposals?: { target: string; summary: string; status: string; additions: number; deletions: number }[]
  createdAt?: string
}

export function exportConversationMarkdown(book: string, id: string): string {
  const c = loadConversation(book, id)
  if (!c) throw new Error('会话不存在')
  const lines: string[] = [`# ${c.title || '会话记录'}`, '', `- 作品：${book}`, `- 智能体：${c.agentId}`, `- 更新时间：${c.updatedAt}`, '']
  const msgs = (c.messages || []) as ExportMessage[]
  for (const m of msgs) {
    if (m.role === 'user') lines.push('## 作者', '', m.content, '')
    else if (m.role === 'assistant') {
      lines.push('## 智能体', '')
      if (m.thinking) lines.push('<details><summary>思考过程</summary>', '', m.thinking, '', '</details>', '')
      for (const t of m.toolCalls || []) lines.push(`> 工具 \`${t.name}\` ${t.ok ? '成功' : '失败'}`, '')
      lines.push(m.content, '')
      for (const p of m.proposals || []) {
        lines.push(`> 修改提案：\`${p.target}\` — ${p.summary}（+${p.additions} −${p.deletions}，状态：${p.status}）`, '')
      }
    }
  }
  return lines.join('\n')
}