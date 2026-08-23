import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
	desktopApi,
	type PiPackageInfo,
	type PiPackageScope,
	type PiThemeInfo,
} from "../api/desktop-api";
import type { PiCommandInfo, PiCommandSource, PiResourceScope } from "../pi/ecosystem";

type EcosystemPanelProps = {
	workspaceRoot: string | null;
	sessionReady: boolean;
	loadCommands: () => Promise<PiCommandInfo[]>;
	onUseCommand: (command: string) => void;
	onClose: () => void;
};

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "The Pi ecosystem bridge returned an unknown error.";
}

function scopeLabel(scope: PiPackageScope | PiThemeInfo["scope"] | PiResourceScope): string {
	if (scope === "project") return "Project";
	if (scope === "user") return "User";
	if (scope === "temporary") return "Temporary";
	return "Built-in";
}

function resourceTitle(source: PiCommandSource): string {
	if (source === "extension") return "Extensions / Plugins";
	if (source === "skill") return "Skills";
	return "Prompts";
}

export function EcosystemPanel({ workspaceRoot, sessionReady, loadCommands, onUseCommand, onClose }: EcosystemPanelProps) {
	const requestSequence = useRef(0);
	const [packages, setPackages] = useState<PiPackageInfo[]>([]);
	const [commands, setCommands] = useState<PiCommandInfo[]>([]);
	const [themes, setThemes] = useState<PiThemeInfo[]>([]);
	const [source, setSource] = useState("");
	const [scope, setScope] = useState<PiPackageScope>("user");
	const [loading, setLoading] = useState(false);
	const [mutating, setMutating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [resourcesStale, setResourcesStale] = useState(false);
	const [approvedProjectWorkspace, setApprovedProjectWorkspace] = useState<string | null>(null);
	const includeProjectPackages = workspaceRoot !== null && approvedProjectWorkspace === workspaceRoot;

	const refresh = useCallback(async (approveProject = includeProjectPackages) => {
		const request = ++requestSequence.current;
		if (!workspaceRoot) {
			setPackages([]);
			setCommands([]);
			setThemes([]);
			setError(null);
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		const failures: string[] = [];
		const [packageResult, themeResult] = await Promise.allSettled([
			desktopApi.listPiPackages(workspaceRoot, approveProject),
			desktopApi.listPiThemes(workspaceRoot),
		]);
		if (request !== requestSequence.current) return;
		if (packageResult.status === "fulfilled") setPackages(packageResult.value);
		else {
			setPackages([]);
			failures.push(describeError(packageResult.reason));
		}
		if (themeResult.status === "fulfilled") setThemes(themeResult.value);
		else {
			setThemes([]);
			failures.push(describeError(themeResult.reason));
		}
		if (sessionReady) {
			try {
				const nextCommands = await loadCommands();
				if (request !== requestSequence.current) return;
				setCommands(nextCommands);
				setResourcesStale(false);
			} catch (nextError) {
				if (request !== requestSequence.current) return;
				setCommands([]);
				failures.push(describeError(nextError));
			}
		} else {
			setCommands([]);
			setResourcesStale(false);
		}
		if (failures.length) setError([...new Set(failures)].join(" "));
		setLoading(false);
	}, [includeProjectPackages, loadCommands, sessionReady, workspaceRoot]);

	useEffect(() => {
		void refresh();
		return () => {
			requestSequence.current += 1;
		};
	}, [refresh]);

	const finishMutation = async (
		operation: () => Promise<{ message: string }>,
		approveProject = includeProjectPackages,
	) => {
		setMutating(true);
		setError(null);
		setMessage(null);
		try {
			const result = await operation();
			setMessage(result.message);
			await refresh(approveProject);
			if (sessionReady) setResourcesStale(true);
			return true;
		} catch (nextError) {
			setError(describeError(nextError));
			return false;
		} finally {
			setMutating(false);
		}
	};

	const install = async (event: FormEvent) => {
		event.preventDefault();
		if (!workspaceRoot || !source.trim() || mutating) return;
		const trustNote = scope === "project"
			? "\n\nProject scope asks Pi to trust this project's local package configuration for this command."
			: "";
		if (!await desktopApi.confirmAction(
			`Install this ${scope} Pi package?\n\n${source.trim()}\n\nPi packages run with full system access. Review the source before continuing.${trustNote}`,
			"Install",
		)) return;
		const installed = await finishMutation(
			() => desktopApi.installPiPackage(workspaceRoot, source.trim(), scope),
			scope === "project" || includeProjectPackages,
		);
		if (installed) {
			if (scope === "project") setApprovedProjectWorkspace(workspaceRoot);
			setSource("");
		}
	};

	const remove = async (entry: PiPackageInfo) => {
		if (!workspaceRoot || mutating) return;
		const trustNote = entry.scope === "project"
			? "\n\nPi will trust project-local package configuration for this removal command."
			: "";
		if (!await desktopApi.confirmAction(`Remove this ${entry.scope} Pi package?\n\n${entry.source}${trustNote}`, "Remove")) return;
		await finishMutation(
			() => desktopApi.removePiPackage(workspaceRoot, entry.source, entry.scope),
			entry.scope === "project" || includeProjectPackages,
		);
	};

	const updateAll = async () => {
		if (!workspaceRoot || mutating || packages.length === 0) return;
		if (!await desktopApi.confirmAction("Ask Pi to update all trusted, unpinned packages?\n\nThis may download and execute third-party package code.", "Update")) return;
		await finishMutation(
			() => desktopApi.updatePiPackages(workspaceRoot, null, includeProjectPackages),
			includeProjectPackages,
		);
	};

	const showProjectPackages = async () => {
		if (!workspaceRoot) return;
		if (!await desktopApi.confirmAction(
			"Allow Pi to read this workspace's project package settings?\n\nThis list command does not run package resources, but project packages still have full system access when Pi loads them.",
			"Allow",
		)) return;
		setApprovedProjectWorkspace(workspaceRoot);
	};

	const resourceGroups: PiCommandSource[] = ["extension", "skill", "prompt"];

	return (
		<aside className="workspace-tool-panel ecosystem-panel" aria-label="Pi ecosystem">
			<header className="tool-panel__header">
				<div>
					<p className="eyebrow">Pi Ecosystem</p>
					<strong>Packages & resources</strong>
				</div>
				<div className="tool-panel__actions">
					<button type="button" onClick={() => void refresh()} disabled={!workspaceRoot || loading || mutating}>Refresh</button>
					<button type="button" className="tool-panel__close" onClick={onClose} title="Close ecosystem panel">×</button>
				</div>
			</header>

			{!workspaceRoot ? <div className="tool-panel__empty">Choose a working directory first.</div> : null}
			{error ? <p className="tool-panel__error" role="alert">{error}</p> : null}
			{message ? <p className="ecosystem-panel__message" role="status">{message}</p> : null}
			{resourcesStale ? <p className="ecosystem-panel__notice">Reconnect Pi to load package resource changes into the active session.</p> : null}

			{workspaceRoot ? (
				<div className="ecosystem-panel__body">
					<section className="ecosystem-section">
						<header>
							<div><h3>Packages</h3><span>{packages.length}</span></div>
							<div className="ecosystem-section__actions">
								{!includeProjectPackages ? <button type="button" onClick={() => void showProjectPackages()} disabled={mutating || loading}>Show project</button> : null}
								<button type="button" onClick={() => void updateAll()} disabled={mutating || loading || packages.length === 0}>Update all</button>
							</div>
						</header>
						<p className="ecosystem-section__help">Install, remove, and update through Pi's own package manager. Project packages stay hidden until explicitly approved; pinned packages stay pinned.</p>
						<form className="ecosystem-install" onSubmit={(event) => void install(event)}>
							<input
								value={source}
								onChange={(event) => setSource(event.target.value)}
								placeholder="npm:package, git:repo, or ./workspace-path"
								spellCheck={false}
								disabled={mutating}
								data-testid="package-source"
							/>
							<div className="ecosystem-install__actions">
								<label><span>Scope</span><select value={scope} onChange={(event) => setScope(event.target.value as PiPackageScope)} disabled={mutating}><option value="user">User</option><option value="project">Project</option></select></label>
								<button type="submit" disabled={mutating || !source.trim()} data-testid="package-install">{mutating ? "Working…" : "Install"}</button>
							</div>
						</form>
						<p className="ecosystem-security">Security: Pi packages and extensions run with full system access.</p>
						{loading && packages.length === 0 ? <p className="ecosystem-section__empty">Reading Pi package settings…</p> : null}
						{!loading && packages.length === 0 ? <p className="ecosystem-section__empty">No Pi packages configured for this workspace.</p> : null}
						<ul className="ecosystem-package-list">
							{packages.map((entry) => (
								<li key={`${entry.scope}:${entry.source}`}>
									<div>
										<strong title={entry.source}>{entry.source}</strong>
										<span title={entry.installedPath ?? undefined}>{entry.installedPath ?? "Configured; install path not present"}</span>
										<small><em>{scopeLabel(entry.scope)}</em>{entry.filtered ? <em>Filtered</em> : null}</small>
									</div>
									<button type="button" className="is-danger" onClick={() => void remove(entry)} disabled={mutating}>Remove</button>
								</li>
							))}
						</ul>
					</section>

					<section className="ecosystem-section">
						<header><div><h3>Runtime resources</h3><span>{commands.length}</span></div></header>
						<p className="ecosystem-section__help">Commands are discovered from the active Pi RPC runtime. Built-in TUI-only commands are intentionally absent.</p>
						{!sessionReady ? <p className="ecosystem-section__empty">Select a ready Pi session to discover extensions, plugins, skills, and prompts.</p> : null}
						{sessionReady && !loading && commands.length === 0 ? <p className="ecosystem-section__empty">No invokable package resources were reported by Pi.</p> : null}
						{resourceGroups.map((resourceSource) => {
							const entries = commands.filter((entry) => entry.source === resourceSource);
							if (!entries.length) return null;
							return (
								<div className="ecosystem-resource-group" key={resourceSource}>
									<h4>{resourceTitle(resourceSource)} <span>{entries.length}</span></h4>
									<ul>
										{entries.map((entry) => (
											<li key={`${entry.source}:${entry.name}:${entry.sourceInfo.path}`}>
												<div>
													<strong>/{entry.name}</strong>
													{entry.description ? <span>{entry.description}</span> : null}
													<small title={entry.sourceInfo.path}>{scopeLabel(entry.sourceInfo.scope)} · {entry.sourceInfo.source}</small>
												</div>
												<button type="button" onClick={() => onUseCommand(`/${entry.name} `)}>Use</button>
											</li>
										))}
									</ul>
								</div>
							);
						})}
					</section>

					<section className="ecosystem-section">
						<header><div><h3>Themes</h3><span>{themes.length}</span></div></header>
						<p className="ecosystem-section__help">Pi's built-in and directly discovered user/project themes. Package-owned themes remain managed with their package.</p>
						<ul className="ecosystem-theme-list">
							{themes.map((theme) => (
								<li key={`${theme.scope}:${theme.path ?? theme.name}`}>
									<div><strong>{theme.name}</strong><span title={theme.path ?? undefined}>{theme.path ?? "Pi built-in theme"}</span></div>
									<em>{scopeLabel(theme.scope)}</em>
								</li>
							))}
						</ul>
					</section>
				</div>
			) : null}
		</aside>
	);
}
