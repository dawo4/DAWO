// 自定义智能体：存储、AI 起草、统一解析（内置 + 自定义）
// 存储于 userData/custom-agents.json；提示词内联存放（不走 prompts/*.md，避免混进设置页模板列表）
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { getConfig, TaskCfg, Provider } from './config'
import { AGENTS, AgentDef, STRUCT_BOARDS } from './agents'
import { getPrompt, renderPrompt } from './prompts'
import { LibKind } from './materials'
import { estimateTokens, recordCall } from './ailog'

export interface CustomAgent extends Omit<AgentDef, 'promptId'> {
  id: string
  name: string
  desc: string
  stage: string
  welcome: string[]
  readScope: string[]
  /** 内联系统提示词 */
  prompt: string
  /** 可读的资源库；空数组 = 不给库工具 */
  libsRead: LibKind[]
  /** 是否允许写资源库（需 libsRead 非空才有意义） */
  libsWrite: boolean
  webSearch: boolean
  /** 分配模式：可作为主智能体把工作分配给其他智能体（每次调用需作者确认） */
  orchestrator: boolean
  /** 语义检索：对话前自动检索全书文稿与资源库注入相关片段（需已配置向量化） */
  vectorSearch: boolean
  /** 允许调用的结构化板块 key（STRUCT_BOARDS）；省略 = 全部允许（兼容旧数据） */
  structBoards?: string[]
  /** 允许读写的自定义面板名（list 原型）；省略 = 全部允许（兼容旧数据），空数组 = 全部禁止 */
  panelBoards?: string[]
  enabled: boolean
  createdAt: string
}

let cache: CustomAgent[] | null = null
let filePath: string

function load(): CustomAgent[] {
  if (!filePath) filePath = join(app.getPath('userData'), 'custom-agents.json')
  if (cache) return cache
  try {
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as CustomAgent[]
      cache = Array.isArray(raw) ? raw : []
      return cache
    }
  } catch {
    /* 损坏则重建 */
  }
  cache = []
  return cache
}

function persist(list: CustomAgent[]): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8')
  renameSync(tmp, filePath)
  cache = list
}

export function listCustomAgents(): CustomAgent[] {
  return load()
}

export function saveCustomAgent(a: CustomAgent): { ok: boolean; message: string } {
  if (!a.id || !a.name?.trim() || !a.prompt?.trim()) return { ok: false, message: '缺少 id / 名称 / 提示词' }
  const list = load()
  const i = list.findIndex((x) => x.id === a.id)
  const normalized: CustomAgent = {
    ...a,
    name: a.name.trim(),
    desc: a.desc || '',
    stage: a.stage || '自定义',
    welcome: Array.isArray(a.welcome) ? a.welcome.filter((w) => String(w).trim()).slice(0, 6) : [],
    readScope: Array.isArray(a.readScope) ? a.readScope : [],
    libsRead: Array.isArray(a.libsRead) ? a.libsRead.filter((k) => k === 'materials' || k === 'skills' || k === 'notes') : [],
    libsWrite: !!a.libsWrite,
    webSearch: !!a.webSearch,
    orchestrator: !!a.orchestrator,
    vectorSearch: !!a.vectorSearch,
    structBoards: Array.isArray(a.structBoards)
      ? a.structBoards.filter((k) => STRUCT_BOARDS.some((b) => b.key === k))
      : undefined,
    panelBoards: Array.isArray(a.panelBoards) ? a.panelBoards.map((s) => String(s).trim()).filter(Boolean) : undefined,
    enabled: a.enabled !== false
  }
  if (i >= 0) list[i] = normalized
  else list.push({ ...normalized, createdAt: a.createdAt || new Date().toISOString() })
  persist(list)
  return { ok: true, message: i >= 0 ? '已保存修改' : '已入库' }
}

export function deleteCustomAgent(id: string): { ok: boolean; message: string } {
  const list = load()
  const i = list.findIndex((x) => x.id === id)
  if (i < 0) return { ok: false, message: '未找到该智能体' }
  list.splice(i, 1)
  persist(list)
  return { ok: true, message: '已删除' }
}

export function setCustomAgentEnabled(id: string, enabled: boolean): { ok: boolean; message: string } {
  const list = load()
  const a = list.find((x) => x.id === id)
  if (!a) return { ok: false, message: '未找到该智能体' }
  a.enabled = !!enabled
  persist(list)
  return { ok: true, message: enabled ? '已在妙笔启用' : '已在妙笔停用' }
}

// ============ 统一解析：内置 + 自定义 ============

export interface ResolvedAgent extends AgentDef {
  /** 自定义智能体的内联提示词；内置为空（走 promptId） */
  inlinePrompt?: string
  /** 自定义智能体的库权限；内置为空表示不限制 */
  libsRead?: LibKind[]
  libsWrite?: boolean
  /** 自定义智能体的结构化板块权限；省略表示不限制 */
  structBoards?: string[]
  /** 自定义面板（list 原型）读写授权（面板名）；省略 = 全部允许，空数组 = 全部禁止 */
  panelBoards?: string[]
  webSearch: boolean
  /** 分配模式：可调用 dispatch_agent 把工作分配给其他智能体 */
  orchestrator: boolean
  /** 语义检索：对话前自动检索全书文稿与资源库注入相关片段（内置开关存 config.agentVectorSearch，自定义存在自身定义里） */
  vectorSearch: boolean
  custom: boolean
}

/** 内置智能体也允许装联网搜索（开关存 config.agentWebSearch）；自定义的存在自身定义里 */
export function resolveAgent(id: string): ResolvedAgent {
  const builtin = AGENTS.find((a) => a.id === id)
  if (builtin) {
    const overrides = getConfig().agentWebSearch || {}
    const orch = getConfig().agentOrchestrator || {}
    const vector = getConfig().agentVectorSearch || {}
    return { ...builtin, webSearch: !!overrides[id], orchestrator: !!orch[id], vectorSearch: !!vector[id], custom: false }
  }
  const custom = load().find((a) => a.id === id)
  if (custom) {
    return {
      id: custom.id,
      name: custom.name,
      desc: custom.desc,
      promptId: '',
      stage: custom.stage,
      welcome: custom.welcome,
      readScope: custom.readScope,
      inlinePrompt: custom.prompt,
      libsRead: custom.libsRead,
      libsWrite: custom.libsWrite,
      structBoards: custom.structBoards,
      panelBoards: custom.panelBoards,
      webSearch: custom.webSearch,
      orchestrator: custom.orchestrator,
      vectorSearch: custom.vectorSearch === true,
      custom: true
    }
  }
  // 兜底：通用助手
  const fallback = AGENTS[0]
  return { ...fallback, webSearch: false, orchestrator: false, vectorSearch: false, custom: false }
}

/** 可被分配工作的成员名册（内置全部 + 已启用的自定义），供主智能体的系统提示词展示 */
export function listRoster(): { id: string; name: string; desc: string }[] {
  const customs = load()
    .filter((a) => a.enabled)
    .map((a) => ({ id: a.id, name: a.name, desc: a.desc }))
  return [...AGENTS.map((a) => ({ id: a.id, name: a.name, desc: a.desc })), ...customs]
}

// ============ LLM 一次性调用（非流式）：AI 起草智能体定义 / 会话摘要 ============

function llmTaskCfg(taskKey = 'agent'): { provider: Provider; cfg: TaskCfg } {
  const config = getConfig()
  const cfg: TaskCfg = config.tasks?.[taskKey] || ({} as TaskCfg)
  const provider = config.providers.find((p) => p.id === cfg.providerId)
  if (!provider || !cfg.model) throw new Error('尚未配置模型：请到「设置 → AI 服务」为对应任务分配服务商与模型')
  return { provider, cfg }
}

/** OpenAI 兼容非流式补全；返回首个 choice 的文本。每一次调用都落 AI 调用记录。
 *  signal 可选：调用方（如批量修订）用 AbortController 中断进行中的请求 */
export async function llmComplete(
  system: string,
  user: string,
  feature = 'llm',
  featureLabel = '一次性调用',
  taskKey = 'agent',
  signal?: AbortSignal
): Promise<string> {
  const { provider, cfg } = llmTaskCfg(taskKey)
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  const startedAt = Date.now()
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
      body: JSON.stringify({ model: cfg.model, temperature: cfg.temperature ?? 0.7, stream: false, messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ] }),
      signal: signal ?? AbortSignal.timeout(120000)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`接口返回 ${res.status}：${text.slice(0, 300)}`)
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content || ''
    if (!content.trim()) throw new Error('模型返回了空内容')
    recordCall({
      kind: 'text',
      feature,
      featureLabel,
      provider: provider.name,
      model: cfg.model,
      ok: true,
      status: 'success',
      durationMs: Date.now() - startedAt,
      tokens: estimateTokens(system.length + user.length + content.length),
      tokensEstimated: true,
      error: ''
    })
    return content
  } catch (e) {
    const err = e as Error
    recordCall({
      kind: 'text',
      feature,
      featureLabel,
      provider: provider.name,
      model: cfg.model,
      ok: false,
      status: err.name === 'AbortError' ? 'aborted' : 'failed',
      durationMs: Date.now() - startedAt,
      tokens: estimateTokens(system.length + user.length),
      tokensEstimated: true,
      error: err.message
    })
    throw e
  }
}

/** 剥掉 ```json 围栏后解析 JSON 对象 */
function parseJsonLoose(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('未找到 JSON 内容')
  return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>
}

const VALID_SCOPE = ['正文', '大纲', '设定', '角色']

/** 让 AI 根据需求描述起草一个自定义智能体定义；解析失败重试一次 */
export async function draftCustomAgent(desc: string, bookContext: string): Promise<CustomAgent> {
  if (!desc.trim()) throw new Error('请先描述你想让这个智能体做什么')
  const tpl = getPrompt('agent-creator')
  if (!tpl) throw new Error('提示词模板缺失：agent-creator')
  const system = renderPrompt(tpl, {})
  const user = `【作品背景】\n${bookContext || '（未指定）'}\n\n【需求描述】\n${desc.trim()}`

  let raw: string
  try {
    raw = await llmComplete(system, user, 'agent-draft', 'AI 起草智能体')
    return normalizeDraft(parseJsonLoose(raw), desc)
  } catch {
    // 重试一次：更严格地要求只输出 JSON
    raw = await llmComplete(`${system}\n\n再次强调：只输出一个 JSON 对象，不要任何解释、围栏或多余文本。`, user, 'agent-draft', 'AI 起草智能体')
    return normalizeDraft(parseJsonLoose(raw), desc)
  }
}

function normalizeDraft(j: Record<string, unknown>, desc: string): CustomAgent {
  const name = String(j.name || '').trim() || '自定义智能体'
  const prompt = String(j.prompt || '').trim()
  if (!prompt) throw new Error('AI 没有生成有效的系统提示词，请重试或补充描述')
  const scope = Array.isArray(j.readScope) ? (j.readScope as unknown[]).map(String).filter((s) => VALID_SCOPE.includes(s)) : []
  const libs = Array.isArray(j.libsRead) ? (j.libsRead as unknown[]).map(String).filter((s) => s === 'materials' || s === 'skills' || s === 'notes') : []
  return {
    id: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    desc: String(j.desc || '').trim() || desc.slice(0, 40),
    stage: String(j.stage || '自定义').trim() || '自定义',
    prompt,
    welcome: Array.isArray(j.welcome) ? (j.welcome as unknown[]).map(String).filter((w) => w.trim()).slice(0, 4) : [],
    readScope: scope,
    libsRead: libs as LibKind[],
    libsWrite: j.libsWrite === true,
    webSearch: j.webSearch === true,
    orchestrator: j.orchestrator === true,
    vectorSearch: false,
    enabled: false,
    createdAt: new Date().toISOString()
  }
}

/** 会话历史压缩摘要 */
export async function summarizeConversation(history: { role: 'user' | 'assistant'; content: string }[]): Promise<string> {
  const tpl = getPrompt('context-compress')
  if (!tpl) throw new Error('提示词模板缺失：context-compress')
  const system = renderPrompt(tpl, {})
  const user = history
    .slice(-40)
    .map((m) => `${m.role === 'user' ? '作者' : '智能体'}：${m.content.slice(0, 4000)}`)
    .join('\n\n')
  const out = await llmComplete(system, user, 'context-compress', '上下文压缩')
  return out.trim().slice(0, 2000)
}
