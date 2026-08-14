import { useEffect, useState, type KeyboardEvent } from "react";
import type { ChatActivity, ChatDelivery } from "../chat/chat-types";

type ChatInputProps = {
	connected: boolean;
	activity: ChatActivity;
	sending: boolean;
	aborting: boolean;
	onSend: (text: string, delivery: ChatDelivery) => Promise<void>;
	onAbort: () => Promise<void>;
	seed: { id: number; text: string } | null;
};

export function ChatInput({ connected, activity, sending, aborting, onSend, onAbort, seed }: ChatInputProps) {
	const [text, setText] = useState("");
	const [queuedDelivery, setQueuedDelivery] = useState<Exclude<ChatDelivery, "prompt">>("steer");
	const running = activity !== "idle";
	const delivery: ChatDelivery = running ? queuedDelivery : "prompt";
	const canSend = connected && text.trim().length > 0 && !sending;

	useEffect(() => {
		if (seed) setText(seed.text);
	}, [seed]);

	const submit = () => {
		if (!canSend) return;
		const next = text;
		setText("");
		void onSend(next, delivery);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
		event.preventDefault();
		submit();
	};

	return (
		<div className="composer">
			{running ? (
				<div className="composer__modes" aria-label="Queue behavior">
					<button type="button" className={queuedDelivery === "steer" ? "is-active" : ""} onClick={() => setQueuedDelivery("steer")}>Steer next turn</button>
					<button type="button" className={queuedDelivery === "followUp" ? "is-active" : ""} onClick={() => setQueuedDelivery("followUp")}>Follow up after finish</button>
				</div>
			) : null}
			<div className="composer__box">
				<textarea
					data-testid="chat-input"
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={connected ? (running ? "Add direction while Pi is working…" : "Ask Pi about this workspace…") : "Connect Pi to start chatting…"}
					disabled={!connected}
					rows={3}
				/>
				<div className="composer__actions">
					<span>Enter to send · Shift+Enter for newline</span>
					<div>
						{running ? (
							<button type="button" className="button button--danger" onClick={() => void onAbort()} disabled={aborting} data-testid="abort-button">
								{aborting ? "Stopping…" : "Stop"}
							</button>
						) : null}
						<button type="button" className="button button--primary" onClick={submit} disabled={!canSend} data-testid="send-button">
							{sending ? "Sending…" : running ? (delivery === "steer" ? "Queue steer" : "Queue follow-up") : "Send"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
