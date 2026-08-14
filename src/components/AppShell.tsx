import { useState } from "react";
import type { DesktopRuntimeInfo } from "../api/desktop-api";
import { applyTheme, readStoredTheme, storeTheme, type Theme } from "../theme";
import { TitleBar } from "./TitleBar";

export type RuntimeState =
	| { status: "loading" }
	| { status: "ready"; info: DesktopRuntimeInfo }
	| { status: "error"; message: string };

type AppShellProps = {
	runtimeState: RuntimeState;
	onRetryRuntime: () => Promise<void>;
};

function RuntimePanel({ state, onRetry }: { state: RuntimeState; onRetry: () => Promise<void> }) {
	if (state.status === "loading") {
		return (
			<div className="runtime-state" role="status">
				<span className="spinner" aria-hidden="true" />
				<span>Checking the Rust bridge…</span>
			</div>
		);
	}

	if (state.status === "error") {
		return (
			<div className="runtime-state runtime-state--error" role="alert">
				<div>
					<strong>Native bridge unavailable</strong>
					<p>{state.message}</p>
				</div>
				<button type="button" className="button button--secondary" onClick={() => void onRetry()}>
					Retry
				</button>
			</div>
		);
	}

	return (
		<div className="runtime-grid" aria-label="Desktop runtime information">
			<RuntimeValue label="Platform" value={state.info.platform} />
			<RuntimeValue label="Architecture" value={state.info.arch} />
			<RuntimeValue label="App version" value={`v${state.info.version}`} />
		</div>
	);
}

function RuntimeValue({ label, value }: { label: string; value: string }) {
	return (
		<div className="runtime-value">
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}

export function AppShell({ runtimeState, onRetryRuntime }: AppShellProps) {
	const [theme, setTheme] = useState<Theme>(() => readStoredTheme());

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
						<h1>Local projects</h1>
					</div>

					<button type="button" className="new-session" disabled>
						<span aria-hidden="true">＋</span>
						<span>New session</span>
						<small>Phase 3</small>
					</button>

					<nav className="sidebar__nav" aria-label="Shell destinations">
						<button type="button" className="nav-item nav-item--active" aria-current="page">
							<span className="nav-icon" aria-hidden="true">◫</span>
							<span>Overview</span>
						</button>
						<button type="button" className="nav-item" disabled>
							<span className="nav-icon" aria-hidden="true">◎</span>
							<span>Sessions</span>
						</button>
					</nav>

					<div className="sidebar__spacer" />
					<div className="sidebar__status">
						<span className={`status-dot status-dot--${runtimeState.status}`} aria-hidden="true" />
						<div>
							<strong>Tauri runtime</strong>
							<span>{runtimeState.status === "ready" ? "Connected" : runtimeState.status === "error" ? "Needs attention" : "Checking"}</span>
						</div>
					</div>
				</aside>

				<main className="workspace">
					<div className="workspace__content">
						<p className="eyebrow eyebrow--accent">Migration foundation</p>
						<h2>React is ready. Pi stays native.</h2>
						<p className="workspace__intro">
							This first shell proves the renderer and Gustav’s Rust bridge share one desktop lifecycle. Chat and agent streaming intentionally begin in Phase 2.
						</p>

						<section className="bridge-card" aria-labelledby="bridge-card-title">
							<div className="bridge-card__heading">
								<div>
									<span className="bridge-card__kicker">Native bridge</span>
									<h3 id="bridge-card-title">Desktop runtime</h3>
								</div>
								<span className="foundation-chip">Phase 1</span>
							</div>
							<RuntimePanel state={runtimeState} onRetry={onRetryRuntime} />
						</section>

						<div className="next-step">
							<span className="next-step__number">02</span>
							<div>
								<strong>Next: real Pi conversation transport</strong>
								<p>RPC streaming, tool events, abort, and second-prompt reliability remain outside this shell.</p>
							</div>
						</div>
					</div>
				</main>
			</div>
		</div>
	);
}
