import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats, countWords, dayKey, heatLevel, stripFrontmatter } from "../src/stats.ts";

const ago = (n: number) => { const d = new Date(2026, 10, 7); d.setDate(d.getDate() - n); return dayKey(d); };
const now = new Date(2026, 10, 7, 12);

test("streak counts back from yesterday when today is still empty", () => {
	const s = computeStats({ [ago(1)]: { w: 600, s: 0 }, [ago(2)]: { w: 10, s: 0 }, [ago(4)]: { w: 900, s: 0 } }, 500, now);
	assert.equal(s.streak, 2);
	assert.equal(s.best.w, 900);
	assert.equal(s.goalDays, 2);
	assert.equal(s.total, 1510);
});

test("today extends the streak and gives a pace", () => {
	const s = computeStats({ [ago(0)]: { w: 120, s: 300 }, [ago(1)]: { w: 600, s: 0 } }, 500, now);
	assert.equal(s.streak, 2);
	assert.equal(s.pace, 24);
	assert.equal(s.minutes, 5);
});

test("no pace before a minute of writing", () => {
	assert.equal(computeStats({ [ago(0)]: { w: 40, s: 30 } }, 500, now).pace, null);
});

test("heat levels against the goal", () => {
	assert.deepEqual([0, 100, 200, 400, 500].map((w) => heatLevel(w, 500, false)), [0, 1, 2, 3, 4]);
	assert.equal(heatLevel(999, 500, true), -1);
});

test("words ignore frontmatter", () => {
	assert.equal(countWords(stripFrontmatter("---\ntitle: x\nauthor: y\n---\nOne two  three\nfour")), 4);
});
