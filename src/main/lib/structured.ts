import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, normalize, sep } from 'path'
import { getLibraryRoot } from './library'

/**
 * 结构化资料数据（时间线 / 故事线 / 角色关系图）。
 * 存在作品目录下的 JSON 里，便于 AI 通过结构化工具可靠写入与校验；
 * 旧的 Markdown 表格与 vue-flow 格式会在首次读取时自动迁移。
 */

export type TimelineLine = 'main' | 'sub'

export interface TimelineNode {
  id: string
  /** 事件标题 */
  title: string
  /** 时间描述（“三年前”“登基当日”等，可空） */
  time: string
  /** 排序用序号 */
  sortKey: number
  /** 主线 / 支线 */
  line: TimelineLine
  /** 绑定章节文件路径（可绑多个：大线可跨十几章） */
  chapters: string[]
  desc: string
  characters: string[]
}

export interface StoryNode {
  id: string
  label: string
  /** 节点类型：setup 铺垫 / conflict 冲突 / turn 转折 / climax 高潮 / ending 收束 / foreshadow 伏笔 / payoff 回收 */
  kind: string
  main: boolean
  /** 绑定章节文件路径（可绑多个） */
  chapters: string[]
  desc: string
  x: number
  y: number
}

export interface StoryEdge {
  id: string
  source: string
  target: string
  label: string
}

export interface CharNode {
  id: string
  name: string
  role: string
  x: number
  y: number
}

export type RelationKind = 'family' | 'love' | 'friend' | 'enemy' | 'other'

export interface CharEdge {
  id: string
  source: string
  target: string
  relation: RelationKind
  label: string
}

export const STORY_KINDS = ['setup', 'conflict', 'turn', 'climax', 'ending', 'foreshadow', 'payoff'] as const
export const RELATION_KINDS: RelationKind[] = ['family', 'love', 'friend', 'enemy', 'other']

const TIMELINE_FILE = '时间线.json'
const STORY_FILE = '故事线.json'
const CHAR_GRAPH_FILE = join('角色', '关系图.json')
const LEGACY_TIMELINE_MD = '时间线.md'

function bookRoot(book: string): string {
  return normalize(join(getLibraryRoot(), book))
}

/** 防路径穿越 */
function resolve(book: string, rel: string): string {
  const base = bookRoot(book)
  const full = normalize(join(base, rel))
  if (full !== base && !full.startsWith(base + sep)) throw new Error('非法路径')
  return full
}

function readJson<T>(book: string, rel: string, fallback: T): T {
  try {
    const p = resolve(book, rel)
    if (!existsSync(p)) return fallback
    return JSON.parse(readFileSync(p, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJson(book: string, rel: string, data: unknown): void {
  const p = resolve(book, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

// ============ 时间线 ============

function parseLegacyTimelineMd(md: string): TimelineNode[] {
  const out: TimelineNode[] = []
  const lines = md.split('\n')
  let i = 0
  for (const line of lines) {
    const t = line.trim()
    if (!t.startsWith('|')) continue
    const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    if (cells.length < 2) continue
    if (cells[0] === '时间' || /^-+$/.test(cells[0])) continue
    i += 1
    out.push({
      id: uid('tl'),
      title: cells[1] || cells[0] || `事件 ${i}`,
      time: cells[0] || '',
      sortKey: i,
      line: 'main',
      chapters: [],
      desc: cells[2] || '',
      characters: []
    })
  }
  return out
}

export function readTimeline(book: string): TimelineNode[] {
  const p = resolve(book, TIMELINE_FILE)
  if (existsSync(p)) {
    const data = readJson<{ nodes?: TimelineNode[] }>(book, TIMELINE_FILE, {})
    // 走一遍归一化：顺带把旧的单章节 chapter 字段迁成 chapters 数组
    return Array.isArray(data.nodes) ? normalizeTimeline(data.nodes) : []
  }
  // 首次读取：把旧的 Markdown 表格迁移过来
  try {
    const mdPath = resolve(book, LEGACY_TIMELINE_MD)
    if (existsSync(mdPath)) {
      const nodes = parseLegacyTimelineMd(readFileSync(mdPath, 'utf-8'))
      if (nodes.length) {
        writeTimeline(book, nodes)
        return nodes
      }
    }
  } catch {
    /* 迁移失败则返回空 */
  }
  return []
}

/** 章节绑定归一化：chapters 数组优先，兼容旧的单个 chapter 字符串 */
function chaptersOf(n: { chapters?: unknown; chapter?: unknown }): string[] {
  if (Array.isArray(n.chapters)) return [...new Set((n.chapters as unknown[]).map(String).filter(Boolean))]
  const one = String(n.chapter || '')
  return one ? [one] : []
}

/**
 * 归一化时间线。opts.preserve=true（AI 提案路径）：AI 没提到的旧事件自动保留（按 id/标题认领），
 * 防止增量更新时漏传把时间线清空；面板保存路径不开启，正常增删。
 */
export function normalizeTimeline(nodes: unknown, opts?: { preserve?: boolean; prev?: TimelineNode[] }): TimelineNode[] {
  const list = Array.isArray(nodes) ? (nodes as Record<string, unknown>[]) : []
  const prev = opts?.prev || []
  const prevById = new Map(prev.map((n) => [n.id, n]))
  const prevByTitle = new Map(prev.map((n) => [n.title, n]))
  const claimed = new Set<string>()
  const out = list.map((n, i) => {
    const pn = (String(n.id || '') ? prevById.get(String(n.id)) : undefined) || prevByTitle.get(String(n.title || '').trim())
    if (pn) claimed.add(pn.id)
    return {
      id: pn?.id || String(n.id || '') || uid('tl'),
      title: String(n.title || '').slice(0, 200) || (pn?.title ?? ''),
      time: n.time !== undefined ? String(n.time).slice(0, 100) : (pn?.time ?? ''),
      sortKey: typeof n.sortKey === 'number' ? n.sortKey : (pn?.sortKey ?? i),
      line: n.line === 'sub' ? ('sub' as const) : n.line === 'main' ? ('main' as const) : (pn?.line ?? ('main' as const)),
      chapters: n.chapters !== undefined || n.chapter !== undefined ? chaptersOf(n) : (pn?.chapters ?? []),
      desc: n.desc !== undefined ? String(n.desc || '') : (pn?.desc ?? ''),
      characters: Array.isArray(n.characters) ? (n.characters as unknown[]).map(String) : (pn?.characters ?? [])
    }
  })
  if (opts?.preserve) {
    for (const pn of prev) if (!claimed.has(pn.id)) out.push(pn)
  }
  return out
}

export function writeTimeline(book: string, nodes: unknown): TimelineNode[] {
  const clean = normalizeTimeline(nodes)
  writeJson(book, TIMELINE_FILE, { nodes: clean })
  return clean
}

/** 供 AI 审阅用的人类可读渲染 */
export function renderTimelineText(nodes: TimelineNode[]): string {
  if (!nodes.length) return '(时间线为空)'
  return [...nodes]
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((n, i) => {
      const parts = [`${i + 1}. [${n.line === 'main' ? '主线' : '支线'}] ${n.time ? `${n.time} · ` : ''}${n.title}`]
      if (n.desc) parts.push(`   说明：${n.desc}`)
      if (n.chapters.length) parts.push(`   绑定章节：${n.chapters.map((c) => c.replace(/^正文\//, '')).join('、')}`)
      if (n.characters.length) parts.push(`   涉及角色：${n.characters.join('、')}`)
      return parts.join('\n')
    })
    .join('\n')
}

// ============ 故事线 / 关系图（同为节点-边图） ============

interface RawGraphNode {
  id?: string
  label?: string
  name?: string
  kind?: string
  role?: string
  main?: boolean
  chapter?: string
  chapters?: unknown[]
  desc?: string
  position?: { x?: number; y?: number }
  x?: number
  y?: number
  data?: { label?: string; kind?: string; main?: boolean; chapter?: string; desc?: string }
}

interface RawGraphEdge {
  id?: string
  source?: string
  target?: string
  label?: string
  relation?: string
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function readStory(book: string): { nodes: StoryNode[]; edges: StoryEdge[] } {
  const data = readJson<{ nodes?: RawGraphNode[]; edges?: RawGraphEdge[] }>(book, STORY_FILE, {})
  const nodes = (data.nodes || []).map((n) => ({
    id: String(n.id || uid('sn')),
    label: String(n.label || n.data?.label || '未命名'),
    kind: String(n.kind || n.data?.kind || 'setup'),
    main: n.main ?? n.data?.main ?? true,
    chapters: chaptersOf(n),
    desc: String(n.desc || n.data?.desc || ''),
    x: num(n.x ?? n.position?.x),
    y: num(n.y ?? n.position?.y)
  }))
  const edges = (data.edges || []).map((e) => ({
    id: String(e.id || uid('se')),
    source: String(e.source || ''),
    target: String(e.target || ''),
    label: String(e.label || '')
  }))
  return { nodes, edges }
}

/**
 * 归一化故事线图。opts.preserve=true（AI 提案路径）：AI 没提到的旧节点/旧连线自动保留并集合并，
 * 防止增量更新时「忘了传」把图清空；面板保存路径不开启，正常增删。
 */
export function normalizeStory(nodes: unknown, edges: unknown, opts?: { preserve?: boolean; prev?: { nodes: StoryNode[]; edges: StoryEdge[] } }): { nodes: StoryNode[]; edges: StoryEdge[] } {
  const list = Array.isArray(nodes) ? (nodes as Record<string, unknown>[]) : []
  const elist = Array.isArray(edges) ? (edges as Record<string, unknown>[]) : []
  const prevNodes = opts?.prev?.nodes || []
  const prevEdges = opts?.prev?.edges || []
  const prevById = new Map(prevNodes.map((n) => [n.id, n]))
  const prevByLabel = new Map(prevNodes.map((n) => [n.label, n]))
  const claimed = new Set<string>()
  const clean = list.map((n, i) => {
    const pn = (String(n.id || '') ? prevById.get(String(n.id)) : undefined) || prevByLabel.get(String(n.label || '').trim())
    if (pn) claimed.add(pn.id)
    return {
      id: pn?.id || String(n.id || '') || uid('sn'),
      label: String(n.label || n.name || '未命名').slice(0, 120),
      kind: STORY_KINDS.includes(String(n.kind) as (typeof STORY_KINDS)[number]) ? String(n.kind) : (pn?.kind && STORY_KINDS.includes(pn.kind as (typeof STORY_KINDS)[number]) ? pn.kind : 'setup'),
      main: n.main === undefined ? (pn?.main ?? true) : !!n.main,
      chapters: n.chapters !== undefined || n.chapter !== undefined ? chaptersOf(n) : (pn?.chapters ?? []),
      desc: String(n.desc || '') || (n.desc === undefined ? (pn?.desc ?? '') : ''),
      x: typeof n.x === 'number' ? n.x : (pn?.x ?? 80 + (i % 4) * 240),
      y: typeof n.y === 'number' ? n.y : (pn?.y ?? 60 + Math.floor(i / 4) * 140)
    }
  })
  // AI 没提到的旧节点自动保留
  if (opts?.preserve) {
    for (const pn of prevNodes) if (!claimed.has(pn.id)) clean.push(pn)
  }
  const ids = new Set(clean.map((n) => n.id))
  // AI 常用节点标题当端点（read_graph 输出的就是标题），按 id → 标题两级解析
  const labelToId = new Map(clean.map((n) => [n.label, n.id]))
  if (opts?.preserve) for (const pn of prevNodes) if (!labelToId.has(pn.label)) labelToId.set(pn.label, pn.id)
  const resolveEndpoint = (v: string): string => (ids.has(v) ? v : labelToId.get(v) || v)
  let eclean = elist
    .map((e) => ({
      id: String(e.id || uid('se')),
      source: resolveEndpoint(String(e.source || '').trim()),
      target: resolveEndpoint(String(e.target || '').trim()),
      label: String(e.label || '')
    }))
    .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
  // AI 旧连线并集保留（AI 漏传/写错端点只会没效果，不会清掉现有连线）
  if (opts?.preserve) {
    const seen = new Set(eclean.map((e) => `${e.source}\u0000${e.target}`))
    for (const pe of prevEdges) {
      if (ids.has(pe.source) && ids.has(pe.target) && !seen.has(`${pe.source}\u0000${pe.target}`)) eclean.push(pe)
    }
  }
  return { nodes: clean, edges: eclean }
}

export function writeStory(book: string, nodes: unknown, edges: unknown): { nodes: StoryNode[]; edges: StoryEdge[] } {
  const clean = normalizeStory(nodes, edges)
  writeJson(book, STORY_FILE, clean)
  return clean
}

export function readCharGraph(book: string): { nodes: CharNode[]; edges: CharEdge[] } {
  const data = readJson<{ nodes?: RawGraphNode[]; edges?: RawGraphEdge[] }>(book, CHAR_GRAPH_FILE, {})
  const nodes = (data.nodes || []).map((n) => ({
    id: String(n.id || uid('cn')),
    name: String(n.name || n.label || n.data?.label || '未命名角色'),
    role: String(n.role || ''),
    x: num(n.x ?? n.position?.x),
    y: num(n.y ?? n.position?.y)
  }))
  const edges = (data.edges || []).map((e) => ({
    id: String(e.id || uid('ce')),
    source: String(e.source || ''),
    target: String(e.target || ''),
    relation: (RELATION_KINDS.includes(e.relation as RelationKind) ? e.relation : 'other') as RelationKind,
    label: String(e.label || '')
  }))
  return { nodes, edges }
}

/**
 * 归一化角色关系图。opts.preserve=true（AI 提案路径）：AI 没提到的旧角色/旧连线自动保留，
 * 防止「忘了传」把图清空；面板保存路径不开启，正常增删。
 */
export function normalizeCharGraph(nodes: unknown, edges: unknown, opts?: { preserve?: boolean; prev?: { nodes: CharNode[]; edges: CharEdge[] } }): { nodes: CharNode[]; edges: CharEdge[] } {
  const list = Array.isArray(nodes) ? (nodes as Record<string, unknown>[]) : []
  const elist = Array.isArray(edges) ? (edges as Record<string, unknown>[]) : []
  const prevNodes = opts?.prev?.nodes || []
  const prevEdges = opts?.prev?.edges || []
  const prevById = new Map(prevNodes.map((n) => [n.id, n]))
  const prevByName = new Map(prevNodes.map((n) => [n.name, n]))
  const claimed = new Set<string>()
  const clean = list.map((n, i) => {
    const pn = (String(n.id || '') ? prevById.get(String(n.id)) : undefined) || prevByName.get(String(n.name || n.label || '').trim())
    if (pn) claimed.add(pn.id)
    return {
      id: pn?.id || String(n.id || '') || uid('cn'),
      name: String(n.name || n.label || '未命名角色').slice(0, 60) || (pn?.name ?? '未命名角色'),
      role: n.role !== undefined ? String(n.role).slice(0, 60) : (pn?.role ?? ''),
      x: typeof n.x === 'number' ? n.x : (pn?.x ?? 80 + (i % 5) * 180),
      y: typeof n.y === 'number' ? n.y : (pn?.y ?? 60 + Math.floor(i / 5) * 120)
    }
  })
  if (opts?.preserve) {
    for (const pn of prevNodes) if (!claimed.has(pn.id)) clean.push(pn)
  }
  const ids = new Set(clean.map((n) => n.id))
  // AI 常用角色名当端点（read_graph 输出的就是名字），按 id → 名字两级解析
  const nameToId = new Map(clean.map((n) => [n.name, n.id]))
  if (opts?.preserve) for (const pn of prevNodes) if (!nameToId.has(pn.name)) nameToId.set(pn.name, pn.id)
  const resolveEndpoint = (v: string): string => (ids.has(v) ? v : nameToId.get(v) || v)
  let eclean = elist
    .map((e) => ({
      id: String(e.id || uid('ce')),
      source: resolveEndpoint(String(e.source || '').trim()),
      target: resolveEndpoint(String(e.target || '').trim()),
      relation: (RELATION_KINDS.includes(e.relation as RelationKind) ? e.relation : 'other') as RelationKind,
      label: String(e.label || '')
    }))
    .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
  if (opts?.preserve) {
    const seen = new Set(eclean.map((e) => `${e.source}\u0000${e.target}`))
    for (const pe of prevEdges) {
      if (ids.has(pe.source) && ids.has(pe.target) && !seen.has(`${pe.source}\u0000${pe.target}`)) eclean.push(pe)
    }
  }
  return { nodes: clean, edges: eclean }
}

export function writeCharGraph(book: string, nodes: unknown, edges: unknown): { nodes: CharNode[]; edges: CharEdge[] } {
  const clean = normalizeCharGraph(nodes, edges)
  writeJson(book, CHAR_GRAPH_FILE, clean)
  return clean
}

export function renderStoryText(nodes: StoryNode[], edges: StoryEdge[]): string {
  if (!nodes.length) return '(故事线为空)'
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const head = nodes.map(
    (n) => `· [${n.main ? '主线' : '支线'}|${n.kind}] ${n.label}${n.chapters.length ? `（${n.chapters.map((c) => c.replace(/^正文\//, '')).join('、')}）` : ''}${n.desc ? ` — ${n.desc}` : ''}`
  )
  const links = edges.map((e) => `→ ${byId.get(e.source)?.label || e.source} ⇒ ${byId.get(e.target)?.label || e.target}${e.label ? `（${e.label}）` : ''}`)
  return [...head, '', '连接：', ...links].join('\n')
}

export function renderCharGraphText(nodes: CharNode[], edges: CharEdge[]): string {
  if (!nodes.length) return '(关系图为空)'
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const head = nodes.map((n) => `· ${n.name}${n.role ? `（${n.role}）` : ''}`)
  const links = edges.map(
    (e) => `→ ${byId.get(e.source)?.name || e.source} ⇄ ${byId.get(e.target)?.name || e.target}【${e.relation}】${e.label}`
  )
  return [...head, '', '关系：', ...links].join('\n')
}

export const STRUCTURED_FILES = {
  timeline: TIMELINE_FILE,
  story: STORY_FILE,
  charGraph: CHAR_GRAPH_FILE,
  dict: '专名词典.json',
  foreshadow: '伏笔登记.json',
  power: '境界体系.json',
  tracking: '出场追踪.json',
  map: '地图.json',
  outline: '细纲.json'
}

// ============ 专名词典（书内圣经）：统一登记专有名词，AI 写作时强制引用防吃书 ============

export interface DictEntry {
  id: string
  /** 专名，如「青云剑诀」 */
  term: string
  /** 类别：人物 / 地点 / 组织势力 / 功法技能 / 物品道具 / 称谓礼仪 / 其他 */
  category: string
  /** 别名、旧称、误写防范 */
  aliases: string[]
  /** 设定说明 */
  desc: string
  /** 首次出场章节（可空） */
  firstChapter: string
}

export const DICT_CATEGORIES = ['人物', '地点', '组织势力', '功法技能', '物品道具', '称谓礼仪', '其他']

export function readDict(book: string): DictEntry[] {
  const data = readJson<{ entries?: DictEntry[] }>(book, STRUCTURED_FILES.dict, {})
  return Array.isArray(data.entries) ? data.entries : []
}

/**
 * 归一化词典。opts.preserve=true（AI 提案路径）：AI 没提到的旧条目自动保留（按 id/词条认领），
 * 防止增量更新时漏传把词典清空；面板保存路径不开启，正常增删。
 */
export function normalizeDict(entries: unknown, opts?: { preserve?: boolean; prev?: DictEntry[] }): DictEntry[] {
  const list = Array.isArray(entries) ? (entries as Record<string, unknown>[]) : []
  const prev = opts?.prev || []
  const prevById = new Map(prev.map((e) => [e.id, e]))
  const prevByTerm = new Map(prev.map((e) => [e.term, e]))
  const claimed = new Set<string>()
  const clean = list
    .map((e) => {
      const pn = (String(e.id || '') ? prevById.get(String(e.id)) : undefined) || prevByTerm.get(String(e.term || '').trim())
      if (pn) claimed.add(pn.id)
      return {
        id: pn?.id || String(e.id || '') || uid('dict'),
        term: String(e.term || '').slice(0, 100) || (pn?.term ?? ''),
        category: DICT_CATEGORIES.includes(String(e.category)) ? String(e.category) : (e.category === undefined ? (pn?.category ?? '其他') : '其他'),
        aliases: Array.isArray(e.aliases) ? (e.aliases as unknown[]).map((x) => String(x).slice(0, 50)).filter(Boolean) : (e.aliases === undefined ? (pn?.aliases ?? []) : []),
        desc: String(e.desc || '').slice(0, 2000) || (e.desc === undefined ? (pn?.desc ?? '') : ''),
        firstChapter: e.firstChapter !== undefined ? String(e.firstChapter || '').slice(0, 100) : (pn?.firstChapter ?? '')
      }
    })
    .filter((e) => e.term.trim())
  if (opts?.preserve) {
    for (const p of prev) if (!claimed.has(p.id)) clean.push(p)
  }
  return clean
}

export function writeDict(book: string, entries: unknown): DictEntry[] {
  const clean = normalizeDict(entries)
  writeJson(book, STRUCTURED_FILES.dict, { entries: clean })
  return clean
}

/** 供 AI 审阅用的人类可读渲染：按类别分组 */
export function renderDictText(entries: DictEntry[]): string {
  if (!entries.length) return '(专名词典为空)'
  const groups = new Map<string, DictEntry[]>()
  for (const e of entries) {
    if (!groups.has(e.category)) groups.set(e.category, [])
    groups.get(e.category)!.push(e)
  }
  const out: string[] = []
  for (const cat of DICT_CATEGORIES) {
    const list = groups.get(cat)
    if (!list?.length) continue
    out.push(`【${cat}】`)
    for (const e of list) {
      const parts = [`· ${e.term}`]
      if (e.aliases.length) parts.push(`（又称：${e.aliases.join('、')}）`)
      if (e.desc) parts.push(`：${e.desc}`)
      if (e.firstChapter) parts.push(`〔首次出场：${e.firstChapter}〕`)
      out.push(parts.join(''))
    }
    out.push('')
  }
  // 兜底：不在预设类别里的条目
  const others = entries.filter((e) => !DICT_CATEGORIES.includes(e.category))
  if (others.length) out.push(`【其他】`, ...others.map((e) => `· ${e.term}：${e.desc}`))
  return out.join('\n').trim()
}

// ============ 伏笔登记板：埋下的钩子统一挂账，回收/作废有据可查 ============

export type ForeshadowStatus = '悬置' | '已收' | '作废'

export interface ForeshadowEntry {
  id: string
  /** 伏笔内容 */
  content: string
  /** 埋设章节 */
  plantChapter: string
  /** 计划回收点（章节 / 时机描述，可空） */
  planRecycle: string
  status: ForeshadowStatus
  note: string
}

export const FORESHADOW_STATUSES: ForeshadowStatus[] = ['悬置', '已收', '作废']

export function readForeshadow(book: string): ForeshadowEntry[] {
  const data = readJson<{ entries?: ForeshadowEntry[] }>(book, STRUCTURED_FILES.foreshadow, {})
  return Array.isArray(data.entries) ? data.entries : []
}

/**
 * 归一化伏笔登记。opts.preserve=true（AI 提案路径）：AI 没提到的旧条目自动保留（按 id/内容认领）；
 * 面板保存路径不开启，正常增删。
 */
export function normalizeForeshadow(entries: unknown, opts?: { preserve?: boolean; prev?: ForeshadowEntry[] }): ForeshadowEntry[] {
  const list = Array.isArray(entries) ? (entries as Record<string, unknown>[]) : []
  const prev = opts?.prev || []
  const prevById = new Map(prev.map((e) => [e.id, e]))
  const prevByContent = new Map(prev.map((e) => [e.content.trim(), e]))
  const claimed = new Set<string>()
  const clean = list
    .map((e) => {
      const pn = (String(e.id || '') ? prevById.get(String(e.id)) : undefined) || prevByContent.get(String(e.content || '').trim())
      if (pn) claimed.add(pn.id)
      return {
        id: pn?.id || String(e.id || '') || uid('fs'),
        content: String(e.content || '').slice(0, 500) || (pn?.content ?? ''),
        plantChapter: e.plantChapter !== undefined ? String(e.plantChapter || '').slice(0, 100) : (pn?.plantChapter ?? ''),
        planRecycle: e.planRecycle !== undefined ? String(e.planRecycle || '').slice(0, 200) : (pn?.planRecycle ?? ''),
        status: (FORESHADOW_STATUSES.includes(String(e.status) as ForeshadowStatus) ? String(e.status) : (pn?.status ?? '悬置')) as ForeshadowStatus,
        note: e.note !== undefined ? String(e.note || '').slice(0, 1000) : (pn?.note ?? '')
      }
    })
    .filter((e) => e.content.trim())
  if (opts?.preserve) {
    for (const p of prev) if (!claimed.has(p.id)) clean.push(p)
  }
  return clean
}

export function writeForeshadow(book: string, entries: unknown): ForeshadowEntry[] {
  const clean = normalizeForeshadow(entries)
  writeJson(book, STRUCTURED_FILES.foreshadow, { entries: clean })
  return clean
}

/** 供 AI 审阅用的人类可读渲染：按状态分组，悬置的排最前 */
export function renderForeshadowText(entries: ForeshadowEntry[]): string {
  if (!entries.length) return '(伏笔登记为空)'
  const out: string[] = []
  for (const st of FORESHADOW_STATUSES) {
    const list = entries.filter((e) => e.status === st)
    if (!list.length) continue
    out.push(`【${st}】`)
    for (const e of list) {
      const parts = [`· ${e.content}`]
      if (e.plantChapter) parts.push(`（埋设：${e.plantChapter}）`)
      if (e.planRecycle) parts.push(`〔计划回收：${e.planRecycle}〕`)
      if (e.note) parts.push(` —— ${e.note}`)
      out.push(parts.join(''))
    }
    out.push('')
  }
  return out.join('\n').trim()
}

// ============ 境界体系板：力量等级 + 越级规则 + 角色当前境界 ============

export interface PowerRealm {
  id: string
  name: string
  /** 排序序号，越小越低阶 */
  sortKey: number
}

export interface PowerChar {
  id: string
  /** 角色名 */
  name: string
  /** 当前境界（对应 realms 里的名称） */
  realm: string
  note: string
}

export interface PowerData {
  realms: PowerRealm[]
  /** 越级 / 战力规则说明 */
  rules: string
  chars: PowerChar[]
}

export function readPower(book: string): PowerData {
  const data = readJson<Partial<PowerData>>(book, STRUCTURED_FILES.power, {})
  return {
    realms: Array.isArray(data.realms) ? data.realms : [],
    rules: String(data.rules || ''),
    chars: Array.isArray(data.chars) ? data.chars : []
  }
}

/**
 * 归一化境界体系。opts.preserve=true（AI 提案路径）：AI 没提到的旧境界/旧角色自动保留（按 id/名称认领），
 * rules 未传则沿用现状；面板保存路径不开启，正常增删。
 */
export function normalizePower(data: unknown, opts?: { preserve?: boolean; prev?: PowerData }): PowerData {
  const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const realms = Array.isArray(raw.realms) ? (raw.realms as Record<string, unknown>[]) : []
  const chars = Array.isArray(raw.chars) ? (raw.chars as Record<string, unknown>[]) : []
  const prev = opts?.prev
  const prevRealms = prev?.realms || []
  const prevChars = prev?.chars || []
  const realmById = new Map(prevRealms.map((r) => [r.id, r]))
  const realmByName = new Map(prevRealms.map((r) => [r.name, r]))
  const claimedRealms = new Set<string>()
  const realmsOut = realms
    .map((r, i) => {
      const pn = (String(r.id || '') ? realmById.get(String(r.id)) : undefined) || realmByName.get(String(r.name || '').trim())
      if (pn) claimedRealms.add(pn.id)
      return {
        id: pn?.id || String(r.id || '') || uid('pr'),
        name: String(r.name || '').slice(0, 60) || (pn?.name ?? ''),
        sortKey: typeof r.sortKey === 'number' ? r.sortKey : (pn?.sortKey ?? i)
      }
    })
    .filter((r) => r.name.trim())
  // AI 没提到的旧境界自动保留，排到末尾
  if (opts?.preserve) {
    for (const p of prevRealms) {
      if (!claimedRealms.has(p.id)) realmsOut.push({ ...p, sortKey: realmsOut.length ? realmsOut[realmsOut.length - 1].sortKey + 1 : 0 })
    }
  }
  const charById = new Map(prevChars.map((c) => [c.id, c]))
  const charByName = new Map(prevChars.map((c) => [c.name, c]))
  const claimedChars = new Set<string>()
  const charsOut = chars
    .map((c) => {
      const pn = (String(c.id || '') ? charById.get(String(c.id)) : undefined) || charByName.get(String(c.name || '').trim())
      if (pn) claimedChars.add(pn.id)
      return {
        id: pn?.id || String(c.id || '') || uid('pc'),
        name: String(c.name || '').slice(0, 60) || (pn?.name ?? ''),
        realm: c.realm !== undefined ? String(c.realm || '').slice(0, 60) : (pn?.realm ?? ''),
        note: c.note !== undefined ? String(c.note || '').slice(0, 500) : (pn?.note ?? '')
      }
    })
    .filter((c) => c.name.trim())
  // AI 没提到的旧角色境界自动保留
  if (opts?.preserve) {
    for (const p of prevChars) if (!claimedChars.has(p.id)) charsOut.push(p)
  }
  return {
    realms: realmsOut
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((r, i) => ({ ...r, sortKey: i })),
    rules: raw.rules !== undefined ? String(raw.rules || '').slice(0, 2000) : (prev?.rules ?? ''),
    chars: charsOut
  }
}

export function writePower(book: string, data: unknown): PowerData {
  const clean = normalizePower(data)
  writeJson(book, STRUCTURED_FILES.power, clean)
  return clean
}

/** 供 AI 审阅用的人类可读渲染：境界从低到高，角色对号入座 */
export function renderPowerText(data: PowerData): string {
  if (!data.realms.length && !data.chars.length) return '(境界体系为空)'
  const out: string[] = []
  if (data.realms.length) {
    out.push(`【境界（低→高）】${data.realms.map((r) => r.name).join(' → ')}`)
    if (data.rules) out.push(`规则：${data.rules}`)
  }
  if (data.chars.length) {
    out.push('', '【角色当前境界】')
    for (const c of data.chars) {
      const parts = [`· ${c.name}：${c.realm || '未定'}`]
      if (c.note) parts.push(`（${c.note}）`)
      out.push(parts.join(''))
    }
  }
  return out.join('\n').trim()
}

// ============ 角色出场追踪板：每个角色最近在哪、什么状态，防失忆防神隐 ============

export type TrackingStatus = '健康' | '受伤' | '闭关' | '离场' | '死亡'

export interface TrackingEntry {
  id: string
  name: string
  status: TrackingStatus
  /** 最近出场章节 */
  lastChapter: string
  /** 当前所在地 */
  location: string
  note: string
}

export const TRACKING_STATUSES: TrackingStatus[] = ['健康', '受伤', '闭关', '离场', '死亡']

export function readTracking(book: string): TrackingEntry[] {
  const data = readJson<{ entries?: TrackingEntry[] }>(book, STRUCTURED_FILES.tracking, {})
  return Array.isArray(data.entries) ? data.entries : []
}

/**
 * 归一化出场追踪。opts.preserve=true（AI 提案路径）：AI 没提到的旧条目自动保留（按 id/角色名认领）；
 * 面板保存路径不开启，正常增删。
 */
export function normalizeTracking(entries: unknown, opts?: { preserve?: boolean; prev?: TrackingEntry[] }): TrackingEntry[] {
  const list = Array.isArray(entries) ? (entries as Record<string, unknown>[]) : []
  const prev = opts?.prev || []
  const prevById = new Map(prev.map((e) => [e.id, e]))
  const prevByName = new Map(prev.map((e) => [e.name, e]))
  const claimed = new Set<string>()
  const clean = list
    .map((e) => {
      const pn = (String(e.id || '') ? prevById.get(String(e.id)) : undefined) || prevByName.get(String(e.name || '').trim())
      if (pn) claimed.add(pn.id)
      return {
        id: pn?.id || String(e.id || '') || uid('tk'),
        name: String(e.name || '').slice(0, 60) || (pn?.name ?? ''),
        status: (TRACKING_STATUSES.includes(String(e.status) as TrackingStatus) ? String(e.status) : (pn?.status ?? '健康')) as TrackingStatus,
        lastChapter: e.lastChapter !== undefined ? String(e.lastChapter || '').slice(0, 100) : (pn?.lastChapter ?? ''),
        location: e.location !== undefined ? String(e.location || '').slice(0, 100) : (pn?.location ?? ''),
        note: e.note !== undefined ? String(e.note || '').slice(0, 500) : (pn?.note ?? '')
      }
    })
    .filter((e) => e.name.trim())
  if (opts?.preserve) {
    for (const p of prev) if (!claimed.has(p.id)) clean.push(p)
  }
  return clean
}

export function writeTracking(book: string, entries: unknown): TrackingEntry[] {
  const clean = normalizeTracking(entries)
  writeJson(book, STRUCTURED_FILES.tracking, { entries: clean })
  return clean
}

/** 供 AI 审阅用的人类可读渲染：按状态分组 */
export function renderTrackingText(entries: TrackingEntry[]): string {
  if (!entries.length) return '(出场追踪为空)'
  const out: string[] = []
  for (const st of TRACKING_STATUSES) {
    const list = entries.filter((e) => e.status === st)
    if (!list.length) continue
    out.push(`【${st}】`)
    for (const e of list) {
      const parts = [`· ${e.name}`]
      if (e.lastChapter) parts.push(`（最近出场：${e.lastChapter}）`)
      if (e.location) parts.push(`〔所在地：${e.location}〕`)
      if (e.note) parts.push(` —— ${e.note}`)
      out.push(parts.join(''))
    }
    out.push('')
  }
  return out.join('\n').trim()
}

// ============ 地图路线图：多张地图（标签页），地点节点+连线，底图存独立图片文件 ============

export type MapNodeStatus = '已写过' | '待写'

export interface MapNode {
  id: string
  label: string
  status: MapNodeStatus
  x: number
  y: number
}

export interface MapEdge {
  id: string
  source: string
  target: string
  label: string
}

export interface MapBase {
  /** draw=手绘 / image=上传图片 / none=无底图 */
  kind: 'draw' | 'image' | 'none'
  /** 底图文件的书内相对路径（设定/地图图/xx.png），kind=none 时为空 */
  path: string
  /** 底图不透明度 0~1 */
  opacity: number
}

export interface BookMap {
  id: string
  name: string
  nodes: MapNode[]
  edges: MapEdge[]
  base: MapBase
}

export function readMaps(book: string): BookMap[] {
  const data = readJson<{ maps?: BookMap[] }>(book, STRUCTURED_FILES.map, {})
  return Array.isArray(data.maps) ? data.maps : []
}

function normalizeMapBase(raw: Record<string, unknown> | undefined): MapBase {
  const kind = raw?.kind === 'draw' || raw?.kind === 'image' ? raw.kind : 'none'
  return {
    kind,
    path: String(raw?.path || ''),
    opacity: typeof raw?.opacity === 'number' ? Math.min(1, Math.max(0.05, raw.opacity)) : 0.5
  }
}

/**
 * 归一化地图数据。
 * - 逐字段与现有数据合并：没传的地图/节点/连线/名称/底图都原样保留，防止 AI 增量更新时把手绘底图、连线、坐标、状态清掉
 * - 节点优先按 id 认亲，没带 id 时按地名认领，保住既有节点的坐标与状态
 * - opts.preserve=true（AI 提案路径）：AI 没提到的整张地图、整批节点也自动保留，AI 无法靠「忘了传」误删数据；面板保存路径不开启，正常增删
 */
export function normalizeMaps(maps: unknown, prev?: BookMap[], opts?: { preserve?: boolean }): BookMap[] {
  const list = Array.isArray(maps) ? (maps as Record<string, unknown>[]) : []
  const prevList = prev || []
  const prevById = new Map(prevList.map((p) => [p.id, p]))
  const claimedMaps = new Set<string>()

  const out = list.map((m, i) => {
    // 认领现有地图：优先按 id，没传 id 时按地图名认领（AI 常忘了带 id）
    let id = String(m.id || '')
    if (!id) {
      const name = String(m.name || '').trim()
      const byName = name ? prevList.find((p) => p.name === name && !claimedMaps.has(p.id)) : undefined
      if (byName) id = byName.id
    }
    if (id) claimedMaps.add(id)
    const pm = prevById.get(id)

    // 节点：整体没传 → 原样保留；传了 → 逐节点按 id/地名合并，缺的字段沿用现状
    const prevNodes = pm?.nodes || []
    const prevNodeById = new Map(prevNodes.map((n) => [n.id, n]))
    const prevNodeByLabel = new Map(prevNodes.map((n) => [n.label, n]))
    const claimedNodes = new Set<string>()
    const claimPrev = (n: Record<string, unknown>): MapNode | undefined => {
      const nid = String(n.id || '')
      const pn = (nid ? prevNodeById.get(nid) : undefined) || prevNodeByLabel.get(String(n.label || '').trim())
      if (pn && !claimedNodes.has(pn.id)) {
        claimedNodes.add(pn.id)
        return pn
      }
      return undefined
    }
    let nodes: MapNode[]
    if (!Array.isArray(m.nodes)) {
      nodes = prevNodes
    } else {
      nodes = (m.nodes as Record<string, unknown>[]).map((n, ni) => {
        const pn = claimPrev(n)
        return {
          id: pn?.id || String(n.id || '') || uid('mn'),
          label: n.label !== undefined ? String(n.label).slice(0, 100) : (pn?.label ?? ''),
          status:
            n.status === '已写过' ? ('已写过' as const) : n.status === '待写' ? ('待写' as const) : (pn?.status ?? '待写'),
          x: typeof n.x === 'number' ? Math.round(n.x) : (pn?.x ?? 80 + (ni % 4) * 200),
          y: typeof n.y === 'number' ? Math.round(n.y) : (pn?.y ?? 60 + Math.floor(ni / 4) * 140)
        }
      })
      // AI 提案路径：没提到的旧节点自动保留，防止「忘了传」把节点删没
      if (opts?.preserve) {
        for (const pn of prevNodes) if (!claimedNodes.has(pn.id)) nodes.push(pn)
      }
    }

    // 连线：整体没传 → 原样保留（过滤掉已不存在的端点）；传了 → 照常归一化
    const ids = new Set(nodes.map((n) => n.id))
    // AI 常用地名当端点（read_map 输出的就是地名），这里按 id → 地名两级解析
    const labelToId = new Map(nodes.map((n) => [n.label, n.id]))
    const resolveEndpoint = (v: string): string => (ids.has(v) ? v : labelToId.get(v) || v)
    let edges = (
      Array.isArray(m.edges) ? (m.edges as Record<string, unknown>[]) : (opts?.preserve ? (pm?.edges || []) : [])
    )
      .map((e) => ({
        id: String(e.id || uid('me')),
        source: resolveEndpoint(String(e.source || '').trim()),
        target: resolveEndpoint(String(e.target || '').trim()),
        label: String(e.label || '').slice(0, 60)
      }))
      .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
    // AI 提案路径：连线做并集合并（按 source+target 去重，AI 新传的覆盖旧 label）——
    // AI 端点写错、漏抄都只会「没效果」，绝不会把现有连线清掉；删线请在地图页手动操作
    if (opts?.preserve && pm?.edges.length) {
      const seen = new Set(edges.map((e) => `${e.source}\u0000${e.target}`))
      for (const pe of pm.edges) {
        if (ids.has(pe.source) && ids.has(pe.target) && !seen.has(`${pe.source}\u0000${pe.target}`)) edges.push(pe)
      }
    }

    // 未显式传 base（如 AI 提案只改节点）时沿用原有底图，防止把手绘/上传的底图静默清掉
    const fallbackBase = m.base === undefined ? pm?.base : undefined
    return {
      id: id || uid('map'),
      name: m.name !== undefined ? String(m.name).slice(0, 40) : (pm?.name ?? `地图 ${i + 1}`),
      nodes,
      edges,
      base: fallbackBase ?? normalizeMapBase(m.base as Record<string, unknown> | undefined)
    }
  })

  // AI 提案路径：没提到的整张地图自动保留
  if (opts?.preserve) {
    for (const p of prevList) if (!claimedMaps.has(p.id)) out.push(p)
  }
  return out
}

export function writeMaps(book: string, maps: unknown): BookMap[] {
  const clean = normalizeMaps(maps, readMaps(book))
  writeJson(book, STRUCTURED_FILES.map, { maps: clean })
  return clean
}

/** 供 AI 审阅用的人类可读渲染 */
export function renderMapsText(maps: BookMap[]): string {
  if (!maps.length) return '(地图为空)'
  const out: string[] = []
  for (const m of maps) {
    out.push(`【${m.name}】`)
    if (m.base.kind !== 'none') out.push(`底图：${m.base.kind} ${m.base.path}（浓度 ${m.base.opacity}）`)
    for (const n of m.nodes) out.push(`· ${n.label}〔${n.status}〕（坐标 ${n.x},${n.y}）`)
    const byId = new Map(m.nodes.map((n) => [n.id, n]))
    for (const e of m.edges) {
      out.push(`→ ${byId.get(e.source)?.label || e.source} ⇄ ${byId.get(e.target)?.label || e.target}${e.label ? `（${e.label}）` : ''}`)
    }
    out.push('')
  }
  return out.join('\n').trim()
}

// ============ 卷/章细纲板：每章一句话细纲+完成状态，全局看节奏 ============

export interface OutlineEntry {
  id: string
  /** 卷名（可空 = 未分卷） */
  vol: string
  /** 章节序号 */
  no: number
  /** 章节标题 */
  title: string
  /** 一句话细纲 */
  beat: string
  /** 全文细纲存档（智能体或工作流落盘的完整细纲；逐章生文检测到就直接采用，不再重新构思） */
  beatFull?: string
  status: '待写' | '已写'
}

export function readOutline(book: string): OutlineEntry[] {
  const data = readJson<{ entries?: OutlineEntry[] }>(book, STRUCTURED_FILES.outline, {})
  return Array.isArray(data.entries) ? data.entries : []
}

/**
 * 归一化细纲。opts.preserve=true（AI 提案路径）：AI 没提到的旧章自动保留（按 id/章序号认领）；
 * 面板保存路径不开启，正常增删。
 */
export function normalizeOutline(entries: unknown, opts?: { preserve?: boolean; prev?: OutlineEntry[] }): OutlineEntry[] {
  const list = Array.isArray(entries) ? (entries as Record<string, unknown>[]) : []
  const prev = opts?.prev || []
  const prevById = new Map(prev.map((e) => [e.id, e]))
  const prevByNo = new Map(prev.filter((e) => e.no > 0).map((e) => [e.no, e]))
  const claimed = new Set<string>()
  const clean = list
    .map((e) => {
      const no = typeof e.no === 'number' && Number.isFinite(e.no) ? Math.max(1, Math.floor(e.no)) : 0
      const pn = (String(e.id || '') ? prevById.get(String(e.id)) : undefined) || (no ? prevByNo.get(no) : undefined)
      if (pn) claimed.add(pn.id)
      return {
        id: pn?.id || String(e.id || '') || uid('ol'),
        vol: e.vol !== undefined ? String(e.vol || '').slice(0, 60) : (pn?.vol ?? ''),
        no: no || (pn?.no ?? 1),
        title: e.title !== undefined ? String(e.title || '').slice(0, 120) : (pn?.title ?? ''),
        beat: String(e.beat || '').slice(0, 1000) || (e.beat === undefined ? (pn?.beat ?? '') : ''),
        beatFull: e.beatFull !== undefined ? String(e.beatFull || '').slice(0, 12000) || undefined : pn?.beatFull,
        status: e.status === '已写' ? ('已写' as const) : e.status === '待写' ? ('待写' as const) : (pn?.status ?? ('待写' as const))
      }
    })
    .filter((e) => e.beat.trim() || e.title.trim())
  if (opts?.preserve) {
    for (const p of prev) if (!claimed.has(p.id)) clean.push(p)
  }
  return clean
    .sort((a, b) => (a.vol === b.vol ? a.no - b.no : a.vol.localeCompare(b.vol, 'zh')))
}

export function writeOutline(book: string, entries: unknown): OutlineEntry[] {
  // prev 只用于字段回退（如 beatFull 在面板编辑时兜底保留），不开启 preserve——面板保存允许正常增删
  const clean = normalizeOutline(entries, { prev: readOutline(book) })
  writeJson(book, STRUCTURED_FILES.outline, { entries: clean })
  return clean
}

// ============ 建书工作流自动登记：角色卡/世界观提取结果一次性并入结构化板块（生成即同步） ============

/** 工作流提取产物（AI 输出的 JSON 解析结果，字段全部可选、形状宽松） */
export interface WorkflowExtract {
  dict?: unknown[]
  power?: { realms?: unknown[]; rules?: string; chars?: unknown[] }
  maps?: unknown[]
  graph?: { nodes?: unknown[]; edges?: unknown[] }
}

/** 以 preserve 增量合并写入：没提到的现有条目自动保留；有变化才落盘。返回各板块条目数供前端汇报 */
export function registerWorkflowStructure(book: string, data: WorkflowExtract): Record<string, number> {
  const result: Record<string, number> = { dict: -1, realms: -1, mapNodes: -1, graphNodes: -1 }

  if (Array.isArray(data.dict) && data.dict.length) {
    const prev = readDict(book)
    const merged = normalizeDict(data.dict, { preserve: true, prev })
    if (prev.length !== merged.length || renderDictText(prev) !== renderDictText(merged)) {
      writeJson(book, STRUCTURED_FILES.dict, { entries: merged })
    }
    result.dict = merged.length
  }

  if (data.power && (Array.isArray(data.power.realms) || data.power.rules)) {
    const prev = readPower(book)
    // 宽松容错：AI 直接给境界名字符串数组时转成对象
    const realms = Array.isArray(data.power.realms) ? data.power.realms.map((r) => (typeof r === 'string' ? { name: r } : r)) : undefined
    const merged = normalizePower({ realms, rules: data.power.rules, chars: data.power.chars }, { preserve: true, prev })
    if (renderPowerText(prev) !== renderPowerText(merged)) {
      writeJson(book, STRUCTURED_FILES.power, merged)
    }
    result.realms = merged.realms.length
  }

  if (Array.isArray(data.maps) && data.maps.length) {
    const prev = readMaps(book)
    const merged = normalizeMaps(data.maps, prev, { preserve: true })
    if (prev.length !== merged.length || renderMapsText(prev) !== renderMapsText(merged)) {
      writeJson(book, STRUCTURED_FILES.map, { maps: merged })
    }
    result.mapNodes = merged.reduce((n, m) => n + (m.nodes?.length || 0), 0)
  }

  if (data.graph && Array.isArray(data.graph.nodes) && data.graph.nodes.length) {
    const prev = readCharGraph(book)
    const merged = normalizeCharGraph(data.graph.nodes, data.graph.edges, { preserve: true, prev })
    if (renderCharGraphText(prev.nodes, prev.edges) !== renderCharGraphText(merged.nodes, merged.edges)) {
      writeJson(book, STRUCTURED_FILES.charGraph, merged)
    }
    result.graphNodes = merged.nodes.length
    result.graphEdges = merged.edges.length
  }

  return result
}

/** 按 no 覆盖或新增一条（工作流逐章生成时调用，幂等） */
export function upsertOutline(
  book: string,
  patch: { vol?: string; no: number; title?: string; beat?: string; beatFull?: string; status?: '待写' | '已写' }
): OutlineEntry[] {
  const entries = readOutline(book)
  const idx = entries.findIndex((e) => e.no === patch.no)
  if (idx >= 0) {
    const cur = entries[idx]
    entries[idx] = {
      ...cur,
      vol: patch.vol ?? cur.vol,
      title: patch.title ?? cur.title,
      beat: patch.beat ?? cur.beat,
      beatFull: patch.beatFull !== undefined ? patch.beatFull || undefined : cur.beatFull,
      status: patch.status ?? cur.status
    }
  } else {
    entries.push({
      id: uid('ol'),
      vol: patch.vol || '',
      no: patch.no,
      title: patch.title || `第${patch.no}章`,
      beat: patch.beat || '',
      beatFull: patch.beatFull || undefined,
      status: patch.status || '待写'
    })
  }
  return writeOutline(book, entries)
}

/** 更新某章完成状态（逐章生文完成时调用） */
export function setOutlineStatus(book: string, no: number, status: '待写' | '已写'): OutlineEntry[] {
  const entries = readOutline(book)
  const idx = entries.findIndex((e) => e.no === no)
  if (idx >= 0) entries[idx] = { ...entries[idx], status }
  return writeOutline(book, entries)
}

/** 供 AI 审阅用的人类可读渲染：按卷分组 */
export function renderOutlineText(entries: OutlineEntry[]): string {
  if (!entries.length) return '(细纲为空)'
  const out: string[] = []
  let curVol: string | null = null
  for (const e of entries) {
    if (e.vol !== curVol) {
      curVol = e.vol
      out.push(`【${e.vol || '未分卷'}】`)
    }
    const head = `${e.no}. ${e.title || `第${e.no}章`}〔${e.status}〕${e.beatFull ? '〔有全文存档〕' : ''}`
    out.push(e.beat ? `${head}：${e.beat}` : head)
  }
  return out.join('\n').trim()
}