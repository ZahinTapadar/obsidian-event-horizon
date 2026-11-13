export interface Day { w: number; s: number } // words typed, seconds spent typing
export type History = Record<string, Day>;

export interface Stats {
	today: number;
	goal: number;
	streak: number;
	best: { key: string | null; w: number };
	total: number;
	goalDays: number;
	minutes: number;
	pace: number | null;
}

/** Local calendar day as YYYY-MM-DD. */
export const dayKey = (d: Date = new Date()): string => d.toLocaleDateString("en-CA");

export const countWords = (text: string): number => (text.match(/\S+/g) ?? []).length;

/** Drops a leading YAML frontmatter block so it doesn't count as prose. */
export const stripFrontmatter = (text: string): string => text.replace(/^---[\s\S]*?\n---/, "");

export function computeStats(history: History, goal: number, now: Date = new Date()): Stats {
	const keys = Object.keys(history).filter((k) => (history[k]?.w ?? 0) > 0);
	const today = history[dayKey(now)] ?? { w: 0, s: 0 };

	let streak = 0;
	const d = new Date(now);
	if (!((history[dayKey(d)]?.w ?? 0) > 0)) d.setDate(d.getDate() - 1); // today not started yet: the streak still stands
	while ((history[dayKey(d)]?.w ?? 0) > 0) {
		streak++;
		d.setDate(d.getDate() - 1);
	}

	let best: Stats["best"] = { key: null, w: 0 };
	for (const k of keys) if (history[k].w > best.w) best = { key: k, w: history[k].w };

	return {
		today: today.w,
		goal,
		streak,
		best,
		total: keys.reduce((sum, k) => sum + history[k].w, 0),
		goalDays: keys.filter((k) => history[k].w >= goal).length,
		minutes: Math.round(today.s / 60),
		pace: today.s >= 60 ? Math.round(today.w / (today.s / 60)) : null,
	};
}

/** Heat level 0–4 for a day's words against the goal (-1 = future). */
export function heatLevel(words: number, goal: number, future: boolean): number {
	if (future) return -1;
	if (words === 0) return 0;
	if (words < goal * 0.25) return 1;
	if (words < goal * 0.5) return 2;
	if (words < goal) return 3;
	return 4;
}
