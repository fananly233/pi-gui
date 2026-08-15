import assert from "node:assert/strict";
import test from "node:test";
import {
	applyFileMention,
	extractFileMentionQuery,
	filterFileMentions,
	formatFileMention,
} from "../src/files/file-mentions.ts";

test("extracts unquoted and quoted file queries at the caret", () => {
	assert.deepEqual(extractFileMentionQuery("check @src/ma"), {
		start: 6,
		query: "src/ma",
		quoted: false,
	});
	assert.deepEqual(extractFileMentionQuery('check @"my dir/fi'), {
		start: 6,
		query: "my dir/fi",
		quoted: true,
	});
	assert.equal(extractFileMentionQuery("email@example.com"), null);
});

test("formats and applies workspace-relative file mentions", () => {
	assert.equal(formatFileMention("src/main.ts"), "@src/main.ts");
	assert.equal(formatFileMention("my dir/notes.md"), '@"my dir/notes.md"');
	const query = extractFileMentionQuery("open @src/ma");
	assert.ok(query);
	assert.deepEqual(applyFileMention("open @src/ma now", 12, query, "src/main.ts"), {
		text: "open @src/main.ts now",
		caret: 18,
	});
});

test("ranks basename prefixes before broader path matches", () => {
	assert.deepEqual(
		filterFileMentions(["docs/main-guide.md", "src/main.ts", "src/domain.ts", "main.css"], "main"),
		["main.css", "src/main.ts", "docs/main-guide.md", "src/domain.ts"],
	);
});
