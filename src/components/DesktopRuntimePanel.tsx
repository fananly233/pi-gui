import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import {
	desktopApi,
	type InstalledPiRuntime,
	type PiRuntimeDiagnostics,
	type PiRuntimeMode,
	type PiRuntimeStatus,
} from "../api/desktop-api";
import "./DesktopRuntimePanel.css";

type DesktopRuntimePanelProps = {
	onClose: () => void;
};

type PendingConfirmation =
	| { kind: "install" }
	| { kind: "system-settings" }
	| { kind: "activate"; version: string };

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "The native runtime manager returned an unknown error.";
}

function runtimeHeading(status: PiRuntimeStatus): string {
	if (status.effectiveSource === "managed") return "Managed by Pi Desktop";
	if (status.effectiveSource === "bundled") return "Bundled with Pi Desktop";
	if (status.effectiveSource === "system" && status.fallback) return "System Pi fallback";
	if (status.effectiveSource === "system") return "Using system Pi";
	return "Pi is not installed";
}

function formatTimestamp(timestamp: number): string {
	if (!timestamp) return "Unknown";
	return new Date(timestamp * 1000).toLocaleString();
}

function VersionRow({ runtime, busy, onActivate }: {
	runtime: InstalledPiRuntime;
	busy: boolean;
	onActivate: (version: string) => Promise<void>;
}) {
	return (
		<li>
			<div>
				<strong>Pi {runtime.version}</strong>
				<span>{runtime.asset} · installed {formatTimestamp(runtime.installedAt)}</span>
			</div>
			{runtime.current
				? <em>Current</em>
				: <button type="button" onClick={() => void onActivate(runtime.version)} disabled={busy}>Use version</button>}
		</li>
	);
}

export function DesktopRuntimePanel({ onClose }: DesktopRuntimePanelProps) {
	const [status, setStatus] = useState<PiRuntimeStatus | null>(null);
	const [diagnostics, setDiagnostics] = useState<PiRuntimeDiagnostics | null>(null);
	const [loading, setLoading] = useState(true);
	const [checking, setChecking] = useState(false);
	const [mutating, setMutating] = useState(false);
	const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [mode, setMode] = useState<PiRuntimeMode>("managed");
	const [systemPath, setSystemPath] = useState("");
	const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);

	const refresh = useCallback(async (checkUpdates = false) => {
		if (checkUpdates) setChecking(true);
		else setLoading(true);
		setError(null);
		try {
			const next = await desktopApi.getPiRuntimeStatus(checkUpdates);
			setStatus(next);
			setMode(next.mode);
			setSystemPath(next.systemPiPath ?? "");
		} catch (nextError) {
			setError(describeError(nextError));
		} finally {
			setLoading(false);
			setChecking(false);
		}
	}, []);

	useEffect(() => {
		void refresh(false);
	}, [refresh]);

	const install = async () => {
		if (mutating || status?.activeRpcCount) return;
		setMutating(true);
		setError(null);
		setMessage(null);
		try {
			const result = await desktopApi.installManagedPiRuntime();
			setMessage(result.already_installed
				? `Managed Pi ${result.version} is active.`
				: `Managed Pi ${result.version} was verified and installed.`);
			await refresh(true);
		} catch (nextError) {
			setError(describeError(nextError));
		} finally {
			setMutating(false);
		}
	};

	const saveRuntimeSettings = async () => {
		if (mutating || status?.activeRpcCount) return;
		setMutating(true);
		setError(null);
		setMessage(null);
		try {
			await desktopApi.setPiRuntimeSettings(mode, systemPath.trim() || null);
			setMessage(mode === "managed" ? "Managed runtime selected." : "System Pi selected.");
			await refresh(false);
		} catch (nextError) {
			setError(describeError(nextError));
		} finally {
			setMutating(false);
		}
	};

	const activate = async (version: string) => {
		if (mutating || status?.activeRpcCount) return;
		setMutating(true);
		setError(null);
		setMessage(null);
		try {
			await desktopApi.activateManagedPiRuntime(version);
			setMessage(`Managed Pi ${version} is now active.`);
			await refresh(false);
		} catch (nextError) {
			setError(describeError(nextError));
		} finally {
			setMutating(false);
		}
	};

	const requestRuntimeSettingsSave = () => {
		if (mode === "system") setConfirmation({ kind: "system-settings" });
		else void saveRuntimeSettings();
	};

	const confirmAction = () => {
		const pending = confirmation;
		setConfirmation(null);
		if (!pending) return;
		if (pending.kind === "install") void install();
		else if (pending.kind === "system-settings") void saveRuntimeSettings();
		else void activate(pending.version);
	};

	const confirmationCopy = confirmation?.kind === "install"
		? {
			title: "Install managed Pi?",
			body: "Pi Desktop will download the matching earendil-works/pi release, verify its published SHA-256 checksum, and keep the previous managed version for rollback. No global npm package or PATH entry will be changed.",
			confirm: "Download and install",
		}
		: confirmation?.kind === "system-settings"
			? {
				title: "Use system Pi?",
				body: "Pi Desktop will execute this binary for future sessions but will never update or remove it. Leave the path blank to use Pi from PATH.",
				confirm: "Use system Pi",
			}
			: confirmation?.kind === "activate"
				? {
					title: `Use managed Pi ${confirmation.version}?`,
					body: "Future sessions will use this verified version. Other managed versions remain installed so the switch can be reversed.",
					confirm: "Switch version",
				}
				: null;

	const toggleDiagnostics = async () => {
		const nextOpen = !diagnosticsOpen;
		setDiagnosticsOpen(nextOpen);
		if (!nextOpen) return;
		setError(null);
		try {
			setDiagnostics(await desktopApi.getPiRuntimeDiagnostics());
		} catch (nextError) {
			setError(describeError(nextError));
		}
	};

	const busy = loading || checking || mutating || Boolean(status?.operationActive);
	const settingsChanged = status
		? mode !== status.mode || systemPath.trim() !== (status.systemPiPath ?? "")
		: false;

	return (
		<aside className="workspace-tool-panel desktop-runtime-panel" aria-label="Pi runtime manager">
			<header className="tool-panel__header">
				<div>
					<p className="eyebrow">Desktop Runtime</p>
					<strong>Pi Runtime</strong>
				</div>
				<div className="tool-panel__actions">
					<button type="button" onClick={() => void refresh(false)} disabled={busy}>Refresh</button>
					<button type="button" className="tool-panel__close" onClick={onClose} title="Close runtime panel">×</button>
				</div>
			</header>

			{error ? <p className="tool-panel__error" role="alert">{error}</p> : null}
			{message ? <p className="desktop-runtime-panel__message" role="status">{message}</p> : null}
			{loading && !status ? <div className="tool-panel__empty">Reading native runtime state…</div> : null}

			{status ? (
				<div className="desktop-runtime-panel__body">
					<section className="runtime-hero">
						<div className="runtime-hero__title">
							<span className={`status-dot status-dot--${status.effectiveSource === "unavailable" ? "error" : status.fallback ? "loading" : "ready"}`} aria-hidden="true" />
							<div>
								<h3>{runtimeHeading(status)}</h3>
								<strong>{status.currentVersion ? `Version ${status.currentVersion}` : "Version unavailable"}</strong>
							</div>
						</div>
						{status.note ? <p>{status.note}</p> : null}
						<code title={status.executable ?? undefined}>{status.executable ?? "No Pi executable resolved"}</code>
						<div className="runtime-hero__actions">
							<button type="button" className="button button--secondary" onClick={() => void refresh(true)} disabled={busy}>
								{checking ? "Checking…" : "Check updates"}
							</button>
							<button type="button" className="button button--primary" onClick={() => setConfirmation({ kind: "install" })} disabled={busy || status.activeRpcCount > 0}>
								{mutating ? "Working…" : status.managed && status.updateAvailable ? `Update to ${status.latestVersion}` : status.managed ? "Reinstall / verify" : "Install managed Pi"}
							</button>
						</div>
						{status.activeRpcCount > 0 ? <small>Disconnect {status.activeRpcCount} active Pi session{status.activeRpcCount === 1 ? "" : "s"} before runtime maintenance.</small> : null}
					</section>

					{status.latestVersion ? (
						<section className="runtime-section runtime-release">
							<header><h3>Official release</h3><span>{status.latestVersion}</span></header>
							<p>{status.updateAvailable ? "A newer managed runtime is available." : "The resolved Pi runtime is current."}{status.publishedAt ? ` Published ${new Date(status.publishedAt).toLocaleDateString()}.` : ""}</p>
							{status.releaseNotes ? <details><summary>Release notes</summary><pre>{status.releaseNotes}</pre></details> : null}
							{status.releaseUrl ? <button type="button" onClick={() => void open(status.releaseUrl!)}>Open official release</button> : null}
						</section>
					) : null}

					<section className="runtime-section runtime-settings">
						<header><h3>Advanced</h3><span>Applied to new sessions</span></header>
						<label>
							<span>Runtime source</span>
							<select value={mode} onChange={(event) => setMode(event.target.value as PiRuntimeMode)} disabled={busy}>
								<option value="managed">Managed by Pi Desktop</option>
								<option value="system">Use system Pi</option>
							</select>
						</label>
						{mode === "system" ? (
							<label>
								<span>Pi executable path</span>
								<input value={systemPath} onChange={(event) => setSystemPath(event.target.value)} placeholder="Leave blank to use Pi from PATH" spellCheck={false} disabled={busy} />
							</label>
						) : null}
						<p>Managed mode falls back to an existing system Pi until a verified standalone release is installed. Pi Desktop never changes global npm packages or PATH.</p>
						<button type="button" onClick={requestRuntimeSettingsSave} disabled={busy || !settingsChanged || status.activeRpcCount > 0}>Save runtime source</button>
					</section>

					<section className="runtime-section runtime-versions">
						<header><h3>Managed versions</h3><span>{status.installedVersions.length}</span></header>
						{status.installedVersions.length ? (
							<ul>{status.installedVersions.map((runtime) => <VersionRow key={runtime.version} runtime={runtime} busy={busy || status.activeRpcCount > 0} onActivate={async (version) => setConfirmation({ kind: "activate", version })} />)}</ul>
						) : <p>No managed runtime installed yet.</p>}
					</section>

					<section className="runtime-section runtime-diagnostics">
						<header><h3>Diagnostics & logs</h3><button type="button" onClick={() => void toggleDiagnostics()}>{diagnosticsOpen ? "Hide" : "Show"}</button></header>
						<p>Only lifecycle metadata is logged. Prompts, model output, credentials, and environment variables are excluded.</p>
						{diagnosticsOpen && diagnostics ? (
							<div className="runtime-diagnostics__content">
								<dl>
									<div><dt>Runtime data</dt><dd>{diagnostics.runtimeRoot}</dd></div>
									<div><dt>Settings</dt><dd>{diagnostics.settingsPath}</dd></div>
									<div><dt>Log</dt><dd>{diagnostics.logPath}</dd></div>
									<div><dt>Processes</dt><dd>{diagnostics.activeRpcCount} RPC · {diagnostics.activeTerminalCount} terminal</dd></div>
								</dl>
								<ol className="runtime-log-list">
									{diagnostics.logs.slice(-50).reverse().map((entry, index) => (
										<li key={`${entry.timestamp_ms}:${entry.event}:${index}`}>
											<time>{new Date(entry.timestamp_ms).toLocaleTimeString()}</time>
											<strong>{entry.event}</strong>
											<span>{entry.detail}</span>
										</li>
									))}
								</ol>
							</div>
						) : null}
					</section>
				</div>
			) : null}

			{confirmationCopy ? (
				<div className="runtime-confirmation" role="presentation">
					<section role="dialog" aria-modal="true" aria-labelledby="runtime-confirmation-title">
						<p className="eyebrow">Explicit confirmation</p>
						<h3 id="runtime-confirmation-title">{confirmationCopy.title}</h3>
						<p>{confirmationCopy.body}</p>
						<div>
							<button type="button" className="button button--secondary" onClick={() => setConfirmation(null)}>Cancel</button>
							<button type="button" className="button button--primary" onClick={confirmAction}>{confirmationCopy.confirm}</button>
						</div>
					</section>
				</div>
			) : null}
		</aside>
	);
}
