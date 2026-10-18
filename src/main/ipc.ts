import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { getConfig, updateConfig, saveConfig } from './lib/config'
import { setLibraryRoot, getLibraryRoot } from './lib/library'
import * as lib from './lib/library'
import * as prompts from './lib/prompts'
import * as materials from './lib/materials'
import * as conversations from './lib/conversations'
import * as structured from './lib/structured'
import * as characters from './lib/characters'
import * as panels from './lib/panels'
import * as lexicon from './lib/lexicon'
import * as memory from './lib/memory'
import * as ailog from './lib/ailog'
import * as backup from './lib/backup'
import { runAi, abortRun, fetchModels, testProvider, AiRunParams } from './ai'
import { providerSearchSupported, type SearchProtocol } from './lib/websearch'
import { scanLocalServices } from './lib/localscan'
import { historyDiff } from './lib/library'
import { startBatchRevise, batchAbort, BatchParams } from './lib/batch'
import { vectorSearch, vectorStatus, vectorRebuild, vectorUpdate, vectorClear, testEmbedding } from './lib/vectors'
import { runAgent, abortAgentRun, applyProposal, rejectProposal, getProposal, allProposals, bookFileList, applyLibProposal, rejectLibProposal, AgentRunParams, decideSubagent } from './agent'
import * as customAgents from './lib/customAgents'

export function registerIpc(): void {
  ipcMain.handle('config:get', () => getConfig())

  // ============ 无边框窗口控制 ============
  ipcMain.handle('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.handle('win:maximizeToggle', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return false
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
    return w.isMaximized()
  })
  ipcMain.handle('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle('win:isMaximized', (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false)

  ipcMain.handle('config:update', (_e, patch: Record<string, unknown>) => {
    const cfg = updateConfig(patch)
    if (typeof patch.libraryRoot === 'string') {
      setLibraryRoot(patch.libraryRoot as string)
      materials.ensureLibraries()
    }
    return cfg
  })

  ipcMain.handle('books:list', () => lib.listBooks())
  ipcMain.handle('book:create', (
    _e,
    meta: {
      title: string
      genre?: string
      platform?: string
      styleTags?: string[]
      idea?: string
      viewpoint?: string
      audience?: string
      group?: string
    }
  ) => lib.createBook(meta))
  ipcMain.handle('book:delete', (_e, title: string) => lib.deleteBook(title))
  ipcMain.handle('book:rename', (_e, oldTitle: string, newTitle: string) => lib.renameBook(oldTitle, newTitle))
  ipcMain.handle('book:meta:read', (_e, book: string) => lib.readBookMeta(book))
  ipcMain.handle('book:meta:write', (_e, book: string, patch: Record<string, unknown>) => lib.writeBookMeta(book, patch))

  ipcMain.handle('file:read', (_e, book: string, rel: string) => lib.readTextFile(book, rel))
  ipcMain.handle('file:write', (_e, book: string, rel: string, content: string) => lib.writeTextFile(book, rel, content))
  ipcMain.handle('file:delete', (_e, book: string, rel: string) => lib.deleteFile(book, rel))
  ipcMain.handle('history:list', (_e, book: string, rel: string) => lib.historyList(book, rel))
  ipcMain.handle('history:read', (_e, book: string, rel: string, file: string) => lib.historyRead(book, rel, file))
  ipcMain.handle('history:restore', (_e, book: string, rel: string, file: string) => lib.historyRestore(book, rel, file))
  ipcMain.handle('tree:list', (_e, book: string) => lib.listTree(book))
  ipcMain.handle('stats:get', (_e, book: string) => lib.readStats(book))
  ipcMain.handle('stats:add', (_e, book: string, hand: number, ai: number) => lib.addStats(book, hand, ai))
  ipcMain.handle('stats:record', (_e, book: string, rel: string, len: number) => lib.recordCount(book, rel, len))

  ipcMain.handle('import:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win ? lib.pickImportFile(win) : null
  })
  ipcMain.handle('import:pickText', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win ? lib.pickSourceText(win) : null
  })
  ipcMain.handle('import:file', (_e, book: string, filePath: string) => lib.importToBook(book, filePath))
  ipcMain.handle('import:migrate', async (e, mode: 'each' | 'merge', mergeTitle: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { books: [], chapters: 0, errors: ['窗口不可用'] }
    return lib.migrateImport(win, mode, mergeTitle)
  })

  ipcMain.handle('app:openLibrary', () => lib.openLibraryInExplorer())
  ipcMain.handle('preset:lastUpdate', () => materials.lastPresetUpdate())

  ipcMain.handle('prompts:list', () => prompts.listPrompts())
  ipcMain.handle('prompts:get', (_e, id: string) => prompts.getPrompt(id))
  ipcMain.handle('prompts:save', (_e, id: string, content: string) => prompts.savePrompt(id, content))
  ipcMain.handle('prompts:dir', () => prompts.promptsDirPath())

  ipcMain.handle('ai:run', (e, params: AiRunParams) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) void runAi(win, params)
  })
  ipcMain.handle('ai:abort', (_e, runId: string) => abortRun(runId))
  ipcMain.handle('ai:fetchModels', async (_e, provider: { id: string; name: string; baseUrl: string; apiKey: string }) => {
    return fetchModels(provider)
  })
  ipcMain.handle('ai:testProvider', (_e, provider: { baseUrl: string; apiKey: string }, model: string) => testProvider(provider, model))
  ipcMain.handle('ai:providerSearchSupported', (_e, baseUrl: string, protocol?: SearchProtocol) => providerSearchSupported(baseUrl, protocol))
  ipcMain.handle('local:scan', (_e, apiKey?: string) => scanLocalServices(apiKey))

  // ============ 历史快照 / 批量修订 ============
  ipcMain.handle('history:diff', (_e, book: string, rel: string, file: string) => historyDiff(book, rel, file))
  ipcMain.handle('batch:revise', (e, params: BatchParams) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) void startBatchRevise(win, params)
  })
  ipcMain.handle('batch:abort', (_e, runId: string) => batchAbort(runId))

  // ============ 向量语义检索 ============
  ipcMain.handle('vector:search', (_e, book: string, query: string, topK?: number, opts?: { scope?: 'all' | 'book'; minScore?: number }) =>
    vectorSearch(book, query, topK, opts)
  )
  ipcMain.handle('vector:status', (_e, book: string) => vectorStatus(book))
  ipcMain.handle('vector:update', (_e, book: string) => vectorUpdate(book))
  ipcMain.handle('vector:rebuild', (_e, book: string) => vectorRebuild(book))
  ipcMain.handle('vector:clear', (_e, book: string) => vectorClear(book))
  ipcMain.handle('vector:test', (_e, baseUrl: string, apiKey: string, model: string) => testEmbedding(baseUrl, apiKey, model))

  // ============ 智能体 ============
  ipcMain.handle('agent:run', (e, params: AgentRunParams) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) void runAgent(win, params)
  })
  ipcMain.handle('agent:abort', (_e, runId: string) => abortAgentRun(runId))
  ipcMain.handle('agent:subagentDecide', (_e, id: string, allow: boolean) => decideSubagent(id, allow))
  ipcMain.handle('agent:proposalGet', (_e, id: string) => getProposal(id))
  ipcMain.handle('agent:proposals', () => allProposals())
  ipcMain.handle('agent:bookFiles', (_e, book: string) => bookFileList(book))
  ipcMain.handle('proposal:apply', (_e, id: string) => applyProposal(id))
  ipcMain.handle('proposal:reject', (_e, id: string) => rejectProposal(id))

  // ============ 自定义智能体（智能体库） ============
  ipcMain.handle('customAgents:list', () => customAgents.listCustomAgents())
  ipcMain.handle('customAgents:save', (_e, a: customAgents.CustomAgent) => customAgents.saveCustomAgent(a))
  ipcMain.handle('customAgents:delete', (_e, id: string) => customAgents.deleteCustomAgent(id))
  ipcMain.handle('customAgents:setEnabled', (_e, id: string, enabled: boolean) => customAgents.setCustomAgentEnabled(id, enabled))
  ipcMain.handle('customAgents:draft', async (e, desc: string, bookContext: string) => {
    void e
    return customAgents.draftCustomAgent(desc, bookContext)
  })
  ipcMain.handle('agent:summarize', async (_e, history: { role: 'user' | 'assistant'; content: string }[]) =>
    customAgents.summarizeConversation(history)
  )

  // ============ 资源库入库提案 ============
  ipcMain.handle('libProposal:apply', (_e, id: string, keys?: string[]) => applyLibProposal(id, keys))
  ipcMain.handle('libProposal:reject', (_e, id: string) => rejectLibProposal(id))

  // ============ 会话 ============
  ipcMain.handle('conv:list', (_e, book: string) => conversations.listConversations(book))
  ipcMain.handle('conv:load', (_e, book: string, id: string) => conversations.loadConversation(book, id))
  ipcMain.handle('conv:save', (_e, book: string, conv: conversations.StoredConversation) => conversations.saveConversation(book, conv))
  ipcMain.handle('conv:delete', (_e, book: string, id: string) => conversations.deleteConversation(book, id))
  ipcMain.handle('conv:export', async (e, book: string, id: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    const md = conversations.exportConversationMarkdown(book, id)
    const r = await dialog.showSaveDialog(win, {
      title: '导出会话记录',
      defaultPath: `会话记录-${id}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (r.canceled || !r.filePath) return null
    lib.writeAbsolute(r.filePath, md)
    return r.filePath
  })

  // ============ 素材库 / 技能库 ============
  ipcMain.handle('lib:list', (_e, kind: materials.LibKind) => materials.listLibrary(kind))
  ipcMain.handle('lib:read', (_e, kind: materials.LibKind, group: string, name: string) => materials.readEntry(kind, group, name))
  ipcMain.handle('lib:write', (_e, kind: materials.LibKind, group: string, name: string, summary: string, tags: string[], body: string) => {
    materials.writeEntry(kind, group, name, summary, tags, body)
  })
  ipcMain.handle('lib:delete', (_e, kind: materials.LibKind, group: string, name: string) => materials.deleteEntry(kind, group, name))
  ipcMain.handle('lib:createGroup', (_e, kind: materials.LibKind, group: string) => materials.createGroup(kind, group))
  ipcMain.handle('lib:deleteGroup', (_e, kind: materials.LibKind, group: string) => materials.deleteGroup(kind, group))
  ipcMain.handle('lib:importSkill', async (e, group: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    const r = await dialog.showOpenDialog(win, {
      title: '导入技能（Markdown 文件）',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return materials.importSkillFile(r.filePaths[0], group)
  })
  ipcMain.handle('lib:root', () => getLibraryRoot())
  ipcMain.handle('lib:open', (_e, kind: materials.LibKind) => lib.openPathInExplorer(materials.kindRootPath(kind)))

  // ============ 外观：背景图 ============
  ipcMain.handle('bg:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win ? lib.pickBackgroundImage(win) : null
  })
  ipcMain.handle('bg:dataUrl', (_e, p: string) => lib.backgroundImageDataUrl(p))

  // ============ 结构化资料：时间线 / 故事线 / 关系图 ============
  ipcMain.handle('tl:read', (_e, book: string) => structured.readTimeline(book))
  ipcMain.handle('tl:write', (_e, book: string, nodes: unknown) => structured.writeTimeline(book, nodes))
  ipcMain.handle('story:read', (_e, book: string) => structured.readStory(book))
  ipcMain.handle('story:write', (_e, book: string, nodes: unknown, edges: unknown) => structured.writeStory(book, nodes, edges))
  ipcMain.handle('chargraph:read', (_e, book: string) => structured.readCharGraph(book))
  // 面板注册表（阶段二）：内置 9 板块 + 自定义列表面板的统一通道
  ipcMain.handle('panels:list', (_e, book: string) => panels.listPanels(book))
  ipcMain.handle('panels:add', (_e, book: string, input: { name: string; fields?: unknown[] }) => panels.addPanel(book, input as never))
  ipcMain.handle('panels:rename', (_e, book: string, id: string, name: string) => panels.renamePanel(book, id, name))
  ipcMain.handle('panels:remove', (_e, book: string, id: string) => panels.removePanel(book, id))
  ipcMain.handle('panels:setHidden', (_e, book: string, id: string, hidden: boolean) => panels.setPanelHidden(book, id, hidden))
  ipcMain.handle('panels:read', (_e, book: string, panelId: string) => panels.readPanelData(book, panelId))
  ipcMain.handle('panels:write', (_e, book: string, panelId: string, data: unknown) => panels.writePanelData(book, panelId, data))
  // 词库外置（去AI味信号词/红牌追加表）
  ipcMain.handle('lexicon:read', () => lexicon.readLexicon())
  ipcMain.handle('lexicon:save', (_e, data: unknown) => lexicon.saveLexicon(data as never))
  ipcMain.handle('lexicon:open', () => lexicon.openLexicon())
  // 作者记忆：条目式存储（全局 + 书籍），设置页管理 + 智能体 read_memory/write_memory 共用
  ipcMain.handle('memory:readGlobal', () => memory.readGlobalEntries())
  ipcMain.handle('memory:writeGlobal', (_e, entries: unknown) => memory.writeGlobalEntries(entries as never))
  ipcMain.handle('memory:readBook', (_e, book: string) => memory.readBookEntries(book))
  ipcMain.handle('memory:writeBook', (_e, book: string, entries: unknown) => memory.writeBookEntries(book, entries as never))
  ipcMain.handle('memory:open', (_e, scope: 'global' | 'book', book?: string) => memory.openMemory(scope, book))
  // 建书工作流自动登记：提取结果以 preserve 增量并入词典/境界/地图/关系图
  ipcMain.handle('structure:register', (_e, book: string, payload: unknown) => structured.registerWorkflowStructure(book, (payload || {}) as structured.WorkflowExtract))
  ipcMain.handle('chargraph:write', (_e, book: string, nodes: unknown, edges: unknown) =>
    structured.writeCharGraph(book, nodes, edges)
  )

  // ============ 专名词典（书内圣经） ============
  ipcMain.handle('dict:read', (_e, book: string) => structured.readDict(book))
  ipcMain.handle('dict:write', (_e, book: string, entries: unknown) => structured.writeDict(book, entries))

  // ============ 伏笔登记 / 境界体系 / 出场追踪 ============
  ipcMain.handle('foreshadow:read', (_e, book: string) => structured.readForeshadow(book))
  ipcMain.handle('foreshadow:write', (_e, book: string, entries: unknown) => structured.writeForeshadow(book, entries))
  ipcMain.handle('power:read', (_e, book: string) => structured.readPower(book))
  ipcMain.handle('power:write', (_e, book: string, data: unknown) => structured.writePower(book, data))
  ipcMain.handle('tracking:read', (_e, book: string) => structured.readTracking(book))
  ipcMain.handle('tracking:write', (_e, book: string, entries: unknown) => structured.writeTracking(book, entries))

  // ============ 地图路线图 / 卷章细纲 ============
  ipcMain.handle('map:read', (_e, book: string) => structured.readMaps(book))
  ipcMain.handle('map:write', (_e, book: string, maps: unknown) => structured.writeMaps(book, maps))
  ipcMain.handle('map:image:save', (_e, book: string, mapId: string, dataUrl: string) => lib.saveMapImage(book, mapId, dataUrl))
  ipcMain.handle('map:image:pick', async (e, book: string, mapId: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win ? lib.pickMapImage(win, book, mapId) : null
  })
  ipcMain.handle('map:image:read', (_e, book: string, rel: string) => lib.mapImageDataUrl(book, rel))
  ipcMain.handle('outline:read', (_e, book: string) => structured.readOutline(book))
  ipcMain.handle('outline:write', (_e, book: string, entries: unknown) => structured.writeOutline(book, entries))
  ipcMain.handle('outline:upsert', (_e, book: string, patch: { vol?: string; no: number; title?: string; beat?: string; status?: '待写' | '已写' }) =>
    structured.upsertOutline(book, patch)
  )
  ipcMain.handle('outline:setStatus', (_e, book: string, no: number, status: '待写' | '已写') => structured.setOutlineStatus(book, no, status))

  // ============ AI 调用记录 ============
  ipcMain.handle('aiLog:query', (_e, filter?: ailog.AiLogFilter) => ailog.queryCalls(filter || {}))
  ipcMain.handle('aiLog:stats', () => ailog.callStats())
  ipcMain.handle('aiLog:features', () => ailog.callFeatures())
  ipcMain.handle('aiLog:clear', () => ailog.clearCalls())

  // ============ 保存与备份 ============
  const backupDirCfg = (): string => getConfig().backup?.dir || ''
  ipcMain.handle('backup:create', (_e, book: string) => backup.createBackup(book, backupDirCfg()))
  ipcMain.handle('backup:list', () => backup.listBackups(backupDirCfg()))
  ipcMain.handle('backup:delete', (_e, dir: string) => backup.deleteBackup(dir, backupDirCfg()))
  ipcMain.handle('backup:restore', (_e, dir: string) => backup.restoreBackup(dir, backupDirCfg()))
  ipcMain.handle('backup:open', () => {
    const dir = backup.backupDir(backupDirCfg())
    void shell.openPath(dir)
    return dir
  })

  // ============ 角色一人一档 ============
  ipcMain.handle('characters:readAll', (_e, book: string) => characters.readAllCharacters(book))
  ipcMain.handle('characters:saveSplit', (_e, book: string, text: string) => characters.saveCharactersFromText(book, text))
}

export function initLibraryRoot(): void {
  setLibraryRoot(getConfig().libraryRoot)
  materials.ensureLibraries()
  void saveConfig
}