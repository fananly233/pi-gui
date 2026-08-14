import assert from "node:assert/strict";
import test from "node:test";
import { EventNormalizer } from "../src/pi/event-normalizer.ts";

test("assembles delta-only text and reconciles with authoritative message_end", () => {
	const normalizer = new EventNormalizer();
	const events = [
		{ type: "message_start", message: { role: "assistant", content: [] } },
		{ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "reason" } },
		{ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Hello" } },
		{ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: " world" } },
		{
			type: "message_end",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "reasoning complete" },
					{ type: "text", text: "Hello world!" },
				],
				stopReason: "stop",
			},
		},
	].flatMap((event) => normalizer.normalize(event));

	assert.deepEqual(events.map((event) => event.type), [
		"assistant_started",
		"assistant_thinking_delta",
		"assistant_text_delta",
		"assistant_text_delta",
		"assistant_reconciled",
	]);
	assert.deepEqual(events.at(-1), {
		type: "assistant_reconciled",
		messageId: "assistant-1",
		text: "Hello world!",
		thinking: "reasoning complete",
		status: "complete",
	});
});

test("creates an assistant message when a provider emits no streaming start", () => {
	const normalizer = new EventNormalizer();
	const events = normalizer.normalize({
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Stopped" }],
			stopReason: "aborted",
			errorMessage: "Request aborted",
		},
	});

	assert.equal(events[0].type, "assistant_started");
	assert.deepEqual(events[1], {
		type: "assistant_reconciled",
		messageId: "assistant-1",
		text: "Stopped",
		thinking: "",
		status: "aborted",
	});
});

test("normalizes accumulated tool progress and final results", () => {
	const normalizer = new EventNormalizer();
	const events = [
		{ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "echo ok" } },
		{
			type: "tool_execution_update",
			toolCallId: "call-1",
			partialResult: { content: [] },
		},
		{
			type: "tool_execution_update",
			toolCallId: "call-1",
			partialResult: { content: [{ type: "text", text: "partial" }] },
		},
		{
			type: "tool_execution_end",
			toolCallId: "call-1",
			result: { content: [{ type: "text", text: "partial\ncomplete" }] },
			isError: false,
		},
	].flatMap((event) => normalizer.normalize(event));

	assert.deepEqual(events, [
		{ type: "tool_started", toolCallId: "call-1", name: "bash", args: { command: "echo ok" } },
		{ type: "tool_updated", toolCallId: "call-1", output: "" },
		{ type: "tool_updated", toolCallId: "call-1", output: "partial" },
		{ type: "tool_finished", toolCallId: "call-1", output: "partial\ncomplete", isError: false },
	]);
});

test("waits for agent_settled instead of treating agent_end as ready", () => {
	const normalizer = new EventNormalizer();
	assert.deepEqual(normalizer.normalize({ type: "agent_end", willRetry: false }), []);
	assert.deepEqual(normalizer.normalize({ type: "agent_settled" }), [{ type: "run_settled" }]);
	assert.deepEqual(normalizer.normalize({ type: "queue_update", steering: ["one"], followUp: ["two"] }), [
		{ type: "queue_updated", steering: ["one"], followUp: ["two"] },
	]);
});
