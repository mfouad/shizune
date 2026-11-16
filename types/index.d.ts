export type Item = {
  id: string
  text: string
  isDone: boolean
  createdAt: number
  sentToSession?: boolean
}

export type StorageMode = 'ideas' | 'todo' | 'local'

declare module 'claude-code' {
  interface PluginState {
    'shizune': {
      items: Shaped<Item[]>
      status: string | null
      mode: StorageMode
      tab: 'open' | 'done'
    }
  }
}
