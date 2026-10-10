import { defineStore } from 'pinia'
import type { BookMeta } from '../types'

export interface TreeNode {
  name: string
  path: string
  dir: boolean
  children?: TreeNode[]
}

interface State {
  books: BookMeta[]
  current: BookMeta | null
  tree: TreeNode[]
}

export const useLibraryStore = defineStore('library', {
  state: (): State => ({ books: [], current: null, tree: [] }),
  actions: {
    async loadBooks() {
      this.books = (await window.api.booksList()) as unknown as BookMeta[]
    },
    async openBook(title: string) {
      this.current = (await window.api.bookMetaRead(title)) as unknown as BookMeta
      await this.refreshTree()
      await window.api.configUpdate({ activeBook: title })
      const { useAppStore } = await import('./app')
      const app = useAppStore()
      if (app.config) app.config.activeBook = title
    },
    async refreshTree() {
      if (!this.current) return
      this.tree = (await window.api.treeList(this.current.title)) as unknown as TreeNode[]
    },
    async saveMeta(patch: Partial<BookMeta>) {
      if (!this.current) return
      this.current = (await window.api.bookMetaWrite(this.current.title, patch as Record<string, unknown>)) as unknown as BookMeta
    },
    chapterList(): TreeNode[] {
      const ch = this.tree.find((n) => n.name === '正文')
      return (ch?.children || []).filter((n) => !n.dir)
    },
    async todayStats(): Promise<{ handwritten: number; ai: number }> {
      if (!this.current) return { handwritten: 0, ai: 0 }
      const s = await window.api.statsGet(this.current.title)
      const day = new Date().toISOString().slice(0, 10)
      return s.days[day] || { handwritten: 0, ai: 0 }
    }
  }
})
