import { ItemView, MarkdownView, WorkspaceLeaf, setTooltip } from "obsidian";
import type EventHorizonPlugin from "./main";
import { Day, computeStats, countWords, dayKey, dayReadout, heatLevel, stripFrontmatter } from "./stats";

export const STATS_VIEW = "event-horizon-stats";
const READ_WPM = 230;
const fmt = (n: number) => n.toLocaleString();
type Slot = "heat" | "bars";
const shortDate = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export class StatsView extends ItemView {
	private hovered: Record<Slot, string | null> = { heat: null, bars: null }; // survives the re-render that follows each word
	constructor(leaf: WorkspaceLeaf, private plugin: EventHorizonPlugin) {
		super(leaf);
	}

	getViewType(): string { return STATS_VIEW; }
	getDisplayText(): string { return "Writing statistics"; }
	getIcon(): string { return "orbit"; }

	async onOpen(): Promise<void> {
		this.render(true);
	}

	private countUp(el: HTMLElement, to: number, animate: boolean): void {
		if (!animate || to === 0) { el.setText(fmt(to)); return; }
		const t0 = performance.now(), dur = 900;
		const step = (t: number) => {
			const k = Math.min(1, (t - t0) / dur);
			el.setText(fmt(Math.round(to * (1 - Math.pow(1 - k, 3)))));
			if (k < 1) window.requestAnimationFrame(step);
		};
		window.requestAnimationFrame(step);
	}

	/**
	 * A readout line under a chart that says what was written on the hovered (or tapped) day.
	 * Returns a function that wires one cell or column to it.
	 */
	private readout(parent: HTMLElement, area: HTMLElement, slot: Slot): (el: HTMLElement, d: Date, day: Day | undefined) => void {
		const goal = this.plugin.settings.goal;
		const box = parent.createDiv({ cls: "eh-readout" });
		const date = box.createSpan({ cls: "eh-readout-date" });
		const words = box.createSpan({ cls: "eh-readout-words" });
		const extra = box.createSpan({ cls: "eh-readout-extra" });
		let current: HTMLElement | null = null;
		const reset = () => {
			current?.removeClass("is-hover");
			current = null;
			this.hovered[slot] = null;
			box.addClass("is-empty");
			date.setText("Hover a day to see what you wrote");
			words.setText("");
			extra.setText("");
		};
		reset();
		// a touch tap fires pointerleave right after it lifts; keep what was tapped until the next tap
		area.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") reset(); });
		return (el, d, day) => {
			const key = dayKey(d);
			const show = () => {
				current?.removeClass("is-hover");
				current = el;
				el.addClass("is-hover");
				this.hovered[slot] = key;
				const r = dayReadout(day?.w ?? 0, day?.s ?? 0, goal);
				box.removeClass("is-empty");
				date.setText(shortDate(d));
				words.setText(r.words);
				extra.setText(r.extra);
			};
			el.addEventListener("pointerenter", show);
			if (this.hovered[slot] === key) show();
		};
	}

	render(entrance: boolean): void {
		const p = this.plugin;
		const history = p.settings.history;
		const s = computeStats(history, p.settings.goal);
		const animate = entrance && !p.isCalm();
		const root = this.contentEl;
		root.empty();
		root.addClass("eh-stats");
		root.toggleClass("is-animated", animate);

		const head = root.createDiv({ cls: "eh-stats-head" });
		head.createDiv({ cls: "eh-eyebrow", text: new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) });
		head.createDiv({ cls: "eh-stats-title", text: "Writing" });

		// today: one large number inside a ring
		const today = root.createDiv({ cls: "eh-today" });
		const C = 2 * Math.PI * 52, pct = Math.min(1, s.today / Math.max(1, s.goal));
		const svg = today.createSvg("svg", { attr: { viewBox: "0 0 120 120" } });
		svg.createSvg("circle", { cls: "eh-big-bg", attr: { cx: 60, cy: 60, r: 52 } });
		const fg = svg.createSvg("circle", { cls: "eh-big-fg", attr: { cx: 60, cy: 60, r: 52 } });
		fg.setCssProps({ "--dash": `${C}`, "--off": `${animate ? C : C * (1 - pct)}` });
		if (animate) window.requestAnimationFrame(() => window.requestAnimationFrame(() => fg.setCssProps({ "--off": `${C * (1 - pct)}` })));
		const mid = today.createDiv({ cls: "eh-today-mid" });
		const num = mid.createDiv({ cls: "eh-today-num" });
		mid.createDiv({ cls: "eh-today-sub", text: s.today >= s.goal ? "page written ✦" : `of ${fmt(s.goal)} words` });
		this.countUp(num, s.today, animate);
		setTooltip(today, `${fmt(s.today)} words today, ${Math.round(pct * 100)}% of your goal`);

		// tiles
		const tiles = root.createDiv({ cls: "eh-tiles" });
		const tile = (label: string, value: number | null, note?: string) => {
			const t = tiles.createDiv({ cls: "eh-tile" });
			const v = t.createDiv({ cls: "eh-tile-value" });
			t.createDiv({ cls: "eh-tile-label", text: label });
			if (note) setTooltip(t, note);
			if (value === null) v.setText("—");
			else this.countUp(v, value, animate);
		};
		tile("day streak", s.streak, "Days in a row with any writing");
		tile("words, all time", s.total);
		tile("best day", s.best.w, s.best.key ? `Most words in one day: ${s.best.key}` : "No writing yet");
		tile("goal days", s.goalDays, `Days you reached ${fmt(s.goal)} words`);
		tile("min writing today", s.minutes, "Typing time today; pauses over 20 seconds are not counted");
		tile("words / min", s.pace, "Your pace today while actually writing");

		// heatmap: last 16 weeks, one ice hue from faint to full
		const sec1 = root.createDiv({ cls: "eh-section" });
		sec1.createDiv({ cls: "eh-section-title", text: "Last 16 weeks" });
		const grid = sec1.createDiv({ cls: "eh-heat" });
		const start = new Date();
		start.setDate(start.getDate() - start.getDay() - 7 * 15); // the Sunday 15 weeks back
		const now = new Date();
		const heatCells: [HTMLElement, Date][] = [];
		for (let i = 0; i < 16 * 7; i++) {
			const d = new Date(start);
			d.setDate(start.getDate() + i);
			const w = history[dayKey(d)]?.w ?? 0;
			const lvl = heatLevel(w, s.goal, d > now);
			const c = grid.createDiv({ cls: `eh-cell l${lvl}` });
			c.setCssProps({ "--i": `${i}` });
			if (lvl >= 0) {
				setTooltip(c, `${shortDate(d)} · ${fmt(w)} words`, { placement: "top" });
				heatCells.push([c, d]);
			}
		}
		const legend = sec1.createDiv({ cls: "eh-heat-legend" });
		legend.createSpan({ text: "less" });
		for (const l of [0, 1, 2, 3, 4]) legend.createDiv({ cls: `eh-cell l${l}` });
		legend.createSpan({ text: "goal" });
		const heatHover = this.readout(sec1, grid, "heat");
		for (const [c, d] of heatCells) heatHover(c, d, history[dayKey(d)]);

		// bars: last 14 days, dashed line at the goal
		const sec2 = root.createDiv({ cls: "eh-section" });
		sec2.createDiv({ cls: "eh-section-title", text: "Last 14 days" });
		const days = Array.from({ length: 14 }, (_, i) => {
			const d = new Date();
			d.setDate(d.getDate() - 13 + i);
			return { d, w: history[dayKey(d)]?.w ?? 0 };
		});
		const top = Math.max(s.goal, ...days.map((x) => x.w));
		const bars = sec2.createDiv({ cls: "eh-bars" });
		const goalLine = bars.createDiv({ cls: "eh-goal-line" });
		goalLine.setCssProps({ "--goal": `${(s.goal / top) * 100}%` });
		goalLine.createSpan({ text: `goal ${fmt(s.goal)}` });
		const cols: [HTMLElement, Date][] = [];
		days.forEach(({ d, w }, i) => {
			const col = bars.createDiv({ cls: "eh-bar-col" });
			const bar = col.createDiv({ cls: "eh-bar" + (w >= s.goal ? " is-goal" : "") });
			bar.setCssProps({ "--h": `${(w / top) * 100}%`, "--i": `${i}` });
			setTooltip(col, `${shortDate(d)} · ${fmt(w)} words`, { placement: "top" });
			cols.push([col, d]);
		});
		const axis = sec2.createDiv({ cls: "eh-bars-axis" });
		axis.createSpan({ text: days[0].d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) });
		axis.createSpan({ text: "today" });
		const barHover = this.readout(sec2, bars, "bars");
		for (const [col, d] of cols) barHover(col, d, history[dayKey(d)]);

		// this note
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file) {
			const body = stripFrontmatter(view.data);
			const words = countWords(body);
			const sec3 = root.createDiv({ cls: "eh-section eh-note" });
			sec3.createDiv({ cls: "eh-section-title", text: "This note" });
			sec3.createDiv({ cls: "eh-note-name", text: view.file.basename });
			sec3.createDiv({ cls: "eh-note-meta", text: `${fmt(words)} words  ·  ${Math.max(1, Math.round(words / READ_WPM))} min read  ·  ${fmt(view.data.length)} characters` });
		}
	}
}
