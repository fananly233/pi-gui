import assert from "node:assert/strict";
import test from "node:test";
import { normalizePiCommands } from "../src/pi/ecosystem.ts";

test("normalizes Pi 0.84 sourceInfo and excludes unrelated fields", () => {
	const commands = normalizePiCommands([
		{
			name: "skill:review",
			description: "Review this change",
			source: "skill",
			sourceInfo: {
				path: "C:/Users/test/.pi/agent/skills/review/SKILL.md",
				source: "npm:review-tools",
				scope: "user",
				origin: "package",
				baseDir: "C:/Users/test/.pi/agent/npm/review-tools",
				apiKey: "must-not-leak",
			},
			secret: "must-not-leak",
		},
	]);

	assert.deepEqual(commands, [{
		name: "skill:review",
		description: "Review this change",
		source: "skill",
		sourceInfo: {
			path: "C:/Users/test/.pi/agent/skills/review/SKILL.md",
			source: "npm:review-tools",
			scope: "user",
			origin: "package",
			baseDir: "C:/Users/test/.pi/agent/npm/review-tools",
		},
	}]);
	assert.equal(JSON.stringify(commands).includes("must-not-leak"), false);
});

test("drops malformed commands and deduplicates stable identities", () => {
	const valid = {
		name: "fix-tests",
		source: "prompt",
		sourceInfo: {
			path: "C:/work/.pi/prompts/fix-tests.md",
			source: "C:/work/.pi/prompts/fix-tests.md",
			scope: "project",
			origin: "top-level",
		},
	};
	const commands = normalizePiCommands([
		valid,
		valid,
		{ ...valid, name: "" },
		{ ...valid, source: "builtin" },
		{ ...valid, sourceInfo: { ...valid.sourceInfo, scope: "root" } },
	]);

	assert.equal(commands.length, 1);
	assert.equal(commands[0].name, "fix-tests");
});
