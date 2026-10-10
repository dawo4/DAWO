import { existsSync, mkdirSync, readdirSync, rmSync, statSync, cpSync } from 'fs'
import { join, basename, normalize, sep } from 'path'
import { getLibraryRoot } from './library'

/**
 * 保存与备份：把整本书（含 .inkdesk 会话与历史）复制到备份目录。
 * 备份目录默认在书架旁的「墨案备份」，可在设置中修改；支持手动备份与退出时自动备份。
 */

export interface BackupItem {
  book: string
  dir: string
  at: string
  sizeBytes: number
}

function defaultBackupDir(): string {
  return join(getLibraryRoot(), '..', 'DAWO 备份')
}

export function backupDir(configured?: string): string {
  const dir = configured && configured.trim() ? configured : defaultBackupDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

function safeBook(book: string): string {
  const src = normalize(join(getLibraryRoot(), book))
  const base = normalize(getLibraryRoot())
  if (!src.startsWith(base + sep)) throw new Error('非法作品名')
  if (!existsSync(src)) throw new Error('作品不存在')
  return src
}

function dirSize(p: string): number {
  let total = 0
  for (const name of readdirSync(p)) {
    const full = join(p, name)
    if (statSync(full).isDirectory()) total += dirSize(full)
    else total += statSync(full).size
  }
  return total
}

export function createBackup(book: string, configuredDir?: string): BackupItem {
  const src = safeBook(book)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = join(backupDir(configuredDir), `${book} · ${stamp}`)
  cpSync(src, dest, { recursive: true })
  return { book, dir: dest, at: new Date().toISOString(), sizeBytes: dirSize(dest) }
}

export function listBackups(configuredDir?: string): BackupItem[] {
  const root = backupDir(configuredDir)
  const out: BackupItem[] = []
  for (const name of readdirSync(root)) {
    const full = join(root, name)
    try {
      if (!statSync(full).isDirectory()) continue
      // 目录名格式：`书名 · 时间戳`
      const idx = name.lastIndexOf(' · ')
      if (idx < 0) continue
      out.push({
        book: name.slice(0, idx),
        dir: full,
        // 文件名里的时间戳已被转义，用目录修改时间即可
        at: statSync(full).mtime.toISOString(),
        sizeBytes: dirSize(full)
      })
    } catch {
      /* 跳过损坏项 */
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1))
}

export function deleteBackup(dir: string, configuredDir?: string): void {
  const root = normalize(backupDir(configuredDir))
  const full = normalize(dir)
  if (!full.startsWith(root + sep)) throw new Error('非法备份路径')
  rmSync(full, { recursive: true, force: true })
}

/** 恢复：把备份覆盖回书架（会先给当前版本做一个「恢复前快照」） */
export function restoreBackup(dir: string, configuredDir?: string): string {
  const root = normalize(backupDir(configuredDir))
  const full = normalize(dir)
  if (!full.startsWith(root + sep)) throw new Error('非法备份路径')
  const name = basename(full)
  const idx = name.lastIndexOf(' · ')
  const book = idx > 0 ? name.slice(0, idx) : name
  const dest = normalize(join(getLibraryRoot(), book))
  if (!dest.startsWith(normalize(getLibraryRoot()) + sep)) throw new Error('非法作品名')
  if (existsSync(dest)) {
    const snapshot = join(backupDir(configuredDir), `${book} · 恢复前快照-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`)
    cpSync(dest, snapshot, { recursive: true })
    rmSync(dest, { recursive: true, force: true })
    // Windows 下目录被占用时 rm 可能静默部分失败：残留目录会让恢复变成新旧混合，必须报错
    if (existsSync(dest)) throw new Error(`「${book}」目录删除失败（可能正被其他程序占用），已保留恢复前快照，请关闭占用后重试`)
  }
  cpSync(full, dest, { recursive: true })
  return book
}

export function openBackupDir(configuredDir?: string): string {
  return backupDir(configuredDir)
}