import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { DesktopSessionInfo } from "../api/desktop-api";
import type { PiChatController } from "../hooks/usePiChat";
import type { PiForkOption } from "../pi/pi-adapter";
import { isSessionRuntimeTransitioning, normalizeFsPath, sessionRuntimeKey } from "../sessions/session-runtime-state";

function sessionTitle(session: DesktopSessionInfo): string {
	return session.name?.trim() || `Session ${session.id.slice(0, 8)}`;
}

function formatRelativeTime(timestamp: number): string {
	if (!timestamp) return "Unknown";
	const elapsed = Math.max(0, Date.now() - timestamp);
	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(timestamp).toLocaleDateString();
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return String(tokens || 0);
}

type ForkDialogState = {
	session: DesktopSessionInfo;
	options: PiForkOption[];
	loading: boolean;
	forkingEntryId: string | null;
	error: string | null;
};

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function SessionSidebar({ chat }: { chat: PiChatController }) {
	const [query, setQuery] = useState("");
	const [renamePath, setRenamePath] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
	const [forkDialog, setForkDialog] = useState<ForkDialogState | null>(null);
	const forkRequest = useRef(0);
	const workspaceConnected = chat.connection.status === "connected";
	const normalizedActivePath = normalizeFsPath(chat.activeSessionPath);
	const filteredSessions = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		if (!needle) return chat.sessions;
		return chat.sessions.filter((session) =>
			`${sessionTitle(session)} ${session.path} ${session.id}`.toLocaleLowerCase().includes(needle),
		);
	}, [chat.sessions, query]);

	const activeIsListed = chat.sessions.some((session) => normalizeFsPath(session.path) === normalizedActivePath);
	const showTransientActive = Boolean(chat.activeRuntimeKey && !activeIsListed);

	const beginRename = (session: DesktopSessionInfo) => {
		setConfirmDeletePath(null);
		setRenamePath(session.path);
		setRenameValue(sessionTitle(session));
	};

	const commitRename = async (session: DesktopSessionInfo) => {
		const value = renameValue.trim();
		if (!value) return;
		try {
			await chat.renameSession(session, value);
			setRenamePath(null);
		} catch {
			// The controller exposes the actionable error beside the list.
		}
	};

	const onRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>, session: DesktopSessionInfo) => {
		if (event.key === "Enter") void commitRename(session);
		if (event.key === "Escape") setRenamePath(null);
	};

	const deleteConfirmed = async (session: DesktopSessionInfo) => {
		try {
			await chat.deleteSession(session);
			setConfirmDeletePath(null);
		} catch {
			// Keep the confirmation visible so the user can act on the displayed error.
		}
	};

	const openForkDialog = async (session: DesktopSessionInfo) => {
		const request = ++forkRequest.current;
		setForkDialog({ session, options: [], loading: true, forkingEntryId: null, error: null });
		try {
			const options = await chat.loadForkOptions(session);
			if (request !== forkRequest.current) return;
			setForkDialog({ session, options, loading: false, forkingEntryId: null, error: null });
		} catch (error) {
			if (request !== forkRequest.current) return;
			setForkDialog({ session, options: [], loading: false, forkingEntryId: null, error: describeError(error) });
		}
	};

	const closeForkDialog = () => {
		forkRequest.current += 1;
		setForkDialog(null);
	};

	const commitFork = async (option: PiForkOption) => {
		if (!forkDialog) return;
		const request = forkRequest.current;
		setForkDialog({ ...forkDialog, forkingEntryId: option.entryId, error: null });
		try {
			await chat.forkSession(forkDialog.session, option);
			if (request === forkRequest.current) closeForkDialog();
		} catch (error) {
			if (request !== forkRequest.current) return;
			setForkDialog((current) => (current ? { ...current, forkingEntryId: null, error: describeError(error) } : current));
		}
	};

	return (
		<section className="sessions-panel" aria-label="Sessions">
			<div className="sessions-panel__heading">
				<div>
					<p className="eyebrow">Sessions</p>
					<strong>{workspaceConnected ? `${chat.sessions.length} saved` : "Connect first"}</strong>
				</div>
				<div className="sessions-panel__heading-actions">
					<button
						type="button"
						className="icon-button"
						title="Refresh sessions"
						aria-label="Refresh sessions"
						onClick={() => void chat.refreshSessions()}
						disabled={!workspaceConnected || chat.sessionsLoading}
					>
						↻
					</button>
					<button
						type="button"
						className="button button--primary sessions-panel__new"
						onClick={() => void chat.newSession()}
						disabled={!workspaceConnected || chat.sessionsLoading || Boolean(chat.selectingRuntimeKey)}
						data-testid="new-session-button"
					>
						<span aria-hidden="true">＋</span> New
					</button>
				</div>
			</div>

			{workspaceConnected ? (
				<input
					className="session-search"
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search sessions…"
					aria-label="Search sessions"
				/>
			) : null}

			{chat.sessionsError ? (
				<div className="sessions-notice sessions-notice--error" role="alert">
					<span>{chat.sessionsError}</span>
					<button type="button" onClick={() => void chat.refreshSessions()}>Retry</button>
				</div>
			) : null}
			{chat.sessionActionError ? <div className="sessions-notice sessions-notice--error" role="alert">{chat.sessionActionError}</div> : null}

			<div className="session-list" role="list" aria-busy={chat.sessionsLoading}>
				{showTransientActive ? (
					<div className="session-row session-row--active session-row--transient" role="listitem">
						<span className={`session-row__state session-row__state--${chat.activity === "idle" ? "ready" : "running"}`} />
						<div className="session-row__body">
							<strong>{chat.activeSessionName || "New session"}</strong>
							<span>{chat.activeRuntimePhase === "ready" ? "Unsaved draft" : "Starting Pi…"}</span>
						</div>
					</div>
				) : null}

				{chat.sessionsLoading && chat.sessions.length === 0 ? (
					<div className="session-list__empty"><span className="spinner" /> Loading real Pi sessions…</div>
				) : !workspaceConnected ? (
					<div className="session-list__empty">Choose a workspace and connect before session files are read.</div>
				) : filteredSessions.length === 0 && !showTransientActive ? (
					<div className="session-list__empty">{query ? "No sessions match this search." : "No saved sessions in this workspace yet."}</div>
				) : (
					filteredSessions.map((session) => {
						const normalizedPath = normalizeFsPath(session.path);
						const active = normalizedPath === normalizedActivePath;
						const runtime = chat.sessionRuntimes.find((entry) => normalizeFsPath(entry.sessionPath) === normalizedPath);
						const loading = chat.selectingRuntimeKey === sessionRuntimeKey(session.path);
						const actionBusy = normalizeFsPath(chat.sessionAction?.path) === normalizedPath;
						const renaming = normalizeFsPath(renamePath) === normalizedPath;
						const confirmingDelete = normalizeFsPath(confirmDeletePath) === normalizedPath;
						const runtimeBusy = Boolean(runtime && (
							runtime.activity !== "idle" || isSessionRuntimeTransitioning(runtime.phase)
						));

						return (
							<div
								key={session.path}
								className={`session-row${active ? " session-row--active" : ""}${loading ? " session-row--loading" : ""}`}
								role="listitem"
								data-session-id={session.id}
							>
								{confirmingDelete ? (
									<div className="session-row__confirm">
										<span>Delete “{sessionTitle(session)}”?</span>
										<div>
											<button type="button" className="button button--danger" onClick={() => void deleteConfirmed(session)} disabled={actionBusy}>Delete</button>
											<button type="button" className="button button--secondary" onClick={() => setConfirmDeletePath(null)} disabled={actionBusy}>Cancel</button>
										</div>
									</div>
								) : renaming ? (
									<div className="session-row__rename">
										<input
											autoFocus
											value={renameValue}
											onChange={(event) => setRenameValue(event.target.value)}
											onKeyDown={(event) => onRenameKeyDown(event, session)}
											aria-label={`Rename ${sessionTitle(session)}`}
										/>
										<button type="button" className="icon-button" onClick={() => void commitRename(session)} disabled={!renameValue.trim() || actionBusy} aria-label="Save session name">✓</button>
										<button type="button" className="icon-button" onClick={() => setRenamePath(null)} disabled={actionBusy} aria-label="Cancel rename">×</button>
									</div>
								) : (
									<>
										<button type="button" className="session-row__select" onClick={() => void chat.selectSession(session)} aria-current={active ? "page" : undefined}>
											<span className={`session-row__state session-row__state--${loading || runtimeBusy ? "running" : runtime?.phase === "failed" ? "error" : active ? "ready" : "idle"}`} />
											<span className="session-row__body">
												<strong title={sessionTitle(session)}>{sessionTitle(session)}</strong>
												<span>{loading ? "Loading…" : `${formatRelativeTime(session.modifiedAt)} · ${formatTokens(session.tokens)} tokens`}</span>
											</span>
										</button>
										<div className="session-row__actions">
											<button type="button" onClick={() => beginRename(session)} title="Rename" aria-label={`Rename ${sessionTitle(session)}`} disabled={actionBusy}>✎</button>
											<button type="button" onClick={() => void openForkDialog(session)} title="Fork from message" aria-label={`Fork ${sessionTitle(session)}`} disabled={actionBusy || runtimeBusy}>⑂</button>
											<button type="button" onClick={() => { setRenamePath(null); setConfirmDeletePath(session.path); }} title="Delete" aria-label={`Delete ${sessionTitle(session)}`} disabled={actionBusy || runtimeBusy}>×</button>
										</div>
									</>
								)}
							</div>
						);
					})
				)}
			</div>

			{forkDialog ? (
				<div className="session-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeForkDialog()}>
					<section className="session-modal__card" role="dialog" aria-modal="true" aria-labelledby="fork-dialog-title">
						<header>
							<div>
								<p className="eyebrow">Fork session</p>
								<h3 id="fork-dialog-title">Choose a user message</h3>
								<span>{sessionTitle(forkDialog.session)}</span>
							</div>
							<button type="button" className="icon-button" onClick={closeForkDialog} aria-label="Close fork dialog" disabled={Boolean(forkDialog.forkingEntryId)}>×</button>
						</header>
						<div className="fork-options">
							{forkDialog.loading ? (
								<div className="session-list__empty"><span className="spinner" /> Loading fork points…</div>
							) : forkDialog.options.length === 0 ? (
								<div className="session-list__empty">No user messages are available to fork.</div>
							) : (
								forkDialog.options.map((option, index) => (
									<button type="button" key={option.entryId} className="fork-option" onClick={() => void commitFork(option)} disabled={Boolean(forkDialog.forkingEntryId)}>
										<span>{index + 1}</span>
										<strong>{option.text}</strong>
										<small>{forkDialog.forkingEntryId === option.entryId ? "Creating fork…" : "Fork here"}</small>
									</button>
								))
							)}
						</div>
						{forkDialog.error ? <p className="session-modal__error" role="alert">{forkDialog.error}</p> : null}
						<footer>Pi creates a new session before the selected prompt and returns that prompt to the composer for editing.</footer>
					</section>
				</div>
			) : null}
		</section>
	);
}
