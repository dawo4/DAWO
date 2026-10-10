// 自动更新：electron-updater 走 GitHub Releases（publish 配置在 electron-builder.yml）
// 仓库当前私有：latest.yml 拉不到（404），错误统一转成人话并给 Releases 页兜底入口；转公开后全自动生效
import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain, shell } from 'electron'

const RELEASES_URL = 'https://github.com/dawo4/DAWO/releases'

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

export function initUpdater(): void {
  autoUpdater.autoDownload = false // 用户点了才下载
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send('checking'))
  autoUpdater.on('update-available', (i) => send('available', { version: i.version }))
  autoUpdater.on('update-not-available', (i) => send('none', { version: i.version }))
  autoUpdater.on('download-progress', (p) => send('downloading', { percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => send('downloaded', { version: i.version }))
  autoUpdater.on('error', (e) => send('error', { message: friendlyError(e as Error & { description?: string }) }))

  // 启动 15 秒后静默查一次，不打扰
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 15000)

  ipcMain.handle('update:check', async () => {
    try {
      const r = await autoUpdater.checkForUpdates()
      return { ok: true, version: r?.updateInfo?.version || '' }
    } catch (e) {
      return { ok: false, message: friendlyError(e as Error & { description?: string }) }
    }
  })
  ipcMain.handle('update:download', () => {
    autoUpdater.downloadUpdate().catch(() => {})
    return { ok: true }
  })
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
    return { ok: true }
  })
  ipcMain.handle('update:openPage', async () => {
    await shell.openExternal(RELEASES_URL)
    return { ok: true }
  })
}
