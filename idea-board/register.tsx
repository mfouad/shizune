import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item, StorageMode } from '../types'

const PANE = 'idea-board'
const TITLE = 'Ideas'

const items = atom({ plugin: 'shizune', key: 'items' } as const, [], { shape: 'items-1' })
const status = atom({ plugin: 'shizune', key: 'status' } as const, null)
const mode = atom({ plugin: 'shizune', key: 'mode' } as const, 'local')
const tab = atom({ plugin: 'shizune', key: 'tab' } as const, 'open')

type Saved = { items: Item[] }

function titleOf(item: Item): string {
  const first = (item.text.split('\n')[0] ?? '').trim()
  return first.length > 120 ? first.slice(0, 117) + '...' : first
}

// ---- Storage -------------------------------------------------------------
//
// 'ideas': <session folder>/.claude/ideas.md
// 'todo':  <session folder>/TODO.md
// 'local': this machine only, in the mod's own store ($.store)
//
// In both files the board owns only the block between the two markers, so
// anything else in TODO.md is left alone. $.store always keeps a copy too.

const START = '<!-- idea-board:start (managed by Shizune; edit freely, keep these markers) -->'
const END = '<!-- idea-board:end -->'
const MODES: { mode: StorageMode; label: string }[] = [
  { mode: 'ideas', label: '.claude/ideas.md' },
  { mode: 'todo', label: 'TODO.md' },
  { mode: 'local', label: 'Local only' },
]


let cwd = '.'
let storeKey = 'board'
let modeKey = 'mode'
let lastWritten = ''

function pathFor(m: StorageMode): string | null {
  if (m === 'ideas') return `${cwd}/.claude/ideas.md`
  if (m === 'todo') return `${cwd}/TODO.md`
  return null
}

function labelFor(m: StorageMode): string {
  return MODES.find(x => x.mode === m)?.label ?? m
}

type Meta = { id?: string; c?: number; s?: 1 }

function toMarkdown(saved: Saved): string {
  const out: string[] = [START]
  out.push('', '## Tasks', '')
  if (saved.items.length === 0) out.push('_No tasks yet._')
  for (const i of saved.items) {
    const [first = '', ...rest] = i.text.split('\n')
    const meta: Meta = { id: i.id, c: i.createdAt }
    if (i.sentToSession) meta.s = 1
    out.push(`- [${i.isDone ? 'x' : ' '}] ${first.trim()} <!-- ib:${JSON.stringify(meta)} -->`)
    for (const line of rest) if (line.trim()) out.push(`  ${line.trim()}`)
  }
  out.push('', END)
  return out.join('\n')
}

function fromMarkdown(text: string): Saved | null {
  const a = text.indexOf(START.slice(0, 22))
  const b = text.indexOf(END)
  if (a < 0 || b < a) return null
  const lines = text.slice(a, b).split('\n')
  const list: Item[] = []
  let n = 0
  for (const line of lines) {
    const it = line.match(/^[-*] \[( |x|X)\] (.*?)\s*(?:<!-- ib:(\{.*\}) -->)?\s*$/)
    if (it) {
      let meta: Meta = {}
      try {
        meta = it[3] ? (JSON.parse(it[3]) as Meta) : {}
      } catch {}
      n += 1
      list.push({
        id: meta.id ?? `md-${n}-${(it[2] ?? '').slice(0, 24)}`,
        text: (it[2] ?? '').trim(),
        isDone: it[1] !== ' ',
        createdAt: meta.c ?? 0,
        ...(meta.s ? { sentToSession: true } : {}),
      })
      continue
    }
    const last = list[list.length - 1]
    if (last && /^\s{2,}\S/.test(line)) last.text += `\n${line.trim()}`
  }
  return { items: list }
}

async function readFile($: EngineInterface, path: string): Promise<string | null> {
  if (!(await $.fs.exists(path))) return null
  return String(await $.fs.read(path))
}

async function loadFrom($: EngineInterface, m: StorageMode): Promise<Saved | null> {
  const path = pathFor(m)
  if (!path) return ((await $.store.get(storeKey)) as Saved | undefined) ?? null
  const text = await readFile($, path)
  return text === null ? null : fromMarkdown(text)
}

async function save($: EngineInterface) {
  const saved: Saved = { items: await read($, items) }
  await $.store.set(storeKey, saved)
  const path = pathFor(await read($, mode))
  if (!path) return
  try {
    const block = toMarkdown(saved)
    const old = (await readFile($, path)) ?? ''
    const a = old.indexOf(START.slice(0, 22))
    const b = old.indexOf(END)
    const head = path.endsWith('TODO.md') ? '# TODO' : '# Ideas'
    const next =
      a >= 0 && b > a
        ? old.slice(0, a) + block + old.slice(b + END.length)
        : old.trim()
          ? `${old.replace(/\s*$/, '')}\n\n${block}\n`
          : `${head}\n\n${block}\n`
    lastWritten = next
    await $.fs.write(path, next)
  } catch (err) {
    await update($, status, () => `Could not write ${path}: ${String(err)}`)
  }
}

// Reload from the chosen file when it changed outside the pane (by hand, or
// by Claude). Local mode has nothing to reload.
async function reloadIfChanged($: EngineInterface) {
  const path = pathFor(await read($, mode))
  if (!path) return
  try {
    const text = await readFile($, path)
    if (text === null || text === lastWritten) return
    lastWritten = text
    const saved = fromMarkdown(text)
    if (!saved) return
    await update($, items, () => saved.items)
  } catch {}
}

// Switching keeps everything: items already in the target are merged with
// the current list (by id), then the result is written there.
async function switchMode($: EngineInterface, m: StorageMode) {
  if ((await read($, mode)) === m) return
  const there = await loadFrom($, m)
  const here = await read($, items)
  if (there) {
    const ids = new Set(there.items.map(i => i.id))
    await update($, items, () => [...there.items, ...here.filter(i => !ids.has(i.id))])
  }
  await update($, mode, () => m)
  await $.store.set(modeKey, m)
  await save($)
  $.ui.toast(`Saving to ${labelFor(m)}`)
}

let seq = 0

// "todo: buy milk" at the start of a line. Case does not matter.
const TODO_LINE = /^\s*todo\s*:\s*(.*)$/i

function stripTodo(text: string): string {
  const m = text.match(TODO_LINE)
  return (m ? (m[1] ?? '') : text).trim()
}

async function addTasks($: EngineInterface, texts: string[]) {
  const now = await $.clock.now()
  const fresh: Item[] = texts
    .map(t => t.trim())
    .filter(t => t !== '')
    .map(text => {
      seq += 1
      return { id: `${now}-${seq}`, text, isDone: false, createdAt: now }
    })
  if (fresh.length === 0) return 0
  await update($, items, l => [...fresh, ...l])
  await save($)
  return fresh.length
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    cwd = await $.session.cwd()
    storeKey = `board:${cwd}`
    modeKey = `mode:${cwd}`
    const m = ((await $.store.get(modeKey)) as StorageMode | undefined) ?? 'local'
    await update($, mode, () => m)
    try {
      const saved = (await loadFrom($, m)) ?? (await loadFrom($, 'local'))
      if (saved) {
        await update($, items, () => saved.items ?? [])
      }
      const path = pathFor(m)
      if (path) lastWritten = (await readFile($, path)) ?? ''
    } catch (err) {
      await update($, status, () => `Could not read ${labelFor(m)}: ${String(err)}`)
    }

    await $.command.register({
      name: 'ideas',
      description: 'Open the idea board: tasks for this project',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  // Lines of a typed message that start with "todo:" become tasks. They are
  // taken out of the message; a message of nothing but todo lines is stopped.
  on('prompt.submit', async ($, e, next) => {
    const typed = e.origin?.kind === 'composer' || e.origin?.kind === 'bridge'
    if (!typed || e.command || e.isMeta) return next(e)

    const lines = e.text.split('\n')
    const todos = lines.filter(l => TODO_LINE.test(l)).map(stripTodo)
    if (todos.length === 0) return next(e)

    const added = await addTasks($, todos)
    const rest = lines.filter(l => !TODO_LINE.test(l)).join('\n').trim()
    const what = added === 1 ? `"${todos.find(t => t !== '')}"` : `${added} tasks`

    if (rest === '') {
      return { drop: added > 0 ? `Added ${what} to your idea board.` : 'Nothing after todo: to add.' }
    }
    if (added > 0) $.ui.toast(`Added ${what} to your idea board`)
    return next({ ...e, text: rest })
  })

  on('turn.complete', async ($, e, next) => {
    await reloadIfChanged($)
    return next(e)
  })

  on('command.run', { command: 'ideas' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text: 'Idea board opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Input, Select } = ui
    const list = await read($, items)
    const statusText = await read($, status)
    const where = await read($, mode)

    const setStatus = (text: string | null) => update($, status, () => text)

    const add = async (value: string) => {
      await addTasks($, [stripTodo(value)])
    }

    const patch = async (id: string, fn: (i: Item) => Item) => {
      await update($, items, l => l.map(i => (i.id === id ? fn(i) : i)))
      await save($)
    }

    const remove = async (id: string) => {
      await update($, items, l => l.filter(i => i.id !== id))
      await save($)
    }

    // Puts the request in the prompt box; the person sends it with Enter, so
    // the session is started on their own words.
    const toSession = async (item: Item) => {
      const filled = await $.prompt.fill({
        text:
          `Start a new session for this task from my idea board, ` +
          `with a complete brief:\n\n${item.text}`,
      })
      if (filled.isFilled === false) {
        $.ui.toast('Could not reach the prompt box.')
        return
      }
      await patch(item.id, i => ({ ...i, sentToSession: true }))
      $.ui.toast('Press Enter in the prompt to start the session.')
    }

    const tabNow = await read($, tab)
    const hasHover = e.surface !== 'terminal'
    const open = list.filter(i => !i.isDone)
    const done = list.filter(i => i.isDone)
    const shown = tabNow === 'open' ? open : done

    const row = (item: Item) => {
      const detail = item.text.split('\n').slice(1).join(' ').trim()
      const scope = `row-${item.id}`
      const icon = item.isDone ? '✓' : '○'
      return (
        <Box key={scope} paddingY={hasHover ? 'xs' : 0} hover={{ scope }}>
          <Button
            key={`done-${item.id}`}
            plain
            label={icon}
            onPress={() => patch(item.id, i => ({ ...i, isDone: !i.isDone }))}
          />
          <Box flexDirection="column" flexGrow={1} flexShrink={1} marginLeft={1}>
            <Text dimColor={item.isDone} strikethrough={item.isDone}>
              {titleOf(item)}
              {item.sentToSession ? <Text color="claude"> ▸</Text> : ''}
            </Text>
            {detail !== '' && (
              <Text dimColor size="footnote">
                {detail.slice(0, 160)}
              </Text>
            )}
            <Box gap={2}>
              {!item.isDone && (
                <Button key={`sess-${item.id}`} plain onPress={() => toSession(item)}>
                  <Text dimColor size="footnote">
                    ▶ Session
                  </Text>
                </Button>
              )}
              <Button key={`del-${item.id}`} plain onPress={() => remove(item.id)}>
                <Text dimColor size="footnote">
                  ✕ Delete
                </Text>
              </Button>
            </Box>
          </Box>
        </Box>
      )
    }

    const tabButton = (t: 'open' | 'done', label: string, count: number) => (
      <Button key={`tab-${t}`} plain onPress={() => update($, tab, () => t)}>
        <Text bold={tabNow === t} dimColor={tabNow !== t}>
          {label}
        </Text>
        <Text dimColor> {String(count)}</Text>
      </Button>
    )

    return (
      <Box flexDirection="column" gap={hasHover ? 'sm' : 0}>
        {/* Add */}
        <Box alignItems="center">
          <Box flexGrow={1}>
            <Input
              key="new"
              autoFocus
              placeholder="Add a task, or type todo: … in the chat"
              value=""
              submitLabel="add"
              onSubmit={add}
            />
          </Box>
        </Box>

        {/* Tabs on the left, storage on the right */}
        <Box justifyContent="space-between" alignItems="center">
          <Box gap={2}>
            {tabButton('open', 'Open', open.length)}
            {tabButton('done', 'Done', done.length)}
          </Box>
          <Box alignItems="center" gap={1}>
            {where !== 'local' && <Button key="reload" plain label="⟳" onPress={() => reloadIfChanged($)} />}
            <Select
              key="mode"
              value={where}
              options={MODES.map(m => ({ value: m.mode, label: m.label }))}
              onSelect={v => switchMode($, v as StorageMode)}
            />
          </Box>
        </Box>

        {statusText && (
          <Button key="dismiss-status" plain onPress={() => setStatus(null)}>
            <Text color="error" size="footnote">
              {statusText} ✕
            </Text>
          </Button>
        )}

        <Box flexDirection="column">
          {shown.length === 0 && (
            <Text dimColor size="footnote">
              {tabNow === 'open' ? 'Nothing open.' : 'Nothing done yet.'}
            </Text>
          )}
          {shown.map(row)}
          {tabNow === 'done' && done.length > 0 && (
            <Button
              key="clear-done"
              plain
              onPress={async () => {
                await update($, items, l => l.filter(i => !i.isDone))
                await save($)
              }}
            >
              <Text dimColor size="footnote">
                Clear done
              </Text>
            </Button>
          )}
        </Box>
      </Box>
    )
  })
}
