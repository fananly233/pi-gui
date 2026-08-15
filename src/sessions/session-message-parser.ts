import type { ChatMessage } from "../chat/chat-types";
import type { JsonObject } from "../pi/event-normalizer";

function asObject(value: unknown): JsonObject | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function textFromContent(content: unknown, blockType = "text"): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map(asObject)
		.filter((block): block is JsonObject => block !== null && block.type === blockType)
		.map((block) => (typeof block.text === "string" ? block.text : blockType === "thinking" && typeof block.thinking === "string" ? block.thinking : ""))
		.filter(Boolean)
		.join("\n");
}

function assistantStatus(message: JsonObject): "complete" | "aborted" | "error" {
	if (message.stopReason === "aborted") return "aborted";
	if (message.stopReason === "error" || typeof message.errorMessage === "string") return "error";
	return "complete";
}

function imagesFromContent(content: unknown): { name: string; mimeType: string }[] {
	if (!Array.isArray(content)) return [];
	return content
		.map(asObject)
		.filter((block): block is JsonObject => block !== null && block.type === "image")
		.map((block, index) => ({
			name: `Attached image ${index + 1}`,
			mimeType: typeof block.mimeType === "string" ? block.mimeType : "image",
		}));
}

export function parseSessionMessages(messages: JsonObject[]): ChatMessage[] {
	const parsed: ChatMessage[] = [];

	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (message.role === "user") {
			const text = textFromContent(message.content);
			const images = imagesFromContent(message.content);
			if (text || images.length) parsed.push({
				id: `history-user-${index}`,
				role: "user",
				text,
				delivery: "prompt",
				status: "accepted",
				...(images.length ? { images } : {}),
			});
			continue;
		}

		if (message.role === "assistant") {
			const status = assistantStatus(message);
			const error = typeof message.errorMessage === "string" ? message.errorMessage : undefined;
			parsed.push({
				id: `history-assistant-${index}`,
				role: "assistant",
				text: textFromContent(message.content),
				thinking: textFromContent(message.content, "thinking"),
				status,
				...(error ? { error } : {}),
			});
			continue;
		}

		if (message.role === "toolResult") {
			parsed.push({
				id: `history-tool-${index}`,
				role: "tool",
				name: typeof message.toolName === "string" ? message.toolName : "tool",
				args: null,
				output: textFromContent(message.content),
				status: message.isError === true ? "error" : "complete",
			});
		}
	}

	return parsed;
}
