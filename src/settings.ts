import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type EventHorizonPlugin from "./main";
import type { History } from "./stats";

export interface EventHorizonSettings {
	look: boolean;
	accent: string; // empty = palette default
	measure: number; // em
	fontSize: number; // px
	lineHeight: number;
	motion: boolean;
	aurora: boolean;
	grain: boolean;
	glide: boolean;
	petals: boolean;
	milestones: boolean;
	countAllWords: boolean;
	followSystemMotion: boolean;
	readingPage: "auto" | "paper" | "night";
	typewriter: boolean;
	typewriterOffset: number; // 0–1 of the editor height
	goal: number;
	every: number;
	history: History;
	sides?: { l: boolean; r: boolean }; // sidebars to restore after Reading mode
}

export const DEFAULT_SETTINGS: EventHorizonSettings = {
	look: true,
	accent: "",
	measure: 40,
	fontSize: 20,
	lineHeight: 1.8,
	motion: true,
	aurora: true,
	grain: true,
	glide: true,
	petals: true,
	milestones: true,
	countAllWords: true,
	followSystemMotion: false,
	readingPage: "auto",
	typewriter: true,
	typewriterOffset: 0.45,
	goal: 500,
	every: 100,
	history: {},
};

const PINK = "#ff5a6f";

export class EventHorizonSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: EventHorizonPlugin) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		if (key === "accent") return this.plugin.settings.accent || PINK;
		return this.plugin.settings[key as keyof EventHorizonSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
		this.plugin.applyAppearance();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				items: [
					{ name: "Event Horizon look", desc: "Paper palette, Fraunces headings, aurora, quiet chrome and the bookshelf styling. Turn off to keep only the rewards, statistics and Reading mode.", control: { type: "toggle", key: "look" } },
					{ name: "Accent colour", desc: "Used for the caret, links, petals and rings.", aliases: ["color", "pink"], control: { type: "color", key: "accent" } },
					{
						name: "Reset accent colour",
						desc: "Back to Event Horizon pink.",
						action: () => { void this.setControlValue("accent", "").then(() => this.update()); },
					},
					{ name: "Reading column width", desc: "Line length of the page, in em.", control: { type: "slider", key: "measure", min: 28, max: 70, step: 1 } },
					{ name: "Body font size", control: { type: "slider", key: "fontSize", min: 15, max: 26, step: 1, displayFormat: (v) => `${v}px` } },
					{ name: "Line height", control: { type: "slider", key: "lineHeight", min: 1.4, max: 2.2, step: 0.05 } },
				],
			},
			{
				type: "group",
				heading: "Motion",
				items: [
					{ name: "Animations", desc: "Fades, hovers, shimmer and page turns.", control: { type: "toggle", key: "motion" } },
					{ name: "Aurora", desc: "Slow-drifting colour behind the top of each page.", control: { type: "toggle", key: "aurora" } },
					{ name: "Paper grain", control: { type: "toggle", key: "grain" } },
					{ name: "Gliding caret", desc: "The caret slides between positions instead of jumping.", control: { type: "toggle", key: "glide" } },
					{ name: "Petals while typing", desc: "Tiny hearts and petals drift up from the caret.", control: { type: "toggle", key: "petals" } },
					{ name: "Follow system reduce motion", desc: "When on, everything goes still whenever reduce motion is enabled in your operating system.", aliases: ["accessibility"], control: { type: "toggle", key: "followSystemMotion" } },
				],
			},
			{
				type: "group",
				heading: "Reading mode",
				items: [
					{ name: "Page", desc: "Paper is a cream page, Night a dark one. Auto follows the app theme. You can also switch from the status bar while reading.", control: { type: "dropdown", key: "readingPage", options: { auto: "Auto", paper: "Paper", night: "Night" } } },
				],
			},
			{
				type: "group",
				heading: "Typewriter",
				items: [
					{ name: "Typewriter scrolling", desc: "Keeps the line you are writing at a fixed height, gliding the page as you go.", control: { type: "toggle", key: "typewriter" } },
					{ name: "Typing position", desc: "How far down the editor the line you are writing sits.", control: { type: "slider", key: "typewriterOffset", min: 0.2, max: 0.8, step: 0.05, displayFormat: (v) => `${Math.round(v * 100)}%` } },
				],
			},
			{
				type: "group",
				heading: "Writing goal",
				items: [
					{ name: "Milestones", desc: "A word bloom every few words, and a celebration at your daily goal.", control: { type: "toggle", key: "milestones" } },
					{ name: "Count words from anywhere", desc: "Count every new word that lands in your notes: typed, pasted, or written by another plugin such as Copilot. Turn off to count only what you type in the editor.", control: { type: "toggle", key: "countAllWords" } },
					{ name: "Daily goal", desc: "New words per day.", control: { type: "number", key: "goal", min: 1, step: 1 } },
					{ name: "Bloom every", desc: "Words between milestone blooms.", control: { type: "number", key: "every", min: 1, step: 1 } },
				],
			},
		];
	}
}
