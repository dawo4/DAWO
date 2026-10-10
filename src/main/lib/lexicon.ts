import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { shell } from 'electron'

// ============ 词库外置（去AI味红牌/信号词表）：userData/词库.json 可编辑，改完面板里点「词库」重载 ============
// 约定：只支持「追加」自定义词与红牌（内置词表是实测校准过的基线，不做删除）；pattern 为正则字符串

export interface LexiconRedCard {
  key: string
  label: string
  /** 正则字符串（不要带斜杠和标志位） */
  pattern: string
  hint: string
  /** 适用文体：fiction / article，缺省两边都生效 */
  genres?: string[]
}

export interface LexiconData {
  _说明?: string
  /** 追加红牌句式（出现即警告） */
  redCards?: LexiconRedCard[]
  /** 追加对话层信号词：疑虑（小说正文只统计角色台词） */
  dialogDoubt?: string[]
  dialogDigress?: string[]
  dialogVoice?: string[]
  /** 追加文章层信号词 */
  articleDoubt?: string[]
  articleDigress?: string[]
  articleVoice?: string[]
}

const DEFAULT: LexiconData = {
  _说明:
    '去AI味词库（追加制）：在数组里加条目即可生效。redCards.pattern 填正则字符串（不要斜杠），genres 可选 "fiction"/"article"；六个信号词数组直接加词字符串。编辑保存后，回到写作台「去AI味」面板点「词库」按钮重载。',
  redCards: [],
  dialogDoubt: [],
  dialogDigress: [],
  dialogVoice: [],
  articleDoubt: [],
  articleDigress: [],
  articleVoice: []
}

function lexiconFile(): string {
  return join(app.getPath('userData'), '词库.json')
}

export function lexiconPath(): string {
  return lexiconFile()
}

/** 懒初始化：首次读取时落一份带说明的默认文件 */
export function readLexicon(): LexiconData {
  const p = lexiconFile()
  if (!existsSync(p)) {
    writeFileSync(p, JSON.stringify(DEFAULT, null, 2), 'utf-8')
    return JSON.parse(JSON.stringify(DEFAULT))
  }
  try {
    return { ...JSON.parse(readFileSync(p, 'utf-8')) }
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT))
  }
}

export function saveLexicon(data: LexiconData): void {
  writeFileSync(lexiconFile(), JSON.stringify(data, null, 2), 'utf-8')
}

/** 在系统编辑器里打开词库文件 */
export function openLexicon(): void {
  const p = lexiconFile()
  if (!existsSync(p)) readLexicon()
  shell.openPath(p)
}
