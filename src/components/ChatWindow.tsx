import { useEffect, useRef } from "react";
import type { PiChatController } from "../hooks/usePiChat";
import { ChatInput } from "./ChatInput";
import { MessageView } from "./MessageView";

type ChatWindowProps = Pick<
	PiChatController,
	"connection" | "activity" | "messages" | "queue" | "sending" | "aborting" | "lastError" | "send" | "abort" | "clearError"
>;

export function ChatWindow(props: ChatWindowProps) {
	const bottomRef = useRef<HTMLDivElement>(null);
	const connected = props.connection.status === "connected";
	const queuedCount = props.queue.steering.length + props.queue.followUp.length;

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: props.activity === "idle" ? "smooth" : "auto", block: "end" });
	}, [props.activity, props.messages]);

	return (
		<section className="chat-panel" aria-label="Pi Core Chat">
			<header className="chat-header">
				<div>
					<p className="eyebrow eyebrow--accent">Pi Core Chat</p>
					<h2>Work with Pi, directly.</h2>
				</div>
				<div className="chat-header__status">
					<span className={`status-dot status-dot--${connected ? (props.activity === "idle" ? "ready" : "loading") : "muted"}`} />
					<span>{!connected ? "Offline" : props.activity === "idle" ? "Ready" : props.activity === "retrying" ? "Retrying" : "Running"}</span>
					{queuedCount > 0 ? <span className="queue-chip">{queuedCount} queued</span> : null}
				</div>
			</header>

			<div className="chat-timeline" data-testid="chat-timeline" aria-live="polite">
				{props.messages.length === 0 ? (
					<div className="chat-empty">
						<div className="chat-empty__mark">π</div>
						<h3>{connected ? "Pi is ready for a real prompt" : "Connect a workspace to begin"}</h3>
						<p>{connected ? "Responses, thinking deltas, tool execution and aborts stream here through the native Rust bridge." : "Phase 2 uses your installed Pi CLI and configured credentials. No mock agent is involved."}</p>
					</div>
				) : (
					<div className="message-list">
						{props.messages.map((message) => <MessageView key={message.id} message={message} />)}
					</div>
				)}
				<div ref={bottomRef} />
			</div>

			{props.lastError ? (
				<div className="chat-error" role="alert">
					<span>{props.lastError}</span>
					<button type="button" onClick={props.clearError}>Dismiss</button>
				</div>
			) : null}

			<ChatInput connected={connected} activity={props.activity} sending={props.sending} aborting={props.aborting} onSend={props.send} onAbort={props.abort} />
		</section>
	);
}
