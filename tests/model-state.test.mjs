import assert from "node:assert/strict";
import test from "node:test";
import {
	formatProviderName,
	groupModelsByProvider,
	normalizePiModel,
	normalizePiModels,
	normalizeThinkingLevel,
	normalizeThinkingLevels,
} from "../src/models/model-state.ts";

test("normalizes only safe model display fields", () => {
	const model = normalizePiModel({
		provider: "openai-codex",
		id: "gpt-5.4-mini",
		name: "GPT 5.4 Mini",
		reasoning: true,
		input: ["text", "image", 42],
		contextWindow: 200000,
		maxTokens: 32768,
		baseUrl: "https://secret.example.test",
		headers: { Authorization: "Bearer must-not-leak" },
		apiKey: "must-not-leak",
	});

	assert.deepEqual(model, {
		provider: "openai-codex",
		id: "gpt-5.4-mini",
		name: "GPT 5.4 Mini",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 200000,
		maxTokens: 32768,
	});
	assert.equal(Object.hasOwn(model, "headers"), false);
	assert.equal(Object.hasOwn(model, "baseUrl"), false);
	assert.equal(Object.hasOwn(model, "apiKey"), false);
});

test("drops invalid and duplicate model records", () => {
	const models = normalizePiModels([
		{ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek" },
		{ provider: "deepseek", id: "deepseek-v4-flash", name: "Duplicate" },
		{ provider: "", id: "invalid" },
		null,
	]);

	assert.equal(models.length, 1);
	assert.equal(models[0].name, "DeepSeek");
});

test("filters and groups models without changing provider identity", () => {
	const models = normalizePiModels([
		{ provider: "openai-codex", id: "gpt-5.4-mini", name: "GPT Mini" },
		{ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek Flash" },
		{ provider: "openai-codex", id: "gpt-5.4", name: "GPT Full" },
	]);
	const groups = groupModelsByProvider(models, "gpt");

	assert.equal(groups.length, 1);
	assert.equal(groups[0].provider, "openai-codex");
	assert.deepEqual(groups[0].models.map((model) => model.name), ["GPT Full", "GPT Mini"]);
	assert.equal(formatProviderName("openai-codex"), "OpenAI Codex");
});

test("keeps Pi thinking levels ordered and falls back safely", () => {
	assert.deepEqual(normalizeThinkingLevels(["high", "off", "max", "unknown"]), ["off", "high", "max"]);
	assert.deepEqual(normalizeThinkingLevels([]), ["off"]);
	assert.equal(normalizeThinkingLevel("xhigh"), "xhigh");
	assert.equal(normalizeThinkingLevel("unknown"), "off");
});
