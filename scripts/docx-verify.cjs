// docx 产物自检：解包检查 word/media 扩展名与 [Content_Types].xml 映射
// 背景：docx@9 的 ImageRun 不传 type 时媒体文件名落成 <hash>.undefined，Word/WPS 能猜格式显示，
// 但按扩展名解析图片的读取器（如小黑盒上传）直接失败。此模块纯 Node 实现（内置 zlib，无依赖）。
const zlib = require('zlib')

const ALLOWED_IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'emf', 'wmf', 'tiff', 'webp']

/**
 * 校验 docx buffer：
 * 1. word/media/ 内所有文件必须是标准图片扩展名（.undefined / 无后缀即报错）
 * 2. [Content_Types].xml 必须为实际用到的每种图片扩展名提供映射
 * @returns {{ images: number, exts: string[] }}
 */
function verifyDocx(buf) {
  // 定位 ZIP End Of Central Directory（允许最长 65536 字节注释）
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('docx 自检失败：不是有效的 ZIP（找不到 EOCD）')
  const count = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16)
  const mediaExts = new Set()
  let mediaFiles = 0
  let contentTypesXml = null
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('docx 自检失败：中央目录损坏')
    const method = buf.readUInt16LE(ptr + 10)
    const compSize = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOff = buf.readUInt32LE(ptr + 42)
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8')
    if (name.startsWith('word/media/')) {
      const base = name.slice('word/media/'.length)
      if (base) {
        const dot = base.lastIndexOf('.')
        const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
        mediaExts.add(ext)
        mediaFiles++
        if (!ALLOWED_IMG_EXT.includes(ext)) {
          throw new Error(`docx 自检失败：非标准图片扩展名 "${name}"（ImageRun 需显式传 type: 'png'）`)
        }
      }
    }
    if (name === '[Content_Types].xml') {
      const lNameLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const start = localOff + 30 + lNameLen + lExtraLen
      const raw = buf.slice(start, start + compSize)
      contentTypesXml = (method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8')
    }
    ptr += 46 + nameLen + extraLen + commentLen
  }
  if (mediaExts.size && !contentTypesXml) throw new Error('docx 自检失败：缺少 [Content_Types].xml')
  for (const ext of mediaExts) {
    const mapped = contentTypesXml.includes(`Extension="${ext}"`) || contentTypesXml.includes(`Extension="${ext.toUpperCase()}"`)
    if (!mapped) throw new Error(`docx 自检失败：[Content_Types].xml 缺少 "${ext}" 的映射，按扩展名解析的读取器会失败`)
  }
  return { images: mediaFiles, exts: [...mediaExts] }
}

module.exports = { verifyDocx }
