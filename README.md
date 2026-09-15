# dsh-insight-dock

English | [中文](README.zh.md)

An insight dock for the DSH Web GUI.

While an agent is focused on a task it can park a short, strictly-bounded side
observation — *"wait, that other thing could…"* — without derailing what it is
doing. The note shows up above the composer, and you decide later whether to hear
it out.

The point is the **context anchor**. Every note remembers the session sequence it
was created at, so `insight_load` can read the real conversation log back from
that moment. That read comes from the durable session log, which is why a note
still works after the agent's own context has been compacted away.

## Install

```
dsh plugin --profile <profile> add dsh-insight-dock
```

`dsh plugin` is a thin wrapper over pnpm, run inside the profile directory. It
reconciles `dsh.profile.bundles` against the installed packages, sees the
`dsh.bundle.patch` declaration in this package, and appends it to the bundle
stack; the profile boot then merges `cordis.patch.yml` — a single `insert` of the
plugin row. **No profile file has to be edited by hand.**

The bundle stack is read once at boot, so **restart `dsh`** before the plugin
appears.

<details>
<summary>Installing from a local checkout instead</summary>

```
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-insight
```

Mind the `realpath` trap: Node resolves a symlinked package to its real location
before resolving its imports, so a linked checkout can only find `@deepseek-ai/*`
if it has its own `node_modules`
(`ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-tools'`). A
registry install materializes the package inside the profile and has no such
problem.

</details>

## What you get

**Above the composer**, a single-line dock — `💡 3 条见解` — that expands to the
current note; the arrows step through the rest.

| Action | Effect |
| --- | --- |
| 说来听听 | Asks the agent to talk through this note, from the log window it anchored. |
| 关闭 | Removes the note. |
| 关闭并告诉 agent 为什么 | Removes the note *and* injects a one-line notice carrying your reason. |

**In Settings**, a 见解 section: enable/disable, prompt strength (below), the
concurrent-open cap (1–50), and the lifetime in minutes (1–1440, default **5**).

## Prompt strength

The dock only works if the agent thinks to use it, and that is governed almost
entirely by one ambient line in its context. The 提示强度 setting picks which
line, and when:

| Level | Injected when | Content |
| --- | --- | --- |
| 不邀请 | never — a close-with-reason notice still gets through | — |
| 有纸条时 | only while notes are open | the open-note reminder |
| 一直邀请 | always | a positive criterion: *real, currently unactionable, lost if not written down* |
| 一直邀请 + 强化 | always | that criterion plus a standing "scan for one before you start" |

The default is 有纸条时, which preserves the historical behaviour — and it is
**structurally unable to produce a first note**, because the reminder it gates on
does not exist until one has already been recorded. The two levels above it
inject with zero notes, which is the only way a first one can appear.

Every earlier version of this text was a list of prohibitions — *not a to-do*,
*not an escape hatch for deferring work*, *if you can do it now, do it now*. The
measured effect was abstention. Across **94 recorded sessions and 625 turns**,
the only notes ever recorded were the ones created while building this plugin:
17 calls, every one of them a test fixture, and **zero** in the other 93 sessions.
A description made entirely of reasons not to act produces exactly that. The
一直邀请 levels state a positive criterion instead.

## Two faces

**Host** — `exports "."` → `lib/index.js`:

| Surface | What it does |
| --- | --- |
| `insight_add` | Records a note. Title ≤ 60, reason ≤ 200, a required `why_not_now` ≤ 120, one note per turn, ≤ 5 open. |
| `insight_list` | Lists this session's notes. |
| `insight_load` | Reads the log window around the note's anchor — and consumes the note. |
| `insight_withdraw` | Lets the agent retract its own note. |
| prompt context | One ambient line while notes are open: these are not a to-do list, and a note that turns out to belong to the current task has to be *done*, not filed. |
| `/insight/api/<op>` | The browser half's channel. |

**Client** — `exports "./client"` → `lib/client.js`, served at
`/plugins/dsh-insight-dock/client.js`: the dock in `conversation.input.dock`
(order 30), and the settings page in `settings.section`.

## Lifecycle

Every ending deletes the record. There is no archive.

| Transition | Trigger | Result |
| --- | --- | --- |
| `active` → gone | the lifetime elapsed and nobody asked to hear it | deleted |
| `active` → `heard` | you click 说来听听 | the host steers one message into the agent |
| `heard` → gone | the agent reads it via `insight_load` | its context has been handed over, so the note is removed |
| `heard` → gone | the agent never got there (abandoned or failed turn) | deleted once the lifetime elapses **from the moment it was heard** |
| `active` / `heard` → gone | the agent withdraws its own note | deleted |
| `active` / `heard` → gone | you close it | deleted — a close *with a reason* still injects its one-line notice first |

A heard note therefore normally lives for seconds, not minutes: `insight_load`
deletes it at the instant it hands the content over. The `heardAt` lifetime is
only the backstop that keeps an unanswered note from sitting in the dock forever.

**Notes live in memory only.** Nothing about a note is written to disk. With a
lifetime measured in minutes that costs almost nothing — a restart outlives every
note anyway, so persistence would only ever preserve an empty set — and it
removes a whole class of failure: a silently failed write, `serial` bookkeeping,
and the fork / workspace / storage-layer caveats a side-car would have brought.

## Known limitations

Measured, not guessed.

1. **The UI text is Chinese.** Every user-facing string (`说来听听`,
   `关闭并告诉 agent 为什么`, the settings labels) and every tool description is a
   literal Chinese string. There is no locale binding, so an English-locale
   session still sees Chinese everywhere.

2. **Every ending deletes; nothing is archived.** There is no "已归档" row and no
   record behind it. Expiry in particular is irreversible: shortening the
   lifetime destroys notes outright, and **lengthening it again cannot bring them
   back.**

3. **A restart clears the dock.** Notes are held in memory, so they do not
   survive a `dsh` restart, and a forked session does not inherit them. At the
   default five-minute lifetime this is invisible; it only bites if you set a long
   lifetime *and* restart with notes still open.

   Making them log-resident — `session.append` of a log-only, non-surface event
   plus `sessionProjections.register` — would make them fork-inheriting and
   checkpointed. That needs the event type registered through TypeScript module
   augmentation, which a hand-written `lib/*.js` package cannot do. Deliberately
   not paid for: with a time-based lifetime, persistence buys very little.

4. **Settings *are* persisted** (`~/.dsh/insight-settings.json`), on purpose — a
   lifetime or cap that reset on every restart would be useless. They are a
   side-car rather than a registered `ctx.settings` namespace.

5. **The settings-nav icon is the shell's fallback gear.** A `settings.section`
   registration projects only `id`, `order` and `label`; the nav glyph comes from
   a closed list of built-in ids (`models` / `agent-presets` / `plugins`, else a
   gear), so a plugin cannot supply one.

6. **Icons degrade.** The dock asks
   `@deepseek-ai/dsh-client-ui-primitives` for `IconLightOutline16`,
   `IconChevronLeftOutline14` and `IconChevronRightOutline14`, and falls back to
   hand-drawn 16px inline SVG if that require fails. A missing baseline entry is
   therefore a cosmetic loss, not a dead panel.

## Notification behaviour

Closing a note *with a reason* makes the host inject a one-line `notice` message
into the agent — deliberately **without waking the driver**, so the agent cannot
reply to it. Closing without a reason notifies nobody.

## Development

`lib/index.js` and `lib/client.js` are the shipped artifacts and are
hand-written; there is no build step. `lib/client.js` is a lazy-CJS bundle in the
shape the client module loader expects:

```js
window.__ModuleLoader__.load({
  id: "dsh-insight-dock",        // must equal the package.json name
  factory: (require) => { /* … */ return module.exports },
})
```

`node --check` proves syntax only. Both real bugs found during development — a
`join()` separator emitted as content, and `heard` notes escaping the lifetime —
passed the syntax check *and* a stubbed smoke test, and only appeared once the
plugin was actually run. Test it live.

## License

MIT
