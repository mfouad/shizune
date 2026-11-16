import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'shizune',
  component: 'Pane',
  requestId: 'idea-board',
  props: {
    title: 'Ideas',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// Stands in for the engine: a store, a clock and a folder of files.
function engine(on: On, files: Map<string, string>) {
  const store = new Map<string, unknown>()
  on('command.register', () => ({ value: { command: 'ideas' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 1000 }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
}

test('add a task, tick it done, and find it in the Done tab', async ($, on) => {
  engine(on, new Map())

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.input({ key: 'new', text: 'Add dark mode\nfollow the system theme' })
  expect(await ui.find({ type: 'Text', text: /Add dark mode/ })).toBeDefined()
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')
  expect(keys.some(k => k.startsWith('push-'))).toBe(false)

  const done = (await ui.findAll({ type: 'Button' })).find(b => b.key?.startsWith('done-'))
  await ui.press({ key: done!.key! })
  expect(await ui.find({ type: 'Text', text: /Add dark mode/ })).toBeUndefined()
  await ui.press({ key: 'tab-done' })
  expect(await ui.find({ type: 'Text', text: /Add dark mode/ })).toBeDefined()
  await ui.unmount()
})

test('TODO.md keeps its own text; the board reads back what it wrote', async ($, on) => {
  const files = new Map([['/proj/TODO.md', '# My todo\n\n- buy milk\n']])
  engine(on, files)

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.select({ key: 'mode', value: 'todo' })
  await ui.input({ key: 'new', text: 'Try SQLite\nfor offline mode' })

  const todo = files.get('/proj/TODO.md') ?? ''
  expect(todo.startsWith('# My todo\n\n- buy milk')).toBe(true)
  expect(todo).toContain('## Tasks')
  expect(todo).toContain('- [ ] Try SQLite <!-- ib:')
  expect(todo).toContain('  for offline mode')

  // A hand edit (ticking the box) shows in the pane after a reload.
  files.set('/proj/TODO.md', todo.replace('- [ ] Try SQLite', '- [x] Try SQLite'))
  await ui.press({ key: 'reload' })
  expect(await ui.find({ type: 'Text', text: /Try SQLite/ })).toBeUndefined()
  await ui.press({ key: 'tab-done' })
  expect(await ui.find({ type: 'Text', text: /Try SQLite/ })).toBeDefined()
  await ui.unmount()
})

test('.claude/ideas.md is created with a heading', async ($, on) => {
  const files = new Map<string, string>()
  engine(on, files)

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'new', text: 'Ship v1' })
  await ui.select({ key: 'mode', value: 'ideas' })

  const md = files.get('/proj/.claude/ideas.md') ?? ''
  expect(md.startsWith('# Ideas\n')).toBe(true)
  expect(md).toContain('- [ ] Ship v1')
  await ui.unmount()
})

test('the redesigned pane draws on every surface', async ($, on) => {
  engine(on, new Map())
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const first = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await first.input({ key: 'new', text: 'Card title\nwith detail' })
  await first.unmount()
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Card title/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /with detail/ })).toBeDefined()
    await ui.unmount()
  }
})

test('▶ puts a session request in the prompt box instead of sending it', async ($, on) => {
  engine(on, new Map())
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', () => {
    throw new Error('the board must not submit prompts itself')
  })

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'new', text: 'How to publish?' })
  const sess = (await ui.findAll({ type: 'Button' })).find(b => b.key?.startsWith('sess-'))
  await ui.press({ key: sess!.key! })

  expect(filled[0]).toContain('Start a new session for this task')
  expect(filled[0]).toContain('How to publish?')
  await ui.unmount()
})


test('an older file with a Notes section loads every item as a task', async ($, on) => {
  const files = new Map([
    [
      '/proj/.claude/ideas.md',
      '# Ideas\n\n<!-- idea-board:start -->\n\n## Tasks\n\n- [ ] Old task\n\n## Notes\n\n- [ ] Old note\n\n<!-- idea-board:end -->\n',
    ],
  ])
  engine(on, files)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'mode', value: 'ideas' })
  expect(await ui.find({ type: 'Text', text: /Old note/ })).toBeDefined()
  expect(files.get('/proj/.claude/ideas.md')).not.toContain('## Notes')
  await ui.unmount()
})

test('a message that is only todo lines becomes tasks and is stopped', async ($, on) => {
  engine(on, new Map())
  on('prompt.submit', () => {
    throw new Error('the message should not reach the model')
  })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const r = await $.prompt.submit({
    text: 'todo: Write the README\nTODO: add a license',
    origin: { kind: 'composer' },
    wait: false,
  })
  expect(r.drop).toContain('2 tasks')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Write the README/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /add a license/ })).toBeDefined()
  await ui.unmount()
})

test('todo lines are taken out of a longer message and the rest goes on', async ($, on) => {
  engine(on, new Map())
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  let reached = ''
  on('prompt.submit', (_, e) => {
    reached = e.text
    return { text: e.text }
  })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  await $.prompt.submit({
    text: 'Fix the login bug please.\ntodo: check the logout flow too',
    origin: { kind: 'composer' },
    wait: false,
  })
  expect(reached).toBe('Fix the login bug please.')
  expect(toasts[0]).toContain('check the logout flow too')
})

test('the pane field drops a typed todo: prefix', async ($, on) => {
  engine(on, new Map())
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'new', text: 'todo: Ship it' })
  expect((await ui.find({ type: 'Text', text: /Ship it/ }))?.text?.startsWith('Ship it')).toBe(true)
  await ui.unmount()
})
