import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const confirmationCallers = [
	"src/components/AppShell.tsx",
	"src/components/EcosystemPanel.tsx",
	"src/components/FilesPanel.tsx",
	"src/components/FileViewer.tsx",
	"src/components/GitPanel.tsx",
];

test("native mutations never depend on WebView window.confirm", async () => {
	for (const path of confirmationCallers) {
		const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
		assert.doesNotMatch(source, /window\.confirm\s*\(/, path);
		assert.match(source, /desktopApi\.confirmAction\s*\(/, path);
	}

	const api = await readFile(new URL("../src/api/desktop-api.ts", import.meta.url), "utf8");
	assert.match(api, /confirm\s+as\s+confirmDialog/);
	assert.match(api, /return\s+await\s+confirmDialog\s*\(/);
	assert.match(api, /catch\s*\([^)]*\)[\s\S]*return\s+false/);
});

test("package and worktree mutations hold an immediate lock while awaiting confirmation", async () => {
	const ecosystem = await readFile(new URL("../src/components/EcosystemPanel.tsx", import.meta.url), "utf8");
	assert.match(ecosystem, /if \(mutationLock\.current\) return false;\s*mutationLock\.current = true;/);
	assert.equal((ecosystem.match(/finishMutation\(\s*async \(\) => \{\s*if \(!await desktopApi\.confirmAction/g) ?? []).length, 3);

	const git = await readFile(new URL("../src/components/GitPanel.tsx", import.meta.url), "utf8");
	assert.match(git, /if \(mutationLock\.current\) return;\s*mutationLock\.current = true;/);
	assert.match(git, /runMutation\(async \(\) => \{\s*if \(!await desktopApi\.confirmAction/);
});
