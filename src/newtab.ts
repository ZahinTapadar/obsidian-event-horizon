// The living new tab: a photographed black hole with orbiting light, drawn into Obsidian's empty tabs.
import { App, View, WorkspaceLeaf } from "obsidian";
import sky from "../assets/sky.jpg";

// the disk, measured on the photo (fractions of its width/height): k=0 inner edge, k=1 outer edge.
// These numbers are calibrated for this one photo (assets/sky.jpg); a different image needs new ones.
const DISK = { cx0: 0.264, cy0: 0.528, rx0: 0.387, ry0: 0.132, cx1: 0.236, cy1: 0.56, rx1: 0.75, ry1: 0.228 };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const STOPS: [number, number[]][] = [[0, [90, 130, 255]], [0.45, [200, 220, 255]], [0.62, [255, 255, 255]], [0.82, [255, 150, 90]], [1, [255, 70, 40]]];

/** Colour across the disk: blue inside, white in the bright band, ember at the rim. */
function tone(k: number, a: number): string {
	let i = 1;
	while (i < STOPS.length - 1 && k > STOPS[i][0]) i++;
	const [k0, c0] = STOPS[i - 1], [k1, c1] = STOPS[i], t = Math.min(1, Math.max(0, (k - k0) / (k1 - k0)));
	return `rgba(${c0.map((v, j) => Math.round(v + (c1[j] - v) * t)).join(",")},${a})`;
}

interface Streak { k: number; a: number; len: number; w: number; life: number; max: number; v: number }
interface Light { x: number; y: number; s: number; ph: number; sp: number }
// internal API, absent on some versions/platforms
interface InternalPlugins { getPluginById(id: string): { instance?: { openGlobalSearch?(q: string): void } } | null }

class Scene {
	readonly el: HTMLElement;
	private win: Window;
	private cv: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D | null;
	private time: HTMLElement;
	private date: HTMLElement;
	private greet: HTMLElement;
	private calm: boolean;
	private mx = 0.5; private my = 0.5; private px = 0.5; private py = 0.5;
	private glow: HTMLCanvasElement;
	private streaks: Streak[];
	private lights: Light[];
	private img: HTMLImageElement;
	private raf = 0;
	private clock: number;
	private dead = false;

	constructor(app: App, host: HTMLElement) {
		const doc = host.doc, win = host.win;
		this.win = win;
		this.el = host.createDiv({ cls: "eh-newtab" });
		this.cv = this.el.createEl("canvas", { cls: "eh-sky", attr: { "aria-hidden": "true" } });
		this.el.createDiv({ cls: "eh-veil", attr: { "aria-hidden": "true" } });
		const head = this.el.createDiv({ cls: "eh-head" });
		this.greet = head.createEl("p", { cls: "eh-kicker eh-greet" });
		this.time = head.createEl("h1", { cls: "eh-time" });
		this.date = head.createEl("p", { cls: "eh-kicker" });
		const dock = this.el.createDiv({ cls: "eh-dock" });
		const input = dock.createEl("input", { cls: "eh-q", attr: { type: "search", placeholder: "Search the vault", "aria-label": "Search the vault" } });
		input.addEventListener("keydown", (e) => {
			const q = input.value.trim();
			if (e.key !== "Enter" || !q) return;
			const ip = (app as unknown as { internalPlugins?: InternalPlugins }).internalPlugins;
			ip?.getPluginById("global-search")?.instance?.openGlobalSearch?.(q);
		});
		const recent = dock.createDiv({ cls: "eh-recent" });
		for (const path of app.workspace.getLastOpenFiles().slice(0, 6)) {
			const name = (path.split("/").pop() ?? path).replace(/\.md$/, "");
			recent.createEl("button", { text: name, attr: { title: path } }).addEventListener("click", () => void app.workspace.openLinkText(path, "", false));
		}

		this.ctx = this.cv.getContext("2d");
		this.calm = win.matchMedia("(prefers-reduced-motion: reduce)").matches; // frame holds still; light still moves, slower
		this.el.addEventListener("mousemove", (e) => {
			const r = this.el.getBoundingClientRect();
			this.mx = (e.clientX - r.left) / r.width;
			this.my = (e.clientY - r.top) / r.height;
		});
		this.glow = this.sprite(doc, 255, 70, 40);
		this.streaks = Array.from({ length: 150 }, () => this.streak());
		this.lights = Array.from({ length: 140 }, () => ({ x: Math.random(), y: 0.79 + Math.pow(Math.random(), 0.7) * 0.21, s: 6 + Math.random() * 16, ph: Math.random() * 6.28, sp: 0.4 + Math.random() * 1.4 }));
		this.img = new Image();
		this.img.src = sky;
		this.img.decode().then(() => { if (!this.dead) this.raf = win.requestAnimationFrame((t) => this.frame(t)); }).catch(() => {});
		this.clock = win.setInterval(() => this.tick(), 1000);
		this.tick();
	}

	private sprite(doc: Document, r: number, g: number, b: number): HTMLCanvasElement {
		const s = doc.createElement("canvas");
		s.width = s.height = 64;
		const c = s.getContext("2d");
		if (!c) return s;
		const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
		grd.addColorStop(0, `rgba(${r},${g},${b},1)`);
		grd.addColorStop(0.25, `rgba(${r},${g},${b},.45)`);
		grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
		c.fillStyle = grd;
		c.fillRect(0, 0, 64, 64);
		return s;
	}

	private streak(): Streak {
		const k = Math.pow(Math.random(), 0.8);
		// Kepler: inner orbits turn faster, angular speed ~ r^-1.5
		return { k, a: Math.random() * Math.PI * 2, len: 0.12 + Math.random() * 0.35, w: 1 + Math.random() * 2.2, life: 0, max: 400 + Math.random() * 900,
			v: (0.9 + Math.random() * 0.3) * 0.0016 / Math.pow(0.3 + k, 1.5) };
	}

	private tick(): void {
		const d = new Date(), h = d.getHours();
		this.time.setText(d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, ""));
		this.date.setText(d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }));
		this.greet.setText(h < 5 ? "Deep night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Late orbit");
	}

	private frame(t: number): void {
		this.raf = this.win.requestAnimationFrame((n) => this.frame(n));
		const W = this.el.clientWidth, H = this.el.clientHeight, ctx = this.ctx, img = this.img;
		if (!W || !H || !ctx) return; // tab hidden behind another one
		const dpr = Math.min(this.win.devicePixelRatio || 1, 2);
		if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) {
			this.cv.width = Math.round(W * dpr);
			this.cv.height = Math.round(H * dpr);
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (!this.calm) { this.px += (this.mx - this.px) * 0.04; this.py += (this.my - this.py) * 0.04; }
		const zoom = 1.06 + (this.calm ? 0 : 0.015 * Math.sin(t / 9000));
		const s = Math.max(W / img.width, H / img.height) * zoom, iw = img.width * s, ih = img.height * s;
		const ox = (W - iw) / 2 - (this.px - 0.5) * 36, oy = (H - ih) / 2 - (this.py - 0.5) * 22;
		ctx.globalCompositeOperation = "source-over";
		ctx.drawImage(img, ox, oy, iw, ih);
		ctx.globalCompositeOperation = "lighter";
		for (const l of this.lights) {
			ctx.globalAlpha = (0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(t / 1000 * l.sp + l.ph), 3)) * 0.55;
			ctx.drawImage(this.glow, ox + l.x * iw - l.s / 2, oy + l.y * ih - l.s / 2, l.s, l.s);
		}
		ctx.globalAlpha = 1;
		for (let i = 0; i < this.streaks.length; i++) {
			const st = this.streaks[i];
			st.a += this.calm ? st.v * 0.5 : st.v;
			st.life++;
			if (st.life > st.max) { this.streaks[i] = this.streak(); continue; }
			const fade = Math.min(1, st.life / 60, (st.max - st.life) / 60), k = st.k;
			const cx = ox + lerp(DISK.cx0, DISK.cx1, k) * iw, cy = oy + lerp(DISK.cy0, DISK.cy1, k) * ih;
			const rx = lerp(DISK.rx0, DISK.rx1, k) * iw, ry = lerp(DISK.ry0, DISK.ry1, k) * ih;
			const a0 = st.a - st.len, g = ctx.createLinearGradient(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, cx + Math.cos(st.a) * rx, cy + Math.sin(st.a) * ry);
			g.addColorStop(0, tone(k, 0));
			g.addColorStop(0.7, tone(k, 0.5 * fade));
			g.addColorStop(1, `rgba(255,255,255,${fade})`);
			ctx.strokeStyle = g;
			ctx.lineWidth = st.w;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.ellipse(cx, cy, rx, ry, 0, a0, st.a);
			ctx.stroke();
		}
		ctx.globalCompositeOperation = "source-over";
	}

	destroy(): void {
		this.dead = true;
		this.win.cancelAnimationFrame(this.raf);
		this.win.clearInterval(this.clock);
		this.el.detach();
	}
}

/** Keeps one Scene in every empty tab while `enabled()` says so. */
export class NewTabs {
	private scenes = new Map<HTMLElement, Scene>(); // empty leaf's content element -> its scene

	constructor(private app: App, private enabled: () => boolean) {}

	sync(): void {
		const wanted = new Set<HTMLElement>();
		if (this.enabled()) this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			const el = (leaf.view as View & { contentEl?: HTMLElement }).contentEl; // the empty view is an ItemView at runtime
			if (leaf.view.getViewType() === "empty" && el) wanted.add(el);
		});
		for (const [host, scene] of this.scenes) {
			if (!wanted.has(host) || !host.isConnected) this.drop(host, scene);
		}
		for (const host of wanted) {
			if (this.scenes.has(host)) continue;
			host.addClass("eh-newtab-host");
			this.scenes.set(host, new Scene(this.app, host));
		}
	}

	destroy(): void {
		for (const [host, scene] of this.scenes) this.drop(host, scene);
	}

	private drop(host: HTMLElement, scene: Scene): void {
		scene.destroy();
		host.removeClass("eh-newtab-host");
		this.scenes.delete(host);
	}
}
