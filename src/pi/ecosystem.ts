export type PiCommandSource = "extension" | "prompt" | "skill";
export type PiResourceScope = "user" | "project" | "temporary";
export type PiResourceOrigin = "package" | "top-level";

export type PiResourceSourceInfo = Readonly<{
	path: string;
	source: string;
	scope: PiResourceScope;
	origin: PiResourceOrigin;
	baseDir?: string;
}>;

export type PiCommandInfo = Readonly<{
	name: string;
	description: string | null;
	source: PiCommandSource;
	sourceInfo: PiResourceSourceInfo;
}>;

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSourceInfo(value: unknown): PiResourceSourceInfo | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const sourceInfo = value as Record<string, unknown>;
	const path = optionalString(sourceInfo.path);
	const source = optionalString(sourceInfo.source);
	const scope = sourceInfo.scope;
	const origin = sourceInfo.origin;
	if (!path || !source || (scope !== "user" && scope !== "project" && scope !== "temporary")) return null;
	if (origin !== "package" && origin !== "top-level") return null;
	const baseDir = optionalString(sourceInfo.baseDir);
	return { path, source, scope, origin, ...(baseDir ? { baseDir } : {}) };
}

export function normalizePiCommands(value: unknown): PiCommandInfo[] {
	if (!Array.isArray(value)) return [];
	const commands: PiCommandInfo[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const raw = entry as Record<string, unknown>;
		const name = optionalString(raw.name);
		const source = raw.source;
		const sourceInfo = normalizeSourceInfo(raw.sourceInfo);
		if (!name || (source !== "extension" && source !== "prompt" && source !== "skill") || !sourceInfo) continue;
		const key = `${source}\u0000${name}\u0000${sourceInfo.path}`;
		if (seen.has(key)) continue;
		seen.add(key);
		commands.push({
			name,
			description: optionalString(raw.description),
			source,
			sourceInfo,
		});
	}
	return commands.sort((left, right) =>
		left.source.localeCompare(right.source) || left.name.localeCompare(right.name),
	);
}
