import { defineStore } from 'pinia'
import type { LibGroup, LibKind } from '../types'

interface State {
  materials: LibGroup[]
  skills: LibGroup[]
  notes: LibGroup[]
  loading: boolean
}

export const useLibrariesStore = defineStore('libraries', {
  state: (): State => ({
    materials: [],
    skills: [],
    notes: [],
    loading: false
  }),

  getters: {
    groups: (s) => (kind: LibKind): LibGroup[] => (kind === 'skills' ? s.skills : kind === 'notes' ? s.notes : s.materials)
  },

  actions: {
    async refresh(kind?: LibKind) {
      this.loading = true
      try {
        const kinds: LibKind[] = kind ? [kind] : ['materials', 'skills', 'notes']
        for (const k of kinds) {
          const list = (await window.api.libList(k)) as LibGroup[]
          if (k === 'skills') this.skills = list
          else if (k === 'notes') this.notes = list
          else this.materials = list
        }
      } finally {
        this.loading = false
      }
    },

    async read(kind: LibKind, group: string, name: string) {
      return (await window.api.libRead(kind, group, name)) as {
        name: string
        summary: string
        tags: string[]
        updatedAt: string
        body: string
      }
    },

    async write(kind: LibKind, group: string, name: string, summary: string, tags: string[], body: string) {
      await window.api.libWrite(kind, group, name, summary, tags, body)
      await this.refresh(kind)
    },

    async remove(kind: LibKind, group: string, name: string) {
      await window.api.libDelete(kind, group, name)
      await this.refresh(kind)
    },

    async createGroup(kind: LibKind, group: string) {
      await window.api.libCreateGroup(kind, group)
      await this.refresh(kind)
    },

    async deleteGroup(kind: LibKind, group: string) {
      await window.api.libDeleteGroup(kind, group)
      await this.refresh(kind)
    },

    async importSkill(group: string): Promise<string | null> {
      const name = (await window.api.libImportSkill(group)) as string | null
      if (name) await this.refresh('skills')
      return name
    },

    async open(kind: LibKind) {
      await window.api.libOpen(kind)
    }
  }
})