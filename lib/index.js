/**
 * dsh-insight — host half.
 *
 * Owns four agent-facing tools, one ambient prompt-context contribution, the
 * insight store (per-session JSON side-car), and the `/insight/api` prefix
 * route the browser half talks to.
 *
 * Ported from the dynamic Cordis plugin `insgt-1` (pkg-26). The only structural
 * changes are the ones a real plugin requires:
 *   - `harness.defineTool` / `harness.handle` → `defineTool` from
 *     `@deepseek-ai/dsh-tools` + `ctx.tools.register`, and
 *     `ctx.webServer.register` for the client channel (the dynamic runner's
 *     private RPC does not exist here);
 *   - `ctx.get('fs')` → `node:fs` (a real plugin runs in Node, and the
 *     abstract fs service applies a sandbox fence that is wrong for a plugin's
 *     own state directory);
 *   - expiry is now a DELETION, not an archive status.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-insight-dock'

/** `webServer` is a hard dependency; `sessions` / `agents` / `systemPrompt`
 *  are read through `ctx.get()` so a deployment without them degrades to
 *  "tools only" instead of leaving the row waiting forever. */
export const inject = ['tools', 'webServer']

const API_PREFIX = '/insight/api'
const CONFIG_FILE = 'insight-settings.json'

const DEFAULT_TTL_MINUTES = 5
const MAX_TTL_MINUTES = 1440
const DEFAULT_MAX_OPEN = 5
const HARD_MAX_OPEN = 50

const TITLE_MAX = 60
const REASON_MAX = 200
const WHY_MAX = 120
const EXCERPT_MAX = 420
const WINDOW_DEFAULT = 6
const WINDOW_MAX = 20
const BODY_LIMIT = 1 << 20

const DIRECTIVE =
  '\n\n[给模型的提示，不要出现在你的回复中] 这是你自己此前留下的想法，不是别人的笔记：' +
  '用第一人称讲——你当时为什么这么想、你认为该怎么做、代价在哪。' +
  '不要用“这条见解认为…”“这条讲的是…”这类第三人称转述，也不要交代你读了什么或走了什么流程。' +
  '若你只是为了自己回忆才读它，就当它不存在，不要主动提起。'

const TOOL_TEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string', required: true } },
  },
  render: (_args, value) => [{ type: 'text', text: String(value.text) }],
}

export function apply(ctx) {
  const items = new Map()
  const pendingNotices = new Map()
  let serial = 0
  let msgSerial = 0

  const config = { enabled: true, maxOpen: DEFAULT_MAX_OPEN, ttlMinutes: DEFAULT_TTL_MINUTES }
  const stateDir = join(homedir(), '.dsh')
  const configPath = join(stateDir, CONFIG_FILE)

  const sessions = ctx.get('sessions')
  const agents = ctx.get('agents')
  const promptSvc = ctx.get('systemPrompt')

  //#region helpers -----------------------------------------------------------

  const nowMs = () => Date.now()

  function clip(value, max) {
    const s = value === null || value === undefined ? '' : String(value)
    return s.length > max ? s.slice(0, max) + '…' : s
  }

  function clampInt(v, lo, hi, fallback) {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return fallback
    return Math.max(lo, Math.min(hi, Math.round(n)))
  }

  function ttlMs() {
    return Math.max(1, Number(config.ttlMinutes) || DEFAULT_TTL_MINUTES) * 60000
  }

  function nextMsgId(prefix) {
    msgSerial += 1
    return prefix + '-' + String(nowMs()) + '-' + String(msgSerial)
  }

  function configView() {
    return { enabled: !!config.enabled, maxOpen: config.maxOpen, ttlMinutes: config.ttlMinutes }
  }

  function applyConfig(raw) {
    if (!raw || typeof raw !== 'object') return
    if (raw.enabled !== undefined) config.enabled = !!raw.enabled
    if (raw.maxOpen !== undefined) config.maxOpen = clampInt(raw.maxOpen, 1, HARD_MAX_OPEN, config.maxOpen)
    if (raw.ttlMinutes !== undefined) config.ttlMinutes = clampInt(raw.ttlMinutes, 1, MAX_TTL_MINUTES, config.ttlMinutes)
  }

  function liveSession(id) {
    try {
      return sessions ? sessions.get(id) : undefined
    } catch {
      return undefined
    }
  }

  function blocksToText(blocks) {
    if (!Array.isArray(blocks)) return ''
    const parts = []
    for (const b of blocks) {
      if (!b) continue
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
      else if (b.type === 'image') parts.push('[图片]')
      else if (b.type === 'file') parts.push('[文件]')
      else if (b.type === 'tool-call') parts.push('[工具调用]')
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim()
  }

  function initiatorSessionId() {
    try {
      if (agents) {
        const cur = agents.currentInitiator()
        if (cur && cur.id) return String(cur.id)
      }
    } catch {}
    return ''
  }

  function assemblySessionId(context) {
    try {
      const agent = context && context.agent ? context.agent : undefined
      if (agent && agent.session && agent.session.id) return String(agent.session.id)
    } catch {}
    return initiatorSessionId()
  }

  function currentSessionId(exec) {
    try {
      if (exec && exec.agent && exec.agent.id) return String(exec.agent.id)
    } catch {}
    return initiatorSessionId()
  }

  //#endregion

  //#region config (JSON side-car) -------------------------------------------

  function loadConfig() {
    try {
      applyConfig(JSON.parse(readFileSync(configPath, 'utf8')))
      return true
    } catch {
      return false
    }
  }

  function saveConfig() {
    try {
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(configPath, JSON.stringify(configView(), null, 2), 'utf8')
      return true
    } catch (e) {
      ctx.logger?.warn?.('dsh-insight: failed to write %s: %o', configPath, e)
      return false
    }
  }

  loadConfig()

  //#endregion

  //#region store -------------------------------------------------------------

  /** Unsorted view of one session's notes; does not sweep. */
  function listOf(sid) {
    const out = []
    for (const it of items.values()) {
      if (it.sessionId !== sid) continue
      out.push(it)
    }
    out.sort((a, b) => a.createdAt - b.createdAt)
    return out
  }

  /** A note is expired when it is past the TTL, measured from `createdAt` for a
   *  note nobody has asked to hear, and from `heardAt` once the user did ask.
   *
   *  A `heard` note normally disappears within seconds because `insight_load`
   *  deletes it the moment the agent takes its content; the `heardAt` TTL is the
   *  backstop for the case where the agent never gets there (an abandoned or
   *  failed turn), so a heard note cannot sit in the dock forever.
   *
   *  Every other ending deletes the note outright — the user closing it and the
   *  agent withdrawing it both remove the record rather than keeping a terminal
   *  marker — so `active` and `heard` are the only states that exist. */
  function isExpired(rec, now) {
    if (rec.status !== 'active' && rec.status !== 'heard') return false
    const from = rec.status === 'heard' ? rec.heardAt || rec.createdAt : rec.createdAt
    return now - from >= ttlMs()
  }

  /**
   * Delete every expired note for one session — from the in-memory map AND
   * from the persisted `items`, then write the file back.
   *
   * This is NOT an archive: the record is gone. Shortening the TTL therefore
   * destroys notes irreversibly, and raising it again cannot bring them back.
   * Returns the number removed.
   */
  function sweepExpired(sid) {
    const now = nowMs()
    let removed = 0
    for (const [id, rec] of Array.from(items)) {
      if (sid && rec.sessionId !== sid) continue
      const live = rec.status === 'active' || rec.status === 'heard'
      if (live && !isExpired(rec, now)) continue
      items.delete(id)
      removed += 1
    }
    return removed
  }

  function sessionItems(sid, onlyOpen) {
    sweepExpired(sid)
    const all = listOf(sid)
    if (!onlyOpen) return all
    return all.filter((it) => it.status === 'active' || it.status === 'heard')
  }

  function statusLabel(s) {
    if (s === 'active') return '未处理'
    if (s === 'heard') return '已听过'
    return String(s)
  }

  function currentTurn(session) {
    if (!session) return 0
    try {
      const evs = session.snapshotEvents()
      for (let i = evs.length - 1; i >= 0; i--) {
        if (evs[i] && evs[i].type === 'turn/start' && evs[i].data) return Number(evs[i].data.turn) || 0
      }
    } catch {}
    return 0
  }

  function takeNotices(sid) {
    const arr = pendingNotices.get(sid)
    if (!arr || !arr.length) return ''
    pendingNotices.set(sid, [])
    return arr.map((n) => n.text).join('\n')
  }

  function readWindow(rec, radius) {
    const session = liveSession(rec.sessionId)
    if (!session) return { lines: [], error: '会话已不在内存中，无法回读当时的日志。' }
    const center = rec.centerSeq
    if (center === null || center === undefined || center < 0) {
      return { lines: [], error: '记录当时会话还是空的，没有可回读的上下文。' }
    }
    const from = Math.max(0, center - radius)
    const to = center + radius + 1
    let events
    try {
      events = session.snapshotEvents(from, to)
    } catch (e) {
      return { lines: [], error: '日志读取失败：' + clip(e && e.message ? e.message : e, 160) }
    }
    const lines = []
    for (const ev of events) {
      if (!ev || !ev.data) continue
      if (ev.type === 'turn/start') lines.push('── 第 ' + String(ev.data.turn) + ' 轮 ──')
      else if (ev.type === 'user/message') lines.push('用户: ' + clip(blocksToText(ev.data.content), EXCERPT_MAX))
      else if (ev.type === 'assistant/message') {
        lines.push('助手: ' + clip(blocksToText(ev.data.message ? ev.data.message.content : null), EXCERPT_MAX))
      } else if (ev.type === 'tool/call') {
        lines.push('工具: ' + clip(String(ev.data.name) + '(' + clip(ev.data.arguments, 160) + ')', EXCERPT_MAX))
      }
    }
    return { lines, error: null }
  }

  function stamp(ms) {
    try {
      return new Date(ms).toISOString()
    } catch {
      return String(ms)
    }
  }

  //#endregion

  //#region delivery ----------------------------------------------------------

  function visibleText(rec) {
    return '我想听听「' + rec.title + '」——讲讲你自己当时的想法。'
  }

  function deliver(rec, mode) {
    const agent = agents ? agents.get(rec.sessionId) : undefined
    if (!agent) return { ok: false, error: 'agent 不在线' }
    const msg = {
      id: nextMsgId('insight-hear'),
      role: 'user',
      content: [{ type: 'text', text: visibleText(rec) }],
      source: { kind: 'user' },
    }
    if (mode === 'inject' && typeof agent.inject === 'function') {
      agent.inject(msg)
      return { ok: true, mode: 'inject' }
    }
    if (mode === 'followup' && typeof agent.followup === 'function') {
      agent.followup(msg)
      return { ok: true, mode: 'followup' }
    }
    if (typeof agent.steer === 'function') {
      agent.steer(msg)
      return { ok: true, mode: 'steer' }
    }
    return { ok: false, error: 'agent 上没有 steer/inject/followup' }
  }

  function notifyClosed(rec, reason) {
    const line =
      '用户关闭了见解 ' +
      rec.id +
      '「' +
      rec.title +
      '」' +
      (reason ? '，原因：' + reason + '。' : '。') +
      '不必回复，也不必追问。'
    let delivered = false
    try {
      const agent = agents ? agents.get(rec.sessionId) : undefined
      if (agent && typeof agent.inject === 'function') {
        agent.inject({
          id: nextMsgId('insight-closed'),
          role: 'user',
          content: [{ type: 'text', text: line }],
          source: { kind: 'plugin', plugin: 'dsh-insight-dock', form: 'notice', summary: line },
        })
        delivered = true
      }
    } catch {
      delivered = false
    }
    if (!delivered) {
      const arr = pendingNotices.get(rec.sessionId) || []
      arr.push({ id: rec.id, text: line })
      pendingNotices.set(rec.sessionId, arr)
    }
    return delivered
  }

  //#endregion

  //#region tools -------------------------------------------------------------

  const toolAdd = defineTool({
    name: 'insight_add',
    description:
      '趁手上的任务不便打断时，记下一个与它无关的侧面发现——「欸，另外那件事其实可以…」。' +
      '严格边界：如果这个想法指向你手上正在做的事（同一个目标、同一个文件、同一个决定、这一步本来就该处理的），' +
      '那就现在做掉，不要记成见解。见解不是待办、不是备忘、更不是暂缓当前工作的出口，它不会替你完成任何事。' +
      '落笔前先自问：这件事我现在能做完吗？能，就现在做。每条只记一个观点，一轮最多一条。' +
      '用户没让你展开前，不要在回复里讲它。',
    parameters: {
      title: { type: 'string', required: true, description: '一句话观点，形如「我认为…可以让…更好」。不超过 60 字。' },
      reason: { type: 'string', required: true, description: '简短理由，不超过 200 字。只写最关键的因果，不要写步骤、清单或待办。' },
      why_not_now: {
        type: 'string',
        required: true,
        description: '一句话说明这件事为什么现在不能做。如果你答不出来，说明你本该现在做它，而不是记下来。',
      },
    },
    output: TOOL_TEXT_OUTPUT,
    execute: async (args, exec) => {
      if (!config.enabled) throw new Error('见解功能已被用户关闭，未记录。')
      const sid = currentSessionId(exec)
      if (!sid) throw new Error('无法确定当前会话，见解未记录。')
      sweepExpired(sid)

      const title = String(args && args.title ? args.title : '').trim()
      const reason = String(args && args.reason ? args.reason : '').trim()
      const why = String(args && args.why_not_now ? args.why_not_now : '').trim()
      if (!why) throw new Error('why_not_now 不能为空。答不出「为什么现在不能做」，就说明你该现在做它，而不是记成见解。')
      if (why.length > WHY_MAX) throw new Error('why_not_now 太长（' + String(why.length) + ' 字 > ' + String(WHY_MAX) + '），一句话就够。')
      if (!title) throw new Error('title 不能为空。')
      if (title.length > TITLE_MAX) throw new Error('title 太长（' + String(title.length) + ' 字 > ' + String(TITLE_MAX) + '）。请压成一句话观点。')
      if (!reason) throw new Error('reason 不能为空：没有理由的见解对用户没有价值。')
      if (reason.length > REASON_MAX) throw new Error('reason 太长（' + String(reason.length) + ' 字 > ' + String(REASON_MAX) + '）。只留最关键的因果，不要写步骤或清单。')

      const session = liveSession(sid)
      const turn = currentTurn(session)
      if (turn > 0) {
        const same = listOf(sid).filter((it) => it.createdTurn === turn)
        if (same.length) throw new Error('本轮已经记过一条见解（' + same[0].id + '）。一轮最多新增一条。')
      }

      const open = sessionItems(sid, true)
      const maxOpen = Math.max(1, Number(config.maxOpen) || DEFAULT_MAX_OPEN)
      if (open.length >= maxOpen) {
        throw new Error('当前会话已有 ' + String(maxOpen) + ' 条未处理见解，已达上限。请先用 insight_withdraw 撤回一条，或等它们过期。')
      }

      serial += 1
      const id = 'i-' + String(serial)
      let centerSeq = -1
      try {
        if (session && session.seq !== undefined && session.seq !== null) centerSeq = Number(session.seq) - 1
      } catch {
        centerSeq = -1
      }
      const rec = {
        id,
        sessionId: sid,
        title,
        reason,
        whyNotNow: why,
        createdAt: nowMs(),
        createdTurn: turn,
        centerSeq,
        status: 'active',
      }
      items.set(id, rec)

      const mins = Math.max(1, Number(config.ttlMinutes) || DEFAULT_TTL_MINUTES)
      const out = []
      out.push('已记下见解 ' + id + '：「' + title + '」')
      out.push('- 归属会话：' + sid + '，上下文锚点 ' + sid + ':' + String(centerSeq))
      out.push('- 存活：' + String(mins) + ' 分钟后自动删除；当前 ' + String(open.length + 1) + '/' + String(maxOpen) + ' 条')
      out.push('- 现在回到手上的工作。')
      out.push('- 如果回头发现这条其实属于当前任务，立刻 insight_withdraw("' + id + '") 并把它做掉——记下来不算处理。')
      return { text: out.join('\n') }
    },
  })

  const toolList = defineTool({
    name: 'insight_list',
    description: '查看当前会话里你留下的见解纸条（标题、理由、创建多久了）。用于避免重复记录，以及确认自己是否已经提过、有没有被用户关掉。',
    parameters: {},
    output: TOOL_TEXT_OUTPUT,
    execute: async (_args, exec) => {
      const sid = currentSessionId(exec)
      if (!sid) throw new Error('无法确定当前会话。')
      const all = sessionItems(sid, false)
      const lines = []
      const header = takeNotices(sid)
      if (header) lines.push(header)
      if (!all.length) lines.push('当前会话没有见解纸条。')
      else {
        lines.push('当前会话见解 ' + String(all.length) + ' 条：')
        for (const it of all) {
          lines.push('- [' + it.id + '] ' + statusLabel(it.status) + ' · ' + stamp(it.createdAt) + ' · ' + it.title + '｜理由：' + it.reason)
        }
      }
      return { text: lines.join('\n') }
    },
  })

  const toolLoad = defineTool({
    name: 'insight_load',
    description:
      '读回某条见解创建那一刻附近的真实对话日志（用户/助手发言、工具调用名），用于回忆「当时为什么冒出这个念头」。' +
      '只在用户表示想听这条见解、或你确实需要回忆依据时调用。读完之后用第一人称讲你自己的判断，不要转述、也不要交代你读了什么。',
    parameters: {
      id: { type: 'string', required: true, description: '见解 id，例如 i-1。' },
      radius: { type: 'integer', description: '前后各取多少条事件，默认 6，上限 20。' },
    },
    output: TOOL_TEXT_OUTPUT,
    execute: async (args, exec) => {
      const sid = currentSessionId(exec)
      sweepExpired(sid)
      const id = String(args && args.id ? args.id : '').trim()
      const rec = items.get(id)
      if (!rec) throw new Error('没有这条见解：' + (id || '(空)') + '。用 insight_list 看看现在还有哪些。')
      if (rec.sessionId !== sid) throw new Error('见解 ' + rec.id + ' 属于另一个会话，不能在这里回读。')
      let radius = WINDOW_DEFAULT
      if (args && args.radius !== undefined && args.radius !== null) {
        const r = Number(args.radius)
        if (Number.isFinite(r) && r >= 0) radius = Math.min(WINDOW_MAX, Math.round(r))
      }
      const win = readWindow(rec, radius)
      const head = []
      head.push('这是你自己在会话 ' + rec.sessionId + ' 留下的想法 ' + rec.id + '（' + stamp(rec.createdAt) + '）。')
      head.push('- 标题：' + rec.title)
      head.push('- 当时的理由：' + rec.reason)
      if (rec.whyNotNow) head.push('- 当时为什么没现在做：' + rec.whyNotNow)
      head.push('- 上下文锚点：' + rec.sessionId + ':' + String(rec.centerSeq))
      let body
      if (win.error) body = head.join('\n') + '\n\n上下文无法回读：' + win.error
      else if (!win.lines.length) body = head.join('\n') + '\n\n锚点附近没有可读的文本事件。'
      else body = head.join('\n') + '\n\n创建时的现场：\n' + win.lines.join('\n')

      // Only a `heard` note is consumed by this read. The agent may also load an
      // `active` note purely for its own recall — that note has never been shown
      // to the user, so deleting it here would destroy something they never saw.
      if (rec.status === 'heard') {
        items.delete(rec.id)
        return { text: body + '\n\n（这条见解已随本次回读删除，不必再提起它。）' + DIRECTIVE }
      }
      return { text: body + DIRECTIVE }
    },
  })

  const toolWithdraw = defineTool({
    name: 'insight_withdraw',
    description:
      '主动撤回你自己留下的一条见解。两种情况：你发现它其实不对/已经被做掉/不再值得占用注意力；' +
      '或者——更重要——你发现它其实属于当前任务，那就先撤回，然后立刻去把它做掉。撤回后不要再提起它。',
    parameters: {
      id: { type: 'string', required: true, description: '要撤回的见解 id。' },
      reason: { type: 'string', description: '为什么撤回，一句话即可。' },
    },
    output: TOOL_TEXT_OUTPUT,
    execute: async (args, exec) => {
      const sid = currentSessionId(exec)
      sweepExpired(sid)
      const id = String(args && args.id ? args.id : '').trim()
      const rec = items.get(id)
      if (!rec) throw new Error('没有这条见解：' + (id || '(空)') + '。')
      if (rec.sessionId !== sid) throw new Error('见解 ' + rec.id + ' 属于另一个会话。')
      const title = rec.title
      items.delete(rec.id)
      return { text: '已撤回见解 ' + rec.id + '「' + title + '」，它已经从面板上移除。不要再主动提起或解释；如果它属于当前任务，现在就去把它做掉。' }
    },
  })

  ctx.effect(() => {
    const disposers = [toolAdd, toolList, toolLoad, toolWithdraw].map((t) => ctx.tools.register(t))
    return () => {
      for (const d of disposers) {
        try {
          d()
        } catch {}
      }
    }
  })

  //#endregion

  //#region prompt context ----------------------------------------------------

  if (promptSvc) {
    ctx.effect(() =>
      promptSvc.context({
        name: 'insight-dock',
        order: 500,
        text: (context) => {
          try {
            if (!config.enabled) return ''
            const sid = assemblySessionId(context)
            if (!sid) return ''
            const parts = []
            const notice = takeNotices(sid)
            if (notice) parts.push(notice)
            const open = sessionItems(sid, true)
            if (open.length) {
              const ids = open.map((i) => i.id).join('、')
              parts.push(
                '你在专注时留下了 ' +
                  String(open.length) +
                  ' 条见解纸条（' +
                  ids +
                  '）。它们装的是与手上任务无关的侧面发现，不是待办，也不会替你完成任何工作。' +
                  '如果其中某条其实属于你当前的任务，现在就去把它做掉，然后 insight_withdraw 撤回它。' +
                  '除此之外不要主动提起，也不要每轮追问。',
              )
            }
            return parts.join('\n')
          } catch {
            return ''
          }
        },
      }),
    )
  }

  //#endregion

  //#region http api ----------------------------------------------------------

  function writeJson(res, status, payload) {
    try {
      const body = JSON.stringify(payload)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': String(Buffer.byteLength(body)),
      })
      res.end(body)
    } catch {
      try {
        res.writeHead(500)
        res.end()
      } catch {}
    }
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > BODY_LIMIT) {
          reject(new Error('request body too large'))
          try {
            req.destroy()
          } catch {}
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  function opOf(req) {
    const url = String((req && req.url) || '')
    const path = url.split('?')[0]
    return path.slice(API_PREFIX.length).replace(/^\/+/, '')
  }

  async function handleOp(req, res) {
    const op = opOf(req)
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    let args = {}
    try {
      const raw = await readBody(req)
      if (raw.trim()) args = JSON.parse(raw)
    } catch (e) {
      writeJson(res, 400, { ok: false, error: String(e && e.message ? e.message : e) })
      return
    }

    if (op === 'config_get') {
      writeJson(res, 200, { config: configView() })
      return
    }

    if (op === 'config_set') {
      applyConfig(args && args.config ? args.config : {})
      const persisted = saveConfig()
      writeJson(res, 200, { ok: true, config: configView(), persisted })
      return
    }

    if (op === 'snapshot') {
      const sid = args && args.sessionId ? String(args.sessionId) : ''
      if (!sid) {
        writeJson(res, 200, { items: [], config: configView() })
        return
      }
      const out = sessionItems(sid, false).map((it) => ({
        id: it.id,
        title: it.title,
        reason: it.reason,
        createdAt: it.createdAt,
        status: it.status,
        heardAt: it.heardAt || null,
      }))
      writeJson(res, 200, { items: out, config: configView() })
      return
    }

    if (op === 'hear') {
      const id = args && args.id ? String(args.id) : ''
      const sid = args && args.sessionId ? String(args.sessionId) : ''
      sweepExpired(sid)
      const rec = items.get(id)
      if (!rec) {
        writeJson(res, 200, { ok: false, error: '这条见解已经不存在了。' })
        return
      }
      if (rec.status !== 'active' && rec.status !== 'heard') {
        writeJson(res, 200, { ok: false, error: '这条见解已失效（' + statusLabel(rec.status) + '）。' })
        return
      }
      const mode = args && args.mode ? String(args.mode) : 'steer'
      let result
      try {
        result = deliver(rec, mode)
      } catch (e) {
        result = { ok: false, error: String(e && e.message ? e.message : e) }
      }
      if (result.ok) {
        rec.status = 'heard'
        rec.heardAt = nowMs()
        writeJson(res, 200, { ok: true, injected: true, mode: result.mode, id: rec.id, title: rec.title })
        return
      }
      writeJson(res, 200, {
        ok: true,
        injected: false,
        injectError: result.error,
        message: visibleText(rec),
        id: rec.id,
        title: rec.title,
      })
      return
    }

    if (op === 'close') {
      const id = args && args.id ? String(args.id) : ''
      const sid = args && args.sessionId ? String(args.sessionId) : ''
      const rec = items.get(id)
      if (!rec) {
        writeJson(res, 200, { ok: false, error: '这条见解已经不存在了。' })
        return
      }
      const reason = args && args.reason ? clip(String(args.reason), 300) : ''
      const notify = !!(args && args.notifyAgent) && !!reason
      const notified = notify ? notifyClosed(rec, reason) : false
      items.delete(rec.id)
      writeJson(res, 200, { ok: true, notified })
      return
    }

    writeJson(res, 404, { ok: false, error: 'unknown op: ' + op })
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (req, res) => {
        handleOp(req, res).catch((e) => {
          writeJson(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
        })
      },
    }),
  )

  //#endregion
}
