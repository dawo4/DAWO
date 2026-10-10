// electron 桩：测试 bundle 时替换 electron 模块（normalize 等纯函数不会真正用到这些能力）
// 注意：需具名导出，源码里是 `import { app, dialog, shell } from 'electron'`
export const app = {
  getPath: () => '.',
  getAppPath: () => '.',
  isPackaged: false,
  whenReady: () => Promise.resolve()
}
export const BrowserWindow = class {}
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
export const shell = { openExternal: async () => {}, openPath: async () => '' }
export const ipcMain = { handle: () => {}, on: () => {} }
export const session = { defaultSession: { clearCache: async () => {} } }
