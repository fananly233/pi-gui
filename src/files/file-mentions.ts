export type FileMentionQuery = Readonly<{
	start: number;
	query: string;
	quoted: boolean;
}>;

export function extractFileMentionQuery(textBeforeCaret: string): FileMentionQuery | null {
	const match = /(?:^|\s)@("?)([^\n\r"]*)$/.exec(textBeforeCaret);
	if (!match) return null;
	const tokenOffset = match[0].lastIndexOf("@");
	const query = match[2] ?? "";
	if (!(match[1] ?? "") && /\s/.test(query)) return null;
	return {
		start: match.index + tokenOffset,
		query,
		quoted: match[1] === '"',
	};
}

export function formatFileMention(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	return /\s/.test(normalized)
		? `@"${normalized.replace(/"/g, '\\"')}"`
		: `@${normalized}`;
}

export function applyFileMention(
	text: string,
	caret: number,
	query: FileMentionQuery,
	path: string,
): { text: string; caret: number } {
	const insertion = `${formatFileMention(path)} `;
	const suffix = text.slice(caret).replace(/^[ \t]/, "");
	const next = `${text.slice(0, query.start)}${insertion}${suffix}`;
	return { text: next, caret: query.start + insertion.length };
}

function matchRank(path: string, query: string): number {
	const normalizedPath = path.toLowerCase();
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return 3;
	const name = normalizedPath.split("/").at(-1) ?? normalizedPath;
	if (name.startsWith(normalizedQuery)) return 0;
	if (normalizedPath.startsWith(normalizedQuery)) return 1;
	if (name.includes(normalizedQuery)) return 2;
	return normalizedPath.includes(normalizedQuery) ? 3 : Number.POSITIVE_INFINITY;
}

export function filterFileMentions(files: readonly string[], query: string, limit = 30): string[] {
	return files
		.map((path) => ({ path, rank: matchRank(path, query) }))
		.filter((entry) => Number.isFinite(entry.rank))
		.sort((left, right) => left.rank - right.rank || left.path.length - right.path.length || left.path.localeCompare(right.path))
		.slice(0, limit)
		.map((entry) => entry.path);
}
