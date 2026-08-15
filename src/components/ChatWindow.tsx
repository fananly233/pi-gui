import { useEffect, useRef, useState } from "react";
import type { PiChatController } from "../hooks/usePiChat";
import { ChatInput } from "./ChatInput";
import { MessageView } from "./MessageView";
import { ModelsAuthPanel } from "./ModelsAuthPanel";

type ChatWindowProps = Pick<
	PiChatController,
	| "connection"
	| "activity"
	| "messages"
	| "queue"
	| "sending"
	| "aborting"
	| "configuringModel"
	| "model"
	| "thinkingLevel"
	| "lastError"
	| "send"
	| "abort"
	| "clearError"
	| "sessionReady"
	| "activeSessionName"
	| "activeSessionPath"
	| "activeRuntimePhase"
	| "selectingRuntimeKey"
	| "composerSeed"
	| "activeRuntimeKey"
	| "sessionRuntimes"
	| "loadModelConfiguration"
	| "setModel"
	| "setThinkingLevel"
	| "disconnect"
>;

function baseName(path: string | null): string | null {
	if (!path) return null;
	const parts = path.replace(/\\/g, "/").split("/");
	return parts.at(-1)?.replace(/\.jsonl$/i, "") || null;
}

export function ChatWindow(props: ChatWindowProps) {
	const bottomRef = useRef<HTMLDivElement>(null);
	const [modelsOpen, setModelsOpen] = useState(false);
	const workspaceConnected = props.connection.status === "connected";
	const connected = props.sessionReady;
	const selecting = Boolean(props.selectingRuntimeKey);
	const queuedCount = props.queue.steering.length + props.queue.followUp.length;
	const sessionLabel = props.activeSessionName || baseName(props.activeSessionPath) || "No session selected";
	const statusLabel = !workspaceConnected
		? "Offline"
		: selecting
			? "Loading session"
			: props.activeRuntimePhase === "failed"
				? "Runtime stopped"
				: !connected
					? "Select a session"
					: props.configuringModel
						? "Configuring model"
						: props.activity === "idle"
						? "Ready"
						: props.activity === "retrying"
							? "Retrying"
							: "Running";

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: props.activity === "idle" ? "smooth" : "auto", block: "end" });
	}, [props.activity, props.messages]);

	return (
		<section className="chat-panel" aria-label="Pi Core Chat">
			<header className="chat-header">
				<div>
					<p className="eyebrow eyebrow--accent">Pi Core Chat</p>
					<h2 title={props.activeSessionPath ?? undefined}>{sessionLabel}</h2>
				</div>
				<div className="chat-header__actions">
					<button type="button" className="model-trigger" data-testid="models-auth-button" onClick={() => setModelsOpen(true)}>
						<span>Model</span>
						<strong>{props.model?.name ?? "Models & auth"}</strong>
						<small>{props.model ? `${props.model.provider} · thinking ${props.thinkingLevel}` : "Provider settings"}</small>
					</button>
					<div className="chat-header__status">
						<span className={`status-dot status-dot--${connected ? (props.activity === "idle" && !props.configuringModel ? "ready" : "loading") : props.activeRuntimePhase === "failed" ? "error" : "muted"}`} />
						<span>{statusLabel}</span>
						{queuedCount > 0 ? <span className="queue-chip">{queuedCount} queued</span> : null}
					</div>
				</div>
			</header>

			<ModelsAuthPanel open={modelsOpen} onClose={() => setModelsOpen(false)} chat={props} />

			<div className="chat-timeline" data-testid="chat-timeline" aria-live="polite">
				{props.messages.length === 0 ? (
					<div className="chat-empty">
						<div className="chat-empty__mark">π</div>
						<h3>{!workspaceConnected ? "Connect a workspace to begin" : selecting ? "Loading the selected session" : props.activeRuntimePhase === "failed" ? "This Pi runtime stopped" : connected ? "Pi is ready for a real prompt" : "Select a session or create a new one"}</h3>
						<p>{!workspaceConnected ? "Sessions are only read after you explicitly connect the working directory." : selecting ? "Pi is restoring persisted messages through the native RPC bridge." : props.activeRuntimePhase === "failed" ? "Select this session again to start a fresh runtime and resume it." : connected ? "Responses, thinking deltas, tool execution and aborts stay isolated to this session runtime." : "The sidebar lists real Pi JSONL sessions for this workspace; no mock agent is involved."}</p>
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

			<ChatInput connected={connected} activity={props.activity} sending={props.sending} aborting={props.aborting} configuringModel={props.configuringModel} onSend={props.send} onAbort={props.abort} seed={props.composerSeed} />
		</section>
	);
}
