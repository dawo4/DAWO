import { app, dialog, shell } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, appendFileSync, copyFileSync, renameSync } from 'fs'
import { join, normalize, sep, extname } from 'path'
import { computeDiff } from './diff'

let libraryRoot = ''

export function setLibraryRoot(root: string): void {
  libraryRoot = root
  mkdirSync(root, { recursive: true })
}

export function getLibraryRoot(): string {
  return libraryRoot
}

/** 防路径穿越：解析书内相对路径 */
function safeResolve(book: string, rel: string): string {
  const base = normalize(join(libraryRoot, book))
  const full = normalize(join(base, rel))
  if (!full.startsWith(base + sep) && full !== base) throw new Error('非法路径')
  return full
}

export interface BookMeta {
  title: string
  genre: string
  createdAt: string
  updatedAt: string
  idea: string
  /** 投稿平台/读者定位，如「起点·男频」 */
  platform: string
  /** 风格标签，如 升级流 / 无敌流 / 系统 / 重生 */
  styleTags: string[]
  /** 叙事视角，如「第三人称」 */
  viewpoint: string
  /** 目标读者，如「男频」「女频」「出版 · 全频」 */
  audience: string
  /** 书架分组；空串表示未分组 */
  group: string
  workflow: {
    step: number
    chapterCursor: number
    chapterTotal: number
    completed: boolean[]
  }
}

function defaultWorkflow(): BookMeta['workflow'] {
  return { step: 0, chapterCursor: 1, chapterTotal: 12, completed: [] }
}

export function listBooks(): BookMeta[] {
  if (!existsSync(libraryRoot)) return []
  const books: BookMeta[] = []
  for (const name of readdirSync(libraryRoot)) {
    const p = join(libraryRoot, name)
    try {
      if (!statSync(p).isDirectory()) continue
      const bj = join(p, 'book.json')
      if (!existsSync(bj)) continue
      const meta = JSON.parse(readFileSync(bj, 'utf-8')) as BookMeta
      meta.title = name
      if (!meta.workflow) meta.workflow = defaultWorkflow()
      if (!Array.isArray(meta.styleTags)) meta.styleTags = []
      if (typeof meta.platform !== 'string') meta.platform = ''
      if (typeof meta.viewpoint !== 'string') meta.viewpoint = ''
      if (typeof meta.audience !== 'string') meta.audience = ''
      if (typeof meta.group !== 'string') meta.group = ''
      books.push(meta)
    } catch {
      /* 跳过损坏目录 */
    }
  }
  return books.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function createBook(
  input:
    | {
        title: string
        genre?: string
        platform?: string
        styleTags?: string[]
        idea?: string
        viewpoint?: string
        audience?: string
        group?: string
      }
    | string,
  genreArg?: string
): BookMeta {
  const opt = typeof input === 'string' ? { title: input, genre: genreArg } : input
  const title = String(opt.title || '').trim()
  if (!title) throw new Error('书名不能为空')
  if (/[\\/:*?"<>|]/.test(title) || title.includes('..')) throw new Error('书名不能包含 \\ / : * ? " < > | 等字符')
  const dir = join(libraryRoot, title)
  if (existsSync(dir)) throw new Error('已存在同名书籍')
  for (const sub of ['大纲', '角色', '设定', '正文', '.inkdesk', '.inkdesk/history']) mkdirSync(join(dir, sub), { recursive: true })
  const now = new Date().toISOString()
  const meta: BookMeta = {
    title,
    genre: String(opt.genre || '未分类'),
    createdAt: now,
    updatedAt: now,
    idea: String(opt.idea || ''),
    platform: String(opt.platform || ''),
    styleTags: Array.isArray(opt.styleTags) ? opt.styleTags.map(String) : [],
    viewpoint: String(opt.viewpoint || ''),
    audience: String(opt.audience || ''),
    group: String(opt.group || ''),
    workflow: defaultWorkflow()
  }
  writeFileSync(join(dir, 'book.json'), JSON.stringify(meta, null, 2), 'utf-8')
  return meta
}

export function readBookMeta(book: string): BookMeta {
  return JSON.parse(readFileSync(safeResolve(book, 'book.json'), 'utf-8'))
}

export function writeBookMeta(book: string, patch: Partial<BookMeta>): BookMeta {
  const p = safeResolve(book, 'book.json')
  const meta = JSON.parse(readFileSync(p, 'utf-8')) as BookMeta
  const out = { ...meta, ...patch, updatedAt: new Date().toISOString() }
  writeFileSync(p, JSON.stringify(out, null, 2), 'utf-8')
  return out
}

/**
 * 按实际编码读取文本文件。
 * 中文 TXT 常见 GBK/GB2312/GB18030 编码，直接按 utf-8 读会得到不可逆的乱码，
 * 因此：先看 BOM → 再严格尝试 UTF-8（出错即说明不是 UTF-8）→ 最后按 GB18030 解码
 * （GB18030 向下兼容 GBK 与 GB2312）。
 */
export function readTextAuto(absPath: string): string {
  const buf = readFileSync(absPath)
  if (buf.length === 0) return ''
  // UTF-8 BOM / UTF-16 LE BOM / UTF-16 BE BOM
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf-8')
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf-16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16 BE：手工交换字节后按 LE 解，不依赖 ICU 对 utf-16be 标签的支持
    const n = buf.length - 2
    const sw = Buffer.alloc(n)
    for (let i = 0; i < n; i += 2) {
      sw[i] = buf[i + 3]
      sw[i + 1] = buf[i + 2]
    }
    return sw.toString('utf-16le')
  }
  // 严格 UTF-8：任何非法序列都说明这不是 UTF-8 文本
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    /* 落到 GB18030 */
  }
  try {
    return new TextDecoder('gb18030').decode(buf)
  } catch {
    // 极端环境不支持 GB18030 时退回有损解码，至少不让整个流程崩掉
    return buf.toString('utf-8')
  }
}

export function readTextFile(book: string, rel: string): string {
  const p = safeResolve(book, rel)
  if (!existsSync(p)) return ''
  return readTextAuto(p)
}

export function writeTextFile(book: string, rel: string, content: string): void {
  const p = safeResolve(book, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  // 历史快照：正文有实际变化就留档（供写作台「历史」面板对比回滚）
  if (existsSync(p) && rel.startsWith('正文')) {
    const old = readFileSync(p, 'utf-8')
    if (old !== content) snapshot(book, rel, old)
  }
  writeFileSync(p, content, 'utf-8')
}

function snapshot(book: string, rel: string, content: string): void {
  try {
    const histDir = safeResolve(book, join('.inkdesk', 'history'))
    mkdirSync(histDir, { recursive: true })
    const name = rel.replace(/[\\/:*?"<>|]/g, '_')
    const files = readdirSync(histDir).filter((f) => f.startsWith(name)).sort()
    // 与最近一份快照相同则不重复留档
    const latest = files[files.length - 1]
    if (latest && readTextAuto(join(histDir, latest)) === content) return
    if (files.length >= 20) rmSync(join(histDir, files[0]))
    appendFileSync(join(histDir, `${name}.${Date.now()}.bak`), content, 'utf-8')
  } catch {
    /* 快照失败不影响主流程 */
  }
}

/** 某文件的历史快照列表（新→旧），供写作台「历史版本」面板 */
export function historyList(book: string, rel: string): { file: string; at: string }[] {
  const histDir = safeResolve(book, join('.inkdesk', 'history'))
  if (!existsSync(histDir)) return []
  const prefix = rel.replace(/[\\/:*?"<>|]/g, '_')
  return readdirSync(histDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.bak'))
    .map((f) => {
      const ts = Number(f.slice(prefix.length + 1, -'.bak'.length))
      return { file: f, at: Number.isNaN(ts) ? '' : new Date(ts).toISOString() }
    })
    .filter((x) => x.at)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
}

export function historyRead(book: string, rel: string, file: string): string {
  const histDir = safeResolve(book, join('.inkdesk', 'history'))
  const target = normalize(join(histDir, file))
  if (!target.startsWith(normalize(histDir) + sep) || !file.endsWith('.bak')) throw new Error('非法快照路径')
  return readTextAuto(target)
}

/** 恢复历史版本：当前内容先自动快照一份，再写回 */
export function historyRestore(book: string, rel: string, file: string): void {
  const content = historyRead(book, rel, file)
  const p = safeResolve(book, rel)
  if (existsSync(p)) snapshot(book, rel, readFileSync(p, 'utf-8'))
  writeTextFile(book, rel, content)
}

/** 快照与当前内容的差异（供回滚前预览）：old=快照，current=现文件 */
export function historyDiff(book: string, rel: string, file: string): {
  base: string
  current: string
  hunks: unknown[]
  additions: number
  deletions: number
  truncated: boolean
} {
  const base = historyRead(book, rel, file)
  const current = readTextFile(book, rel)
  const diff = computeDiff(base, current)
  return { base, current, hunks: diff.hunks, additions: diff.additions, deletions: diff.deletions, truncated: diff.truncated }
}

export interface TreeNode {
  name: string
  path: string
  dir: boolean
  children?: TreeNode[]
}

export function listTree(book: string, rel = ''): TreeNode[] {
  const base = normalize(join(libraryRoot, book))
  const dir = rel ? safeResolve(book, rel) : base
  if (!existsSync(dir)) return []
  const out: TreeNode[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const isDir = statSync(p).isDirectory()
    // .inkdesk 是应用私有目录；.json 是给智能体读的结构化数据；图片（地图底图等）由应用与智能体专用通道读写。
    // 这些对作者没有可读性（打开是乱码或空白），统一不在文件树里出现——需要时由智能体通过专门工具读取。
    if (name === '.inkdesk' || name.endsWith('.json') || (!isDir && /\.(png|jpe?g|webp|gif|bmp|ico|svg)$/i.test(name))) continue
    if (isDir && name === '地图图') continue // 应用管理的地图底图目录，整目录隐藏
    const node: TreeNode = { name, path: rel ? `${rel}/${name}` : name, dir: isDir }
    if (isDir) node.children = listTree(book, node.path)
    out.push(node)
  }
  return out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'zh') : a.dir ? -1 : 1))
}

export function deleteBook(title: string): void {
  rmSync(join(libraryRoot, title), { recursive: true, force: true })
}

/** 重命名作品：目录名即书名，需要同步重命名目录并更新元信息 */
export function renameBook(oldTitle: string, newTitle: string): BookMeta {
  const to = String(newTitle || '').trim()
  if (!to) throw new Error('新书名不能为空')
  if (/[\\/:*?"<>|]/.test(to) || to.includes('..')) throw new Error('书名不能包含 \\ / : * ? " < > | 等字符')
  if (to === oldTitle) return readBookMeta(oldTitle)
  const from = join(libraryRoot, oldTitle)
  if (!existsSync(from)) throw new Error('作品不存在')
  const dest = join(libraryRoot, to)
  if (existsSync(dest)) throw new Error('已存在同名作品')
  renameSync(from, dest)
  const meta = readBookMeta(to)
  meta.title = to
  writeBookMeta(to, { title: to })
  return meta
}

export function deleteFile(book: string, rel: string): void {
  const p = safeResolve(book, rel)
  if (existsSync(p)) rmSync(p)
}

/** 章节标题行：第N章 / 第N回 / 第N节 / 卷N，汉字与数字都认；另认楔子/序章/尾声等特殊章名 */
const CHAPTER_RE = /^#{0,3}\s*[ 　]*(第[0-9零一二三四五六七八九十百千万亿]+[章回节][^\n]{0,40}|卷[0-9零一二三四五六七八九十百千万亿]+[^\n]{0,40}|楔子[^\n]{0,40}|序章[^\n]{0,40}|引子[^\n]{0,40}|尾声[^\n]{0,40}|终章[^\n]{0,40}|后记[^\n]{0,40}|番外[^\n]{0,40})\s*$/

/**
 * 把整本 TXT 的内容按章节标题拆成多章。
 * 返回 null 表示没有足够的章节标题（< 3 个），不拆，整本作为单文件。
 */
function splitChapters(content: string): { title: string; body: string }[] | null {
  const lines = content.split(/\r?\n/)
  const marks: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (CHAPTER_RE.test(lines[i])) marks.push(i)
  }
  if (marks.length < 3) return null
  const out: { title: string; body: string }[] = []
  for (let k = 0; k < marks.length; k++) {
    const start = marks[k]
    const end = k + 1 < marks.length ? marks[k + 1] : lines.length
    const title = lines[start].replace(/^#{0,3}\s*/, '').trim()
    const body = lines.slice(start + 1, end).join('\n').trim()
    out.push({ title, body })
  }
  // 标题之前若还有一段内容（书名页/简介），并入第一章开头
  if (marks[0] > 0) {
    const head = lines.slice(0, marks[0]).join('\n').trim()
    if (head) out[0].body = `${head}\n\n${out[0].body}`
  }
  return out
}

/** 文件名安全化：去掉路径与非法字符 */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, ' ').trim().slice(0, 60) || '未命名'
}

export function importToBook(book: string, filePath: string): { file: string; chapters?: number } {
  const content = readTextAuto(filePath)
  const name = filePath.split(/[\\/]/).pop() || '导入'
  const base = safeFileName(name.replace(/\.(txt|md)$/i, ''))
  return importContentToBook(book, base, content)
}

/** 把已读出的文本导入书内（大文件含章节结构时自动拆章），供文件导入与迁移向导共用 */
export function importContentToBook(book: string, base: string, content: string): { file: string; chapters?: number } {

  // 大文件且含章节结构时自动拆分：整本 18MB 塞进一个文件，编辑器根本打不开
  if (content.length > 200_000) {
    const chapters = splitChapters(content)
    if (chapters && chapters.length >= 3) {
      let firstFile = ''
      for (let i = 0; i < chapters.length; i++) {
        const c = chapters[i]
        const no = String(i + 1).padStart(3, '0')
        const body = c.body ? `# ${c.title}\n\n${c.body}\n\n` : `# ${c.title}\n\n`
        // 文件名强制带章节序号：裸标题章（「第一章」「第二章」无副标题）剥掉前缀后同名，会互相覆盖
        const name = `${no}章 ${safeFileName(c.title.replace(/^第[0-9零一二三四五六七八九十百千万亿]+[章回节]\s*/, '')) || base}.md`
        if (!firstFile) firstFile = join('正文', name)
        writeTextFile(book, join('正文', name), body)
      }
      return { file: firstFile, chapters: chapters.length }
    }
  }

  writeTextFile(book, join('正文', `${base}.md`), content)
  return { file: join('正文', `${base}.md`) }
}

// ============ 迁移向导：散落的外部书稿（txt/md/docx 多选）归类成书 ============

/** 多选外部书稿文件 */
export async function pickMigrateFiles(win: Electron.BrowserWindow): Promise<string[] | null> {
  const r = await dialog.showOpenDialog(win, {
    title: '选择要迁移的书稿（可多选）',
    filters: [{ name: '书稿文本', extensions: ['txt', 'md', 'docx'] }],
    properties: ['openFile', 'multiSelections']
  })
  return r.canceled || !r.filePaths.length ? null : r.filePaths
}

/** 读外部文档：txt/md 走编码探测，docx 走 mammoth 提取纯文本 */
async function readExternalDoc(p: string): Promise<{ name: string; text: string }> {
  const name = (p.split(/[\\/]/).pop() || '导入').replace(/\.(txt|md|docx)$/i, '')
  if (/\.docx$/i.test(p)) {
    const mammoth = await import('mammoth')
    const r = await mammoth.extractRawText({ path: p })
    return { name, text: (r.value || '').replace(/\n{3,}/g, '\n\n').trim() }
  }
  return { name, text: readTextAuto(p) }
}

/**
 * 迁移向导执行：多选文件 → 归类成书。
 * mode 'each'：每个文件一本书（书名 = 文件名，重名自动加序号）
 * mode 'merge'：全部并入一本书（书名 = mergeTitle，已存在则直接用；内容按文件名顺序拼接后统一拆章）
 */
export async function migrateImport(
  win: Electron.BrowserWindow,
  mode: 'each' | 'merge',
  mergeTitle: string
): Promise<{ books: string[]; chapters: number; errors: string[] }> {
  const paths = await pickMigrateFiles(win)
  if (!paths) return { books: [], chapters: 0, errors: [] }
  const books: string[] = []
  const errors: string[] = []
  let chapters = 0

  if (mode === 'merge') {
    const title = safeFileName(mergeTitle || '迁移作品')
    if (!existsSync(join(libraryRoot, title))) {
      createBook({ title, genre: '导入作品' })
    }
    const docs: { name: string; text: string }[] = []
    for (const p of paths) {
      try {
        const d = await readExternalDoc(p)
        if (d.text.trim()) docs.push(d)
      } catch (e) {
        errors.push(`${(p.split(/[\\/]/).pop() || p)}：${(e as Error).message}`)
      }
    }
    docs.sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }))
    if (!docs.length) return { books: [], chapters: 0, errors }
    const joined = docs.map((d) => d.text).join('\n\n')
    const r = importContentToBook(title, safeFileName(docs[0].name), joined)
    chapters = r.chapters || 1
    books.push(title)
    return { books, chapters, errors }
  }

  for (const p of paths) {
    try {
      const d = await readExternalDoc(p)
      if (!d.text.trim()) continue
      let title = safeFileName(d.name)
      let n = 2
      while (existsSync(join(libraryRoot, title))) title = `${safeFileName(d.name)}（${n++}）`
      createBook({ title, genre: '导入作品' })
      const r = importContentToBook(title, safeFileName(d.name), d.text)
      chapters += r.chapters || 1
      books.push(title)
    } catch (e) {
      errors.push(`${(p.split(/[\\/]/).pop() || p)}：${(e as Error).message}`)
    }
  }
  return { books, chapters, errors }
}

export async function pickImportFile(win: Electron.BrowserWindow): Promise<string | null> {
  const r = await dialog.showOpenDialog(win, {
    title: '导入 TXT / Markdown',
    filters: [{ name: '文本', extensions: ['txt', 'md'] }],
    properties: ['openFile']
  })
  return r.canceled ? null : r.filePaths[0]
}

/** 选择文本文件直接读出内容（自动探测 UTF-8/GB18030），供拆书等场景引用，免手动复制粘贴 */
export async function pickSourceText(win: Electron.BrowserWindow): Promise<{ name: string; text: string } | null> {
  const r = await dialog.showOpenDialog(win, {
    title: '选择要拆解的文本',
    filters: [{ name: '文本', extensions: ['txt', 'md'] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return null
  const p = r.filePaths[0]
  const name = (p.split(/[\\/]/).pop() || '').replace(/\.(txt|md)$/i, '')
  return { name, text: readTextAuto(p) }
}

/** 选择背景图并复制进应用数据目录（原文件移动/删除后背景不失效），返回新路径 */
export async function pickBackgroundImage(win: Electron.BrowserWindow): Promise<string | null> {
  const r = await dialog.showOpenDialog(win, {
    title: '选择背景图片',
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return null
  const src = r.filePaths[0]
  const dir = join(app.getPath('userData'), '背景图')
  mkdirSync(dir, { recursive: true })
  // 唯一文件名：渲染层按路径缓存 data URL，改名可保证新图不命中旧缓存；同时清理旧图
  const dest = join(dir, `background-${Date.now()}${extname(src).toLowerCase()}`)
  for (const f of readdirSync(dir)) {
    if (/^background-\d+\./.test(f) && join(dir, f) !== dest) rmSync(join(dir, f))
  }
  copyFileSync(src, dest)
  return dest
}

/** 读背景图为 base64 数据 URL（dev 模式页面是 http 源，直接引用 file:// 图片会被安全策略拦掉） */
export function backgroundImageDataUrl(p: string): string {
  if (!existsSync(p)) return ''
  const ext = extname(p).toLowerCase().replace('.', '')
  const mime = ext === 'jpg' ? 'jpeg' : ext
  if (!['jpeg', 'png', 'webp', 'gif', 'bmp'].includes(mime)) return ''
  return `data:image/${mime};base64,${readFileSync(p).toString('base64')}`
}

// ============ 地图底图（存书目录 设定/地图图/ 下，JSON 只存相对路径防膨胀） ============

const MAP_IMG_DIR = join('设定', '地图图')

/** 清理某本书某张地图的旧底图（文件名以 {mapId}- 开头） */
function cleanMapImages(book: string, mapId: string, keepAbs?: string): void {
  const dir = normalize(join(libraryRoot, book, MAP_IMG_DIR))
  if (!existsSync(dir)) return
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(`${mapId}-`)) continue
    const abs = join(dir, f)
    if (abs !== keepAbs) rmSync(abs)
  }
}

/** 保存手绘底图（canvas data URL）到书目录，返回书内相对路径 */
export function saveMapImage(book: string, mapId: string, dataUrl: string): string {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUrl)
  if (!m) throw new Error('非法图片数据')
  const dir = normalize(join(libraryRoot, book, MAP_IMG_DIR))
  mkdirSync(dir, { recursive: true })
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
  const name = `${mapId}-${Date.now()}.${ext}`
  const dest = join(dir, name)
  writeFileSync(dest, Buffer.from(m[2], 'base64'))
  cleanMapImages(book, mapId, dest)
  return normalize(join(MAP_IMG_DIR, name))
}

/** 选择本地图并复制进书目录，返回书内相对路径 */
export async function pickMapImage(win: Electron.BrowserWindow, book: string, mapId: string): Promise<string | null> {
  const r = await dialog.showOpenDialog(win, {
    title: '选择地图底图',
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return null
  const dir = normalize(join(libraryRoot, book, MAP_IMG_DIR))
  mkdirSync(dir, { recursive: true })
  const name = `${mapId}-${Date.now()}${extname(r.filePaths[0]).toLowerCase()}`
  const dest = join(dir, name)
  copyFileSync(r.filePaths[0], dest)
  cleanMapImages(book, mapId, dest)
  return normalize(join(MAP_IMG_DIR, name))
}

/** 读地图底图为 base64 数据 URL（rel 为书内相对路径，防路径穿越；支持 png/jpg/webp/bmp/svg） */
export function mapImageDataUrl(book: string, rel: string): string {
  if (!rel) return ''
  const p = safeResolve(book, rel)
  if (!existsSync(p) || !statSync(p).isFile()) return ''
  const ext = extname(p).toLowerCase().replace('.', '')
  const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext
  if (!['jpeg', 'png', 'webp', 'bmp', 'svg+xml'].includes(mime)) return ''
  return `data:image/${mime};base64,${readFileSync(p).toString('base64')}`
}

export function openLibraryInExplorer(): void {
  shell.openPath(libraryRoot)
}

export function openPathInExplorer(p: string): void {
  shell.openPath(p)
}

/** 写入任意绝对路径（导出会话等场景） */
export function writeAbsolute(absPath: string, content: string): void {
  writeFileSync(absPath, content, 'utf-8')
}

export interface Stats {
  days: Record<string, { handwritten: number; ai: number }>
  prevCounts: Record<string, number>
}

export function readStats(book: string): Stats {
  const p = safeResolve(book, join('.inkdesk', 'stats.json'))
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
  return { days: {}, prevCounts: {} }
}

export function addStats(book: string, handwritten: number, ai: number): Stats {
  const s = readStats(book)
  const day = new Date().toISOString().slice(0, 10)
  s.days[day] = s.days[day] || { handwritten: 0, ai: 0 }
  s.days[day].handwritten += handwritten
  s.days[day].ai += ai
  writeTextFile(book, join('.inkdesk', 'stats.json'), JSON.stringify(s, null, 2))
  return s
}

export function recordCount(book: string, rel: string, length: number): void {
  const s = readStats(book)
  s.prevCounts[rel] = length
  writeTextFile(book, join('.inkdesk', 'stats.json'), JSON.stringify(s, null, 2))
}

export function copyDefaultCover(book: string): void {
  /* 预留 */
}

export function copyFileInBook(book: string, fromAbs: string, relTo: string): void {
  copyFileSync(fromAbs, safeResolve(book, relTo))
}
