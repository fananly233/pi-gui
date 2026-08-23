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
