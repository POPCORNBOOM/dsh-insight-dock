window.__ModuleLoader__.load({
	id: "dsh-insight-dock",
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

		/**
		 * dsh-insight-dock — browser half.
		 *
		 * Two seats: the insight dock above the composer (`conversation.input.dock`)
		 * and its settings page (`settings.section`). All state lives on the host
		 * half and is reached over the package's own `/insight/api/<op>` route —
		 * the same shape dsh-better-sidebar uses for `/sidebar/api/<method>`.
		 *
		 * Icons come from `@deepseek-ai/dsh-client-ui-primitives` when it is
		 * resolvable (two installed third-party client halves require it, so it is
		 * in the baseline) and fall back to hand-drawn 16px inline SVG otherwise.
		 * The fallback is what makes a missing baseline entry a cosmetic loss
		 * instead of a dead panel.
		 */

		const React = require("react")

		let primitives = null
		try {
			primitives = require("@deepseek-ai/dsh-client-ui-primitives")
		} catch {
			primitives = null
		}

		const API_PREFIX = "/insight/api"

		/* ---------------------------------------------------------------- api */

		async function api(op, args) {
			const response = await fetch(API_PREFIX + "/" + op, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(args || {}),
			})
			if (!response.ok) throw new Error("insight api " + op + " → HTTP " + response.status)
			return response.json()
		}

		/* --------------------------------------------------------------- icons */

		const FALLBACK_PATHS = {
			insight: "M8 1.9a4.1 4.1 0 0 0-2.5 7.35c.35.3.55.65.65 1.05h3.7c.1-.4.3-.75.65-1.05A4.1 4.1 0 0 0 8 1.9Z",
			base: "M6.2 12.1h3.6M6.9 14h2.2",
			left: "M9.8 3.6 5.4 8l4.4 4.4",
			right: "M6.2 3.6 10.6 8l-4.4 4.4",
			down: "M3.6 6.2 8 10.6l4.4-4.4",
		}

		/** Resolve a primitives icon by export name; undefined when unavailable. */
		function primitiveIcon(exportName) {
			try {
				const c = primitives && primitives[exportName]
				return typeof c === "function" ? c : undefined
			} catch {
				return undefined
			}
		}

		function fallbackSvg(name, size) {
			const paths = [{ key: "p", d: FALLBACK_PATHS[name] }]
			if (name === "insight") paths.push({ key: "q", d: FALLBACK_PATHS.base })
			return React.createElement(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 16 16",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.2,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
					focusable: "false",
				},
				paths.map((p) => React.createElement("path", { key: p.key, d: p.d })),
			)
		}

		function icon(name, size, exportName) {
			const C = primitiveIcon(exportName)
			if (C) {
				try {
					return React.createElement(C, { size })
				} catch {
					/* fall through to the local glyph */
				}
			}
			return fallbackSvg(name, size)
		}

		const insightGlyph = (size) => icon("insight", size, "IconLightOutline16")
		const chevronLeft = (size) => icon("left", size, "IconChevronLeftOutline14")
		const chevronRight = (size) => icon("right", size, "IconChevronRightOutline14")

		/* ----------------------------------------------------------------- css */

		const CSS = [
			".ins-dock{box-sizing:border-box;display:flex;justify-content:center;align-items:flex-end;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance));max-width:var(--dsh-chat-content-width);margin:0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px);flex:none}",
			".ins-shell{min-width:0}",
			".ins-shell.is-collapsed{flex:0 0 auto}",
			".ins-shell.is-expanded{flex:1 1 auto}",
			".ins-panel{background:var(--dsw-specific-tip);border-radius:12px 12px 0 0;width:100%;padding:2px 0;position:relative;overflow:hidden}",
			'.ins-panel:after{border:.5px solid var(--dsw-alias-border-l1);border-radius:inherit;content:"";pointer-events:none;border-bottom:none;position:absolute;inset:0;z-index:2}',
			".ins-headrow{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;height:36px;padding:0 4px;position:relative;z-index:1}",
			".ins-navslot{display:grid;align-items:center}",
			".ins-navslot-l{justify-items:end}",
			".ins-navslot-r{justify-items:start}",
			".ins-head{box-sizing:border-box;height:36px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:18px;align-items:center;justify-content:center;gap:7px;padding:0 12px;display:flex;white-space:nowrap}",
			".ins-head:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".ins-lead{color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}",
			".ins-count{font-family:Inter, var(--dsw-font-family);font-size:13px;font-weight:500;line-height:24px;white-space:nowrap}",
			".ins-nav{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;flex:none;place-items:center;padding:0;display:grid}",
			".ins-nav:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".ins-nav:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}",
			".ins-nav:disabled{cursor:default;opacity:.45}",
			".ins-body{padding:4px 12px 12px;max-height:240px;overflow-y:auto}",
			".ins-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
			".ins-reason{margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px;white-space:pre-wrap}",
			".ins-meta{margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;opacity:.75}",
			".ins-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}",
			".ins-btn{box-sizing:border-box;height:30px;padding:0 14px;border:none;border-radius:15px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;align-items:center;gap:6px;display:inline-flex;white-space:nowrap}",
			".ins-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".ins-btn:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}",
			".ins-btn-primary{color:var(--dsw-alias-label-primary);font-weight:500}",
			".ins-input{box-sizing:border-box;flex:1;min-width:140px;height:30px;padding:0 14px;border:none;border-radius:15px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}",
			".ins-input:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}",
			".ins-note{font-family:Inter, var(--dsw-font-family);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding:0 12px 6px}",
			".ins-set{flex-direction:column;width:100%;max-width:640px;display:flex}",
			".ins-set-lead{align-items:center;gap:8px;padding:16px 0 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px;display:flex}",
			".ins-set-leadIcon{flex:none;place-items:center;display:grid}",
			".ins-row{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}",
			".ins-row:last-child{border-bottom:none}",
			".ins-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}",
			".ins-rowTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
			".ins-rowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}",
			".ins-num{box-sizing:border-box;height:36px;width:110px;padding:0 14px;border:none;border-radius:18px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;text-align:center}",
			".ins-num:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}",
			".ins-selector{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}",
			".ins-selector:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".ins-selector:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}",
			".ins-chevron{flex:none;display:grid;place-items:center}",
			".ins-switch{box-sizing:border-box;width:44px;height:36px;padding:0;border:0;background:0 0;cursor:pointer;align-items:center;justify-content:flex-end;display:inline-flex}",
			".ins-switch:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-radius:8px}",
			".ins-track{background:var(--dsw-alias-border-l2);width:36px;height:20px;transition:background-color .12s var(--ds-ease-in-out);border-radius:10px;flex:none;display:inline-block;position:relative}",
			".ins-thumb{background:var(--dsw-alias-bg-layer-1);width:16px;height:16px;transition:transform .12s var(--ds-ease-in-out);border-radius:50%;position:absolute;top:2px;left:2px;box-shadow:0 1px 2px rgba(0,0,0,.18)}",
			'.ins-track[data-on="true"]{background:var(--dsw-alias-state-business-primary)}',
			'.ins-track[data-on="true"] .ins-thumb{transform:translate(16px)}',
		].join("\n")

		/* ------------------------------------------------------------- helpers */

		function timeAgo(ms) {
			const d = Date.now() - Number(ms)
			if (!isFinite(d) || d < 60000) return "刚刚"
			if (d < 3600000) return Math.floor(d / 60000) + " 分钟前"
			if (d < 86400000) return Math.floor(d / 3600000) + " 小时前"
			return Math.floor(d / 86400000) + " 天前"
		}

		/** The shell's own `Switch`. The hand-rolled one below is only a fallback —
		 *  it mimics the same geometry, but the primitive is what matches DSH. */
		function switchControl(checked, onChange, ariaLabel) {
			if (primitives && typeof primitives.Switch === "function") {
				return React.createElement(primitives.Switch, {
					checked: !!checked,
					label: ariaLabel,
					onChange: (v) => onChange(typeof v === "boolean" ? v : !checked),
				})
			}
			return React.createElement(
				"button",
				{
					type: "button",
					role: "switch",
					"aria-checked": checked ? "true" : "false",
					"aria-label": ariaLabel,
					className: "ins-switch",
					onClick: () => onChange(!checked),
				},
				React.createElement(
					"span",
					{
						className: "ins-track",
						"data-on": checked ? "true" : undefined,
						"aria-hidden": "true",
					},
					React.createElement("span", { className: "ins-thumb" }),
				),
			)
		}

		function chevronDown() {
			if (primitives && primitives.IconChevronDownOutline14) {
				return React.createElement(primitives.IconChevronDownOutline14, { size: 14 })
			}
			return svgIcon("down", 14)
		}

		/** A choice control in the shell's own shape: a selector pill opening the
		 *  shared `Menu` primitive — exactly how `dsh-client-locale` renders its
		 *  Language row. A native `<select>` is the fallback when the baseline
		 *  primitives are unavailable.
		 *
		 *  This is a COMPONENT, not a helper. It owns React state, so calling it as
		 *  a plain function would charge its `useState` to the CALLER — and the
		 *  caller returns early while its config loads, so the hook count would
		 *  differ between renders and React would throw away the whole section. */
		function InsightSelect(props) {
			const [open, setOpen] = React.useState(false)
			const options = props.options
			const value = props.value
			const active = options.filter((o) => o.value === value)[0] || options[0]

			if (!primitives || typeof primitives.Menu !== "function") {
				return React.createElement(
					"select",
					{ className: "ins-selector", value, onChange: (e) => props.onChange(e.target.value) },
					options.map((o) => React.createElement("option", { key: o.value, value: o.value }, o.label)),
				)
			}

			return React.createElement(primitives.Menu, {
				open,
				onClose: () => setOpen(false),
				items: options.map((o) => ({ id: o.value, label: o.label })),
				selectedId: value,
				align: "end",
				portal: true,
				onSelect: (id) => {
					props.onChange(String(id))
					setOpen(false)
				},
				anchor: React.createElement(
					"button",
					{
						type: "button",
						className: "ins-selector",
						"aria-haspopup": "menu",
						"aria-expanded": open ? "true" : "false",
						onClick: () => setOpen((v) => !v),
					},
					React.createElement("span", null, active ? active.label : ""),
					React.createElement("span", { className: "ins-chevron" }, chevronDown()),
				),
			})
		}

		/* ----------------------------------------------------------- the dock */

		function InsightDock(props) {
			const sessionId =
				props.session && props.session.sessionId
					? String(props.session.sessionId)
					: props.sessionId
						? String(props.sessionId)
						: ""

			const [data, setData] = React.useState({ items: [], config: null })
			const [expanded, setExpanded] = React.useState(false)
			const [cursor, setCursor] = React.useState(0)
			const [note, setNote] = React.useState("")
			const [askId, setAskId] = React.useState("")
			const [reason, setReason] = React.useState("")

			React.useEffect(() => {
				let alive = true
				const load = () => {
					api("snapshot", { sessionId })
						.then((r) => {
							if (!alive || !r) return
							setData({ items: Array.isArray(r.items) ? r.items : [], config: r.config || null })
						})
						.catch(() => {})
				}
				load()
				const handle = window.setInterval(load, 2500)
				return () => {
					alive = false
					window.clearInterval(handle)
				}
			}, [sessionId])

			function viaComposer(text) {
				if (!props.inputActions) {
					setNote("注入失败，且当前会话没有输入框。")
					return
				}
				props.inputActions.setDraft(String(text))
				window.setTimeout(() => {
					try {
						props.inputActions.submit()
					} catch {
						setNote("已填入输入框，请按 Enter 发送。")
					}
				}, 40)
			}

			function hear(item) {
				setNote("")
				api("hear", { id: item.id, sessionId, mode: "steer" })
					.then((r) => {
						if (!r || !r.ok) {
							setNote(r && r.error ? String(r.error) : "这条见解已失效。")
							return
						}
						if (r.injected) {
							setNote("已插话")
							return
						}
						viaComposer(r.message)
					})
					.catch(() => setNote("发送失败。"))
			}

			function closeNow(id) {
				setAskId("")
				setReason("")
				setNote("")
				api("close", { id, sessionId, reason: "", notifyAgent: false }).catch(() => {})
			}

			function closeWithReason(id) {
				const text = reason.trim()
				setAskId("")
				setReason("")
				setNote("")
				api("close", { id, sessionId, reason: text, notifyAgent: true }).catch(() => {})
			}

			const cfg = data.config || {}
			if (cfg.enabled === false) return null

			/* Every ending deletes the record, so the dock only ever sees these two
			   states — there is no archive row left to render. */
			const open = data.items.filter((i) => i.status === "active" || i.status === "heard")
			if (!open.length) return null

			const idx = open.length ? Math.min(cursor, open.length - 1) : 0
			const cur = open[idx]
			const multi = open.length > 1

			function step(delta) {
				if (!multi) return
				setCursor((idx + delta + open.length) % open.length)
				setAskId("")
				setReason("")
			}

			const navL = React.createElement(
				"button",
				{
					className: "ins-nav",
					type: "button",
					disabled: !multi,
					title: "上一条",
					"aria-label": "上一条",
					onClick: (e) => {
						e.stopPropagation()
						step(-1)
					},
				},
				chevronLeft(14),
			)
			const navR = React.createElement(
				"button",
				{
					className: "ins-nav",
					type: "button",
					disabled: !multi,
					title: "下一条",
					"aria-label": "下一条",
					onClick: (e) => {
						e.stopPropagation()
						step(1)
					},
				},
				chevronRight(14),
			)

			const head = React.createElement(
				"div",
				{ className: "ins-headrow" },
				React.createElement("div", { className: "ins-navslot ins-navslot-l" }, expanded ? navL : null),
				React.createElement(
					"button",
					{
						className: "ins-head",
						type: "button",
						"aria-expanded": expanded ? "true" : "false",
						onClick: () => setExpanded(!expanded),
					},
					React.createElement("span", { className: "ins-lead" }, insightGlyph(16)),
					React.createElement("span", { className: "ins-count" }, String(open.length) + " 条见解"),
				),
				React.createElement("div", { className: "ins-navslot ins-navslot-r" }, expanded ? navR : null),
			)

			let body = null
			if (expanded && cur) {
				const asking = askId === cur.id
				const actions = asking
					? React.createElement(
							"div",
							{ className: "ins-actions" },
							React.createElement("input", {
								className: "ins-input",
								value: reason,
								placeholder: "写一句原因",
								onChange: (e) => setReason(e.target.value),
							}),
							React.createElement(
								"button",
								{ className: "ins-btn ins-btn-primary", type: "button", onClick: () => closeWithReason(cur.id) },
								reason.trim() ? "确认并告知" : "直接关闭",
							),
							React.createElement(
								"button",
								{
									className: "ins-btn",
									type: "button",
									onClick: () => {
										setAskId("")
										setReason("")
									},
								},
								"取消",
							),
						)
					: React.createElement(
							"div",
							{ className: "ins-actions" },
							React.createElement("button", { className: "ins-btn ins-btn-primary", type: "button", onClick: () => hear(cur) }, "说来听听"),
							React.createElement("button", { className: "ins-btn", type: "button", onClick: () => closeNow(cur.id) }, "立即关闭"),
							React.createElement(
								"button",
								{
									className: "ins-btn",
									type: "button",
									onClick: () => {
										setAskId(cur.id)
										setReason("")
									},
								},
								"关闭并告诉 agent 为什么",
							),
						)
				const meta =
					timeAgo(cur.createdAt) +
					(cur.status === "heard" ? " · 已听过" : "") +
					(multi ? " · " + String(idx + 1) + "/" + String(open.length) : "")
				body = React.createElement(
					"div",
					{ className: "ins-body" },
					React.createElement("div", { className: "ins-title" }, cur.title),
					React.createElement("div", { className: "ins-reason" }, cur.reason),
					React.createElement("div", { className: "ins-meta" }, meta),
					actions,
				)
			}

			const panel = React.createElement("div", { className: "ins-panel" }, head, body)
			if (!expanded && note) {
				return React.createElement(
					"div",
					{ className: "ins-dock" },
					React.createElement(
						"div",
						{ className: "ins-shell is-collapsed" },
						panel,
						React.createElement("div", { className: "ins-note" }, note),
					),
				)
			}
			return React.createElement(
				"div",
				{ className: "ins-dock" },
				React.createElement("div", { className: "ins-shell " + (expanded ? "is-expanded" : "is-collapsed") }, panel),
			)
		}

		/* ------------------------------------------------------- the settings */

		/** What each ambient-prompt level actually changes. The row renders the
		 *  entry for the CURRENT level, so the knob explains itself. */
		const INJECTION_OPTIONS = [
			{ value: "off", label: "关闭", desc: "不注入任何邀请。你关闭见解时附的原因仍然送达。" },
			{
				value: "whenOpen",
				label: "弱",
				desc: "只在已经有见解时注入一句提醒。注意：它在结构上无法促成第一条——提醒的前提是先有一条。",
			},
			{
				value: "always",
				label: "中",
				desc: "只要在工作就一直注入一句正向判据（真实、现在做不了、不记就会丢）。这是第一条能出现的前提。",
			},
			{
				value: "insist",
				label: "强",
				desc: "在「中」之上再加一句：每次开工前先扫一眼有没有这样的观察。",
			},
		]

		function injectionDesc(value) {
			const hit = INJECTION_OPTIONS.filter((o) => o.value === value)[0]
			return hit ? hit.desc : ""
		}

		function InsightSettings() {
			const [cfg, setCfg] = React.useState(null)
			const [err, setErr] = React.useState("")

			React.useEffect(() => {
				let alive = true
				api("config_get", {})
					.then((r) => {
						if (alive && r && r.config) setCfg(r.config)
					})
					.catch(() => {
						if (alive) setErr("读取失败。")
					})
				return () => {
					alive = false
				}
			}, [])

			function patch(p) {
				const next = Object.assign({}, cfg, p)
				setCfg(next)
				api("config_set", { config: next })
					.then((r) => {
						if (r && r.config) setCfg(r.config)
					})
					.catch(() => setErr("保存失败。"))
			}

			if (!cfg) {
				return React.createElement(
					"div",
					{ className: "ins-set" },
					React.createElement("div", { className: "ins-rowDesc" }, err || "加载中…"),
				)
			}

			return React.createElement(
				"div",
				{ className: "ins-set" },
				React.createElement(
					"div",
					{ className: "ins-set-lead" },
					React.createElement("span", { className: "ins-set-leadIcon" }, insightGlyph(16)),
					React.createElement("span", null, "你在专注时留下的侧面发现会停在这里，等你有空再听。"),
				),
				React.createElement(
					"div",
					{ className: "ins-row" },
					React.createElement(
						"div",
						{ className: "ins-rowText" },
						React.createElement("div", { className: "ins-rowTitle" }, "启用见解"),
						React.createElement("div", { className: "ins-rowDesc" }, "关掉后工具、面板与提示词注入全部停用。"),
					),
					switchControl(!!cfg.enabled, (v) => patch({ enabled: v }), "启用见解"),
				),
				React.createElement(
					"div",
					{ className: "ins-row" },
					React.createElement(
						"div",
						{ className: "ins-rowText" },
						React.createElement("div", { className: "ins-rowTitle" }, "提示强度"),
						React.createElement("div", { className: "ins-rowDesc" }, injectionDesc(cfg.injection)),
					),
					React.createElement(InsightSelect, {
						value: cfg.injection,
						options: INJECTION_OPTIONS,
						onChange: (v) => patch({ injection: v }),
					}),
				),
				React.createElement(
					"div",
					{ className: "ins-row" },
					React.createElement(
						"div",
						{ className: "ins-rowText" },
						React.createElement("div", { className: "ins-rowTitle" }, "同时保留的上限"),
						React.createElement("div", { className: "ins-rowDesc" }, "1 – 50。达到上限后 agent 必须先撤回一条才能新增。"),
					),
					React.createElement("input", {
						className: "ins-num",
						type: "number",
						min: 1,
						max: 50,
						value: String(cfg.maxOpen),
						onChange: (e) => patch({ maxOpen: Number(e.target.value) }),
					}),
				),
				React.createElement(
					"div",
					{ className: "ins-row" },
					React.createElement(
						"div",
						{ className: "ins-rowText" },
						React.createElement("div", { className: "ins-rowTitle" }, "存活时间（分钟）"),
						React.createElement(
							"div",
							{ className: "ins-rowDesc" },
							"默认 5。超过这个时长的见解会被直接删除，不是归档——调短之后再调长救不回来。" +
								"你点过「说来听听」的，agent 一旦读走就立即删除；这里的时长是它始终没被读走时的兜底。1 – 1440。",
						),
					),
					React.createElement("input", {
						className: "ins-num",
						type: "number",
						min: 1,
						max: 1440,
						value: String(cfg.ttlMinutes),
						onChange: (e) => patch({ ttlMinutes: Number(e.target.value) }),
					}),
				),
				err ? React.createElement("div", { className: "ins-rowDesc", style: { padding: "8px 0" } }, err) : null,
			)
		}

		/* ---------------------------------------------------------------- apply */

		/** Cordis client services this half reads. `slots` is always present in the
		 *  web shell; declaring it is what keeps the registration off an
		 *  undefined-access path. */
		const inject = ["slots"]

		function apply(ctx) {
			ctx.effect(() => insertStyle(CSS))
			ctx.slots.inject("conversation.input.dock", () =>
				ctx.slots.register({ name: "conversation.input.dock", id: "insight", order: 30, label: "见解" }, InsightDock),
			)
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register({ name: "settings.section", id: "insight", order: 30, label: "见解" }, InsightSettings),
			)
		}

		/** Package-owned stylesheet, inserted on the same `data-plugin-css`
		 *  convention the shipped plugins use; removed when the fiber unloads. */
		function insertStyle(css) {
			const tag = document.createElement("style")
			tag.dataset.plugin = "dsh-insight-dock"
			tag.dataset.pluginCss = "dsh-insight-dock/Dock.module.css"
			tag.textContent = css
			document.head.appendChild(tag)
			return () => {
				try {
					tag.remove()
				} catch {}
			}
		}

		exports.name = "dsh-insight-dock"
		exports.apply = apply
		exports.inject = inject
		return module.exports
	},
})
