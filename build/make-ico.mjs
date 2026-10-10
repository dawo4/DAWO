// 把 build/icon.png 转成多尺寸 build/icon.ico（electron-builder Windows 图标）
import pngToIco from 'png-to-ico'
import { writeFileSync } from 'fs'

const ico = await pngToIco(['build/icon.png'])
writeFileSync('build/icon.ico', ico)
console.log('build/icon.ico written,', ico.length, 'bytes')
