# dsh-insight-dock

An insight dock for the DSH Web GUI.

While an agent is focused on a task it can park a short, strictly-bounded side
observation — *"欸，另外那件事其实可以…"* — without derailing what it is doing.
The note shows up above the composer, and the user decides later whether to
hear it out.

The point is the **context anchor**. Each note remembers the session sequence it
was created at, so `insight_load` can read the real conversation log back from
that moment. That read comes from the durable session log, so it survives
context compaction — which the agent's own context does not.

> The package was originally going to be named `dsh-insight`. That name is taken
> on npm by an unrelated DSH plugin ("插件评测中心"), so this one is
> `dsh-insight-dock`.

## Install

```
dsh plugin --profile web add dsh-insight-dock@0.1.0
```

Or from a local checkout, without publishing:

```
dsh plugin --profile web add link:D:/Projects/DSHPlugins/dsh-insight
```

`dsh plugin add` reconciles `dsh.profile.bundles` against installed packages,
sees the `dsh.bundle.patch` declaration in `package.json`, appends this package
to the bundle stack, and the profile boot merges `cordis.patch.yml` — a single
`insert` of the plugin row. **No profile file needs to be edited by hand.**

## Two faces

**Host** (`exports "."` → `lib/index.js`) owns:

| Surface | What it does |
| --- | --- |
| `insight_add` | Records a note. Validates title ≤ 60, reason ≤ 200, requires `why_not_now` ≤ 120, one note per turn, ≤ 5 open. |
| `insight_list` | Lists this session's notes. |
| `insight_load` | Reads the log window around the note's anchor. |
| `insight_withdraw` | The agent retracts its own note. |
| prompt context | One ambient line while notes are open, telling the agent these are not a to-do list and that a note which turns out to belong to the current task must be *done*, not filed. |
| `/insight/api/<op>` | The browser half's channel. |

**Client** (`exports "./client"` → `lib/client.js`, served at
`/plugins/dsh-insight-dock/client.js`) owns the dock in
`conversation.input.dock` (order 30) and the settings page in
`settings.section`.

## Settings

The settings page sits in the settings panel and offers: enable/disable, the
concurrent-open cap (1–50), the lifetime in minutes (1–1440, default **5**), and
a two-step "clear cache".

## Lifecycle

A note moves through these endings, and **every one of them deletes the
record** — there is no archive:

| Transition | Trigger | Result |
| --- | --- | --- |
| `active` → gone | the lifetime elapsed and nobody asked to hear it | deleted |
| `active` → `heard` | the user clicks 说来听听 | the host steers one message into the agent |
| `heard` → gone | the agent reads it via `insight_load` | its context has been handed over, so the note is removed |
| `heard` → gone | the agent never got there (abandoned or failed turn) | deleted once the lifetime elapses **from the moment it was heard** |
| `active` / `heard` → gone | the agent withdraws its own note | deleted |
| `active` / `heard` → gone | the user closes it | deleted — a close *with a reason* still injects its one-line notice first |

So a heard note normally lives for seconds, not minutes: `insight_load` deletes
it at the instant it hands the content over. The `heardAt` lifetime is only the
backstop that stops an unanswered note from sitting in the dock forever.

**Notes live in memory only.** Nothing about a note is written to disk. With a
lifetime measured in minutes this costs almost nothing — a restart outlives
every note anyway, so persistence would only ever preserve an empty set — and it
removes a whole class of failure: a silently failed write, `serial`
bookkeeping, and the fork / workspace / storage-layer caveats that a side-car
would have brought.

## Known limitations

These are real and were measured, not guessed.

1. **Every ending deletes; nothing is archived.** There is no "已归档" row and
   no record kept behind it. Expiry is irreversible: shortening the lifetime
   destroys notes outright, and **lengthening it again cannot bring them back.**

2. **A restart clears the dock.** Insights are held in memory, so they do not
   survive a `dsh` restart, and a forked session does not inherit them. At the
   default five-minute lifetime this is invisible; it only bites if you set a
   long lifetime *and* restart while notes are still open.

   Making them log-resident — `session.append` of a log-only, non-surface event
   plus `sessionProjections.register` — would make them fork-inheriting and
   checkpointed. That needs the event type registered through TypeScript module
   augmentation, which a hand-written `lib/*.js` package cannot do. Deliberately
   not paid for: with a time-based lifetime, persistence buys very little.

3. **Settings *are* persisted** (`~/.dsh/insight-settings.json`) — deliberately,
   because a lifetime or cap that reset on every restart would be useless. They
   are a side-car rather than a registered `ctx.settings` namespace: the host half
   *could* register one with `schemastery` (`import z from "schemastery"` is
   demonstrably resolvable from an installed plugin), but a plugin's own settings
   page then has to write back through a client-side remote whose shape was not
   verified. A side-car that works beats a schema-backed namespace that throws.
   Tracked debt.

4. **The settings-nav icon is the shell's fallback gear.** The shell projects
   only `id`, `order` and `label` from a `settings.section` registration and
   picks the nav glyph from a closed list of built-in ids
   (`models` / `agent-presets` / `plugins`, else a gear). A plugin cannot supply
   one.

5. **Icons degrade.** The dock asks
   `@deepseek-ai/dsh-client-ui-primitives` for `IconLightOutline16`,
   `IconChevronLeftOutline14` and `IconChevronRightOutline14`, and falls back to
   hand-drawn 16px inline SVG if that require fails. A missing baseline entry is
   therefore a cosmetic loss, not a dead panel.

## Notification behaviour

When the user closes a note *with a reason*, the host injects a one-line
`notice` message into the agent — deliberately **without waking the driver**, so
the agent cannot reply to it. Closing without a reason notifies nobody.

## License

MIT
