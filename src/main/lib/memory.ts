import { app, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getLibraryRoot } from './library'

// ============ 作者记忆（阶段三）条目式存储：全局（跨书）+ 书籍（单书） ============
// 记忆以「条目」为单位增删改（每条一句话），存 JSON 文件；UI 逐条卡片管理，智能体单条增改不碰其他条目。
// 旧版 Markdown 记忆文件（记忆.md）首次读取时自动迁移为条目并改名 .bak。

export interface MemoryEntry {
  id: string
  /** 一句话记忆 */
  text: string
  /** 分类（可选）：偏好 / 禁区 / 剧情 / 要求… */
  category: string
  createdAt: string
}

const GLOBAL_JSON = '记忆.json'
const GLOBAL_MD = '记忆.md'
const BOOK_REL_JSON = join('记忆', '记忆.json')
const BOOK_REL_MD = join('记忆', '记忆.md')

function uid(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function globalJsonPath(): string {
  return join(app.getPath('userData'), GLOBAL_JSON)
}
function globalMdPath(): string {
  return join(app.getPath('userData'), GLOBAL_MD)
}
function bookJsonPath(book: string): string {
  return join(getLibraryRoot(), book, BOOK_REL_JSON)
}
function bookMdPath(book: string): string {
  return join(getLibraryRoot(), book, BOOK_REL_MD)
}

/** 旧 Markdown 记忆迁移：非空非标题行逐行成条 */
function migrateMd(md: string): MemoryEntry[] | null {
  const lines = md
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('<!--') && !l.startsWith('-->'))
  if (!lines.length) return null
  return lines.map((l) => ({ id: uid(), text: l.replace(/^[-*]\s*/, '').slice(0, 500), category: '', createdAt: new Date().toISOString() }))
}

function readEntries(jsonPath: string, mdPath: string, ensureDir?: string): MemoryEntry[] {
  if (existsSync(jsonPath)) {
    try {
      const data = JSON.parse(readFileSync(jsonPath, 'utf-8'))
      return Array.isArray(data.entries) ? data.entries : []
    } catch {
      return []
    }
  }
  // 旧 md 迁移
  if (existsSync(mdPath)) {
    try {
      const md = readFileSync(mdPath, 'utf-8')
      const entries = migrateMd(md)
      if (entries) {
        if (ensureDir) mkdirSync(ensureDir, { recursive: true })
        writeFileSync(jsonPath, JSON.stringify({ entries }, null, 2), 'utf-8')
        renameSync(mdPath, `${mdPath}.bak`)
        return entries
      }
    } catch {
      /* 迁移失败按空处理 */
    }
  }
  return []
}

function writeEntries(jsonPath: string, entries: MemoryEntry[], ensureDir?: string): void {
  if (ensureDir) mkdirSync(ensureDir, { recursive: true })
  writeFileSync(jsonPath, JSON.stringify({ entries }, null, 2), 'utf-8')
}

export function readGlobalEntries(): MemoryEntry[] {
  return readEntries(globalJsonPath(), globalMdPath())
}

export function writeGlobalEntries(entries: MemoryEntry[]): void {
  writeEntries(globalJsonPath(), entries.slice(0, 500))
}

export function readBookEntries(book: string): MemoryEntry[] {
  // 边界防御：book 为空串时路径会落到书架根，宁可返回空也不读写错位置
  if (!book || !book.trim()) return []
  return readEntries(bookJsonPath(book), bookMdPath(book), join(getLibraryRoot(), book, '记忆'))
}

export function writeBookEntries(book: string, entries: MemoryEntry[]): void {
  if (!book || !book.trim()) return
  writeEntries(bookJsonPath(book), entries.slice(0, 500), join(getLibraryRoot(), book, '记忆'))
}

/** 在系统编辑器里打开记忆 JSON 文件 */
export function openMemory(scope: 'global' | 'book', book?: string): void {
  const p = scope === 'global' ? globalJsonPath() : book ? bookJsonPath(book) : ''
  if (!p || !existsSync(p)) return
  shell.openPath(p)
}
