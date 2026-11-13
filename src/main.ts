import { MarkdownView, Plugin, TAbstractFile, TFile, WorkspaceWindow, debounce, editorInfoField, setTooltip } from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { DEFAULT_SETTINGS, EventHorizonSettingTab, EventHorizonSettings, ICE } from "./settings";
import { NewTabs } from "./newtab";
import { STATS_VIEW, StatsView } from "./stats-view";
import { Day, countWords, dayKey, stripFrontmatter } from "./stats";

const GLYPHS = ["•", "•", "·", "✦", "✧"];
const ICE_LIGHT = ["#a9c8ff", "#f4f7ff", "#cfe0ff"];
const EMBER = ["#ff5b38", "#ff8f4f"];
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const READ_WPM = 230;
const IDLE_MS = 20000; // a pause longer than this does not count as writing time
const fmt = (n: number) => n.toLocaleString();

export default class EventHorizonPlugin extends Plugin {
	settings!: EventHorizonSettings;
	private layer!: HTMLElement;
	private caret!: HTMLElement;
	private progress!: HTMLElement;
	private folio!: HTMLElement;
	private ring!: HTMLElement;
	private ringFg!: SVGCircleElement;
	private ringText!: HTMLElement;
	private modeEl!: HTMLElement;
	private counts = new Map<string, number>(); // words per note, so a change from anywhere is credited once
	private pageEl!: HTMLElement;
	private systemReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
	private reading = false;
	private view: EditorView | null = null;
	private measureKey = {};
	private lastBurst = 0;
	private lastType = 0;
	private typingTimer = 0;
	private bookWords = 0;
	private glides = new WeakMap<HTMLElement, number>();
	private mainDoc!: Document;
	private docs = new Set<Document>(); // main window plus any popouts, for body classes
	private requestSave = debounce(() => void this.saveSettings(), 1500, true);
	private newTabs = new NewTabs(this.app, () => this.settings.newTab);
	private refreshStats = debounce(() => this.statsViews().forEach((v) => v.render(false)), 400, false);

	async onload(): Promise<void> {
		await this.loadSettings();
		// the workspace's own document; activeDocument can be a blank internal page when the plugin is enabled from Settings
		this.mainDoc = this.app.workspace.containerEl.doc;
		this.docs.add(this.mainDoc);

		const body = this.mainDoc.body;
		this.layer = body.createDiv({ cls: "eh-bloom-layer" });
		this.caret = body.createDiv({ cls: "eh-caret" });
		this.progress = body.createDiv({ cls: "eh-progress" });
		this.folio = body.createDiv({ cls: "eh-folio" });
		this.registerEvent(this.app.workspace.on("window-open", (win: WorkspaceWindow) => { this.docs.add(win.doc); this.applyAppearance(); }));
		this.registerEvent(this.app.workspace.on("window-close", (win: WorkspaceWindow) => { this.docs.delete(win.doc); }));
		this.applyAppearance();
		const onSystemMotion = () => this.applyAppearance();
		this.systemReduce.addEventListener("change", onSystemMotion);
		this.register(() => this.systemReduce.removeEventListener("change", onSystemMotion));

		this.ring = this.addStatusBarItem();
		this.ring.addClass("eh-ring");
		const svg = this.ring.createSvg("svg", { attr: { viewBox: "0 0 16 16" } });
		svg.createSvg("circle", { cls: "eh-ring-bg", attr: { cx: 8, cy: 8, r: 6 } });
		this.ringFg = svg.createSvg("circle", { cls: "eh-ring-fg", attr: { cx: 8, cy: 8, r: 6 } });
		this.ringText = this.ring.createSpan({ cls: "eh-ring-text" });
		this.registerDomEvent(this.ring, "click", () => void this.openStats());

		this.modeEl = this.addStatusBarItem();
		this.modeEl.addClass("eh-mode");
		this.registerDomEvent(this.modeEl, "click", () => void this.setReading(!this.reading));
		this.pageEl = this.addStatusBarItem();
		this.pageEl.addClass("eh-page-toggle");
		this.renderPageToggle();
		this.registerDomEvent(this.pageEl, "click", () => this.togglePage());
		// Auto pages follow the app theme, which can change while reading
		this.registerEvent(this.app.workspace.on("css-change", () => this.applyAppearance()));
		this.renderRing();
		this.renderModePill();

		this.registerView(STATS_VIEW, (leaf) => new StatsView(leaf, this));
		this.registerMarkdownPostProcessor((el) => markAttribution(el));
		this.addRibbonIcon("orbit", "Open writing statistics", () => void this.openStats());
		this.addCommand({ id: "open-statistics", name: "Open writing statistics", callback: () => void this.openStats() });
		this.addCommand({ id: "toggle-reading-mode", name: "Toggle Reading mode", callback: () => void this.setReading(!this.reading) });
		this.addCommand({ id: "toggle-reading-page", name: "Switch reading page between paper and night", callback: () => this.togglePage() });
		// phones hide the status bar, so the mode switches also live in the ribbon
		this.addRibbonIcon("book-open", "Toggle Reading mode", () => void this.setReading(!this.reading));
		this.addRibbonIcon("sun-moon", "Switch reading page between paper and night", () => this.togglePage());

		this.registerEditorExtension(EditorView.updateListener.of((u) => this.onUpdate(u)));
		this.registerDomEvent(this.mainDoc, "scroll", (e) => this.onScroll(e), { capture: true, passive: true });
		this.registerDomEvent(window, "keydown", (e) => {
			if (e.key === "Escape" && this.reading && !this.mainDoc.querySelector(".modal-container, .menu, .suggestion-container")) void this.setReading(false);
		});
		// switching notes, panes or modes: drop the caret until an editor reports focus again
		const reset = () => { this.view = null; this.caret.removeClass("is-on"); };
		this.registerEvent(this.app.workspace.on("layout-change", reset));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => { reset(); if (this.reading) void this.applyModeToActive(); this.refreshStats(); }));
		this.registerEvent(this.app.workspace.on("file-open", () => { if (this.reading) window.setTimeout(() => void this.applyModeToActive(), 30); }));
		this.app.workspace.onLayoutReady(() => { this.restoreSides(); void this.watchVault(); this.newTabs.sync(); });
		this.registerEvent(this.app.workspace.on("layout-change", () => this.newTabs.sync()));
		this.addSettingTab(new EventHorizonSettingTab(this.app, this));
	}

	onunload(): void {
		this.newTabs.destroy();
		[this.layer, this.caret, this.progress, this.folio].forEach((el) => el.remove());
		for (const doc of this.docs) doc.body.removeClass("eh-on", "event-horizon", "eh-no-motion", "eh-custom-accent", "eh-calm", "eh-glide", "eh-typewriter", "eh-reading", "eh-page-night");
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<EventHorizonSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved, { history: Object.assign({}, saved?.history) });
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** True when the user asked to follow the system's reduce-motion setting and it is on. */
	isCalm(): boolean {
		return this.settings.followSystemMotion && this.systemReduce.matches;
	}

	private togglePage(): void {
		this.settings.readingPage = this.isNightPage() ? "paper" : "night";
		this.requestSave();
		this.applyAppearance();
	}

	/** Baseline every note's word count, then credit increases however they happen (typing, paste, Copilot, sync). */
	private async watchVault(): Promise<void> {
		const { vault } = this.app;
		const wordsIn = async (f: TFile) => countWords(stripFrontmatter(await vault.cachedRead(f)));
		for (const f of vault.getMarkdownFiles()) this.counts.set(f.path, await wordsIn(f));
		const isNote = (f: TAbstractFile): f is TFile => f instanceof TFile && f.extension === "md";
		const credit = async (f: TFile, fresh: boolean) => {
			const now = await wordsIn(f);
			const before = fresh ? 0 : this.counts.get(f.path);
			this.counts.set(f.path, now);
			if (this.settings.countAllWords && before !== undefined && now > before) this.addWords(now - before);
		};
		// registered after the startup scan, so files Obsidian announces while loading are not counted as new
		this.registerEvent(vault.on("modify", (f) => { if (isNote(f)) void credit(f, false); }));
		this.registerEvent(vault.on("create", (f) => { if (isNote(f)) void credit(f, true); }));
		this.registerEvent(vault.on("delete", (f) => { this.counts.delete(f.path); }));
		this.registerEvent(vault.on("rename", (f, old) => {
			const n = this.counts.get(old);
			this.counts.delete(old);
			if (n !== undefined) this.counts.set(f.path, n);
		}));
	}

	private isNightPage(): boolean {
		const p = this.settings.readingPage;
		return p === "night" || (p === "auto" && this.mainDoc.body.hasClass("theme-dark"));
	}

	applyAppearance(): void {
		const s = this.settings, calm = this.isCalm();
		for (const { body: b } of this.docs) {
			b.addClass("eh-on");
			b.toggleClass("event-horizon", s.look);
			b.toggleClass("eh-no-motion", !s.motion || calm); // the look's animations are all gated on this
			b.toggleClass("eh-calm", calm);
			b.toggleClass("eh-glide", s.glide && !calm);
			b.toggleClass("eh-typewriter", s.typewriter);
			b.toggleClass("eh-custom-accent", !!s.accent);
			b.toggleClass("eh-page-night", this.isNightPage());
			b.setCssProps({
				"--eh-accent-user": s.accent || ICE,
				"--eh-measure": `${s.measure}em`,
				"--eh-font-size": `${s.fontSize}px`,
				"--eh-line-height": `${s.lineHeight}`,
			});
		}
		this.renderPageToggle();
		this.renderRing?.();
		this.refreshStats?.();
		if (this.app.workspace.layoutReady) this.newTabs.sync(); // settings changes land here
	}

	private day(key = dayKey()): Day {
		const h = this.settings.history;
		if (!h[key]) h[key] = { w: 0, s: 0 };
		return h[key];
	}

	// ---- writing: caret, stardust, milestones, typewriter ---------------------
	private onUpdate(u: ViewUpdate): void {
		const edited = u.docChanged && u.transactions.some((t) => t.isUserEvent("input") || t.isUserEvent("delete"));
		const typed = u.docChanged && u.transactions.some((t) => t.isUserEvent("input.type"));
		const keyMove = u.selectionSet && u.transactions.some((t) => t.isUserEvent("select") && !t.isUserEvent("select.pointer"));
		// your own edits move the baseline straight away, so the save that follows is not counted again;
		// outside changes (Copilot, sync) are not user events and get credited by the vault watcher instead
		const path = edited ? u.state.field(editorInfoField, false)?.file?.path : undefined;
		if (path) this.counts.set(path, countWords(stripFrontmatter(u.state.doc.toString())));
		if (typed) {
			const now = Date.now();
			if (this.lastType && now - this.lastType < IDLE_MS) this.day().s += (now - this.lastType) / 1000;
			this.lastType = now;
			const delta = countWords(u.state.doc.toString()) - countWords(u.startState.doc.toString());
			if (delta > 0) this.addWords(delta);
		}
		if (typed || u.selectionSet || u.focusChanged || u.geometryChanged || u.viewportChanged) {
			if (u.view.hasFocus) this.view = u.view;
			this.measure(u.view, typed, false, (edited || keyMove) && this.settings.typewriter);
		}
	}

	private onScroll(e: Event): void {
		if (this.view) this.measure(this.view, false, true, false); // keep the caret glued while the page moves
		const t = e.target as Node | null;
		if (this.reading && t?.instanceOf(HTMLElement) && t.matches(".markdown-preview-view")) this.updateProgress(t);
	}

	private measure(view: EditorView, burst: boolean, instant: boolean, recenter: boolean): void {
		view.requestMeasure({
			key: this.measureKey,
			read: (v) => {
				const sel = v.state.selection.main;
				if (!v.hasFocus || !v.dom.isShown() || v.dom.ownerDocument !== this.mainDoc) return null;
				const c = v.coordsAtPos(sel.head);
				if (!c) return null;
				const box = v.scrollDOM.getBoundingClientRect();
				return { c, box, empty: sel.empty, scroller: v.scrollDOM };
			},
			write: (m) => {
				if (!m) { this.place(null, false, instant); return; }
				const visible = m.c.bottom >= m.box.top && m.c.top <= m.box.bottom;
				this.place(m.empty && visible ? m.c : null, burst, instant);
				if (recenter && m.empty) {
					const caretMid = (m.c.top + m.c.bottom) / 2 - m.box.top;
					this.glideTo(m.scroller, m.scroller.scrollTop + caretMid - this.settings.typewriterOffset * m.box.height);
				}
			},
		});
	}

	/** Smoothly scroll to a target, continuing from wherever an earlier glide got to. */
	private glideTo(el: HTMLElement, target: number): void {
		const max = el.scrollHeight - el.clientHeight;
		const to = Math.max(0, Math.min(max, target));
		const from = el.scrollTop;
		if (Math.abs(to - from) < 1) return;
		const prev = this.glides.get(el);
		if (prev) window.cancelAnimationFrame(prev);
		if (this.isCalm() || !this.settings.motion) { el.scrollTop = to; return; }
		const t0 = performance.now(), dur = 220;
		const step = (now: number) => {
			const k = Math.min(1, (now - t0) / dur);
			el.scrollTop = from + (to - from) * (1 - Math.pow(1 - k, 3));
			if (k < 1) this.glides.set(el, window.requestAnimationFrame(step));
			else this.glides.delete(el);
		};
		this.glides.set(el, window.requestAnimationFrame(step));
	}

	private place(c: { left: number; top: number; bottom: number } | null, burst: boolean, instant: boolean): void {
		const el = this.caret;
		if (!c || !this.settings.glide || this.isCalm()) { el.removeClass("is-on"); return; }
		el.toggleClass("no-anim", instant);
		el.setCssProps({ "--eh-cx": `${c.left}px`, "--eh-cy": `${c.top}px`, "--eh-ch": `${c.bottom - c.top}px` });
		el.addClass("is-on");
		if (burst) {
			el.addClass("is-typing");
			window.clearTimeout(this.typingTimer);
			this.typingTimer = window.setTimeout(() => el.removeClass("is-typing"), 650);
			this.typeBurst(c.left, (c.top + c.bottom) / 2);
		}
	}

	private typeBurst(x: number, y: number): void {
		if (!this.settings.stardust || this.isCalm()) return;
		const now = performance.now();
		if (now - this.lastBurst < 45) return;
		this.lastBurst = now;
		this.spawn(x, y, 2, false);
	}

	private spawn(x: number, y: number, n: number, big: boolean): void {
		for (let i = 0; i < n; i++) {
			const p = this.layer.createSpan({ cls: "eh-p", text: pick(GLYPHS) });
			// small bursts drift upward from the caret, milestone bursts fan out radially
			const ang = big ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
			const dist = big ? 80 + Math.random() * 220 : 12 + Math.random() * 26;
			p.setCssProps({
				"--x": `${x}px`,
				"--y": `${y}px`,
				"--dx": `${Math.cos(ang) * dist}px`,
				"--dy": `${Math.sin(ang) * dist}px`,
				"--r": `${(Math.random() - 0.5) * 240}deg`,
				"--s": `${big ? 10 + Math.random() * 14 : 6 + Math.random() * 6}px`,
				"--t": `${big ? 1.2 + Math.random() * 0.8 : 0.55 + Math.random() * 0.35}s`,
				"--c": Math.random() < 0.7 ? pick(ICE_LIGHT) : pick(EMBER),
			});
			p.addEventListener("animationend", () => p.remove(), { once: true });
		}
	}

	private addWords(delta: number): void {
		const d = this.day();
		const before = d.w;
		d.w += delta;
		this.requestSave();
		this.renderRing();
		this.refreshStats();
		if (!this.settings.milestones || this.isCalm()) return;
		const { goal, every } = this.settings;
		if (before < goal && d.w >= goal) this.celebrate(d.w);
		else if (Math.floor(before / every) < Math.floor(d.w / every)) this.bloom(`${Math.floor(d.w / every) * every} words`);
	}

	private toast(text: string, sub?: string): void {
		const t = this.layer.createDiv({ cls: "eh-toast" });
		t.createSpan({ cls: "eh-orn", text: "— ✦ —" });
		t.createSpan({ cls: "eh-toast-text", text });
		if (sub) t.createSpan({ cls: "eh-toast-sub", text: sub });
		t.addEventListener("animationend", () => t.remove(), { once: true });
	}

	private bloom(text: string): void {
		this.toast(text);
		this.ring.addClass("is-pulse");
		window.setTimeout(() => this.ring.removeClass("is-pulse"), 900);
		this.spawn(window.innerWidth / 2, window.innerHeight * 0.18, 14, true);
	}

	private celebrate(words: number): void {
		this.toast("Today's page is written.", `${fmt(words)} words`);
		const flash = this.layer.createDiv({ cls: "eh-flash" });
		flash.addEventListener("animationend", () => flash.remove(), { once: true });
		this.spawn(window.innerWidth / 2, window.innerHeight * 0.4, 46, true);
	}

	renderRing(): void {
		if (!this.ring) return;
		const words = this.day().w, goal = this.settings.goal;
		const C = 2 * Math.PI * 6;
		this.ringFg.setCssProps({ "--dash": `${C}`, "--off": `${C * (1 - Math.min(1, words / Math.max(1, goal)))}` });
		this.ringText.setText(`${fmt(words)} / ${fmt(goal)}`);
		this.ring.toggleClass("is-done", words >= goal);
		setTooltip(this.ring, `${fmt(words)} of ${fmt(goal)} words today · click for statistics`, { placement: "top" });
	}

	// ---- statistics -----------------------------------------------------------
	private statsViews(): StatsView[] {
		return this.app.workspace.getLeavesOfType(STATS_VIEW).map((l) => l.view).filter((v): v is StatsView => v instanceof StatsView);
	}

	async openStats(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(STATS_VIEW)[0];
		if (!leaf) {
			const right = this.app.workspace.getRightLeaf(false);
			if (!right) return;
			leaf = right;
			await leaf.setViewState({ type: STATS_VIEW, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	// ---- Reading mode: the book ---------------------------------------------
	async setReading(on: boolean): Promise<void> {
		if (on === this.reading) return;
		const ws = this.app.workspace;
		this.reading = on;
		for (const doc of this.docs) doc.body.toggleClass("eh-reading", on);
		if (on) {
			// remembered on disk so quitting mid-book still gives the sidebars back next launch
			this.settings.sides = { l: ws.leftSplit.collapsed, r: ws.rightSplit.collapsed };
			await this.saveSettings();
			ws.leftSplit.collapse();
			ws.rightSplit.collapse();
		} else {
			this.restoreSides();
		}
		await this.applyModeToActive();
		this.renderModePill();
	}

	private restoreSides(): void {
		const sides = this.settings.sides, ws = this.app.workspace;
		if (!sides) return;
		if (!sides.l) ws.leftSplit.expand();
		if (!sides.r) ws.rightSplit.expand();
		delete this.settings.sides;
		this.requestSave();
	}

	private async applyModeToActive(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) return;
		const want = this.reading ? "preview" : "source";
		const st = view.leaf.getViewState();
		if (st.state?.mode !== want) await view.leaf.setViewState({ ...st, state: { ...st.state, mode: want } });
		if (!this.reading) return;
		const fm = this.app.metadataCache.getFileCache(view.file)?.frontmatter ?? {};
		const title = typeof fm.title === "string" ? fm.title : view.file.basename;
		const running = typeof fm.author === "string" ? `${fm.author}  ·  ${title}` : title;
		view.containerEl.setCssProps({ "--eh-running": JSON.stringify(running) });
		this.bookWords = countWords(stripFrontmatter(view.data));
		// a book opens at its first page; wait a frame so the preview has rendered before scrolling it
		window.setTimeout(() => {
			view.previewMode.applyScroll(0);
			const scroller = view.containerEl.querySelector<HTMLElement>(".markdown-preview-view");
			if (scroller) this.updateProgress(scroller);
		}, 60);
	}

	private updateProgress(el: HTMLElement): void {
		const max = el.scrollHeight - el.clientHeight;
		const pct = max > 0 ? Math.min(1, el.scrollTop / max) : 1;
		this.progress.setCssProps({ "--p": `${pct}` });
		const left = Math.max(0, Math.ceil((this.bookWords * (1 - pct)) / READ_WPM));
		this.folio.setText(pct >= 0.995 ? "fin" : `${Math.round(pct * 100)}%  ·  ${left} min left`);
	}

	private renderPageToggle(): void {
		if (!this.pageEl) return;
		const night = this.isNightPage();
		this.pageEl.empty();
		this.pageEl.createSpan({ text: night ? "☾" : "☀" });
		this.pageEl.createSpan({ text: night ? "Night" : "Paper" });
		setTooltip(this.pageEl, night ? "Switch to the paper page" : "Switch to the night page", { placement: "top" });
	}

	private renderModePill(): void {
		this.modeEl.empty();
		this.modeEl.createSpan({ cls: "eh-mode-glyph", text: this.reading ? "✦" : "✎" });
		this.modeEl.createSpan({ text: this.reading ? "Reading" : "Writing" });
		this.modeEl.toggleClass("is-reading", this.reading);
		setTooltip(this.modeEl, this.reading ? "Back to Writing (Esc)" : "Read as a book", { placement: "top" });
	}
}

const ATTRIBUTION = /\s[—–-]\s(?=\S)/g; // " — Reen": a spaced dash before who said it

/** In a quote that ends with an attribution, close the quote before the dash instead of after the name. */
export function markAttribution(el: HTMLElement): void {
	for (const bq of Array.from(el.querySelectorAll("blockquote"))) {
		const p = bq.querySelector(":scope > p:last-of-type");
		if (!p) continue;
		const texts: Text[] = [];
		const walker = activeDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) texts.push(walker.currentNode as Text);
		for (let i = texts.length - 1; i >= 0; i--) {
			const matches = Array.from(texts[i].data.matchAll(ATTRIBUTION));
			const m = matches[matches.length - 1];
			if (!m || m.index === undefined) continue;
			const rest = texts[i].splitText(m.index);
			rest.before(createSpan({ cls: "eh-close", text: "”" }));
			bq.addClass("eh-attributed");
			break;
		}
	}
}
