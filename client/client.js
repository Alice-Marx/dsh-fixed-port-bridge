// dsh-fixed-port-bridge — 浏览器半（client bundle）。
//
// 装载契约照抄已安装的真实样例，形状一字不差：
//   F:\DeepSeek_harness\.dsh\profiles\desktop\node_modules\dsh-plugin\client\client.js 第 1–7 行
//   window.__ModuleLoader__.load({ id: "...", factory: (require) => {
//     var module = { exports: {} }; var exports = module.exports;
//     Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//     let react = require("react");
//     ... return module.exports; } });
//
// 槽位与注册写法来源（实读行）：
//   @ljwei-stak/dsh-model-router/.dsh-plugin/client.js:14452-14456
//     ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register(
//       { name: "plugins.bundle.config", key: ROUTER_PACKAGE, inject: () => card.inject() },
//       RouterSettingsCard))
//   :14064  ROUTER_PACKAGE = "@ljwei-stak/dsh-model-router" —— 该槽位条目的 key 是包名，且条目里没有 id/order/label。
//   :14493-14498  plugins.detail.actions 才用 id+order（列表型槽位），不是这一个。
//
// 无构建链、无 JSX、无 import、无 TS 语法；只用 React.createElement。
window.__ModuleLoader__.load({
	id: "@ljwei-stak/dsh-fixed-port-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");

		const NS = "@ljwei-stak/dsh-fixed-port-bridge";
		const BUNDLE_SLOT = "plugins.bundle.config";
		const STATE_URL = "/coopanion/fixed-port-bridge/state";
		const PORT_URL = "/coopanion/fixed-port-bridge/port";
		const WS_PATH = "/coopanion/pet";
		const MIN_PORT = 1024;
		const MAX_PORT = 65535;

		const ERROR_TEXT = {
			"invalid-port": "端口无效：必须是 1024–65535 之间的整数。",
			"port-in-use": "这个端口已被占用，换一个端口再试。",
			"persist-failed": "写入配置文件失败，端口没有保存。",
			"unchanged": "这个端口就是当前值，无需保存。",
			"bad-json": "宿主没能解析这次请求（内部错误），请重试一次。",
			"forbidden": "宿主拒绝了这次请求：来源校验失败，请用 127.0.0.1 或 localhost 打开 DSH。"
		};
		const NETWORK_TEXT = "宿主路由未就绪，可能需要重启 DSH 才能启用本页。";

		const S = {
			panel: {
				display: "flex",
				flexDirection: "column",
				gap: "10px",
				padding: "14px 16px",
				borderRadius: "10px",
				border: "1px solid rgba(127,127,127,0.24)",
				background: "rgba(127,127,127,0.06)",
				color: "currentColor",
				fontSize: "13px",
				lineHeight: 1.5,
				maxWidth: "760px",
				boxSizing: "border-box"
			},
			header: {
				display: "flex",
				alignItems: "baseline",
				justifyContent: "space-between",
				gap: "8px"
			},
			title: { margin: 0, fontSize: "14px", fontWeight: 600, color: "currentColor" },
			badge: {
				fontSize: "11px",
				padding: "1px 8px",
				borderRadius: "999px",
				border: "1px solid rgba(127,127,127,0.32)",
				color: "currentColor",
				opacity: 0.8,
				whiteSpace: "nowrap"
			},
			hint: { margin: 0, fontSize: "12px", lineHeight: 1.6, color: "currentColor", opacity: 0.66 },
			rows: { display: "flex", flexDirection: "column", gap: "6px" },
			row: { display: "grid", gridTemplateColumns: "92px 1fr", alignItems: "baseline", gap: "10px" },
			label: { fontSize: "12px", color: "currentColor", opacity: 0.6 },
			value: {
				fontSize: "13px",
				color: "currentColor",
				wordBreak: "break-all",
				display: "inline-flex",
				alignItems: "center",
				gap: "6px"
			},
			mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "12.5px" },
			dot: { width: "7px", height: "7px", borderRadius: "999px", display: "inline-block", flex: "0 0 auto" },
			form: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", paddingTop: "2px" },
			input: {
				width: "112px",
				padding: "5px 8px",
				fontSize: "13px",
				color: "currentColor",
				background: "rgba(127,127,127,0.10)",
				border: "1px solid rgba(127,127,127,0.34)",
				borderRadius: "6px",
				outline: "none",
				boxSizing: "border-box",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
			},
			button: {
				padding: "5px 14px",
				fontSize: "12.5px",
				fontWeight: 500,
				color: "currentColor",
				background: "rgba(64,140,255,0.16)",
				border: "1px solid rgba(64,140,255,0.42)",
				borderRadius: "6px",
				cursor: "pointer"
			},
			buttonDisabled: {
				padding: "5px 14px",
				fontSize: "12.5px",
				fontWeight: 500,
				color: "currentColor",
				background: "rgba(127,127,127,0.12)",
				border: "1px solid rgba(127,127,127,0.30)",
				borderRadius: "6px",
				cursor: "not-allowed",
				opacity: 0.55
			},
			ghost: {
				padding: "5px 10px",
				fontSize: "12.5px",
				color: "currentColor",
				background: "transparent",
				border: "1px solid rgba(127,127,127,0.34)",
				borderRadius: "6px",
				cursor: "pointer"
			},
			wsRow: {
				display: "grid",
				gridTemplateColumns: "92px 1fr auto",
				alignItems: "center",
				gap: "10px"
			},
			code: {
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				fontSize: "12.5px",
				padding: "3px 8px",
				borderRadius: "6px",
				background: "rgba(127,127,127,0.12)",
				border: "1px solid rgba(127,127,127,0.22)",
				color: "currentColor",
				userSelect: "all",
				wordBreak: "break-all"
			}
		};

		const TONE = {
			ok: {
				color: "#2ea043",
				background: "rgba(46,160,67,0.10)",
				border: "1px solid rgba(46,160,67,0.35)"
			},
			error: {
				color: "#e5534b",
				background: "rgba(229,83,75,0.10)",
				border: "1px solid rgba(229,83,75,0.35)"
			},
			note: {
				color: "#c98a00",
				background: "rgba(201,138,0,0.10)",
				border: "1px solid rgba(201,138,0,0.35)"
			}
		};

		function noticeStyle(tone) {
			const base = {
				fontSize: "12.5px",
				lineHeight: 1.6,
				padding: "6px 10px",
				borderRadius: "6px"
			};
			const palette = TONE[tone] === undefined ? TONE.note : TONE[tone];
			return Object.assign(base, palette);
		}

		const h = react.createElement;

		// ——— 端点访问：只碰本插件的两个路由，全部 same-origin ———

		async function readState() {
			const response = await fetch(STATE_URL, {
				method: "GET",
				credentials: "same-origin",
				headers: { accept: "application/json" }
			});
			if (!response.ok) throw new Error("state-http-" + response.status);
			const data = await response.json();
			if (!data || data.ok !== true) throw new Error("state-bad-body");
			return data;
		}

		async function writePort(port) {
			const response = await fetch(PORT_URL, {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ port: port })
			});
			let data = null;
			try {
				data = await response.json();
			} catch (error) {
				data = null;
			}
			if (response.ok && data && data.ok === true) return { ok: true, data: data };
			return {
				ok: false,
				status: response.status,
				code: data && typeof data.error === "string" ? data.error : null,
				message: data && typeof data.message === "string" ? data.message : null,
				data: data
			};
		}

		function selectNodeText(node) {
			try {
				if (!node || typeof window === "undefined") return false;
				const selection = window.getSelection();
				if (!selection || typeof document === "undefined") return false;
				const range = document.createRange();
				range.selectNodeContents(node);
				selection.removeAllRanges();
				selection.addRange(range);
				return true;
			} catch (error) {
				return false;
			}
		}

		function sourceText(source) {
			if (source === "file") return "已保存的配置";
			if (source === "config") return "插件默认值";
			return "未知";
		}

		function FixedPortPanel() {
			const [snapshot, setSnapshot] = react.useState(null);
			const [loading, setLoading] = react.useState(true);
			const [loadError, setLoadError] = react.useState(null);
			const [draft, setDraft] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const [copyLabel, setCopyLabel] = react.useState("复制");
			const touched = react.useRef(false);
			const wsRef = react.useRef(null);

			const load = react.useCallback(async function () {
				setLoading(true);
				try {
					const data = await readState();
					setSnapshot(data);
					setLoadError(null);
					if (!touched.current) setDraft(String(data.port));
				} catch (error) {
					setSnapshot(null);
					setLoadError(NETWORK_TEXT);
				} finally {
					setLoading(false);
				}
			}, []);

			react.useEffect(function () {
				load();
			}, [load]);

			const save = react.useCallback(async function () {
				if (busy) return;
				const raw = String(draft).trim();
				const value = Number(raw);
				if (raw === "" || !Number.isInteger(value) || value < MIN_PORT || value > MAX_PORT) {
					setNotice({ tone: "error", text: ERROR_TEXT["invalid-port"] });
					return;
				}
				setBusy(true);
				setNotice(null);
				try {
					const result = await writePort(value);
					if (result.ok) {
						const saved = result.data && result.data.port !== undefined ? result.data.port : value;
						touched.current = false;
						await load();
						setNotice({ tone: "ok", text: "已保存端口 " + String(saved) + "。" });
						return;
					}
					if (result.code === "unchanged") {
						const current = result.data && result.data.port !== undefined ? result.data.port : value;
						setNotice({ tone: "note", text: "端口 " + String(current) + " 已经是当前值，无需保存。" });
						return;
					}
					if (result.code && ERROR_TEXT[result.code] !== undefined) {
						setNotice({ tone: "error", text: ERROR_TEXT[result.code] });
						return;
					}
					setNotice({
						tone: "error",
						text: result.message ? "保存失败：" + result.message : "保存失败（HTTP " + String(result.status) + "）。"
					});
				} catch (error) {
					setNotice({ tone: "error", text: NETWORK_TEXT });
				} finally {
					setBusy(false);
				}
			}, [busy, draft, load]);

			const port = snapshot && snapshot.port !== undefined && snapshot.port !== null ? snapshot.port : null;
			const wsText = "ws://127.0.0.1:" + (port === null ? "<端口>" : String(port)) + WS_PATH;

			const copy = react.useCallback(function () {
				const text = wsText;
				let settled = false;
				const fallback = function () {
					if (settled) return;
					settled = true;
					const selected = selectNodeText(wsRef.current);
					setCopyLabel(selected ? "已选中，按 Ctrl+C" : "复制失败");
					window.setTimeout(function () {
						setCopyLabel("复制");
					}, 2500);
				};
				try {
					if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
						navigator.clipboard.writeText(text).then(function () {
							if (settled) return;
							settled = true;
							setCopyLabel("已复制");
							window.setTimeout(function () {
								setCopyLabel("复制");
							}, 1500);
						}, fallback);
						return;
					}
				} catch (error) {
					// clipboard 被策略禁用 → 走选中文本
				}
				fallback();
			}, [wsText]);

			const statusText = loading && snapshot === null ? "读取中…" : loadError ? "宿主未响应" : "已连接宿主";
			const listening = snapshot !== null && snapshot.listening === true;
			const canPersist = snapshot !== null && snapshot.canPersist === true;
			const hostPort = snapshot && snapshot.hostPort !== undefined && snapshot.hostPort !== null ? String(snapshot.hostPort) : "—";
			const configPath = snapshot && typeof snapshot.configPath === "string" && snapshot.configPath.length > 0 ? snapshot.configPath : "";

			return h(
				"section",
				{ style: S.panel },
				h(
					"div",
					{ style: S.header },
					h("h3", { style: S.title }, "固定端口"),
					h("span", { style: S.badge }, statusText)
				),
				h(
					"p",
					{ style: S.hint },
					"在 DSH 进程内监听这个固定端口，再原样转发到 DSH 每次启动都会变的真实端口。桌宠只需记住这里填的端口。"
				),
				h(
					"div",
					{ style: S.rows },
					h(
						"div",
						{ style: S.row },
						h("span", { style: S.label }, "当前端口"),
						h("span", { style: Object.assign({}, S.value, S.mono) }, port === null ? "—" : String(port))
					),
					h(
						"div",
						{ style: S.row },
						h("span", { style: S.label }, "来源"),
						h("span", { style: S.value }, snapshot === null ? "—" : sourceText(snapshot.source))
					),
					h(
						"div",
						{ style: S.row },
						h("span", { style: S.label }, "监听状态"),
						h(
							"span",
							{ style: S.value },
							h("span", {
								style: Object.assign({}, S.dot, { background: listening ? "#2ea043" : "rgba(127,127,127,0.65)" })
							}),
							snapshot === null ? "—" : listening ? "正在监听" : "未监听"
						)
					),
					h(
						"div",
						{ style: S.row },
						h("span", { style: S.label }, "DSH 真实端口"),
						h("span", { style: Object.assign({}, S.value, S.mono) }, hostPort)
					),
					h(
						"div",
						{ style: S.row },
						h("span", { style: S.label }, "配置文件"),
						snapshot === null
							? h("span", { style: S.value }, "—")
							: canPersist
								? h("span", { style: Object.assign({}, S.value, S.mono) }, configPath.length > 0 ? configPath : "—")
								: h("span", { style: TONE.note }, "无法定位 profile，改动不会持久化")
					)
				),
				h(
					"div",
					{ style: S.form },
					h("input", {
						type: "number",
						min: MIN_PORT,
						max: MAX_PORT,
						step: 1,
						inputMode: "numeric",
						value: draft,
						style: S.input,
						disabled: loading && snapshot === null,
						"aria-label": "固定端口",
						onChange: function (event) {
							touched.current = true;
							setDraft(event.target.value);
						},
						onKeyDown: function (event) {
							if (event.key === "Enter") save();
						}
					}),
					h(
						"button",
						{
							type: "button",
							disabled: busy,
							style: busy ? S.buttonDisabled : S.button,
							onClick: save
						},
						busy ? "保存中…" : "保存"
					),
					h(
						"button",
						{
							type: "button",
							disabled: loading || busy,
							style: S.ghost,
							onClick: load
						},
						"刷新"
					),
					h("span", { style: Object.assign({}, S.hint, { opacity: 0.5 }) }, "范围 1024–65535")
				),
				notice === null
					? null
					: h(
							"div",
							{ style: noticeStyle(notice.tone), role: notice.tone === "error" ? "alert" : "status" },
							notice.text
						),
				loadError !== null && notice === null
					? h("div", { style: noticeStyle("note"), role: "status" }, loadError)
					: null,
				h(
					"div",
					{ style: S.wsRow },
					h("span", { style: S.label }, "桌宠地址"),
					h("code", { style: S.code, ref: wsRef }, wsText),
					h("button", { type: "button", style: S.ghost, onClick: copy }, copyLabel)
				)
			);
		}

		const name = "fixed-port-bridge";
		// 只声明 slots：卡片只挂一个槽位，不需要 locale / configForms。
		const inject = ["slots"];

		// 每次 apply 的注册句柄：重复 apply 时先卸载旧的，避免重复条目。
		let contributions = [];

		function disposeContributions() {
			const pending = contributions;
			contributions = [];
			for (let i = 0; i < pending.length; i++) {
				try {
					pending[i]();
				} catch (error) {
					console.warn("fixed-port-bridge: 旧条目卸载失败", error);
				}
			}
		}

		function apply(ctx) {
			try {
				if (!react || typeof react.createElement !== "function") {
					console.warn("fixed-port-bridge: 客户端没有 react，插件卡片未注册");
					return;
				}
				if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") {
					console.warn("fixed-port-bridge: 客户端没有 slots 服务，插件卡片未注册");
					return;
				}

				const entry = {
					name: BUNDLE_SLOT,
					// 这个槽位按包名对号：宿主详情页用它把卡片认到"包含的组件"里那条 bundle 上。
					key: NS,
					inject: function () {
						return {};
					}
				};

				// 幂等：先卸载上一次 apply 的条目，再重新注册。
				disposeContributions();

				let registration = null;
				try {
					registration = ctx.slots.inject(BUNDLE_SLOT, function () {
						return ctx.slots.register(entry, FixedPortPanel);
					});
				} catch (error) {
					registration = null;
					console.warn("fixed-port-bridge: " + BUNDLE_SLOT + " 条目注册失败", error);
				}
				if (typeof registration === "function") contributions.push(registration);

				return disposeContributions;
			} catch (error) {
				console.warn("fixed-port-bridge: 插件卡片注册失败", error);
				return undefined;
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
