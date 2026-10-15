// 自动更新：electron-updater 走 GitHub Releases（publish 配置在 electron-builder.yml）
// 仓库当前私有：latest.yml 拉不到（404），错误统一转成人话并给 Releases 页兜底入口；转公开后全自动生效
import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain, app, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getConfig } from './config'
import { createBackup } from './backup'

const RELEASES_URL = 'https://github.com/dawo4/DAWO/releases'
const RELEASES_API = 'https://api.github.com/repos/dawo4/DAWO/releases/latest'

// 自动检查频率的节流记录（userData/update-check.json，只存上次检查时间戳）
const DAY_MS = 24 * 3600 * 1000

function lastCheckAt(): number {
  try {
    const p = join(app.getPath('userData'), 'update-check.json')
    if (existsSync(p)) return Number(JSON.parse(readFileSync(p, 'utf-8')).lastCheck) || 0
  } catch {
    /* 损坏按未检查过处理 */
  }
  return 0
}

function markChecked(): void {
  try {
    writeFileSync(join(app.getPath('userData'), 'update-check.json'), JSON.stringify({ lastCheck: Date.now() }), 'utf-8')
  } catch {
    /* 记不上就当每次都查 */
  }
}

/** 按设置决定要不要静默自动检查：关了 / 仅手动不查；每天一次则距上次检查不足 24h 跳过 */
function maybeAutoCheck(): void {
  const u = getConfig().update
  if (!u || u.autoCheck === false) return
  const freq = u.frequency || 'startup'
  if (freq === 'manual') return
  if (freq === 'daily' && Date.now() - lastCheckAt() < DAY_MS) return
  setTimeout(() => {
    autoUpdater
      .checkForUpdates()
      .catch(() => {})
      .finally(markChecked)
  }, 15000)
}

/** 给不带超时的 Promise 加兜底：到点仍未完成就按超时失败（原 Promise 结果丢弃） */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时：连不上更新源（网络原因，可尝试开代理后重试）`)), ms)
    timer.unref?.()
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

function send(status: string, payload?: Record<string, unknown>): void {
  try {
    // 窗口可能在激活时重建，发送时动态取最新一个
    const win = BrowserWindow.getAllWindows().at(-1)
    win?.webContents.send('update:status', { status, ...payload })
  } catch {
    /* 窗口已关 */
  }
}

function friendlyError(e: Error & { description?: string }): string {
  const raw = `${e.message || ''} ${e.description || ''}`
  if (/404|not found/i.test(raw)) return '没有拉到更新信息：仓库还是私有，或最新 Release 里没有更新元数据。可到 Releases 页手动下载。'
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|timeout|net::/i.test(raw)) return '连不上 GitHub（网络原因）。可开代理后重试，或直接到 Releases 页下载。'
  return raw.slice(0, 200) || '未知错误'
}

export function initUpdater(devMode: boolean): void {
  // IPC handler 永远注册：dev 下点「检查更新」要给出明确提示，而不是「No handler registered」
  // electron-updater 的初始化与自动检查只在打包模式启用（dev 下无更新源，checkForUpdates 会直接报错）

  ipcMain.handle('update:check', async () => {
    if (devMode) return { ok: false, message: '开发模式没有更新源，请用打包版检查更新。' }
    try {
      // 30 秒兜底超时：electron-updater 的请求没有自带超时，网络不通（如需要代理而没开）时会无限挂起，
      // 表现为渲染层永远停在「正在检查…」
      const r = await withTimeout(autoUpdater.checkForUpdates(), 30000, '检查更新')
      markChecked()
      return { ok: true, version: r?.updateInfo?.version || '' }
    } catch (e) {
      return { ok: false, message: friendlyError(e as Error & { description?: string }) }
    }
  })
  ipcMain.handle('update:download', () => {
    if (!devMode) autoUpdater.downloadUpdate().catch(() => {})
    return { ok: true }
  })
  ipcMain.handle('update:install', async () => {
    if (devMode) return { ok: true }
    // 安装前自动备份当前作品（可在「保存与备份」里关）：更新有风险，稿子先行
    try {
      const cfg = getConfig()
      if (cfg.backup?.backupOnUpdate !== false && cfg.activeBook) {
        createBackup(cfg.activeBook, cfg.backup?.dir)
      }
    } catch {
      /* 备份失败不拦安装（备份目录不可写等场景，更新照常进行） */
    }
    autoUpdater.quitAndInstall()
    return { ok: true }
  })
  ipcMain.handle('update:openPage', async () => {
    await shell.openExternal(RELEASES_URL)
    return { ok: true }
  })
  // 更新日志：拉最新 Release 的说明（Markdown）、发布日期与安装包体积，供设置页展示
  ipcMain.handle('update:notes', async () => {
    try {
      const res = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DAWO-updater' },
        signal: AbortSignal.timeout(20000)
      })
      if (!res.ok) {
        const hint = res.status === 403 ? '（请求频率受限，稍后再试）' : res.status === 404 ? '（仓库私有或还没有 Release）' : ''
        return { ok: false, message: `GitHub 接口返回 ${res.status}${hint}` }
      }
      const j = (await res.json()) as {
        tag_name?: string
        body?: string
        published_at?: string
        html_url?: string
        assets?: { name: string; size: number }[]
      }
      const exe = (j.assets || []).find((a) => /\.(exe|nsis|zip)$/i.test(a.name))
      return {
        ok: true,
        tag: (j.tag_name || '').replace(/^v/, ''),
        notes: j.body || '',
        publishedAt: j.published_at || '',
        sizeBytes: exe?.size || 0,
        htmlUrl: j.html_url || RELEASES_URL
      }
    } catch (e) {
      return { ok: false, message: friendlyError(e as Error) }
    }
  })

  // 打包模式：初始化 electron-updater 并按设置自动检查。
  // 放在所有 handler 注册之后——前面任何一步同步抛错都不会再连累 handler 注册不上
  if (devMode) return
  autoUpdater.autoDownload = false // 用户点了才下载
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send('checking'))
  autoUpdater.on('update-available', (i) => send('available', { version: i.version }))
  autoUpdater.on('update-not-available', (i) => send('none', { version: i.version }))
  autoUpdater.on('download-progress', (p) =>
    send('downloading', {
      percent: Math.round(p.percent),
      transferred: Math.round(p.transferred),
      total: Math.round(p.total),
      bps: Math.round(p.bytesPerSecond)
    })
  )
  autoUpdater.on('update-downloaded', (i) => send('downloaded', { version: i.version }))
  autoUpdater.on('error', (e) => send('error', { message: friendlyError(e as Error & { description?: string }) }))

  // 启动 15 秒后按设置静默检查，不打扰
  maybeAutoCheck()
}
