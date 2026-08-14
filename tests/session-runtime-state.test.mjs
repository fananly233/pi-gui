import assert from "node:assert/strict";
import test from "node:test";
import {
	SessionSelectionGuard,
	isSessionRuntimeTransitioning,
	normalizeFsPath,
	sessionBelongsToWorkspace,
	sessionInstanceId,
	updateRuntimeSnapshot,
} from "../src/sessions/session-runtime-state.ts";
import { parseSessionMessages } from "../src/sessions/session-message-parser.ts";

function snapshot(key, message) {
	return {
		key,
		cwd: "C:/work",
		sessionPath: `${key}.jsonl`,
		sessionId: key,
		sessionName: null,
		discovery: "test",
		phase: "ready",
		activity: "idle",
		messages: message ? [message] : [],
		queue: { steering: [], followUp: [] },
		sending: false,
		aborting: false,
		lastError: null,
	};
}

test("rapid selection only commits the newest completed request", () => {
	const guard = new SessionSelectionGuard();
	const first = guard.begin("session-a");
	const second = guard.begin("session-b");

	assert.equal(guard.commit(first), false);
	assert.equal(guard.activeKey, null);
	assert.equal(guard.commit(second), true);
	assert.equal(guard.activeKey, "session-b");

	const restart = guard.begin("session-a");
	guard.invalidate();
	assert.equal(guard.commit(restart), false);
	assert.equal(guard.activeKey, null);
});

test("runtime updates stay isolated to their owning session", () => {
	const messageA = { id: "a", role: "user", text: "A", delivery: "prompt", status: "accepted" };
	const messageB = { id: "b", role: "user", text: "B", delivery: "prompt", status: "accepted" };
	const runtimeA = snapshot("a", messageA);
	const runtimeB = snapshot("b", messageB);
	const runtimes = new Map([["a", runtimeA], ["b", runtimeB]]);

	const next = updateRuntimeSnapshot(runtimes, "a", (current) => ({ ...current, lastError: "A only" }));
	assert.equal(next.get("a").lastError, "A only");
	assert.strictEqual(next.get("b"), runtimeB);
	assert.deepEqual(next.get("b").messages, [messageB]);
});

test("treats starting and switching runtimes as unsafe for file mutation", () => {
	assert.equal(isSessionRuntimeTransitioning("starting"), true);
	assert.equal(isSessionRuntimeTransitioning("switching"), true);
	assert.equal(isSessionRuntimeTransitioning("ready"), false);
	assert.equal(isSessionRuntimeTransitioning("failed"), false);
});

test("normalizes Windows workspace paths and creates stable instance ids", () => {
	assert.equal(normalizeFsPath("C:\\Work\\Pi-GUI\\"), "c:/work/pi-gui");
	assert.equal(sessionBelongsToWorkspace("c:/WORK/pi-gui", "C:\\Work\\Pi-GUI\\"), true);
	assert.equal(sessionBelongsToWorkspace("C:/Work/other", "C:/Work/Pi-GUI"), false);
	assert.equal(sessionInstanceId("session:C:/one"), sessionInstanceId("session:C:/one"));
	assert.notEqual(sessionInstanceId("session:C:/one"), sessionInstanceId("session:C:/two"));
});

test("hydrates persisted user, assistant thinking, and tool-result messages", () => {
	const messages = parseSessionMessages([
		{ role: "user", content: [{ type: "text", text: "hello" }] },
		{
			role: "assistant",
			content: [{ type: "thinking", thinking: "reason" }, { type: "text", text: "answer" }],
			stopReason: "stop",
		},
		{ role: "toolResult", toolName: "bash", content: [{ type: "text", text: "ok" }], isError: false },
	]);

	assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "tool"]);
	assert.equal(messages[1].thinking, "reason");
	assert.equal(messages[1].text, "answer");
	assert.equal(messages[2].output, "ok");
});
