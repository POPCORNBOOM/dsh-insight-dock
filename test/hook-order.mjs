/**
 * Hook-order regression test for the insight-dock client half.
 *
 * The bug this exists for: a helper that owns React state was CALLED as a plain
 * function from inside the settings component. The settings component returns
 * early while its config loads, so the helper's hook only ran on the second
 * render — React saw a different hook count and threw the whole section away.
 *
 * The invariant tested here is exact and mechanical: the TOP-LEVEL component
 * must consume the same number of hooks whether or not its loaded-state branch
 * renders.
 */
import { readFileSync } from 'node:fs'

const bundlePath = process.argv[2]
const source = readFileSync(bundlePath, 'utf8')

let factory = null
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory: f }) => {
      factory = f
    },
  },
}

/** Snapshot of the slots the bundle registers, so we can render them ourselves. */
const registered = []
globalThis.host = { call: () => new Promise(() => {}) }
globalThis.fetch = () => new Promise(() => {})

// ---------------------------------------------------------------- fake React
let frames = [] // stack of { name, hooks }
let completed = [] // every finished component frame, outermost first
let preset = null // slot values forced for the current run
let runLabel = ''

function currentFrame() {
  const f = frames[frames.length - 1]
  if (!f) throw new Error('hook called outside any component — that is the bug class this test guards')
  return f
}

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => {
    const f = currentFrame()
    const i = f.hooks.length
    const forced = preset && preset[i] !== undefined ? preset[i] : undefined
    f.hooks.push(true)
    const value = forced !== undefined ? forced : typeof init === 'function' ? init() : init
    return [value, () => {}]
  },
  useEffect: () => {
    currentFrame().hooks.push(true)
  },
  useRef: (v) => ({ current: v }),
}

const primitives = {
  Switch: function Switch() {
    currentFrame().hooks.push(true)
    return null
  },
  Menu: function Menu() {
    currentFrame().hooks.push(true)
    return null
  },
  IconChevronDownOutline14: function IconChevronDownOutline14() {
    return null
  },
  IconLightOutline16: function IconLightOutline16() {
    return null
  },
  IconChevronLeftOutline14: function IconChevronLeftOutline14() {
    return null
  },
  IconChevronRightOutline14: function IconChevronRightOutline14() {
    return null
  },
}

// ------------------------------------------------------------- fake renderer
function render(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) render(child)
    return
  }
  if (typeof node !== 'object') return
  if (typeof node.type === 'function') {
    const frame = { name: node.type.name || '(anonymous)', hooks: [] }
    frames.push(frame)
    try {
      render(node.type({ ...node.props, children: node.children }))
    } finally {
      frames.pop()
      completed.push(frame)
    }
    return
  }
  // host element: recurse into children
  render(node.children)
}

function run(label, forcedPreset, component) {
  preset = forcedPreset
  runLabel = label
  frames = []
  completed = []
  render(component)
  preset = null
  return { label, completed: completed.slice() }
}

// ----------------------------------------------------------------- the test
const requireShim = (name) => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error('unexpected require: ' + name)
}

const ctx = {
  get: (n) => (n === 'slots' ? slots : undefined),
  effect: () => () => {},
  interval: () => () => {},
  timeout: () => {},
  logger: { warn: () => {} },
}
const slots = {
  inject: (_name, fn) => fn(),
  register: (opts, component) => {
    registered.push({ opts, component })
    return () => {}
  },
}

new Function('window', source)(globalThis.window)
if (typeof factory !== 'function') {
  console.log('FAIL: the bundle never called window.__ModuleLoader__.load')
  process.exit(1)
}

ctx.slots = slots

const plugin = factory(requireShim)
plugin.apply(ctx)

const settings = registered.find((r) => r.opts && r.opts.name === 'settings.section')
if (!settings) {
  console.log('FAIL: the bundle registered no settings.section component')
  process.exit(1)
}

// Render once with the config still loading, once with it loaded.
const a = run('loading', null, React.createElement(settings.component, {}))
const b = run('loaded', [{ enabled: true, maxOpen: 5, ttlMinutes: 5, injection: 'always' }], React.createElement(settings.component, {}))

console.log('registered slots: ' + registered.map((r) => r.opts.name).join(', '))
// Depth-first: the root component is the LAST one to finish, not the first.
const rootA = a.completed.length ? a.completed[a.completed.length - 1] : null
const rootB = b.completed.length ? b.completed[b.completed.length - 1] : null
const topA = rootA ? rootA.hooks.length : -1
const topB = rootB ? rootB.hooks.length : -1
console.log('loading render -> root component "' + (rootA || {}).name + '" hooks = ' + topA)
console.log('loaded  render -> root component "' + (rootB || {}).name + '" hooks = ' + topB)
console.log('components rendered (loaded): ' + b.completed.map((f) => f.name + ':' + f.hooks.length).join(', '))

if (topA <= 0) {
  console.log('')
  console.log('INCONCLUSIVE: the outermost component consumed no hooks, so this test cannot see an order change.')
  process.exit(2)
}

if (topA !== topB) {
  console.log('')
  console.log('FAIL: the settings component consumed ' + topB + ' hooks when loaded but ' + topA + ' while loading.')
  console.log('React throws "Rendered more hooks than during the previous render" for exactly this, and the section disappears.')
  process.exit(1)
}

console.log('')
console.log('PASS: hook count is stable across both branches (' + topA + ')')
