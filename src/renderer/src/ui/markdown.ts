import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

/** 渲染智能体输出的 Markdown（内容全部来自本机模型，仍剥离脚本标签兜底） */
export function renderMarkdown(src: string): string {
  if (!src) return ''
  const html = marked.parse(src, { async: false }) as string
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/ on[a-z]+="[^"]*"/gi, '')
}