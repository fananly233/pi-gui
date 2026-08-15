import { useState } from "react";
import type { DesktopRuntimeInfo } from "../api/desktop-api";
import type { PiChatController } from "../hooks/usePiChat";
import { applyTheme, readStoredTheme, storeTheme, type Theme } from "../theme";
import { ChatWindow } from "./ChatWindow";
import { SessionSidebar } from "./SessionSidebar";
import { TitleBar } from "./TitleBar";

export type RuntimeState =
	| { status: "loading" }
	| { status: "ready"; info: DesktopRuntimeInfo }
	| { status: "error"; message: string };

type AppShellProps = {
	runtimeState: RuntimeState;
	onRetryRuntime: () => Promise<void>;
	workspacePath: string;
	onWorkspacePathChange: (path: string) => void;
	onConnect: () => Promise<void>;
	chat: PiChatController;
};

function RuntimePanel({ state, onRetry }: { state: RuntimeState; onRetry: () => Promise<void> }) {
	if (state.status === "loading") return <span>Checking Rust bridge…</span>;
	if (state.status === "error") {
		return (
			<>
				<span title={state.message}>Bridge unavailable</span>
				<button type="button" onClick={() => void onRetry()}>Retry</button>
			</>
		);
	}
	return <span title={`${state.info.platform} / ${state.info.arch}`}>Tauri v{state.info.version}</span>;
}

export function AppShell({ runtimeState, onRetryRuntime, workspacePath, onWorkspacePathChange, onConnect, chat }: AppShellProps) {
	const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
	const connectionBusy = chat.connection.status === "connecting";
	const connected = chat.connection.status === "connected";
	const connectionTone = chat.sessionReady ? (chat.activity === "idle" ? "ready" : "loading") : connected ? "ready" : connectionBusy ? "loading" : chat.connection.status === "error" ? "error" : "muted";

	const toggleTheme = () => {
		const nextTheme: Theme = theme === "dark" ? "light" : "dark";
		applyTheme(nextTheme);
		storeTheme(nextTheme);
		setTheme(nextTheme);
	};

	return (
		<div className="app-frame">
			<TitleBar theme={theme} onToggleTheme={toggleTheme} />

			<div className="app-body">
				<aside className="sidebar" aria-label="Workspace sidebar">
					<div className="sidebar__header">
						<p className="eyebrow">Workspace</p>
						<h1>Local Pi</h1>
					</div>

					<section className="connection-card" aria-label="Pi connection">
						<div className="connection-card__heading">
							<span className={`status-dot status-dot--${connectionTone}`} aria-hidden="true" />
							<div>
								<strong>{chat.sessionReady ? "Pi connected" : connected ? "Session index ready" : connectionBusy ? "Reading sessions" : "Pi runtime"}</strong>
								<span>{chat.sessionReady ? (chat.activity === "idle" ? "Active session ready" : "Agent running") : connected ? "Choose or create a session" : "System CLI · configured model"}</span>
							</div>
						</div>

						<label htmlFor="workspace-path">Working directory</label>
						<input
							id="workspace-path"
							data-testid="workspace-path"
							type="text"
							value={workspacePath}
							onChange={(event) => onWorkspacePathChange(event.target.value)}
							disabled={connectionBusy || connected}
							spellCheck={false}
						/>

						{connected ? (
							<button type="button" className="button button--secondary connection-button" onClick={() => void chat.disconnect()}>
								Disconnect
							</button>
						) : (
							<button
								type="button"
								className="button button--primary connection-button"
								onClick={() => void onConnect()}
								disabled={connectionBusy || runtimeState.status !== "ready" || !workspacePath.trim()}
								data-testid="connect-button"
							>
								{connectionBusy ? "Connecting…" : chat.connection.status === "error" ? "Retry connection" : "Connect Pi"}
							</button>
						)}

						{chat.connection.status === "error" ? <p className="connection-card__error">{chat.connection.message}</p> : null}
						{chat.connection.status === "connected" ? (
							<p className="connection-card__discovery" title={chat.connection.discovery}>{chat.connection.discovery}</p>
						) : null}
					</section>

					<SessionSidebar chat={chat} />

					<div className={`sidebar__runtime sidebar__runtime--${runtimeState.status}`}>
						<span className={`status-dot status-dot--${runtimeState.status}`} aria-hidden="true" />
						<RuntimePanel state={runtimeState} onRetry={onRetryRuntime} />
					</div>
				</aside>

				<main className="workspace workspace--chat">
					<ChatWindow
						connection={chat.connection}
						activity={chat.activity}
						messages={chat.messages}
						queue={chat.queue}
						sending={chat.sending}
						aborting={chat.aborting}
						configuringModel={chat.configuringModel}
						model={chat.model}
						thinkingLevel={chat.thinkingLevel}
						lastError={chat.lastError}
						sessionReady={chat.sessionReady}
						activeSessionName={chat.activeSessionName}
						activeSessionPath={chat.activeSessionPath}
						activeRuntimePhase={chat.activeRuntimePhase}
						selectingRuntimeKey={chat.selectingRuntimeKey}
						composerSeed={chat.composerSeed}
						activeRuntimeKey={chat.activeRuntimeKey}
						sessionRuntimes={chat.sessionRuntimes}
						loadModelConfiguration={chat.loadModelConfiguration}
						setModel={chat.setModel}
						setThinkingLevel={chat.setThinkingLevel}
						disconnect={chat.disconnect}
						send={chat.send}
						abort={chat.abort}
						clearError={chat.clearError}
					/>
				</main>
			</div>
		</div>
	);
}
