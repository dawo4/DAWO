import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getLibraryRoot } from './library'
import {
  readTimeline, writeTimeline, readStory, writeStory, readCharGraph, writeCharGraph,
  readDict, writeDict, readForeshadow, writeForeshadow, readPower, writePower,
  readTracking, writeTracking, readMaps, writeMaps, readOutline, writeOutline
} from './structured'

// ============ 面板注册表（阶段二）：内置 9 板块 + 自定义列表面板的统一抽象 ============
// 数据层设计：内置面板数据文件与位置完全不变（老书零迁移）；自定义面板存 面板/<id>.json

export type PanelPrototype = 'list' | 'hierarchy' | 'graph' | 'timeline'

/** 字段类型：text 单行 / longtext 多行 / tags 顿号分隔 / status 枚举（v1 自由文本） */
export interface PanelFieldDef {
  key: string
  label: string
  type: 'text' | 'longtext' | 'tags' | 'status'
}

export interface PanelInstance {
  id: string
  name: string
  prototype: PanelPrototype
  /** 内置板块的数据通道（结构化板块的 9 个 board），自定义面板无此字段 */
  board?: BuiltinBoard
  /** 自定义列表字段（仅 list 原型） */
  fields?: PanelFieldDef[]
  /** 内置面板可隐藏，不可删除 */
  hidden?: boolean
}

export type BuiltinBoard =
  | 'timeline' | 'story' | 'charGraph' | 'dict' | 'foreshadow'
  | 'power' | 'tracking' | 'map' | 'outline'

/** 内置 9 板块：顺序即资料区/写作台导航顺序，数据文件与结构化时代完全一致（零迁移） */
export const BUILTIN_PANELS: PanelInstance[] = [
  { id: 'timeline', name: '时间线', prototype: 'timeline', board: 'timeline' },
  { id: 'story', name: '故事线', prototype: 'graph', board: 'story' },
  { id: 'charGraph', name: '关系图', prototype: 'graph', board: 'charGraph' },
  { id: 'outline', name: '细纲', prototype: 'list', board: 'outline' },
  { id: 'dict', name: '词典', prototype: 'list', board: 'dict' },
  { id: 'foreshadow', name: '伏笔', prototype: 'list', board: 'foreshadow' },
  { id: 'power', name: '境界', prototype: 'hierarchy', board: 'power' },
  { id: 'tracking', name: '出场', prototype: 'list', board: 'tracking' },
  { id: 'map', name: '地图', prototype: 'graph', board: 'map' }
]

const PANELS_DIR = '面板'
const REGISTRY_FILE = join(PANELS_DIR, '面板.json')

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function bookPath(book: string, rel: string): string {
  return join(getLibraryRoot(), book, rel)
}

/** 每本书的自定义面板注册表：面板/面板.json（缺省 = 无自定义） */
interface BookRegistry {
  instances: PanelInstance[]
}

function readRegistry(book: string): BookRegistry {
  const p = bookPath(book, REGISTRY_FILE)
  if (!existsSync(p)) return { instances: [] }
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'))
    return { instances: Array.isArray(data.instances) ? data.instances : [] }
  } catch {
    return { instances: [] }
  }
}

function writeRegistry(book: string, reg: BookRegistry): void {
  const p = bookPath(book, REGISTRY_FILE)
  mkdirSync(bookPath(book, PANELS_DIR), { recursive: true })
  writeFileSync(p, JSON.stringify(reg, null, 2), 'utf-8')
}

/** 全部面板 = 内置 9 板块 + 本书自定义实例 */
export function listPanels(book: string): PanelInstance[] {
  const reg = readRegistry(book)
  return [...BUILTIN_PANELS, ...reg.instances]
}

export interface AddPanelInput {
  name: string
  /** v1 自定义面板仅支持 list 原型 */
  fields?: PanelFieldDef[]
}

const DEFAULT_FIELDS: PanelFieldDef[] = [
  { key: 'title', label: '标题', type: 'text' },
  { key: 'note', label: '内容', type: 'longtext' }
]

/** 新增自定义列表面板（空白列表：不传字段就给 标题+内容 两个字段） */
export function addPanel(book: string, input: AddPanelInput): PanelInstance {
  const name = String(input.name || '').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 20)
  if (!name) throw new Error('面板名称不能为空')
  const reg = readRegistry(book)
  if (reg.instances.some((p) => p.name === name) || BUILTIN_PANELS.some((p) => p.name === name)) {
    throw new Error(`面板「${name}」已存在`)
  }
  const raw = Array.isArray(input.fields) ? input.fields : []
  const fields = raw.length
    ? raw
        .map((f) => ({
          key: String(f?.key || '').trim().replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 20),
          label: String(f?.label || '').trim().slice(0, 20) || String(f?.key || '').slice(0, 20),
          type: (['text', 'longtext', 'tags', 'status'].includes(String(f?.type)) ? f?.type : 'text') as PanelFieldDef['type']
        }))
        .filter((f) => f.key)
    : DEFAULT_FIELDS
  if (!fields.length) throw new Error('至少需要一个字段')
  const inst: PanelInstance = { id: uid('panel'), name, prototype: 'list', fields }
  reg.instances.push(inst)
  writeRegistry(book, reg)
  // 初始化空数据文件，UI 拉取时不会 404（注意传 id，不是整个对象）
  writePanelData(book, inst.id, [])
  return inst
}

/** 重命名自定义面板（内置不可改） */
export function renamePanel(book: string, id: string, name: string): PanelInstance[] {
  const clean = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 20)
  if (!clean) throw new Error('面板名称不能为空')
  const reg = readRegistry(book)
  const inst = reg.instances.find((p) => p.id === id)
  if (!inst) throw new Error('内置面板不可重命名，自定义面板不存在该 id')
  if (reg.instances.some((p) => p.id !== id && p.name === clean)) throw new Error(`面板「${clean}」已存在`)
  inst.name = clean
  writeRegistry(book, reg)
  return listPanels(book)
}

/** 删除自定义面板（内置只允许切换 hidden 隐藏） */
export function removePanel(book: string, id: string): PanelInstance[] {
  const reg = readRegistry(book)
  const inst = reg.instances.find((p) => p.id === id)
  if (!inst) throw new Error('内置面板不可删除，自定义面板不存在该 id')
  reg.instances = reg.instances.filter((p) => p.id !== id)
  writeRegistry(book, reg)
  const dataFile = bookPath(book, join(PANELS_DIR, `${id}.json`))
  if (existsSync(dataFile)) {
    try {
      unlinkSync(dataFile)
    } catch {
      /* 数据文件占用时保留，不影响功能 */
    }
  }
  return listPanels(book)
}

/** 隐藏/显示面板（内置与自定义都可用，导航按此过滤） */
export function setPanelHidden(book: string, id: string, hidden: boolean): PanelInstance[] {
  if (BUILTIN_PANELS.some((p) => p.id === id)) {
    const reg = readRegistry(book)
    const ov = reg.instances.find((p) => p.id === id)
    if (ov) ov.hidden = hidden
    else reg.instances.push({ ...BUILTIN_PANELS.find((p) => p.id === id)!, hidden })
    writeRegistry(book, reg)
    return listPanels(book)
  }
  const reg = readRegistry(book)
  const inst = reg.instances.find((p) => p.id === id)
  if (!inst) throw new Error('面板不存在')
  inst.hidden = hidden
  writeRegistry(book, reg)
  return listPanels(book)
}

/** 面板可见列表（过滤 hidden） */
export function visiblePanels(book: string): PanelInstance[] {
  return listPanels(book).filter((p) => !p.hidden)
}

// ============ 面板数据读写：内置委托 structured 通道（语义不变），自定义走通用列表 ============

export interface ListEntry {
  id: string
  [key: string]: unknown
}

function readCustomEntries(book: string, id: string): ListEntry[] {
  const p = bookPath(book, join(PANELS_DIR, `${id}.json`))
  if (!existsSync(p)) return []
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'))
    return Array.isArray(data.entries) ? data.entries : []
  } catch {
    return []
  }
}

function writeCustomEntries(book: string, id: string, entries: ListEntry[]): void {
  mkdirSync(bookPath(book, PANELS_DIR), { recursive: true })
  writeFileSync(bookPath(book, join(PANELS_DIR, `${id}.json`)), JSON.stringify({ entries }, null, 2), 'utf-8')
}

/** 按字段定义归一化自定义列表条目；keepEmpty=true（UI 保存路径）保留空行——用户点「添加」出现的新卡片不能被吞掉 */
function normalizeCustomEntries(raw: unknown, fields: PanelFieldDef[], keepEmpty = false): ListEntry[] {
  const arr = Array.isArray(raw) ? raw : []
  const list = arr.map((item, i) => {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const out: ListEntry = {
      id: typeof r.id === 'string' && r.id ? r.id : uid('e') + '-' + i
    }
    for (const f of fields) {
      const v = r[f.key]
      if (v === undefined || v === null) out[f.key] = ''
      else if (Array.isArray(v)) out[f.key] = v.map((x) => String(x).slice(0, 200))
      else out[f.key] = String(v).slice(0, f.type === 'longtext' ? 5000 : 500)
    }
    return out
  })
  return keepEmpty ? list : list.filter((e) => fields.some((f) => String(e[f.key] ?? '').trim()))
}

/** 渲染自定义面板条目为人类可读文本（read_panel 输出与提案 diff 用） */
export function renderPanelEntries(inst: PanelInstance, entries: ListEntry[]): string {
  const fields = inst.fields || DEFAULT_FIELDS
  if (!entries.length) return `（自定义面板「${inst.name}」为空）`
  const lines = entries.map(
    (e) => '· ' + fields.map((f) => `${f.label}:${String(e[f.key] ?? '')}`).join(' | ') + `（id:${e.id}）`
  )
  return [`自定义面板「${inst.name}」（共 ${entries.length} 条，字段：${fields.map((f) => f.key).join('、')}）：`, ...lines].join('\n')
}

/**
 * 智能体写入用：按 id 增量合并（带 id 更新原条目，无 id 追加），不落盘——
 * 返回合并前后数据供 makeProposal 出审阅卡，作者接受后由 file:write 落盘。
 */
export function mergePanelEntries(
  book: string,
  panelNameOrId: string,
  raw: unknown
): { inst: PanelInstance; before: ListEntry[]; after: ListEntry[] } {
  const inst = listPanels(book).find((p) => p.name === panelNameOrId || p.id === panelNameOrId)
  if (!inst) throw new Error(`面板不存在：${panelNameOrId}`)
  if (inst.board) throw new Error(`「${inst.name}」是内置板块，请用它的专用写入工具。`)
  if (inst.prototype !== 'list') throw new Error(`面板「${inst.name}」不是列表型面板`)
  const before = readCustomEntries(book, inst.id)
  const incoming = normalizeCustomEntries(raw, inst.fields || DEFAULT_FIELDS)
  const after = before.map((e) => ({ ...e }))
  for (const e of incoming) {
    const i = after.findIndex((x) => x.id === e.id)
    if (i >= 0) after[i] = { ...after[i], ...e }
    else after.push(e)
  }
  return { inst, before, after }
}

export function readPanelData(book: string, panelId: string): { entries: unknown } {
  const inst = listPanels(book).find((p) => p.id === panelId)
  if (!inst) throw new Error(`面板不存在：${panelId}`)
  switch (inst.board) {
    case 'timeline': return { entries: readTimeline(book) }
    case 'story': return { entries: readStory(book) }
    case 'charGraph': return { entries: readCharGraph(book) }
    case 'dict': return { entries: readDict(book) }
    case 'foreshadow': return { entries: readForeshadow(book) }
    case 'power': return { entries: readPower(book) }
    case 'tracking': return { entries: readTracking(book) }
    case 'map': return { entries: readMaps(book) }
    case 'outline': return { entries: readOutline(book) }
    default: {
      if (inst.prototype !== 'list') throw new Error(`面板「${inst.name}」不支持通用数据读取`)
      return { entries: readCustomEntries(book, inst.id) }
    }
  }
}

export function writePanelData(book: string, panelId: string, data: unknown): { entries: unknown } {
  const inst = listPanels(book).find((p) => p.id === panelId)
  if (!inst) throw new Error(`面板不存在：${panelId}`)
  switch (inst.board) {
    case 'timeline': return { entries: writeTimeline(book, data) }
    case 'story': return { entries: writeStory(book, (data as { nodes?: unknown })?.nodes ?? data, (data as { edges?: unknown })?.edges ?? []) }
    case 'charGraph': return { entries: writeCharGraph(book, (data as { nodes?: unknown })?.nodes ?? data, (data as { edges?: unknown })?.edges ?? []) }
    case 'dict': return { entries: writeDict(book, data) }
    case 'foreshadow': return { entries: writeForeshadow(book, data) }
    case 'power': return { entries: writePower(book, data) }
    case 'tracking': return { entries: writeTracking(book, data) }
    case 'map': return { entries: writeMaps(book, data) }
    case 'outline': return { entries: writeOutline(book, data) }
    default: {
      if (inst.prototype !== 'list') throw new Error(`面板「${inst.name}」不支持通用数据写入`)
      // UI 直接保存路径：保留空条目（用户新建的空白卡片不能被吞）
      const entries = normalizeCustomEntries(data, inst.fields || DEFAULT_FIELDS, true)
      writeCustomEntries(book, inst.id, entries)
      return { entries }
    }
  }
}
