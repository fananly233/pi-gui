export type ChatDelivery = "prompt" | "steer" | "followUp";
export type ChatActivity = "idle" | "running" | "retrying";

export type ChatImageAttachment = Readonly<{
	name: string;
	mimeType: string;
	data: string;
	previewUrl: string;
	size: number;
}>;

export type ChatImageSummary = Readonly<{
	name: string;
	mimeType: string;
}>;

export type UserChatMessage = {
	id: string;
	role: "user";
	text: string;
	delivery: ChatDelivery;
	status: "accepted" | "failed";
	images?: ChatImageSummary[];
};

export type AssistantChatMessage = {
	id: string;
	role: "assistant";
	text: string;
	thinking: string;
	status: "streaming" | "complete" | "aborted" | "error";
	error?: string;
};

export type ToolChatMessage = {
	id: string;
	role: "tool";
	name: string;
	args: unknown;
	output: string;
	status: "running" | "complete" | "error";
};

export type ChatMessage = UserChatMessage | AssistantChatMessage | ToolChatMessage;

export type PiConnectionState =
	| { status: "disconnected" }
	| { status: "connecting" }
	| { status: "connected"; discovery: string }
	| { status: "error"; message: string };
