import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

const api = {
  // ============ 无边框窗口控制 ============
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winMaximizeToggle: () => ipcRenderer.invoke('win:maximizeToggle'),
  winClose: () => ipcRenderer.invoke('win:close'),
  winIsMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  winOnState: (cb: (s: { maximized: boolean }) => void) => {
    const handler = (_e: IpcRendererEvent, s: { maximized: boolean }) => cb(s)
    ipcRenderer.on('win:state', handler)
    return () => ipcRenderer.removeListener('win:state', handler)
  },

  configGet: () => ipcRenderer.invoke('config:get'),
  configUpdate: (patch: Record<string, unknown>) => ipcRenderer.invoke('config:update', patch),

  booksList: () => ipcRenderer.invoke('books:list'),
  bookCreate: (meta: Record<string, unknown>) => ipcRenderer.invoke('book:create', meta),
  bookDelete: (title: string) => ipcRenderer.invoke('book:delete', title),
  bookRename: (oldTitle: string, newTitle: string) => ipcRenderer.invoke('book:rename', oldTitle, newTitle),
  bookMetaRead: (book: string) => ipcRenderer.invoke('book:meta:read', book),
  bookMetaWrite: (book: string, patch: Record<string, unknown>) => ipcRenderer.invoke('book:meta:write', book, patch),

  fileRead: (book: string, rel: string) => ipcRenderer.invoke('file:read', book, rel),
  fileWrite: (book: string, rel: string, content: string) => ipcRenderer.invoke('file:write', book, rel, content),
  fileDelete: (book: string, rel: string) => ipcRenderer.invoke('file:delete', book, rel),
  historyList: (book: string, rel: string) => ipcRenderer.invoke('history:list', book, rel),
  historyRead: (book: string, rel: string, file: string) => ipcRenderer.invoke('history:read', book, rel, file),
  historyRestore: (book: string, rel: string, file: string) => ipcRenderer.invoke('history:restore', book, rel, file),
  historyDiff: (book: string, rel: string, file: string) => ipcRenderer.invoke('history:diff', book, rel, file),
  batchRevise: (params: { runId: string; book: string; chapters: { path: string; title: string }[]; instruction: string }) =>
    ipcRenderer.invoke('batch:revise', params),
  batchAbort: (runId: string) => ipcRenderer.invoke('batch:abort', runId),

  // ============ 向量语义检索 ============
  vectorSearch: (book: string, query: string, topK?: number, opts?: Record<string, unknown>) =>
    ipcRenderer.invoke('vector:search', book, query, topK, opts),
  vectorStatus: (book: string) => ipcRenderer.invoke('vector:status', book),
  vectorUpdate: (book: string) => ipcRenderer.invoke('vector:update', book),
  vectorRebuild: (book: string) => ipcRenderer.invoke('vector:rebuild', book),
  vectorClear: (book: string) => ipcRenderer.invoke('vector:clear', book),
  vectorTest: (baseUrl: string, apiKey: string, model: string) => ipcRenderer.invoke('vector:test', baseUrl, apiKey, model),

  treeList: (book: string) => ipcRenderer.invoke('tree:list', book),

  statsGet: (book: string) => ipcRenderer.invoke('stats:get', book),
  statsAdd: (book: string, hand: number, ai: number) => ipcRenderer.invoke('stats:add', book, hand, ai),
  statsRecord: (book: string, rel: string, len: number) => ipcRenderer.invoke('stats:record', book, rel, len),

  importPick: () => ipcRenderer.invoke('import:pick'),
  importPickText: () => ipcRenderer.invoke('import:pickText'),
  importMigrate: (mode: 'each' | 'merge', mergeTitle: string) => ipcRenderer.invoke('import:migrate', mode, mergeTitle),
  importFile: (book: string, filePath: string) => ipcRenderer.invoke('import:file', book, filePath),
  openLibrary: () => ipcRenderer.invoke('app:openLibrary'),
  presetLastUpdate: () => ipcRenderer.invoke('preset:lastUpdate'),

  promptsList: () => ipcRenderer.invoke('prompts:list'),
  promptsGet: (id: string) => ipcRenderer.invoke('prompts:get', id),
  promptsSave: (id: string, content: string) => ipcRenderer.invoke('prompts:save', id, content),
  promptsDir: () => ipcRenderer.invoke('prompts:dir'),

  aiRun: (params: Record<string, unknown>) => ipcRenderer.invoke('ai:run', params),
  aiAbort: (runId: string) => ipcRenderer.invoke('ai:abort', runId),
  aiFetchModels: (provider: Record<string, string>) => ipcRenderer.invoke('ai:fetchModels', provider),
  aiTestProvider: (provider: Record<string, string>, model: string) => ipcRenderer.invoke('ai:testProvider', provider, model),
  aiProviderSearchSupported: (baseUrl: string) => ipcRenderer.invoke('ai:providerSearchSupported', baseUrl),
  aiOnEvent: (cb: (evt: { runId: string; type: string; payload?: unknown }) => void) => {
    const handler = (_e: IpcRendererEvent, evt: { runId: string; type: string; payload?: unknown }) => cb(evt)
    ipcRenderer.on('ai:event', handler)
    return () => ipcRenderer.removeListener('ai:event', handler)
  },

  // ============ 智能体 ============
  agentRun: (params: Record<string, unknown>) => ipcRenderer.invoke('agent:run', params),
  agentAbort: (runId: string) => ipcRenderer.invoke('agent:abort', runId),
  agentSubagentDecide: (id: string, allow: boolean) => ipcRenderer.invoke('agent:subagentDecide', id, allow),
  agentProposals: () => ipcRenderer.invoke('agent:proposals'),
  agentBookFiles: (book: string) => ipcRenderer.invoke('agent:bookFiles', book),
  proposalApply: (id: string) => ipcRenderer.invoke('proposal:apply', id),
  proposalReject: (id: string) => ipcRenderer.invoke('proposal:reject', id),
  libProposalApply: (id: string, keys?: string[]) => ipcRenderer.invoke('libProposal:apply', id, keys),
  libProposalReject: (id: string) => ipcRenderer.invoke('libProposal:reject', id),
  agentOnEvent: (cb: (evt: { runId: string; type: string; payload?: unknown }) => void) => {
    const handler = (_e: IpcRendererEvent, evt: { runId: string; type: string; payload?: unknown }) => cb(evt)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  },

  // ============ 自定义智能体（智能体库） ============
  customAgentsList: () => ipcRenderer.invoke('customAgents:list'),
  customAgentsSave: (a: Record<string, unknown>) => ipcRenderer.invoke('customAgents:save', a),
  customAgentsDelete: (id: string) => ipcRenderer.invoke('customAgents:delete', id),
  customAgentsSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('customAgents:setEnabled', id, enabled),
  customAgentsDraft: (desc: string, bookContext: string) => ipcRenderer.invoke('customAgents:draft', desc, bookContext),
  agentSummarize: (history: { role: 'user' | 'assistant'; content: string }[]) => ipcRenderer.invoke('agent:summarize', history),

  // ============ 会话 ============
  convList: (book: string) => ipcRenderer.invoke('conv:list', book),
  convLoad: (book: string, id: string) => ipcRenderer.invoke('conv:load', book, id),
  convSave: (book: string, conv: Record<string, unknown>) => ipcRenderer.invoke('conv:save', book, conv),
  convDelete: (book: string, id: string) => ipcRenderer.invoke('conv:delete', book, id),
  convExport: (book: string, id: string) => ipcRenderer.invoke('conv:export', book, id),

  // ============ 素材库 / 技能库 ============
  libList: (kind: string) => ipcRenderer.invoke('lib:list', kind),
  libRead: (kind: string, group: string, name: string) => ipcRenderer.invoke('lib:read', kind, group, name),
  libWrite: (kind: string, group: string, name: string, summary: string, tags: string[], body: string) =>
    ipcRenderer.invoke('lib:write', kind, group, name, summary, tags, body),
  libDelete: (kind: string, group: string, name: string) => ipcRenderer.invoke('lib:delete', kind, group, name),
  libCreateGroup: (kind: string, group: string) => ipcRenderer.invoke('lib:createGroup', kind, group),
  libDeleteGroup: (kind: string, group: string) => ipcRenderer.invoke('lib:deleteGroup', kind, group),
  libImportSkill: (group: string) => ipcRenderer.invoke('lib:importSkill', group),
  libRoot: () => ipcRenderer.invoke('lib:root'),
  libOpen: (kind: string) => ipcRenderer.invoke('lib:open', kind),

  // ============ 外观：背景图 ============
  bgPick: () => ipcRenderer.invoke('bg:pick'),
  bgDataUrl: (p: string) => ipcRenderer.invoke('bg:dataUrl', p),

  // ============ 结构化资料 ============
  tlRead: (book: string) => ipcRenderer.invoke('tl:read', book),
  tlWrite: (book: string, nodes: unknown) => ipcRenderer.invoke('tl:write', book, nodes),
  storyRead: (book: string) => ipcRenderer.invoke('story:read', book),
  storyWrite: (book: string, nodes: unknown, edges: unknown) => ipcRenderer.invoke('story:write', book, nodes, edges),
  dictRead: (book: string) => ipcRenderer.invoke('dict:read', book),
  dictWrite: (book: string, entries: unknown) => ipcRenderer.invoke('dict:write', book, entries),
  foreshadowRead: (book: string) => ipcRenderer.invoke('foreshadow:read', book),
  foreshadowWrite: (book: string, entries: unknown) => ipcRenderer.invoke('foreshadow:write', book, entries),
  powerRead: (book: string) => ipcRenderer.invoke('power:read', book),
  powerWrite: (book: string, data: unknown) => ipcRenderer.invoke('power:write', book, data),
  trackingRead: (book: string) => ipcRenderer.invoke('tracking:read', book),
  trackingWrite: (book: string, entries: unknown) => ipcRenderer.invoke('tracking:write', book, entries),
  mapRead: (book: string) => ipcRenderer.invoke('map:read', book),
  mapWrite: (book: string, maps: unknown) => ipcRenderer.invoke('map:write', book, maps),
  mapImageSave: (book: string, mapId: string, dataUrl: string) => ipcRenderer.invoke('map:image:save', book, mapId, dataUrl),
  mapImagePick: (book: string, mapId: string) => ipcRenderer.invoke('map:image:pick', book, mapId),
  mapImageRead: (book: string, rel: string) => ipcRenderer.invoke('map:image:read', book, rel),
  outlineRead: (book: string) => ipcRenderer.invoke('outline:read', book),
  outlineWrite: (book: string, entries: unknown) => ipcRenderer.invoke('outline:write', book, entries),
  outlineUpsert: (book: string, patch: Record<string, unknown>) => ipcRenderer.invoke('outline:upsert', book, patch),
  outlineSetStatus: (book: string, no: number, status: string) => ipcRenderer.invoke('outline:setStatus', book, no, status),
  charGraphRead: (book: string) => ipcRenderer.invoke('chargraph:read', book),
  structureRegister: (book: string, payload: unknown) => ipcRenderer.invoke('structure:register', book, payload),
  panelsList: (book: string) => ipcRenderer.invoke('panels:list', book),
  panelsAdd: (book: string, input: { name: string; fields?: unknown[] }) => ipcRenderer.invoke('panels:add', book, input),
  panelsRename: (book: string, id: string, name: string) => ipcRenderer.invoke('panels:rename', book, id, name),
  panelsRemove: (book: string, id: string) => ipcRenderer.invoke('panels:remove', book, id),
  panelsSetHidden: (book: string, id: string, hidden: boolean) => ipcRenderer.invoke('panels:setHidden', book, id, hidden),
  panelsRead: (book: string, panelId: string) => ipcRenderer.invoke('panels:read', book, panelId),
  panelsWrite: (book: string, panelId: string, data: unknown) => ipcRenderer.invoke('panels:write', book, panelId, data),
  lexiconRead: () => ipcRenderer.invoke('lexicon:read'),
  lexiconSave: (data: unknown) => ipcRenderer.invoke('lexicon:save', data),
  lexiconOpen: () => ipcRenderer.invoke('lexicon:open'),
  memoryReadGlobal: () => ipcRenderer.invoke('memory:readGlobal'),
  memoryWriteGlobal: (entries: unknown) => ipcRenderer.invoke('memory:writeGlobal', entries),
  memoryReadBook: (book: string) => ipcRenderer.invoke('memory:readBook', book),
  memoryWriteBook: (book: string, entries: unknown) => ipcRenderer.invoke('memory:writeBook', book, entries),
  memoryOpen: (scope: 'global' | 'book', book?: string) => ipcRenderer.invoke('memory:open', scope, book),
  charGraphWrite: (book: string, nodes: unknown, edges: unknown) =>
    ipcRenderer.invoke('chargraph:write', book, nodes, edges),

  // ============ AI 调用记录 ============
  aiLogQuery: (filter?: Record<string, unknown>) => ipcRenderer.invoke('aiLog:query', filter),
  aiLogStats: () => ipcRenderer.invoke('aiLog:stats'),
  aiLogFeatures: () => ipcRenderer.invoke('aiLog:features'),
  aiLogClear: () => ipcRenderer.invoke('aiLog:clear'),

  // ============ 保存与备份 ============
  backupCreate: (book: string) => ipcRenderer.invoke('backup:create', book),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupDelete: (dir: string) => ipcRenderer.invoke('backup:delete', dir),
  backupRestore: (dir: string) => ipcRenderer.invoke('backup:restore', dir),
  backupOpen: () => ipcRenderer.invoke('backup:open'),

  // ============ 角色一人一档 ============
  charactersReadAll: (book: string) => ipcRenderer.invoke('characters:readAll', book),
  charactersSaveSplit: (book: string, text: string) => ipcRenderer.invoke('characters:saveSplit', book, text),

  // ============ 自动更新 ============
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateOpenPage: () => ipcRenderer.invoke('update:openPage'),
  updateNotes: () => ipcRenderer.invoke('update:notes'),
  onUpdateStatus: (cb: (s: { status: string; version?: string; percent?: number; message?: string }) => void) => {
    const listener = (_e: unknown, s: { status: string; version?: string; percent?: number; message?: string }) => cb(s)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api