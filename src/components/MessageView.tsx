import type { ChatMessage } from "../chat/chat-types";
import { MarkdownBody } from "./MarkdownBody";

function formatArgs(args: unknown): string {
	if (typeof args === "string") return args;
	try {
		return JSON.stringify(args ?? {}, null, 2);
	} catch {
		return String(args);
	}
}

export function MessageView({ message }: { message: ChatMessage }) {
	if (message.role === "user") {
		const deliveryLabel = message.delivery === "steer" ? "Steer" : message.delivery === "followUp" ? "Follow-up" : "You";
		return (
			<article className={`message message--user${message.status === "failed" ? " message--failed" : ""}`}>
				<div className="message__meta">
					<span>{deliveryLabel}</span>
					{message.status === "failed" ? <span>Not accepted</span> : null}
				</div>
				<p>{message.text}</p>
			</article>
		);
	}

	if (message.role === "tool") {
		return (
			<article className={`tool-card tool-card--${message.status}`} data-tool-name={message.name}>
				<div className="tool-card__header">
					<span className="tool-card__icon" aria-hidden="true">⌘</span>
					<strong>{message.name}</strong>
					<span>{message.status === "running" ? "Running" : message.status === "error" ? "Failed" : "Complete"}</span>
				</div>
				<details open={message.status === "running"}>
					<summary>Tool details</summary>
					<pre>{formatArgs(message.args)}</pre>
					{message.output ? <pre className="tool-card__output">{message.output}</pre> : null}
				</details>
			</article>
		);
	}

	return (
		<article className={`message message--assistant message--${message.status}`}>
			<div className="message__meta">
				<span>Pi</span>
				<span>{message.status === "streaming" ? "Streaming" : message.status === "aborted" ? "Stopped" : message.status === "error" ? "Error" : "Complete"}</span>
			</div>
			{message.thinking ? (
				<details className="thinking-block">
					<summary>Thinking</summary>
					<p>{message.thinking}</p>
				</details>
			) : null}
			{message.text ? (
				<MarkdownBody content={message.text} />
			) : message.status === "streaming" ? (
				<div className="assistant-wait"><span className="spinner" />Waiting for Pi…</div>
			) : message.status === "aborted" ? (
				<p className="message__stopped">Request stopped.</p>
			) : null}
			{message.error ? <p className="message__error">{message.error}</p> : null}
		</article>
	);
}
