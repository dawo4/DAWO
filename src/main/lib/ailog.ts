import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * AI 调用记录：每一次「文字 AI / 智能体」请求都落一条，用于用量与排错。
 * 只保留最近 MAX_ENTRIES 条，避免无限增长。
 */

export type AiCallKind = 'text' | 'agent'

export interface AiCallRecord {
  id: string
  at: string
  kind: AiCallKind
  /** 功能标识：任务名（workflow/continue/...）或智能体 id */
  feature: string
  /** 中文功能名，便于阅读 */
  featureLabel: string
  provider: string
  model: string
  ok: boolean
  status: 'success' | 'failed' | 'aborted'
  durationMs: number
  tokens: number
  /** 估算还是接口返回 */
  tokensEstimated: boolean
  error: string
}

const MAX_ENTRIES = 2000

let logPath = ''
let cache: AiCallRecord[] | null = null

function file(): string {
  if (!logPath) logPath = join(app.getPath('userData'), 'ai-log.json')
  return logPath
}

function load(): AiCallRecord[] {
  if (cache) return cache
  try {
    const p = file()
    cache = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as AiCallRecord[]) : []
  } catch {
    cache = []
  }
  return cache
}

function save(): void {
  try {
    const p = file()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(cache || [], null, 2), 'utf-8')
  } catch {
    /* 落盘失败不影响主流程 */
  }
}

/** 粗略估算：中文按 1 字 ≈ 0.7 token */
export function estimateTokens(chars: number): number {
  return Math.round(chars / 1.4)
}

export function recordCall(rec: Omit<AiCallRecord, 'id' | 'at'>): void {
  const list = load()
  list.push({ ...rec, id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString() })
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES)
  save()
}

export interface AiLogFilter {
  kind?: AiCallKind | 'all'
  status?: 'all' | 'success' | 'failed' | 'aborted'
  feature?: string
  keyword?: string
  from?: string
  to?: string
  limit?: number
}

export function queryCalls(filter: AiLogFilter = {}): AiCallRecord[] {
  const kw = (filter.keyword || '').trim().toLowerCase()
  const list = load().filter((r) => {
    if (filter.kind && filter.kind !== 'all' && r.kind !== filter.kind) return false
    if (filter.status && filter.status !== 'all' && r.status !== filter.status) return false
    if (filter.feature && filter.feature !== 'all' && r.feature !== filter.feature) return false
    if (filter.from && r.at < filter.from) return false
    if (filter.to && r.at.slice(0, 10) > filter.to) return false
    if (kw && !`${r.featureLabel}${r.model}${r.provider}${r.error}`.toLowerCase().includes(kw)) return false
    return true
  })
  // 最新的在前
  list.reverse()
  return filter.limit ? list.slice(0, filter.limit) : list
}

export interface AiLogStats {
  total: number
  success: number
  failed: number
  aborted: number
  tokens: number
  avgMs: number
}

export function callStats(): AiLogStats {
  const list = load()
  const success = list.filter((r) => r.status === 'success').length
  const failed = list.filter((r) => r.status === 'failed').length
  const aborted = list.filter((r) => r.status === 'aborted').length
  const tokens = list.reduce((a, r) => a + (r.tokens || 0), 0)
  const avgMs = list.length ? Math.round(list.reduce((a, r) => a + (r.durationMs || 0), 0) / list.length) : 0
  return { total: list.length, success, failed, aborted, tokens, avgMs }
}

/** 供筛选下拉使用：出现过的功能列表 */
export function callFeatures(): { key: string; label: string }[] {
  const seen = new Map<string, string>()
  for (const r of load()) if (!seen.has(r.feature)) seen.set(r.feature, r.featureLabel)
  return [...seen.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, 'zh'))
}

export function clearCalls(): void {
  cache = []
  save()
}