import { app, BrowserWindow, session, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { initConfig, getConfig } from './lib/config'
import { initPrompts } from './lib/prompts'
import { createBackup } from './lib/backup'
import { registerIpc, initLibraryRoot } from './ipc'
import { initUpdater } from './lib/updater'
import { migrateAllCharacterFiles } from './lib/characters'

const isDev = !!process.env.ELECTRON_RENDERER_URL
if (isDev) {
  // 开发时不走 HTTP 缓存：否则改了渲染层代码，窗口仍会加载到旧模块
  app.commandLine.appendSwitch('disable-http-cache')
}

/** 应用图标：只要图标文件在就显式设置（开发/预览模式 electron.exe 自带的是默认图标，必须覆盖；打包后 exe 已带同款图标，设置了也无害） */
function windowIcon(): string | undefined {
  const p = join(app.getAppPath(), 'build/icon.ico')
  return existsSync(p) ? p : undefined
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#14110d',
    autoHideMenuBar: true,
    show: false,
    ...(windowIcon() ? { icon: windowIcon() } : {}),
    // 无边框窗口：标题栏与窗口按钮由渲染层顶部栏自绘
    frame: false,
    // Windows 下保留 WS_THICKFRAME，无边框仍可拖边缩放、有阴影与窗口动画
    thickFrame: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 关键：窗口最小化/被遮挡时禁止渲染节流。否则 rAF 冻结会让页面切换的
      // leave 过渡永远完不成（out-in 模式下新视图无法进入），表现为「点了没反应」
      backgroundThrottling: false
    }
  })
  win.on('ready-to-show', () => win.show())
  // 最大化状态变化时通知渲染层切换按钮图标
  const notifyState = (): void => {
    if (!win.isDestroyed()) win.webContents.send('win:state', { maximized: win.isMaximized() })
  }
  win.on('maximize', notifyState)
  win.on('unmaximize', notifyState)
  win.on('enter-full-screen', notifyState)
  win.on('leave-full-screen', notifyState)
  // 渲染层日志转发到主进程 stdout，便于调试
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  initConfig()
  initPrompts()
  initLibraryRoot()
  registerIpc()
  // 旧书迁移：整包角色卡拆成一人一档（幂等，旧文件留 .bak），异步跑不阻塞启动
  setTimeout(() => {
    try {
      migrateAllCharacterFiles()
    } catch {
      /* 迁移失败不阻塞启动，下次再试 */
    }
  }, 3000)
  // 开发时清一次缓存，避免旧模块被复用
  if (isDev) {
    try {
      await session.defaultSession.clearCache()
    } catch {
      /* 清理失败不影响启动 */
    }
  }
  createWindow()
  // 自动更新（GitHub Releases 源）：IPC handler 必须始终注册（否则 dev 下点「检查更新」报 No handler registered），
  // 仅打包模式才真正启用 electron-updater；失败静默，设置→关于里可手动查
  initUpdater(isDev)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 退出时按配置自动备份当前作品（cpSync 同步执行，quit 前能完成）
  try {
    const cfg = getConfig()
    if (cfg.backup?.autoOnExit && cfg.activeBook) {
      createBackup(cfg.activeBook, cfg.backup?.dir)
    }
  } catch {
    /* 备份失败不阻塞退出 */
  }
  app.quit()
})
