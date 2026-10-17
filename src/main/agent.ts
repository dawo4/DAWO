import { BrowserWindow } from 'electron'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, normalize, sep, posix } from 'path'
import { getConfig, TaskCfg, Provider } from './lib/config'
import { getPrompt } from './lib/prompts'
import * as panels from './lib/panels'
import * as memory from './lib/memory'
import { toolSchemasFor } from './lib/agents'
import { resolveAgent, ResolvedAgent, listRoster } from './lib/customAgents'
import { webSearch, readWebpage, providerSearchPatch } from './lib/websearch'
import { computeDiff, DiffHunk } from './lib/diff'
import { readBookMeta, listTree, writeTextFile, getLibraryRoot, readTextFile, TreeNode } from './lib/library'
import { listLibrary, readEntry, writeEntry, readEntriesForContext, LibKind, LIB_LABEL } from './lib/materials'
import { estimateTokens, recordCall } from './lib/ailog'
import { semanticForPrompt } from './lib/vectors'
import {
  STRUCTURED_FILES,
  normalizeCharGraph,
  normalizeDict,
  normalizeForeshadow,
  normalizeMaps,
  normalizeOutline,
  normalizePower,
  normalizeStory,
  normalizeTimeline,
  normalizeTracking,
  readCharGraph,
  readDict,
  readForeshadow,
  readMaps,
  readOutline,
  readPower,
  readStory,
  readTimeline,
  readTracking,
  renderCharGraphText,
  renderDictText,
  renderForeshadowText,
  renderMapsText,
  renderOutlineText,
  renderPowerText,
  renderStoryText,
  renderTimelineText,
  renderTrackingText
} from './lib/structured'

export interface EditProposal {
  id: string
  runId: string
  book: string
  target: string
  summary: string
  baseContent: string
  newContent: string
  hunks: DiffHunk[]
  additions: number
  deletions: number
  truncated: boolean
  status: 'pending' | 'accepting' | 'accepted' | 'rejected' | 'conflict' | 'error'
  message: string
  approvalMode: 'manual' | 'auto-approve'
  createdAt: string
}

export interface ToolTrace {
  id: string
  name: string
  args: string
  ok: boolean
  result: string
  durationMs: number
  requestedAt: string
}

const proposals = new Map<string, EditProposal>()
const runs = new Map<string, AbortController>()
/** 每次 run 累计输出的字符数（用于用量估算） */
const runOutputs = new Map<string, number>()

export function abortAgentRun(runId: string): void {
  runs.get(runId)?.abort()
}

export function getProposal(id: string): EditProposal | undefined {
  return proposals.get(id)
}

export function allProposals(): EditProposal[] {
  return [...proposals.values()]
}

function send(win: BrowserWindow, runId: string, type: string, payload?: unknown): void {
  if (!win.isDestroyed()) win.webContents.send('agent:event', { runId, type, payload })
}

// ============ 工具实现 ============

interface ToolCtx {
  win: BrowserWindow
  runId: string
  book: string
  scope: string[]
  approvalMode: 'manual' | 'auto-approve'
  /** 自定义智能体的库权限；省略 = 不限制（内置智能体） */
  libsRead?: LibKind[]
  libsWrite?: boolean
  /** 分配模式：可作为主智能体 dispatch 子智能体 */
  orchestrator?: boolean
  /** 调用深度：0 = 主智能体；子智能体不能再分配（防止套娃） */
  depth?: number
  /** 自定义面板（list 原型）读写授权（面板名）；省略 = 全部允许，空数组 = 全部禁止 */
  panelBoards?: string[]
  /** 结构化板块授权（自定义智能体）；省略 = 内置智能体不限 */
  structBoards?: string[]
}

type ToolResult = { ok: boolean; content: string; proposal?: EditProposal }

function inScope(scope: string[], rel: string): boolean {
  if (!scope.length) return true
  const top = rel.split(/[\\/]/)[0]
  return scope.includes(top) || !rel.includes('/')
}

function flattenTree(nodes: TreeNode[], prefix = ''): string[] {
  const out: string[] = []
  for (const n of nodes) {
    const p = prefix ? `${prefix}/${n.name}` : n.name
    if (n.dir) out.push(`[目录] ${p}/`, ...flattenTree(n.children || [], p))
    else out.push(`       ${p}`)
  }
  return out
}

function walkFiles(book: string, rel = ''): string[] {
  const out: string[] = []
  const base = rel ? join(getLibraryRoot(), book, rel) : join(getLibraryRoot(), book)
  if (!existsSync(base)) return out
  for (const name of readdirSync(base)) {
    if (name === '.inkdesk' || name === 'book.json') continue
    const p = join(base, name)
    let isDir = false
    try {
      isDir = statSync(p).isDirectory()
    } catch {
      continue
    }
    const next = rel ? `${rel}/${name}` : name
    if (isDir) out.push(...walkFiles(book, next))
    // 只搜 Markdown：结构化数据（时间线/故事线/关系图等 .json）由专门工具读取，不进全文检索
    else if (name.endsWith('.md')) out.push(next)
  }
  return out
}

function safeBookPath(book: string, rel: string): void {
  const base = normalize(join(getLibraryRoot(), book))
  const full = normalize(join(base, rel))
  if (full !== base && !full.startsWith(base + sep)) throw new Error('非法路径')
}

/**
 * 统一生成修改提案。
 * diffOld/diffNew 用来把结构化数据（JSON）渲染成人类可读文本后再做差异，
 * 这样审阅卡片里看到的是「节点/关系」的变化，而不是一堆 JSON 括号。
 * 而 baseContent/newContent 仍是真实文件内容，用于冲突检测与实际落盘。
 */
function makeProposal(
  ctx: ToolCtx,
  rel: string,
  baseContent: string,
  newContent: string,
  summary: string,
  diffOld?: string,
  diffNew?: string,
  unit?: string
): ToolResult {
  const diff = computeDiff(diffOld ?? baseContent, diffNew ?? newContent)
  const proposal: EditProposal = {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId: ctx.runId,
    book: ctx.book,
    target: rel,
    summary,
    baseContent,
    newContent,
    hunks: diff.hunks,
    additions: diff.additions,
    deletions: diff.deletions,
    truncated: diff.truncated,
    status: 'pending',
    message: '',
    approvalMode: ctx.approvalMode,
    createdAt: new Date().toISOString()
  }
  proposals.set(proposal.id, proposal)
  send(ctx.win, ctx.runId, 'proposal', proposal)
  const extra =
    ctx.approvalMode === 'auto-approve'
      ? '提案已提交，处于自动批准模式，将由系统保存。'
      : '提案已提交，等待作者在界面上审阅决定是否接受。'
  const scope = unit ? `（${unit}）` : ''
  return {
    ok: true,
    content: `已生成对「${rel}」的修改提案${scope}（+${diff.additions} −${diff.deletions}）。${extra}`,
    proposal
  }
}

// ============ 资源库入库提案 ============
// 智能体写资源库不再直接落盘：先提交提案，作者在界面上确认后才写入。

/**
 * 手工创建提案（非智能体工具路径）：批量修订管道复用同一提案存储与 applyProposal/rejectProposal IPC。
 */
export function createManualProposal(
  win: BrowserWindow,
  runId: string,
  book: string,
  rel: string,
  baseContent: string,
  newContent: string,
  summary: string
): EditProposal {
  const ctx: ToolCtx = { win, runId, book, scope: [], approvalMode: 'manual' }
  const r = makeProposal(ctx, rel, baseContent, newContent, summary)
  return r.proposal as EditProposal
}

/** 把工具的 library 参数解析为 LibKind（含灵感便签） */
export function asLibKind(v: unknown): LibKind {
  const s = String(v || 'materials')
  return s === 'skills' || s === 'notes' ? (s as LibKind) : 'materials'
}

export interface LibProposalItem {
  library: LibKind
  group: string
  name: string
  summary: string
  tags: string[]
  content: string
  /** 库中已存在同名条目（入库即覆盖） */
  exists: boolean
}

export interface LibProposal {
  id: string
  runId: string
  book: string
  items: LibProposalItem[]
  summary: string
  status: 'pending' | 'applied' | 'rejected' | 'error'
  /** 已入库条目的 key（`library/group/name`），支持逐条勾选分批入库 */
  appliedKeys: string[]
  message: string
  createdAt: string
}

/** 条目在提案中的唯一 key */
export function libItemKey(i: { library: string; group: string; name: string }): string {
  return `${i.library}/${i.group}/${i.name}`
}

const libProposals = new Map<string, LibProposal>()

// ============ 分配模式：子智能体调用（每次需作者确认，自动批准模式除外） ============

interface SubagentDecision {
  resolve: (allow: boolean) => void
}
const subagentDecisions = new Map<string, SubagentDecision>()

/** 作者在询问卡上点了允许 / 拒绝 */
export function decideSubagent(id: string, allow: boolean): { ok: boolean; message: string } {
  const d = subagentDecisions.get(id)
  if (!d) return { ok: false, message: '该请求不存在或已处理' }
  subagentDecisions.delete(id)
  d.resolve(allow)
  return { ok: true, message: allow ? '已允许执行' : '已拒绝' }
}

function waitForDecision(id: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (v: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      subagentDecisions.delete(id)
      resolve(v)
    }
    const timer = setTimeout(() => finish(false), 10 * 60 * 1000) // 10 分钟无人处理视为拒绝，防 run 永久挂起
    const d: SubagentDecision = { resolve: finish }
    subagentDecisions.set(id, d)
    const onAbort = (): void => finish(false)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 合并外部中止信号与超时信号：任一触发即中止（子智能体请求用） */
function runSignal(external: AbortSignal | undefined, ms: number): AbortSignal {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error('子任务超时')), ms)
  const onExt = (): void => ac.abort((external as AbortSignal).reason ?? new Error('已中止'))
  if (external) {
    if (external.aborted) onExt()
    else external.addEventListener('abort', onExt, { once: true })
  }
  ac.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  return ac.signal
}

export function getLibProposal(id: string): LibProposal | undefined {
  return libProposals.get(id)
}

function submitLibProposal(ctx: ToolCtx, rawItems: Record<string, unknown>[], summary: string): ToolResult {
  const items: LibProposalItem[] = []
  for (const raw of rawItems) {
    const library = asLibKind(raw.library)
    const group = String(raw.group || '通用')
    const name = String(raw.name || '').trim()
    const content = String(raw.content || '')
    if (!name || !content.trim()) continue
    const tags = Array.isArray(raw.tags) ? (raw.tags as unknown[]).map(String) : []
    const existing = readEntry(library, group, name)
    items.push({
      library,
      group,
      name,
      summary: String(raw.summary || ''),
      tags,
      content,
      exists: !!existing.body.trim()
    })
  }
  if (!items.length) return { ok: false, content: '没有可入库的有效条目（name 与 content 不能为空）。' }

  const proposal: LibProposal = {
    id: `lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId: ctx.runId,
    book: ctx.book,
    items,
    summary: summary || `入库 ${items.length} 个条目`,
    status: 'pending',
    appliedKeys: [],
    message: '',
    createdAt: new Date().toISOString()
  }
  libProposals.set(proposal.id, proposal)
  send(ctx.win, ctx.runId, 'lib_proposal', proposal)

  const list = items
    .map((i) => `${LIB_LABEL[i.library]}·${i.group}/${i.name}${i.exists ? '（将覆盖同名条目）' : ''}`)
    .join('；')
  return {
    ok: true,
    content: `已提交入库提案（${items.length} 条）：${list}。需作者在界面上确认后才会写入，请不要重复提交同样的内容。`
  }
}

/** 作者确认入库；onlyKeys 省略则入库全部未入库的条目 */
export function applyLibProposal(id: string, onlyKeys?: string[]): { ok: boolean; status: string; message: string } {
  const p = libProposals.get(id)
  if (!p) return { ok: false, status: 'error', message: '提案不存在或已失效' }
  if (p.status !== 'pending') return { ok: false, status: p.status, message: '该提案已处理' }
  const pending = p.items.filter((i) => !p.appliedKeys.includes(libItemKey(i)))
  const targets = onlyKeys && onlyKeys.length ? pending.filter((i) => onlyKeys.includes(libItemKey(i))) : pending
  if (!targets.length) return { ok: false, status: 'pending', message: '没有可入库的条目' }
  try {
    for (const it of targets) {
      writeEntry(it.library, it.group, it.name, it.summary, it.tags, it.content)
      p.appliedKeys.push(libItemKey(it))
    }
    const left = p.items.length - p.appliedKeys.length
    p.status = left > 0 ? 'pending' : 'applied'
    p.message = left > 0 ? `已入库 ${targets.length} 个条目，还有 ${left} 个待确认` : `已全部入库（${p.items.length} 个条目）`
    return { ok: true, status: 'applied', message: p.message }
  } catch (e) {
    p.status = 'error'
    p.message = `入库失败：${(e as Error).message}`
    return { ok: false, status: 'error', message: p.message }
  }
}

export function rejectLibProposal(id: string): { ok: boolean; message: string } {
  const p = libProposals.get(id)
  if (!p) return { ok: false, message: '提案不存在或已失效' }
  p.status = 'rejected'
  p.message = '已丢弃，未写入资源库'
  return { ok: true, message: p.message }
}

/** 子智能体独立执行一项任务（非流式、不能再分配），返回最终文本汇报 */
async function runSubAgent(
  win: BrowserWindow,
  parentRunId: string,
  requestId: string,
  book: string,
  sub: ResolvedAgent,
  task: string,
  externalSignal?: AbortSignal,
  approvalMode: 'manual' | 'auto-approve' = 'auto-approve'
): Promise<string> {
  const cfg = getConfig()
  const taskCfg: TaskCfg = { ...(cfg.tasks?.agent || ({} as TaskCfg)) }
  // 子智能体同样尊重智能体级模型分配（在智能体库里单独指定过的用指定模型）
  const subModel = cfg.agentModels?.[sub.id]
  if (subModel?.providerId) taskCfg.providerId = subModel.providerId
  if (subModel?.model) taskCfg.model = subModel.model
  const provider = cfg.providers.find((p) => p.id === taskCfg.providerId)
  if (!provider || !taskCfg.model) throw new Error('未配置智能体模型，无法执行子任务')
  const subParams: AgentRunParams = {
    runId: `sub-${parentRunId}`,
    book,
    agentId: sub.id,
    approvalMode: 'auto-approve',
    history: [{ role: 'user', content: task }]
  }
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: buildSystemPrompt(subParams, sub) },
    { role: 'user', content: task }
  ]
  const tools = toolSchemasFor({
    webSearch: sub.webSearch,
    libsRead: sub.custom ? sub.libsRead : undefined,
    libsWrite: sub.libsWrite,
    orchestrator: false,
    structBoards: sub.custom ? sub.structBoards : undefined,
    panelBoards: sub.custom ? sub.panelBoards : undefined
  })
  const subCtx: ToolCtx = {
    win,
    runId: parentRunId,
    book,
    scope: sub.readScope,
    // 沿用主会话的审阅模式：手动模式下子智能体的改动同样要过作者审阅，不能悄悄落盘
    approvalMode,
    ...(sub.custom ? { libsRead: sub.libsRead, libsWrite: sub.libsWrite } : {}),
    ...(sub.custom ? { panelBoards: sub.panelBoards } : {}),
    orchestrator: false,
    depth: 1
  }
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

  let lastText = ''
  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: taskCfg.model, temperature: taskCfg.temperature, stream: false, tools, messages }),
      signal: runSignal(externalSignal, 240000)
    })
    if (!res.ok) throw new Error(`接口返回 ${res.status}`)
    const json = (await res.json()) as {
      choices?: { message?: { content?: string; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[]
    }
    const msg = json.choices?.[0]?.message || {}
    const content = typeof msg.content === 'string' ? msg.content : ''
    const calls = msg.tool_calls || []
    if (content) {
      lastText = content
      // 实时展示子智能体的产出（询问卡的输出区）
      send(win, parentRunId, 'subagent_delta', { id: requestId, text: content })
    }
    if (!calls.length) return content || lastText
    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: calls.map((c, i) => ({
        id: c.id || `sub_${turn}_${i}`,
        type: 'function',
        function: { name: c.function?.name, arguments: c.function?.arguments || '{}' }
      }))
    })
    for (const c of calls) {
      let result: ToolResult
      try {
        result = await executeTool(c.function?.name || '', c.function?.arguments || '', subCtx)
      } catch (e) {
        result = { ok: false, content: `工具执行失败：${(e as Error).message}` }
      }
      messages.push({
        role: 'tool',
        tool_call_id: c.id || `sub_${turn}_${c.function?.name}`,
        content: result.content
      })
    }
  }
  return lastText || '（子智能体未产出结果）'
}

async function executeTool(name: string, rawArgs: string, ctx: ToolCtx): Promise<ToolResult> {
  let args: Record<string, unknown> = {}
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
  } catch {
    return { ok: false, content: '参数不是合法 JSON，请检查后重试。' }
  }

  /** 库权限：自定义智能体只能访问授权的库 */
  const libDenied = (kind: LibKind): boolean => !!ctx.libsRead && !ctx.libsRead.includes(kind)
  const denyMsg = (label: string) => `当前智能体没有被授予「${label}」的访问权限。`
  /** 自定义面板权限：内置智能体不限；自定义智能体 = 内置板块至少一个 或 面板授权至少一个 */
  const panelDenied = (): boolean =>
    !!ctx.structBoards && ctx.structBoards.length === 0 && (!ctx.panelBoards || ctx.panelBoards.length === 0)
  /** 单个自定义面板授权检查：panelBoards 省略 = 全部允许 */
  const panelAllowed = (name: string): boolean => !ctx.panelBoards || ctx.panelBoards.includes(name)
  /** 面板引用容错：模型偶尔会把 panel 传成对象（{name:...}/{id:...}），取其中公共键兜底 */
  const panelRefOf = (v: unknown): string => {
    if (typeof v === 'string') return v.trim()
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      for (const k of ['name', 'panel', 'id', 'title']) {
        const s = o[k]
        if (typeof s === 'string' && s.trim()) return s.trim()
      }
      return JSON.stringify(v).slice(0, 40)
    }
    return String(v ?? '').trim()
  }

  switch (name) {
    case 'read_memory': {
      const scope = args.scope === 'global' || args.scope === 'book' ? args.scope : 'both'
      const gList = memory.readGlobalEntries()
      const bList = memory.readBookEntries(ctx.book)
      const renderList = (label, list) =>
        `—— ${label}（共 ${list.length} 条）——\n` +
        (list.length ? list.map((e) => `· [${e.id}]${e.category ? `(${e.category})` : ''} ${e.text}`).join('\n') : '（空）')
      if (scope === 'global') return { ok: true, content: renderList('全局记忆（跨书通用）', gList) }
      if (scope === 'book') return { ok: true, content: renderList('本书记忆', bList) }
      return { ok: true, content: `${renderList('全局记忆（跨书通用）', gList)}\n\n${renderList('本书记忆', bList)}` }
    }

    case 'write_memory': {
      const scope = String(args.scope || '')
      const text = String(args.text || '').trim().slice(0, 500)
      const category = String(args.category || '').trim().slice(0, 20)
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      if (scope !== 'global' && scope !== 'book') return { ok: false, content: 'scope 必须是 global（全局）或 book（本书）。' }
      if (!text) return { ok: false, content: 'text 不能为空：一条记忆一句话，写具体结论。' }
      const isGlobal = scope === 'global'
      const entries = isGlobal ? memory.readGlobalEntries() : memory.readBookEntries(ctx.book)
      let added = false
      if (id) {
        const target = entries.find((e) => e.id === id)
        if (!target) return { ok: false, content: `记忆条目不存在：${id}。先用 read_memory 查看现有条目与 id。` }
        target.text = text
        if (category) target.category = category
      } else {
        if (entries.some((e) => e.text === text)) return { ok: true, content: '这条记忆已存在（文本完全相同），无需重复写入。' }
        entries.unshift({ id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, text, category, createdAt: new Date().toISOString() })
        added = true
      }
      const summary = `${added ? '新增' : '更新'}${isGlobal ? '全局' : '书籍'}记忆：${text.slice(0, 30)}`
      const renderList = (list) => list.map((e) => `· [${e.id}]${e.category ? `(${e.category})` : ''} ${e.text}`).join('\n')
      if (isGlobal) {
        // 全局记忆不在书目录内，走不了提案通道：直写，设置→记忆 随时可查可改
        memory.writeGlobalEntries(entries)
        return { ok: true, content: `已${added ? '新增' : '更新'}全局记忆条目。作者可在「设置 → 记忆」中查看。` }
      }
      const before = memory.readBookEntries(ctx.book)
      if (JSON.stringify(before) === JSON.stringify(entries)) return { ok: true, content: '记忆与现状一致，无需修改。' }
      return makeProposal(ctx, join('记忆', '记忆.json'), JSON.stringify({ entries: before }, null, 2), JSON.stringify({ entries }, null, 2), summary, renderList(before), renderList(entries), `${entries.length} 条`)
    }

    case 'read_panel': {
      if (panelDenied()) return { ok: false, content: '当前智能体没有被授予任何面板访问权限，无法读取自定义面板。' }
      const panelRef = panelRefOf(args.panel)
      const customs = panels.listPanels(ctx.book).filter((p) => !p.board)
      const inst = customs.find((p) => p.name === panelRef || p.id === panelRef)
      if (!inst) {
        return {
          ok: false,
          content: `自定义面板不存在：${panelRef}。可用面板：${customs.map((p) => p.name).join('、') || '（本书还没有自定义面板）'}。内置板块（词典/境界/地图等）请用各自专用工具。`
        }
      }
      const entries = panels.readPanelData(ctx.book, inst.id).entries as Record<string, unknown>[]
      if (!panelAllowed(inst.name)) return { ok: false, content: `当前智能体没有被授权访问自定义面板「${inst.name}」。` }
      return { ok: true, content: panels.renderPanelEntries(inst, entries as never) }
    }

    case 'write_panel': {
      if (panelDenied()) return { ok: false, content: '当前智能体没有被授予任何面板访问权限，无法写入自定义面板。' }
      const name = panelRefOf(args.panel)
      const customs = panels.listPanels(ctx.book).filter((p) => !p.board)
      const found = customs.find((p) => p.name === name || p.id === name)
      if (!found) {
        return { ok: false, content: `自定义面板不存在：${name}。可用面板：${customs.map((p) => p.name).join('、') || '（本书还没有自定义面板）'}。内置板块请用各自专用写入工具。` }
      }
      if (!Array.isArray(args.entries)) return { ok: false, content: 'entries 必须是数组。' }
      if (!panelAllowed(found.name)) return { ok: false, content: `当前智能体没有被授权写入自定义面板「${found.name}」。` }
      const { inst, before, after } = panels.mergePanelEntries(ctx.book, name, args.entries)
      const summary = String(args.summary || '').trim() || `更新自定义面板「${inst.name}」`
      const beforeText = panels.renderPanelEntries(inst, before)
      const afterText = panels.renderPanelEntries(inst, after)
      if (beforeText === afterText) return { ok: true, content: '面板与现状一致，无需修改。' }
      const rel = join('面板', `${inst.id}.json`)
      return makeProposal(
        ctx,
        rel,
        JSON.stringify({ entries: before }, null, 2),
        JSON.stringify({ entries: after }, null, 2),
        summary,
        beforeText,
        afterText,
        `${after.length} 条`
      )
    }

    case 'dispatch_agent': {
      if (ctx.depth && ctx.depth > 0) return { ok: false, content: '子智能体不能再分配工作，请自己完成这项任务。' }
      const ref = String(args.agent || '').trim()
      const task = String(args.task || '').trim()
      if (!ref || !task) return { ok: false, content: '缺少 agent 或 task 参数。' }
      const roster = listRoster()
      const member =
        roster.find((m) => m.id === ref) || roster.find((m) => m.name === ref) || roster.find((m) => m.name.includes(ref))
      if (!member)
        return { ok: false, content: `团队名册里没有「${ref}」。可用成员：${roster.map((m) => `${m.id}（${m.name}）`).join('、')}` }
      const sub = resolveAgent(member.id)
      const requestId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      send(ctx.win, ctx.runId, 'subagent_request', { id: requestId, agentId: sub.id, agentName: sub.name, task })
      // 询问作者：自动批准模式直接执行；手动模式等作者在询问卡上决定（中止运行视为拒绝）
      let allow = true
      if (ctx.approvalMode !== 'auto-approve') {
        const controller = runs.get(ctx.runId)
        allow = await waitForDecision(requestId, controller?.signal ?? new AbortController().signal)
      }
      if (!allow)
        return { ok: false, content: `作者没有批准把工作分配给「${sub.name}」。请自己完成这部分，或提出别的分配方案。` }
      try {
        send(ctx.win, ctx.runId, 'subagent_status', { id: requestId, status: 'running' })
        const report = await runSubAgent(ctx.win, ctx.runId, requestId, ctx.book, sub, task, runs.get(ctx.runId)?.signal, ctx.approvalMode)
        send(ctx.win, ctx.runId, 'subagent_status', { id: requestId, status: 'done', output: report })
        return { ok: true, content: `【子智能体「${sub.name}」的汇报】\n${report}` }
      } catch (e) {
        const msg = (e as Error).message
        send(ctx.win, ctx.runId, 'subagent_status', { id: requestId, status: 'error', output: msg })
        return { ok: false, content: `子智能体「${sub.name}」执行失败：${msg}` }
      }
    }

    case 'web_search': {
      const query = String(args.query || '').trim()
      if (!query) return { ok: false, content: '缺少 query 参数。' }
      try {
        const hits = await webSearch(query)
        if (!hits.length) return { ok: true, content: `搜索「${query}」没有返回结果，换个关键词试试。` }
        const lines = hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet.slice(0, 200)}` : ''}`)
        return { ok: true, content: `「${query}」的搜索结果：\n\n${lines.join('\n')}\n\n需要看哪篇的完整内容就用 read_webpage 读取。` }
      } catch (e) {
        return { ok: false, content: `联网搜索失败：${(e as Error).message}` }
      }
    }

    case 'read_webpage': {
      const url = String(args.url || '').trim()
      if (!url) return { ok: false, content: '缺少 url 参数。' }
      try {
        const text = await readWebpage(url)
        return { ok: true, content: `网页 ${url} 正文：\n\n${text}` }
      } catch (e) {
        return { ok: false, content: `网页读取失败：${(e as Error).message}` }
      }
    }

    case 'list_documents': {
      const tree = listTree(ctx.book)
      const visible = ctx.scope.length ? filterTree(tree, ctx.scope) : tree
      const lines = flattenTree(visible)
      return { ok: true, content: lines.length ? lines.join('\n') : '作品内暂无文件。' }
    }

    case 'read_document': {
      const rel = String(args.path || '')
      if (!rel) return { ok: false, content: '缺少 path 参数。' }
      if (!inScope(ctx.scope, rel)) return { ok: false, content: `当前智能体的读取范围不含「${rel}」，请不要读取该文件。` }
      try {
        safeBookPath(ctx.book, rel)
      } catch {
        return { ok: false, content: '路径非法。' }
      }
      // 二进制文件读出来是乱码，只会浪费上下文：直接拒绝并给出替代方案
      if (/\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|gz|mp3|mp4|wav|woff2?|ttf|eot)$/i.test(rel)) {
        return { ok: false, content: `「${rel}」是二进制文件，无法以文本读取（读出来只会是乱码）。图片类文件请改用视觉/底图通道处理，不要用 read_document。` }
      }
      const text = readTextFile(ctx.book, rel)
      if (!text.trim()) return { ok: true, content: `文件「${rel}」为空或不存在。` }
      return { ok: true, content: `文件「${rel}」内容：\n\n${text.slice(0, 12000)}${text.length > 12000 ? '\n\n（内容过长已截断）' : ''}` }
    }

    case 'search_book': {
      const query = String(args.query || '').trim()
      if (!query) return { ok: false, content: '缺少 query 参数。' }
      const files = walkFiles(ctx.book).filter((f) => inScope(ctx.scope, f))
      const hits: string[] = []
      for (const f of files) {
        const text = readTextFile(ctx.book, f)
        text.split('\n').forEach((line, i) => {
          if (line.includes(query) && hits.length < 60) hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 160)}`)
        })
      }
      return { ok: true, content: hits.length ? `命中 ${hits.length} 处：\n${hits.join('\n')}` : `未找到「${query}」。` }
    }

    case 'propose_edit': {
      const rel = String(args.path || '')
      const content = String(args.content ?? '')
      const summary = String(args.summary || '').trim() || '修改文件内容'
      if (!rel) return { ok: false, content: '缺少 path 参数。' }
      if (!content.trim()) return { ok: false, content: 'content 为空，未提交提案。' }
      if (!inScope(ctx.scope, rel)) return { ok: false, content: `当前智能体的修改范围不含「${rel}」。` }
      try {
        safeBookPath(ctx.book, rel)
      } catch {
        return { ok: false, content: '路径非法。' }
      }
      const base = readTextFile(ctx.book, rel)
      if (base.trim() === content.trim()) return { ok: true, content: `提案内容与「${rel}」现状一致，无需修改。` }
      return makeProposal(ctx, rel, base, content, summary)
    }

    case 'read_timeline': {
      const nodes = readTimeline(ctx.book)
      return { ok: true, content: `当前时间线（共 ${nodes.length} 个节点）：\n\n${renderTimelineText(nodes)}` }
    }

    case 'write_timeline': {
      const summary = String(args.summary || '').trim() || '更新时间线'
      if (!Array.isArray(args.nodes)) return { ok: false, content: 'nodes 必须是数组。' }
      const before = readTimeline(ctx.book)
      // preserve：AI 没提到的旧事件自动保留，防止漏传清空时间线
      const after = normalizeTimeline(args.nodes, { preserve: true, prev: before })
      const rel = STRUCTURED_FILES.timeline
      const base = readTextFile(ctx.book, rel)
      const next = JSON.stringify({ nodes: after }, null, 2)
      if (before.length === after.length && renderTimelineText(before) === renderTimelineText(after)) {
        return { ok: true, content: '时间线与现状一致，无需修改。' }
      }
      return makeProposal(ctx, rel, base, next, summary, renderTimelineText(before), renderTimelineText(after), `${after.length} 个节点`)
    }

    case 'read_dictionary': {
      const entries = readDict(ctx.book)
      return { ok: true, content: `专名词典（共 ${entries.length} 条）：\n\n${renderDictText(entries)}` }
    }

    case 'write_dictionary': {
      const summary = String(args.summary || '').trim() || '更新专名词典'
      if (!Array.isArray(args.entries)) return { ok: false, content: 'entries 必须是数组。' }
      const before = readDict(ctx.book)
      // preserve：AI 没提到的旧条目自动保留，防止漏传清空词典
      const after = normalizeDict(args.entries, { preserve: true, prev: before })
      const beforeText = renderDictText(before)
      const afterText = renderDictText(after)
      if (before.length === after.length && beforeText === afterText) {
        return { ok: true, content: '词典与现状一致，无需修改。' }
      }
      const rel = STRUCTURED_FILES.dict
      const base = readTextFile(ctx.book, rel)
      return makeProposal(
        ctx,
        rel,
        base,
        JSON.stringify({ entries: after }, null, 2),
        summary,
        beforeText,
        afterText,
        `${after.length} 条`
      )
    }

    case 'read_foreshadow': {
      const entries = readForeshadow(ctx.book)
      return { ok: true, content: `伏笔登记板（共 ${entries.length} 条）：\n\n${renderForeshadowText(entries)}` }
    }

    case 'write_foreshadow': {
      const summary = String(args.summary || '').trim() || '更新伏笔登记'
      if (!Array.isArray(args.entries)) return { ok: false, content: 'entries 必须是数组。' }
      const before = readForeshadow(ctx.book)
      // preserve：AI 没提到的旧条目自动保留，防止漏传清空伏笔登记
      const after = normalizeForeshadow(args.entries, { preserve: true, prev: before })
      const beforeText = renderForeshadowText(before)
      const afterText = renderForeshadowText(after)
      if (before.length === after.length && beforeText === afterText) {
        return { ok: true, content: '伏笔登记与现状一致，无需修改。' }
      }
      const rel = STRUCTURED_FILES.foreshadow
      const base = readTextFile(ctx.book, rel)
      return makeProposal(
        ctx,
        rel,
        base,
        JSON.stringify({ entries: after }, null, 2),
        summary,
        beforeText,
        afterText,
        `${after.length} 条`
      )
    }

    case 'read_power': {
      const data = readPower(ctx.book)
      return { ok: true, content: `境界体系板：\n\n${renderPowerText(data)}` }
    }

    case 'write_power': {
      const summary = String(args.summary || '').trim() || '更新境界体系'
      const before = readPower(ctx.book)
      // preserve：AI 没提到的旧境界/旧角色/rules 自动保留，防止漏传清空
      const after = normalizePower({ realms: args.realms, rules: args.rules, chars: args.chars }, { preserve: true, prev: before })
      const beforeText = renderPowerText(before)
      const afterText = renderPowerText(after)
      if (beforeText === afterText) {
        return { ok: true, content: '境界体系与现状一致，无需修改。' }
      }
      const rel = STRUCTURED_FILES.power
      const base = readTextFile(ctx.book, rel)
      return makeProposal(
        ctx,
        rel,
        base,
        JSON.stringify(after, null, 2),
        summary,
        beforeText,
        afterText,
        `${after.realms.length} 重境界 / ${after.chars.length} 个角色`
      )
    }

    case 'read_tracking': {
      const entries = readTracking(ctx.book)
      return { ok: true, content: `角色出场追踪板（共 ${entries.length} 人）：\n\n${renderTrackingText(entries)}` }
    }

    case 'write_tracking': {
      const summary = String(args.summary || '').trim() || '更新出场追踪'
      if (!Array.isArray(args.entries)) return { ok: false, content: 'entries 必须是数组。' }
      const before = readTracking(ctx.book)
      // preserve：AI 没提到的旧条目自动保留，防止漏传清空出场追踪
      const after = normalizeTracking(args.entries, { preserve: true, prev: before })
      const beforeText = renderTrackingText(before)
      const afterText = renderTrackingText(after)
      if (before.length === after.length && beforeText === afterText) {
        return { ok: true, content: '出场追踪与现状一致，无需修改。' }
      }
      const rel = STRUCTURED_FILES.tracking
      const base = readTextFile(ctx.book, rel)
      return makeProposal(
        ctx,
        rel,
        base,
        JSON.stringify({ entries: after }, null, 2),
        summary,
        beforeText,
        afterText,
        `${after.length} 人`
      )
    }

    case 'read_map': {
      const all = readMaps(ctx.book)
      const mapId = String(args.mapId || '')
      const list = mapId ? all.filter((m) => m.id === mapId) : all
      if (mapId && !list.length) return { ok: false, content: `找不到地图「${mapId}」。` }
      return { ok: true, content: `地图路线图（共 ${all.length} 张）：\n\n${renderMapsText(list)}` }
    }

    case 'write_map': {
      const summary = String(args.summary || '').trim() || '更新地图路线图'
      if (!Array.isArray(args.maps)) return { ok: false, content: 'maps 必须是数组。' }
      const before = readMaps(ctx.book)
      // preserve：AI 没提到的地图/节点/连线自动保留，防止增量更新时「忘了传」把数据清掉
      const after = normalizeMaps(args.maps, before, { preserve: true })
      const beforeText = renderMapsText(before)
      const afterText = renderMapsText(after)
      if (before.length === after.length && beforeText === afterText) {
        return { ok: true, content: '地图与现状一致，无需修改。' }
      }
      const rel = STRUCTURED_FILES.map
      const base = readTextFile(ctx.book, rel)
      return makeProposal(
        ctx,
        rel,
        base,
        JSON.stringify({ maps: after }, null, 2),
        summary,
        beforeText,
        afterText,
        `${after.length} 张地图`
      )
    }

    case 'read_outline_plan': {
      const entries = readOutline(ctx.book)
      return { ok: true, content: `卷/章细纲板（共 ${entries.length} 章）：\n\n${renderOutlineText(entries)}` }
    }

    case 'write_outline_plan': {
      const summary = String(args.summary || '').trim() || '更新卷/章细纲'
      if (!Array.isArray(args.entries)) return { ok: false, content: 'entries 必须是数组。' }
      const before = readOutline(ctx.book)
      // preserve：AI 没提到的旧章自动保留，防止漏传清空细纲
      const after = normalizeOutline(args.entries, { preserve: true, prev: before })
      const beforeText = renderOutlineText(before)
      const afterText = renderOutlineText(after)
      if (before.length === after.length && beforeText === afterText) {
        return { ok: true, content: '细纲与现状一致，无需修改。' }
      }
      const rel = STRUCTURED_FILES.outline
      const base = readTextFile(ctx.book, rel)
      return makeProposal(
        ctx,
        rel,
        base,
        JSON.stringify({ entries: after }, null, 2),
        summary,
        beforeText,
        afterText,
        `${after.length} 章`
      )
    }

    case 'read_graph': {
      const kind = String(args.kind || '')
      if (kind !== 'story' && kind !== 'characters') {
        return { ok: false, content: '缺少 kind 参数：kind="story" 读故事线，kind="characters" 读角色关系图。必须明确指定。' }
      }
      if (kind === 'characters') {
        const g = readCharGraph(ctx.book)
        return { ok: true, content: `角色关系图（${g.nodes.length} 个角色，${g.edges.length} 条关系）：\n\n${renderCharGraphText(g.nodes, g.edges)}` }
      }
      const g = readStory(ctx.book)
      return { ok: true, content: `故事线（${g.nodes.length} 个节点，${g.edges.length} 条连接）：\n\n${renderStoryText(g.nodes, g.edges)}` }
    }

    case 'write_graph': {
      const kind = String(args.kind || '')
      if (kind !== 'story' && kind !== 'characters') {
        return { ok: false, content: '缺少 kind 参数：kind="story" 写故事线，kind="characters" 写角色关系图。必须明确指定，不许默认。' }
      }
      const summary = String(args.summary || '').trim() || (kind === 'characters' ? '更新角色关系图' : '更新故事线')
      if (!Array.isArray(args.nodes)) return { ok: false, content: 'nodes 必须是数组。' }
      const rel = kind === 'characters' ? STRUCTURED_FILES.charGraph : STRUCTURED_FILES.story
      const base = readTextFile(ctx.book, rel)
      if (kind === 'characters') {
        const before = readCharGraph(ctx.book)
        // preserve：AI 没提到的旧角色/连线自动保留，防止漏传清图
        const after = normalizeCharGraph(args.nodes, args.edges, { preserve: true, prev: before })
        if (renderCharGraphText(before.nodes, before.edges) === renderCharGraphText(after.nodes, after.edges)) {
          return { ok: true, content: '关系图与现状一致，无需修改。' }
        }
        return makeProposal(
          ctx,
          rel,
          base,
          JSON.stringify(after, null, 2),
          summary,
          renderCharGraphText(before.nodes, before.edges),
          renderCharGraphText(after.nodes, after.edges),
          `${after.nodes.length} 个角色`
        )
      }
      const before = readStory(ctx.book)
      const after = normalizeStory(args.nodes, args.edges, { preserve: true, prev: before })
      if (renderStoryText(before.nodes, before.edges) === renderStoryText(after.nodes, after.edges)) {
        return { ok: true, content: '故事线与现状一致，无需修改。' }
      }
      return makeProposal(
        ctx,
        rel,
        base,
        JSON.stringify(after, null, 2),
        summary,
        renderStoryText(before.nodes, before.edges),
        renderStoryText(after.nodes, after.edges),
        `${after.nodes.length} 个节点`
      )
    }

    case 'list_materials':
    case 'list_library': {
      const only = args.library ? asLibKind(args.library) : null
      if (only && libDenied(only)) return { ok: false, content: denyMsg(LIB_LABEL[only]) }
      // 未指定库且智能体有授权范围时，只列已授权的库
      const kw = String(args.keyword || '').trim().toLowerCase()
      const kinds: LibKind[] = only ? [only] : ctx.libsRead ? ctx.libsRead : ['materials', 'skills', 'notes']
      const parts: string[] = []
      for (const kind of kinds) {
        for (const g of listLibrary(kind)) {
          const hit = kw
            ? g.entries.filter((e) => `${e.name}${e.summary}${e.tags.join('')}`.toLowerCase().includes(kw))
            : g.entries
          if (!hit.length) continue
          parts.push(
            `【${LIB_LABEL[kind]}·${g.name}】\n${hit
              .map((e) => `  ${e.name}（${e.size} 字）${e.summary ? ` — ${e.summary}` : ''}${e.tags.length ? ` [${e.tags.join('/')}]` : ''}`)
              .join('\n')}`
          )
        }
      }
      const scope = only ? LIB_LABEL[only] : '资源库'
      return { ok: true, content: parts.length ? parts.join('\n\n') : `${scope}${kw ? `中没有匹配「${kw}」的条目` : '目前为空'}。` }
    }

    case 'read_material': {
      const kind = asLibKind(args.library)
      if (libDenied(kind)) return { ok: false, content: denyMsg(LIB_LABEL[kind]) }
      const group = String(args.group || '通用')
      const name = String(args.name || '')
      if (!name) return { ok: false, content: '缺少 name 参数。' }
      const e = readEntry(kind, group, name)
      if (!e.body.trim()) return { ok: false, content: `未找到条目「${group}/${name}」。` }
      return { ok: true, content: `条目「${name}」内容：\n\n${e.body}` }
    }

    case 'write_material': {
      if (ctx.libsRead && !ctx.libsWrite) return { ok: false, content: '当前智能体没有被授予写资源库的权限，只能读取。' }
      if (libDenied(asLibKind(args.library))) return { ok: false, content: denyMsg(LIB_LABEL[asLibKind(args.library)]) }
      const items = [args]
      return submitLibProposal(ctx, items, String(args.summary || ''))
    }

    case 'write_materials': {
      if (ctx.libsRead && !ctx.libsWrite) return { ok: false, content: '当前智能体没有被授予写资源库的权限，只能读取。' }
      if (!Array.isArray(args.items) || !args.items.length) return { ok: false, content: 'items 必须是非空数组。' }
      if (args.items.some((it) => libDenied(asLibKind((it as Record<string, unknown>).library))))
        return { ok: false, content: 'items 里有未授权的资源库，请移除后重试。' }
      return submitLibProposal(ctx, args.items as Record<string, unknown>[], String(args.summary || ''))
    }

    default:
      return { ok: false, content: `未知工具：${name}` }
  }
}

function filterTree(nodes: TreeNode[], scope: string[]): TreeNode[] {
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (n.dir) {
      if (scope.includes(n.name)) out.push(n)
      else {
        const kids = filterTree(n.children || [], scope)
        if (kids.length) out.push({ ...n, children: kids })
      }
    } else if (n.name.endsWith('.md')) out.push(n)
  }
  return out
}

// ============ 智能体运行 ============

export interface AgentRunParams {
  runId: string
  book: string
  agentId: string
  approvalMode: 'manual' | 'auto-approve'
  activeFile?: string
  history: { role: 'user' | 'assistant'; content: string }[]
  skillRefs?: { group: string; name: string }[]
  materialRefs?: { group: string; name: string }[]
  noteRefs?: { group: string; name: string }[]
  attachmentText?: { name: string; text: string }[]
  /** 本轮附带的图片（data URL，仅当前轮发给多模态模型，历史不带防 token 爆炸） */
  images?: string[]
  taskOverride?: { providerId?: string; model?: string; temperature?: number; thinkingLevel?: string }
  /** 早期对话的压缩摘要（上下文达窗口 80% 后自动生成，随系统提示词注入） */
  contextSummary?: string
}

interface StreamDeltaAcc {
  content: string
  reasoning: string
  toolCalls: Map<number, { id: string; name: string; args: string }>
  finishReason: string | null
}

/** 思考强度对应的行为约束 */
const LEVEL_TEXT: Record<string, string> = {
  off: '直接给结论和稿面改动，不要展开推理过程。',
  low: '简要说明依据后给结论，不必穷举方案。',
  medium: '先梳理关键信息与取舍，再给出方案；必要时用工具核对原文。',
  high: '充分推演：列出至少两种可行方向，比较代价后给出推荐，并指出风险与副作用。'
}

function buildSystemPrompt(params: AgentRunParams, agent: ResolvedAgent, semanticCtx = ''): string {
  const parts: string[] = [agent.inlinePrompt || getPrompt(agent.promptId) || '']

  let meta: {
    title?: string
    genre?: string
    idea?: string
    platform?: string
    styleTags?: string[]
    viewpoint?: string
    audience?: string
  } = {}
  try {
    meta = readBookMeta(params.book)
  } catch {
    /* 元信息读取失败不影响运行 */
  }
  const tags = Array.isArray(meta.styleTags) && meta.styleTags.length ? meta.styleTags.join('、') : '未设置'
  const extra: string[] = []
  if (meta.audience) extra.push(`目标读者：${meta.audience}`)
  if (meta.viewpoint) extra.push(`叙事视角：${meta.viewpoint}`)
  parts.push(
    `\n【当前作品】\n书名：${params.book}\n题材：${meta.genre || '未设置'}\n风格标签：${tags}\n首发平台：${
      meta.platform || '未设置'
    }${extra.length ? `\n${extra.join('\n')}` : ''}${meta.idea ? `\n作品简介摘要：${meta.idea.slice(0, 600)}` : ''}`
  )
  parts.push(
    '\n【写作定位约束】题材、风格标签与平台定位决定了读者的期待：用词、节奏、爽点密度都要贴合这个定位；' +
      '如果作者的要求与定位明显冲突，先指出冲突再按作者的要求执行。'
  )
  // 作者记忆注入（Letta 核心记忆思路：量小全量进上下文，不搞检索）
  try {
    const gList = memory.readGlobalEntries()
    const bList = memory.readBookEntries(params.book)
    const renderMem = (list: { category: string; text: string }[]) =>
      list.map((e) => `· [${e.category || '记忆'}] ${e.text}`).join('\n')
    if (gList.length || bList.length) {
      const cut = (s: string) => (s.length > 6000 ? `${s.slice(0, 6000)}\n（过长已截断，完整内容用 read_memory 查看）` : s)
      parts.push(
        '\n【作者记忆】以下是作者长期沉淀的偏好、决策与禁区，必须遵守；需要新增或更新记忆时用 read_memory / write_memory（单条一句话，写前先读，新事实覆盖旧事实）：' +
          (gList.length ? `\n—— 全局记忆（跨书通用）——\n${cut(renderMem(gList))}` : '') +
          (bList.length ? `\n—— 本书记忆 ——\n${cut(renderMem(bList))}` : '')
      )
    }
  } catch {
    /* 记忆缺失不影响运行 */
  }
  // 设定智能体：注入词典 / 境界 / 地图现状速览，从源头防重名、防吃书（③ 联动）
  if (agent.promptId === 'agent-setting') {
    try {
      const lines: string[] = []
      const dict = readDict(params.book)
      if (dict.length)
        lines.push(`专名词典（${dict.length} 条）：` + dict.slice(0, 80).map((d) => `${d.term}${d.aliases?.length ? `（别名：${d.aliases.join('/')}）` : ''}`).join('、'))
      const power = readPower(params.book)
      if (power.realms?.length) lines.push(`境界体系：${power.realms.map((r) => r.name).join(' ≥ ')}`)
      const maps = readMaps(params.book)
      const nodes = maps.flatMap((m) => m.nodes || []).map((n) => n.label).filter(Boolean)
      if (nodes.length) lines.push(`地图地点：${[...new Set(nodes)].slice(0, 60).join('、')}`)
      if (lines.length)
        parts.push(
          '\n【结构化现状速览】以下是词典 / 境界 / 地图板块的当前登记现状。你产出或修改的设定必须与它们保持一致：' +
            '同一事物只用一个名字，境界与地理不得与现状矛盾；确需变更时先向作者指出冲突点。若需要更完整的条目内容，用对应的 read_ 工具读取。\n' +
            lines.join('\n')
        )
    } catch {
      /* 结构化数据缺失不影响运行 */
    }
  }
  const sensitive = getConfig().sensitiveWords || []
  if (sensitive.length)
    parts.push(
      `\n【写作规避词】作者明确要求正文不得出现以下词语：${sensitive.join('、')}。` +
        '产出与修改的一切文稿内容都不得包含它们，语义上无法回避时改用同义表达。'
    )
  if (agent.readScope.length) parts.push(`\n【读取范围】你只能读取与修改这些目录：${agent.readScope.join('、')}（以及根级文件）。`)
  if (agent.orchestrator) {
    const roster = listRoster().filter((m) => m.id !== agent.id)
    parts.push(
      '\n【团队分工模式】你已开启分配能力：可以把一项具体工作分配给下列成员独立执行，它会完成并把汇报返回给你。' +
        '需要分配时调用 dispatch_agent 工具（agent 填成员 id，task 写清背景与期望输出），一次分配一件事，拆给你的成员要适合这项工作。' +
        (params.approvalMode === 'auto-approve'
          ? '当前为自动批准模式，分配会直接执行。'
          : '每次分配都会先征求作者同意；被拒绝时不要重复分配，自己完成该部分。') +
        '\n可用成员：\n' +
        roster.map((m) => `- ${m.id}｜${m.name}：${m.desc}`).join('\n')
    )
  }
  if (params.contextSummary) parts.push(`\n【早期对话摘要】以下是本会话更早的对话被压缩后的摘要，是你们已经聊过并确认过的内容，请以此为准保持连续：\n${params.contextSummary}`)
  if (semanticCtx)
    parts.push(
      '\n【语义检索·相关片段】以下是根据作者本轮问题从全书文稿与资源库中语义检索出的相关片段（含来源与相似度），供回答时衔接上下文与保持一致性参考；需要更完整的内容再用相应工具读取原文：\n' +
        semanticCtx
    )
  if (params.activeFile) parts.push(`\n【作者当前打开的文件】${params.activeFile}`)
  parts.push(`\n【思考强度】${LEVEL_TEXT[params.taskOverride?.thinkingLevel || ''] || LEVEL_TEXT.medium}`)

  const skills = params.skillRefs?.length ? readEntriesForContext('skills', params.skillRefs) : []
  if (skills.length) {
    parts.push('\n【作者本次指定使用的技能】请严格按这些方法论执行：')
    for (const s of skills) parts.push(`\n--- ${s.title} ---\n${s.content}`)
  }
  const mats = params.materialRefs?.length ? readEntriesForContext('materials', params.materialRefs) : []
  if (mats.length) {
    parts.push('\n【作者本次引用的素材】写作时必须与这些资料保持一致：')
    for (const m of mats) parts.push(`\n--- ${m.title} ---\n${m.content}`)
  }
  const notes = params.noteRefs?.length ? readEntriesForContext('notes', params.noteRefs) : []
  if (notes.length) {
    parts.push('\n【作者引用的灵感便签】这些是作者随手记下的灵感，可作为点子与方向参考，与正文现状冲突时先向作者确认：')
    for (const n of notes) parts.push(`\n--- ${n.title} ---\n${n.content}`)
  }
  const atts = params.attachmentText?.length ? params.attachmentText : []
  if (atts.length) {
    parts.push('\n【作者附加的文件】')
    for (const a of atts) parts.push(`\n--- ${a.name} ---\n${a.text.slice(0, 20000)}`)
  }
  return parts.join('\n')
}

async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('响应无内容流')
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const l of lines) yield l
  }
}

export async function runAgent(win: BrowserWindow, params: AgentRunParams): Promise<void> {
  const { runId, book, agentId } = params
  const cfg = getConfig()
  const taskKey = 'agent' as const
  const taskCfg: TaskCfg = { ...(cfg.tasks?.[taskKey] || ({} as TaskCfg)) }
  if (params.taskOverride?.providerId) taskCfg.providerId = params.taskOverride.providerId
  if (params.taskOverride?.model) taskCfg.model = params.taskOverride.model
  if (typeof params.taskOverride?.temperature === 'number') taskCfg.temperature = params.taskOverride.temperature
  // 智能体级模型分配（智能体库逐个指定）：覆盖全局「智能体对话」配置；未指定的智能体保持跟随设置
  const agentModel = cfg.agentModels?.[agentId]
  if (agentModel?.providerId) taskCfg.providerId = agentModel.providerId
  if (agentModel?.model) taskCfg.model = agentModel.model

  const controller = new AbortController()
  runs.set(runId, controller)
  const agentStartedAt = Date.now()
  // 连接看门狗触发标记（声明在 try 外，catch 里要用）
  let connectTimedOut = false
  // recordAgentCall 定义在 try 块外，无法访问块内的 agent——把展示名单独提升到外层作用域
  let agentLabel = agentId

  try {
    const provider: Provider | undefined = cfg.providers.find((p) => p.id === taskCfg.providerId)
    if (!provider || !taskCfg.model) {
      send(win, runId, 'error', '尚未配置智能体模型：请到「设置 → AI 服务」为「智能体对话」分配服务商与模型')
      return
    }

    const agent = resolveAgent(agentId)
    agentLabel = agent.name
    // 语义检索注入：只对在智能体库开启了「语义检索」的智能体生效（默认关闭，与联网搜索/分配模式同模式）。
    // ① 传入运行 AbortSignal：作者点「停止」时嵌入请求立即中断；② 10 秒兜底时限：首次建索引可能耗时较长，
    // 超时先跳过注入继续对话（索引在后台继续建，下一条消息即可命中），绝不让检索拖住对话主流程
    let semanticCtx = ''
    try {
      const lastUser = [...(params.history || [])].reverse().find((m) => m.role === 'user')
      if (agent.vectorSearch && params.book && lastUser && lastUser.content.trim().length >= 6) {
        semanticCtx = await Promise.race([
          semanticForPrompt(params.book, lastUser.content, undefined, controller.signal),
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 10000))
        ])
      }
    } catch {
      /* 向量化未配置或检索失败：不影响对话 */
    }
    const ctx: ToolCtx = {
      win,
      runId,
      book,
      scope: agent.readScope,
      approvalMode: params.approvalMode,
      ...(agent.custom ? { libsRead: agent.libsRead, libsWrite: agent.libsWrite } : {}),
      ...(agent.custom ? { panelBoards: agent.panelBoards } : {}),
      orchestrator: agent.orchestrator,
      depth: 0
    }
    // 服务商自带联网搜索：按开关追加厂商专用工具/参数（Kimi $web_search、智谱 web_search、MiMo web_search、通义 enable_search）
    const searchPatch = cfg.providerSearch?.[provider.id] ? providerSearchPatch(provider.baseUrl) : null
    // 厂商自带搜索可用时优先用它，不再注入墨案自带的联网工具，避免两套搜索重复触发
    const tools = toolSchemasFor({
      webSearch: agent.webSearch && !searchPatch,
      libsRead: agent.custom ? agent.libsRead : undefined,
      libsWrite: agent.libsWrite,
      orchestrator: agent.orchestrator,
      structBoards: agent.custom ? agent.structBoards : undefined,
      panelBoards: agent.custom ? agent.panelBoards : undefined
    })
    const allTools = searchPatch?.tools?.length ? [...tools, ...searchPatch.tools] : tools
    const messages: Record<string, unknown>[] = [
      { role: 'system', content: buildSystemPrompt(params, agent, semanticCtx) },
      ...(params.history || []).map((m) => ({ role: m.role, content: m.content }))
    ]
    // 多模态：把本轮图片并入最后一条 user 消息（OpenAI vision content parts 格式）
    const images = (params.images || []).filter((u) => /^data:image\//.test(u))
    if (images.length) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')
      if (lastUser) {
        lastUser.content = [
          { type: 'text', text: String(lastUser.content) },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } }))
        ]
      }
    }

    const baseUrl = provider.baseUrl.replace(/\/+$/, '')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

    for (let turn = 0; turn < 12; turn++) {
      // 连接看门狗：60 秒内没拿到响应头（DNS/连接黑洞）就掐断并按错误结束，绝不无限转圈。
      // 响应头到达后即解除——流式生成耗时多久都不受影响
      connectTimedOut = false
      const connectWatch = setTimeout(() => {
        connectTimedOut = true
        controller.abort()
      }, 60000)
      let res: Response
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers,
          body: JSON.stringify({
            model: taskCfg.model,
            temperature: taskCfg.temperature,
            stream: true,
            tools: allTools,
            ...(searchPatch?.extra || {}),
            messages
          })
        })
      } finally {
        clearTimeout(connectWatch)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const hint = res.status === 401 ? '（API Key 无效或未填）' : res.status === 404 ? '（接口地址或模型名可能有误）' : res.status === 400 ? '（可能该模型不支持工具调用或图片输入：纯文本模型请勿附图，可在设置里换用兼容模型）' : ''
        throw new Error(`接口返回 ${res.status}${hint}：${text.slice(0, 300)}`)
      }

      const acc: StreamDeltaAcc = { content: '', reasoning: '', toolCalls: new Map(), finishReason: null }
      for await (const line of sseLines(res)) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') continue
        let json: Record<string, unknown>
        try {
          json = JSON.parse(data) as Record<string, unknown>
        } catch {
          continue
        }
        const choice = (json.choices as Record<string, unknown>[] | undefined)?.[0]
        if (!choice) continue
        const delta = (choice.delta || {}) as Record<string, unknown>
        const finish = choice.finish_reason as string | null
        if (finish) acc.finishReason = finish

        const think = (delta.reasoning_content ?? delta.reasoning) as string | undefined
        if (think) {
          acc.reasoning += think
          send(win, runId, 'thinking', think)
        }
        const content = (delta.content as string | undefined) ?? ''
        if (content) {
          acc.content += content
          runOutputs.set(runId, (runOutputs.get(runId) || 0) + content.length)
          send(win, runId, 'chunk', content)
        }
        const tcs = delta.tool_calls as { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] | undefined
        if (tcs) {
          for (const tc of tcs) {
            const idx = tc.index ?? 0
            const cur = acc.toolCalls.get(idx) || { id: '', name: '', args: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name = tc.function.name
            if (tc.function?.arguments) cur.args += tc.function.arguments
            acc.toolCalls.set(idx, cur)
          }
        }
      }

      const calls = [...acc.toolCalls.values()].filter((c) => c.name)
      messages.push({
        role: 'assistant',
        content: acc.content || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c, i) => ({
                id: c.id || `call_${turn}_${i}`,
                type: 'function',
                function: { name: c.name, arguments: c.args || '{}' }
              }))
            }
          : {})
      })

      if (!calls.length) {
        send(win, runId, 'done', acc.content)
        recordAgentCall('success', '')
        return
      }

      for (const c of calls) {
        const toolId = c.id || `call_${turn}_${c.name}`
        const startedAt = Date.now()
        send(win, runId, 'tool_start', { id: toolId, name: c.name, args: c.args, requestedAt: new Date().toISOString() })
        let result: ToolResult
        try {
          if (c.name === '$web_search') {
            // Kimi 内置联网搜索：平台已执行，把返回的 arguments（含搜索结果）原样回传即可
            result = { ok: true, content: c.args || '（无搜索结果）' }
          } else {
            result = await executeTool(c.name, c.args, ctx)
          }
        } catch (e) {
          result = { ok: false, content: `工具执行失败：${(e as Error).message}` }
        }
        const trace: ToolTrace = {
          id: toolId,
          name: c.name,
          args: c.args || '{}',
          ok: result.ok,
          result: result.content,
          durationMs: Date.now() - startedAt,
          requestedAt: new Date().toISOString()
        }
        send(win, runId, 'tool_end', trace)
        messages.push({ role: 'tool', tool_call_id: toolId, content: result.content })
      }
    }
    send(win, runId, 'done', '（已达到单轮工具调用上限，请在下一轮继续对话）')
    recordAgentCall('success', '')
  } catch (e) {
    const err = e as Error
    if (connectTimedOut) {
      // 连接看门狗超时：按错误结束（而非「已中止」），提示直指网络/服务商
      send(win, runId, 'error', '连接智能体模型超时（60 秒无响应）：请检查服务商地址是否可达、代理是否开启。')
      recordAgentCall('failed', '连接智能体模型超时（60 秒无响应）')
    } else if (err.name === 'AbortError') {
      send(win, runId, 'aborted')
      recordAgentCall('aborted', '')
    } else {
      send(win, runId, 'error', `智能体运行失败：${err.message}`)
      recordAgentCall('failed', `智能体运行失败：${err.message}`)
    }
  } finally {
    runs.delete(runId)
    runOutputs.delete(runId) // 用量已随 recordAgentCall 落账，清掉防慢泄漏
  }

  function recordAgentCall(status: 'success' | 'failed' | 'aborted', errMsg: string): void {
    const provider = cfg.providers.find((p) => p.id === taskCfg.providerId)
    const outChars = runOutputs.get(runId) || 0
    recordCall({
      kind: 'agent',
      feature: agentId,
      featureLabel: agentLabel,
      provider: provider?.name || '未知服务商',
      model: taskCfg.model,
      ok: status === 'success',
      status,
      durationMs: Date.now() - agentStartedAt,
      tokens: estimateTokens(outChars + 1200),
      tokensEstimated: true,
      error: errMsg
    })
  }
}

// ============ 提案应用 ============

export function applyProposal(id: string): { ok: boolean; status: EditProposal['status']; message: string } {
  const p = proposals.get(id)
  if (!p) return { ok: false, status: 'error', message: '提案不存在或已失效' }
  if (p.status === 'accepted') return { ok: true, status: 'accepted', message: '该提案已应用' }

  p.status = 'accepting'
  try {
    const current = readTextFile(p.book, p.target)
    if (current !== p.baseContent) {
      p.status = 'conflict'
      p.message = '文件在提案生成后已被修改，为避免覆盖较新内容，本次提案未应用。请让智能体重新读取后再提一次。'
      return { ok: false, status: 'conflict', message: p.message }
    }
    writeTextFile(p.book, p.target, p.newContent)
    p.status = 'accepted'
    p.message = '变更已应用并保存到本机。'
    return { ok: true, status: 'accepted', message: p.message }
  } catch (e) {
    p.status = 'error'
    p.message = `应用失败：${(e as Error).message}`
    return { ok: false, status: 'error', message: p.message }
  }
}

export function rejectProposal(id: string): { ok: boolean; message: string } {
  const p = proposals.get(id)
  if (!p) return { ok: false, message: '提案不存在' }
  if (p.status === 'accepted') return { ok: false, message: '已应用的提案无法拒绝' }
  p.status = 'rejected'
  p.message = '已保留当前文稿，未应用这次变更。'
  return { ok: true, message: p.message }
}

/** 读取书内可读文件清单（供前端 @ 引用与上下文指示） */
export function bookFileList(book: string): { path: string; size: number }[] {
  return walkFiles(book).map((f) => {
    let size = 0
    try {
      size = readFileSync(join(getLibraryRoot(), book, ...f.split(posix.sep)), 'utf-8').length
    } catch {
      /* 读取失败按 0 计 */
    }
    return { path: f, size }
  })
}