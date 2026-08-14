import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatActivity, ChatDelivery, ChatMessage, PiConnectionState } from "../chat/chat-types";
import { EventNormalizer, type NormalizedPiEvent } from "../pi/event-normalizer";
import { piAdapter } from "../pi/pi-adapter";

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "Pi returned an unknown error.";
}

function replaceMessage(messages: ChatMessage[], id: string, update: (message: ChatMessage) => ChatMessage): ChatMessage[] {
	const index = messages.findIndex((message) => message.id === id);
	if (index === -1) return messages;
	const next = [...messages];
	next[index] = update(next[index]);
	return next;
}

export function usePiChat() {
	const normalizer = useRef(new EventNormalizer());
	const userSequence = useRef(0);
	const intentionalStop = useRef(false);
	const [connection, setConnection] = useState<PiConnectionState>({ status: "disconnected" });
	const [activity, setActivity] = useState<ChatActivity>("idle");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [queue, setQueue] = useState({ steering: [] as string[], followUp: [] as string[] });
	const [sending, setSending] = useState(false);
	const [aborting, setAborting] = useState(false);
	const [lastError, setLastError] = useState<string | null>(null);

	const applyNormalizedEvent = useCallback((event: NormalizedPiEvent) => {
		switch (event.type) {
			case "run_started":
				setActivity("running");
				setLastError(null);
				return;
			case "run_settled":
				setActivity("idle");
				setAborting(false);
				setMessages((current) =>
					current.map((message) =>
						message.role === "assistant" && message.status === "streaming" ? { ...message, status: "complete" } : message,
					),
				);
				return;
			case "retry_started":
				setActivity("retrying");
				setLastError(event.message);
				return;
			case "assistant_started":
				setMessages((current) => {
					if (current.some((message) => message.id === event.messageId)) return current;
					return [...current, { id: event.messageId, role: "assistant", text: "", thinking: "", status: "streaming" }];
				});
				return;
			case "assistant_text_delta":
				setMessages((current) =>
					replaceMessage(current, event.messageId, (message) =>
						message.role === "assistant" ? { ...message, text: message.text + event.delta } : message,
					),
				);
				return;
			case "assistant_thinking_delta":
				setMessages((current) =>
					replaceMessage(current, event.messageId, (message) =>
						message.role === "assistant" ? { ...message, thinking: message.thinking + event.delta } : message,
					),
				);
				return;
			case "assistant_reconciled":
				setMessages((current) => {
					if (!event.text && !event.thinking && event.status === "complete") {
						return current.filter((message) => message.id !== event.messageId);
					}
					return replaceMessage(current, event.messageId, (message) =>
						message.role === "assistant"
							? {
									...message,
									text: event.text,
									thinking: event.thinking,
									status: event.status,
									...(event.error ? { error: event.error } : {}),
							  }
							: message,
					);
				});
				if (event.error) setLastError(event.error);
				return;
			case "tool_started":
				setMessages((current) => {
					const existing = current.find((message) => message.id === event.toolCallId);
					if (existing) {
						return replaceMessage(current, event.toolCallId, () => ({
							id: event.toolCallId,
							role: "tool",
							name: event.name,
							args: event.args,
							output: "",
							status: "running",
						}));
					}
					return [
						...current,
						{ id: event.toolCallId, role: "tool", name: event.name, args: event.args, output: "", status: "running" },
					];
				});
				return;
			case "tool_updated":
				setMessages((current) =>
					replaceMessage(current, event.toolCallId, (message) =>
						message.role === "tool" ? { ...message, output: event.output } : message,
					),
				);
				return;
			case "tool_finished":
				setMessages((current) =>
					replaceMessage(current, event.toolCallId, (message) =>
						message.role === "tool"
							? { ...message, output: event.output || message.output, status: event.isError ? "error" : "complete" }
							: message,
					),
				);
				return;
			case "queue_updated":
				setQueue({ steering: event.steering, followUp: event.followUp });
				return;
			case "extension_error":
				setLastError(event.message);
		}
	}, []);

	useEffect(() => {
		return piAdapter.onEvent((adapterEvent) => {
			if (adapterEvent.type === "rpc_event") {
				for (const event of normalizer.current.normalize(adapterEvent.event)) applyNormalizedEvent(event);
				return;
			}
			if (adapterEvent.type === "rpc_protocol_error") {
				setLastError(`Pi emitted invalid JSONL: ${adapterEvent.line.slice(0, 160)}`);
				return;
			}
			if (adapterEvent.type === "rpc_disconnected" && !intentionalStop.current) {
				setConnection({ status: "error", message: adapterEvent.reason });
				setActivity("idle");
				setAborting(false);
			}
		});
	}, [applyNormalizedEvent]);

	const connect = useCallback(async (cwd: string) => {
		const workspace = cwd.trim();
		if (!workspace) {
			setConnection({ status: "error", message: "Choose a working directory before connecting Pi." });
			return;
		}

		intentionalStop.current = false;
		setConnection({ status: "connecting" });
		setLastError(null);
		setMessages([]);
		setQueue({ steering: [], followUp: [] });
		setActivity("idle");
		normalizer.current.reset();

		try {
			if (piAdapter.isConnected) await piAdapter.stop();
			const result = await piAdapter.start({ cwd: workspace });
			setConnection({ status: "connected", discovery: result.discovery });
		} catch (error) {
			setConnection({ status: "error", message: describeError(error) });
		}
	}, []);

	const disconnect = useCallback(async () => {
		intentionalStop.current = true;
		setLastError(null);
		try {
			if (piAdapter.isConnected) await piAdapter.stop();
		} catch (error) {
			setLastError(describeError(error));
		} finally {
			setConnection({ status: "disconnected" });
			setActivity("idle");
			setAborting(false);
			setQueue({ steering: [], followUp: [] });
		}
	}, []);

	const send = useCallback(
		async (text: string, requestedDelivery: ChatDelivery) => {
			const message = text.trim();
			if (!message || connection.status !== "connected") return;
			const delivery: ChatDelivery = activity === "idle" ? "prompt" : requestedDelivery === "prompt" ? "steer" : requestedDelivery;
			const id = `user-${++userSequence.current}`;
			setMessages((current) => [...current, { id, role: "user", text: message, delivery, status: "accepted" }]);
			setLastError(null);
			setSending(true);
			if (delivery === "prompt") setActivity("running");

			try {
				if (delivery === "steer") await piAdapter.steer(message);
				else if (delivery === "followUp") await piAdapter.followUp(message);
				else await piAdapter.prompt(message);
			} catch (error) {
				setMessages((current) =>
					replaceMessage(current, id, (entry) => (entry.role === "user" ? { ...entry, status: "failed" } : entry)),
				);
				setLastError(describeError(error));
				if (delivery === "prompt") setActivity("idle");
			} finally {
				setSending(false);
			}
		},
		[activity, connection.status],
	);

	const abort = useCallback(async () => {
		if (connection.status !== "connected" || activity === "idle") return;
		setAborting(true);
		setLastError(null);
		try {
			await piAdapter.abort();
		} catch (error) {
			setAborting(false);
			setLastError(describeError(error));
		}
	}, [activity, connection.status]);

	return {
		connection,
		activity,
		messages,
		queue,
		sending,
		aborting,
		lastError,
		connect,
		disconnect,
		send,
		abort,
		clearError: () => setLastError(null),
	};
}

export type PiChatController = ReturnType<typeof usePiChat>;
