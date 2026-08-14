export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export type PiModelInfo = Readonly<{
	provider: string;
	id: string;
	name: string;
	reasoning: boolean;
	input: ReadonlyArray<string>;
	contextWindow: number | null;
	maxTokens: number | null;
}>;

export type PiModelConfiguration = Readonly<{
	models: PiModelInfo[];
	currentModel: PiModelInfo | null;
	thinkingLevel: PiThinkingLevel;
	thinkingLevels: PiThinkingLevel[];
}>;

export type PiModelProviderGroup = Readonly<{
	provider: string;
	label: string;
	models: PiModelInfo[];
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizePiModel(value: unknown): PiModelInfo | null {
	const model = asRecord(value);
	if (!model) return null;
	const provider = typeof model.provider === "string" ? model.provider.trim() : "";
	const id = typeof model.id === "string" ? model.id.trim() : "";
	if (!provider || !id) return null;
	const name = typeof model.name === "string" && model.name.trim() ? model.name.trim() : id;
	const input = Array.isArray(model.input)
		? model.input.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
		: [];

	// Keep the renderer contract deliberately narrow. Full Pi model objects may
	// contain provider headers and endpoint configuration that the UI must not retain.
	return {
		provider,
		id,
		name,
		reasoning: model.reasoning === true,
		input,
		contextWindow: finiteNumber(model.contextWindow),
		maxTokens: finiteNumber(model.maxTokens),
	};
}

export function normalizePiModels(value: unknown): PiModelInfo[] {
	if (!Array.isArray(value)) return [];
	const models: PiModelInfo[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		const model = normalizePiModel(entry);
		if (!model) continue;
		const key = `${model.provider}\u0000${model.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		models.push(model);
	}
	return models;
}

export function normalizeThinkingLevel(value: unknown): PiThinkingLevel {
	return typeof value === "string" && (PI_THINKING_LEVELS as readonly string[]).includes(value)
		? value as PiThinkingLevel
		: "off";
}

export function normalizeThinkingLevels(value: unknown): PiThinkingLevel[] {
	if (!Array.isArray(value)) return ["off"];
	const levels = PI_THINKING_LEVELS.filter((level) => value.includes(level));
	return levels.length > 0 ? [...levels] : ["off"];
}

export function formatProviderName(provider: string): string {
	const knownNames: Record<string, string> = {
		ai: "AI",
		api: "API",
		cli: "CLI",
		github: "GitHub",
		gpt: "GPT",
		oauth: "OAuth",
		openai: "OpenAI",
		xai: "xAI",
		zai: "ZAI",
	};
	return provider
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => knownNames[part.toLocaleLowerCase()] ?? `${part[0].toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

export function groupModelsByProvider(models: readonly PiModelInfo[], query = ""): PiModelProviderGroup[] {
	const needle = query.trim().toLocaleLowerCase();
	const filtered = needle
		? models.filter((model) => `${model.provider} ${model.id} ${model.name}`.toLocaleLowerCase().includes(needle))
		: models;
	const grouped = new Map<string, PiModelInfo[]>();
	for (const model of filtered) {
		const entries = grouped.get(model.provider) ?? [];
		entries.push(model);
		grouped.set(model.provider, entries);
	}

	return [...grouped.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([provider, entries]) => ({
			provider,
			label: formatProviderName(provider),
			models: entries.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
		}));
}
