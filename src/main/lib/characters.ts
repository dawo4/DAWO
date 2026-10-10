// 角色「一人一档」：旧版全部角色卡堆在 角色/角色设定.md 单文件里，AI 改一个角色要重写整文件（冲突/覆盖/大 diff）。
// 这里提供：旧文件自动拆分迁移（一人一档，原文件留 .bak）、整包文本拆分落盘、聚合读取。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getLibraryRoot, listBooks, readTextFile } from './library'

const CHAR_DIR = '角色'
const LEGACY_FILE = '角色/角色设定.md'

/** 文件名合法化：去路径非法字符与 markdown 强调符，cap 30 字 */
function sanitizeName(raw: string): string {
  return raw
    .replace(/[*_`~]/g, '')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)
}

export interface CharacterSection {
  name: string
  content: string
}

/** 把整包角色卡文本按 # 标题拆成一人一节；没有任何标题结构时返回空数组（调用方回退整文件写） */
export function splitCharacterText(text: string): CharacterSection[] {
  const lines = text.split(/\r?\n/)
  const sections: CharacterSection[] = []
  let cur: { name: string; lines: string[] } | null = null
  const headRe = /^#{1,4}\s*(.+?)\s*$/
  for (const line of lines) {
    const m = line.match(headRe)
    if (m) {
      if (cur) sections.push(cur)
      cur = { name: sanitizeName(m[1]), lines: [line] }
    } else if (cur) {
      cur.lines.push(line)
    }
  }
  if (cur) sections.push(cur)
  return sections
    .map((s) => ({ name: s.name, content: s.lines.join('\n').trim() + '\n' }))
    .filter((s) => s.name.length >= 1)
}

/** 目录内落盘：overwrite=true（工作流重生成，同名角色以新稿为准）直接覆盖；false（迁移）跳过已存在的用户文件 */
function writeSections(dir: string, sections: CharacterSection[], overwrite: boolean): number {
  let count = 0
  for (const s of sections) {
    const target = join(dir, `${s.name}.md`)
    if (!overwrite && existsSync(target)) continue
    writeFileSync(target, s.content, 'utf-8')
    count++
  }
  return count
}

/**
 * 拆分落盘：把整包角色卡文本写入 角色/ 目录（一人一档，同名覆盖）。
 * 拆不出标题结构时整包写 legacy 文件（角色/角色设定.md），返回 legacy=true。
 */
export function saveCharactersFromText(book: string, text: string): { count: number; legacy: boolean } {
  const root = join(getLibraryRoot(), book)
  const dir = join(root, CHAR_DIR)
  mkdirSync(dir, { recursive: true })
  const sections = splitCharacterText(text)
  if (!sections.length) {
    writeFileSync(join(root, LEGACY_FILE), text, 'utf-8')
    return { count: 1, legacy: true }
  }
  // 落档前清掉旧版整包文件：此后一人一档是唯一事实源，避免双源并存各改各的
  try {
    const legacy = join(root, LEGACY_FILE)
    if (existsSync(legacy)) renameSync(legacy, `${legacy}.${Date.now()}.bak`)
  } catch {
    /* 占用时保留，无碍 */
  }
  return { count: writeSections(dir, sections, true), legacy: false }
}

/**
 * 旧书迁移：角色/角色设定.md 存在且有内容 → 拆成一人一档（不覆盖已存在的单卡），原文件改名 .bak。
 * 幂等：拆不出结构（纯文本无标题）则保留原文件不动，下次启动不再尝试（返回 0）。
 */
export function splitLegacyCharacters(book: string): number {
  const root = join(getLibraryRoot(), book)
  const legacyPath = join(root, LEGACY_FILE)
  if (!existsSync(legacyPath)) return 0
  let text = ''
  try {
    text = readFileSync(legacyPath, 'utf-8')
  } catch {
    return 0
  }
  if (!text.trim()) return 0
  const sections = splitCharacterText(text)
  if (!sections.length) return 0
  const dir = join(root, CHAR_DIR)
  mkdirSync(dir, { recursive: true })
  const count = writeSections(dir, sections, false)
  try {
    renameSync(legacyPath, `${legacyPath}.${Date.now()}.bak`)
  } catch {
    /* 占用时保留原文件，内容已拆出，重复度无害 */
  }
  return count
}

/** 启动迁移：书架全部书跑一遍（幂等，旧文件不存在即跳过） */
export function migrateAllCharacterFiles(): void {
  for (const b of listBooks()) {
    try {
      splitLegacyCharacters(b.title)
    } catch {
      /* 单书失败不阻塞其他书 */
    }
  }
}

export interface CharacterFile {
  /** 相对书根的路径，如 角色/林栖.md */
  path: string
  /** 角色名 = 文件名去 .md */
  name: string
  content: string
}

/** 列出 角色/ 下全部 .md（递归含子分组） */
function walkCharFiles(dir: string, relBase: string, out: string[]): void {
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    const abs = join(dir, e)
    const rel = relBase ? `${relBase}/${e}` : e
    try {
      if (statSync(abs).isDirectory()) walkCharFiles(abs, rel, out)
      else if (e.toLowerCase().endsWith('.md')) out.push(rel)
    } catch {
      /* 跳过不可读项 */
    }
  }
}

export function listCharacterFiles(book: string): string[] {
  const dir = join(getLibraryRoot(), book, CHAR_DIR)
  const out: string[] = []
  walkCharFiles(dir, CHAR_DIR, out)
  return out.sort()
}

/** 聚合读取全部角色卡（供工作流注入 / OOC 对照 / 自动登记） */
export function readAllCharacters(book: string): { files: CharacterFile[]; joined: string } {
  const files: CharacterFile[] = []
  for (const rel of listCharacterFiles(book)) {
    try {
      const content = readTextFile(book, rel)
      if (content.trim()) files.push({ path: rel, name: rel.slice(CHAR_DIR.length + 1, -3), content })
    } catch {
      /* 跳过不可读文件 */
    }
  }
  return { files, joined: files.map((f) => f.content).join('\n\n') }
}
