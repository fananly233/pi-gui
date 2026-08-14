export type JsonObject = Record<string, unknown>;

export type AssistantCompletionStatus = "complete" | "aborted" | "error";

export type NormalizedPiEvent =
	| { type: "run_started" }
	| { type: "run_settled" }
	| { type: "retry_started"; message: string }
	| { type: "assistant_started"; messageId: string }
	| { type: "assistant_text_delta"; messageId: string; delta: string }
	| { type: "assistant_thinking_delta"; messageId: string; delta: string }
	| {
			type: "assistant_reconciled";
			messageId: string;
			text: string;
			thinking: string;
			status: AssistantCompletionStatus;
			error?: string;
	  }
	| { type: "tool_started"; toolCallId: string; name: string; args: unknown }
	| { type: "tool_updated"; toolCallId: string; output: string }
	| { type: "tool_finished"; toolCallId: string; output: string; isError: boolean }
	| { type: "queue_updated"; steering: string[]; followUp: string[] }
	| { type: "extension_error"; message: string };

function asObject(value: unknown): JsonObject | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatResult(value: unknown): string {
	const result = asObject(value);
	if (!result) return typeof value === "string" ? value : "";

	const content = result.content;
	if (Array.isArray(content)) {
		const text = content
			.map((item) => asObject(item))
			.filter((item): item is JsonObject => item !== null)
			.filter((item) => item.type === "text")
			.map((item) => asString(item.text))
			.filter(Boolean)
			.join("\n");
		return text;
	}

	if (typeof result.text === "string") return result.text;
	try {
		return JSON.stringify(result, null, 2);
	} catch {
		return "";
	}
}

function readAssistantMessage(value: unknown): {
	text: string;
	thinking: string;
	status: AssistantCompletionStatus;
	error?: string;
} | null {
	const message = asObject(value);
	if (!message || message.role !== "assistant") return null;

	let text = "";
	let thinking = "";
	if (Array.isArray(message.content)) {
		for (const rawBlock of message.content) {
			const block = asObject(rawBlock);
			if (!block) continue;
			if (block.type === "text") text += asString(block.text);
			if (block.type === "thinking") thinking += asString(block.thinking);
		}
	}

	const stopReason = asString(message.stopReason);
	const error = asString(message.errorMessage);
	const status: AssistantCompletionStatus = stopReason === "aborted" ? "aborted" : stopReason === "error" || error ? "error" : "complete";

	return { text, thinking, status, ...(error && status === "error" ? { error } : {}) };
}

/**
 * Converts Pi 0.84.x RPC events into stable renderer events.
 * message_update is delta-only; message_end is always treated as authoritative.
 */
export class EventNormalizer {
	private assistantSequence = 0;
	private activeAssistantId: string | null = null;

	reset(): void {
		this.assistantSequence = 0;
		this.activeAssistantId = null;
	}

	normalize(raw: JsonObject): NormalizedPiEvent[] {
		const type = asString(raw.type);

		switch (type) {
			case "agent_start":
				return [{ type: "run_started" }];
			case "agent_settled":
				return [{ type: "run_settled" }];
			case "message_start":
				return this.normalizeMessageStart(raw.message);
			case "message_update":
				return this.normalizeMessageUpdate(raw.assistantMessageEvent);
			case "message_end":
				return this.normalizeMessageEnd(raw.message);
			case "tool_execution_start":
				return this.normalizeToolStart(raw);
			case "tool_execution_update":
				return this.normalizeToolUpdate(raw);
			case "tool_execution_end":
				return this.normalizeToolEnd(raw);
			case "queue_update":
				return [{ type: "queue_updated", steering: stringArray(raw.steering), followUp: stringArray(raw.followUp) }];
			case "auto_retry_start":
				return [{ type: "retry_started", message: asString(raw.errorMessage) || "Pi is retrying the model request." }];
			case "extension_error":
				return [{ type: "extension_error", message: asString(raw.errorMessage) || asString(raw.error) || "A Pi extension failed." }];
			default:
				return [];
		}
	}

	private nextAssistantId(): string {
		this.assistantSequence += 1;
		return `assistant-${this.assistantSequence}`;
	}

	private ensureAssistantId(): { id: string; created: boolean } {
		if (this.activeAssistantId) return { id: this.activeAssistantId, created: false };
		this.activeAssistantId = this.nextAssistantId();
		return { id: this.activeAssistantId, created: true };
	}

	private normalizeMessageStart(value: unknown): NormalizedPiEvent[] {
		const message = asObject(value);
		if (!message || message.role !== "assistant") return [];
		this.activeAssistantId = this.nextAssistantId();
		return [{ type: "assistant_started", messageId: this.activeAssistantId }];
	}

	private normalizeMessageUpdate(value: unknown): NormalizedPiEvent[] {
		const update = asObject(value);
		if (!update) return [];
		const updateType = asString(update.type);
		if (updateType !== "text_delta" && updateType !== "thinking_delta") return [];

		const delta = asString(update.delta);
		if (!delta) return [];
		const assistant = this.ensureAssistantId();
		const events: NormalizedPiEvent[] = assistant.created ? [{ type: "assistant_started", messageId: assistant.id }] : [];
		events.push(
			updateType === "text_delta"
				? { type: "assistant_text_delta", messageId: assistant.id, delta }
				: { type: "assistant_thinking_delta", messageId: assistant.id, delta },
		);
		return events;
	}

	private normalizeMessageEnd(value: unknown): NormalizedPiEvent[] {
		const message = readAssistantMessage(value);
		if (!message) return [];
		const assistant = this.ensureAssistantId();
		this.activeAssistantId = null;
		const events: NormalizedPiEvent[] = assistant.created ? [{ type: "assistant_started", messageId: assistant.id }] : [];
		events.push({
			type: "assistant_reconciled",
			messageId: assistant.id,
			text: message.text,
			thinking: message.thinking,
			status: message.status,
			...(message.error ? { error: message.error } : {}),
		});
		return events;
	}

	private normalizeToolStart(raw: JsonObject): NormalizedPiEvent[] {
		const toolCallId = asString(raw.toolCallId);
		if (!toolCallId) return [];
		return [{ type: "tool_started", toolCallId, name: asString(raw.toolName) || "tool", args: raw.args }];
	}

	private normalizeToolUpdate(raw: JsonObject): NormalizedPiEvent[] {
		const toolCallId = asString(raw.toolCallId);
		if (!toolCallId) return [];
		return [{ type: "tool_updated", toolCallId, output: formatResult(raw.partialResult) }];
	}

	private normalizeToolEnd(raw: JsonObject): NormalizedPiEvent[] {
		const toolCallId = asString(raw.toolCallId);
		if (!toolCallId) return [];
		return [{ type: "tool_finished", toolCallId, output: formatResult(raw.result), isError: raw.isError === true }];
	}
}
