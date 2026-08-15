import { useCallback, useEffect, useState, type FormEvent } from "react";
import { desktopApi, type GitDiffResult, type GitWorkspaceStatus, type GitWorktree } from "../api/desktop-api";

type GitPanelProps = {
	workspaceRoot: string | null;
	onClose: () => void;
	onUseWorkspace: (path: string) => Promise<void>;
};

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "The native Git bridge returned an unknown error.";
}

function changeCode(indexStatus: string, worktreeStatus: string): string {
	if (indexStatus === "?" && worktreeStatus === "?") return "??";
	return `${indexStatus === " " ? "·" : indexStatus}${worktreeStatus === " " ? "·" : worktreeStatus}`;
}

function canRemove(worktree: GitWorktree): boolean {
	return !worktree.isMain && !worktree.isCurrent && !worktree.dirty && !worktree.locked && !worktree.prunable;
}

function DiffBlock({ title, diff }: { title: string; diff: GitDiffResult | null }) {
	return (
		<section className="git-diff__block">
			<h4>{title}{diff?.truncated ? " · truncated" : ""}</h4>
			<pre>{diff?.content || "No diff for this view."}</pre>
		</section>
	);
}

export function GitPanel({ workspaceRoot, onClose, onUseWorkspace }: GitPanelProps) {
	const [status, setStatus] = useState<GitWorkspaceStatus | null>(null);
	const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [unstagedDiff, setUnstagedDiff] = useState<GitDiffResult | null>(null);
	const [stagedDiff, setStagedDiff] = useState<GitDiffResult | null>(null);
	const [diffLoading, setDiffLoading] = useState(false);
	const [branch, setBranch] = useState("");
	const [createBranch, setCreateBranch] = useState(true);
	const [mutating, setMutating] = useState(false);

	const refresh = useCallback(async () => {
		if (!workspaceRoot) {
			setStatus(null);
			setWorktrees([]);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const [nextStatus, nextWorktrees] = await Promise.all([
				desktopApi.getGitWorkspaceStatus(workspaceRoot),
				desktopApi.listGitWorktrees(workspaceRoot),
			]);
			setStatus(nextStatus);
			setWorktrees(nextWorktrees);
		} catch (nextError) {
			setStatus(null);
			setWorktrees([]);
			setError(describeError(nextError));
		} finally {
			setLoading(false);
		}
	}, [workspaceRoot]);

	useEffect(() => {
		setSelectedPath(null);
		setUnstagedDiff(null);
		setStagedDiff(null);
		void refresh();
	}, [refresh]);

	const loadDiff = async (path: string) => {
		if (!workspaceRoot) return;
		setSelectedPath(path);
		setDiffLoading(true);
		setError(null);
		try {
			const [unstaged, staged] = await Promise.all([
				desktopApi.getGitDiff(workspaceRoot, path, false),
				desktopApi.getGitDiff(workspaceRoot, path, true),
			]);
			setUnstagedDiff(unstaged);
			setStagedDiff(staged);
		} catch (nextError) {
			setError(describeError(nextError));
		} finally {
			setDiffLoading(false);
		}
	};

	const submitWorktree = async (event: FormEvent) => {
		event.preventDefault();
		if (!workspaceRoot || !branch.trim()) return;
		setMutating(true);
		setError(null);
		try {
			await desktopApi.createGitWorktree(workspaceRoot, branch.trim(), createBranch);
			setBranch("");
			await refresh();
		} catch (nextError) {
			setError(describeError(nextError));
		} finally {
			setMutating(false);
		}
	};

	const removeWorktree = async (worktree: GitWorktree) => {
		if (!workspaceRoot || !canRemove(worktree)) return;
		if (!window.confirm(`Remove this clean Git worktree?\n\n${worktree.path}`)) return;
		setMutating(true);
		setError(null);
		try {
			await desktopApi.removeGitWorktree(workspaceRoot, worktree.path);
			await refresh();
		} catch (nextError) {
			setError(describeError(nextError));
		} finally {
			setMutating(false);
		}
	};

	const useWorktree = async (worktree: GitWorktree) => {
		if (worktree.isCurrent || mutating) return;
		setMutating(true);
		setError(null);
		try {
			await onUseWorkspace(worktree.path);
		} catch (nextError) {
			setError(describeError(nextError));
		} finally {
			setMutating(false);
		}
	};

	return (
		<aside className="workspace-tool-panel git-panel" aria-label="Git workspace">
			<header className="tool-panel__header">
				<div>
					<p className="eyebrow">Git</p>
					<strong>{status?.branch || (loading ? "Reading repository…" : "Repository status")}</strong>
				</div>
				<div className="tool-panel__actions">
					<button type="button" onClick={() => void refresh()} disabled={!workspaceRoot || loading || mutating}>Refresh</button>
					<button type="button" className="tool-panel__close" onClick={onClose} title="Close Git panel">×</button>
				</div>
			</header>

			{!workspaceRoot ? <div className="tool-panel__empty">Choose a working directory first.</div> : null}
			{error ? <p className="tool-panel__error" role="alert">{error}</p> : null}
			{status ? (
				<div className="git-panel__body">
					<section className="git-summary">
						<div><span>Branch</span><strong>{status.branch}</strong></div>
						<div><span>Upstream</span><strong>{status.upstream ?? "None"}</strong></div>
						<div><span>Ahead</span><strong>{status.ahead}</strong></div>
						<div><span>Behind</span><strong>{status.behind}</strong></div>
					</section>

					<section className="git-section">
						<h3>Changes <span>{status.changes.length}</span></h3>
						{status.changes.length ? (
							<ul className="git-change-list">
								{status.changes.map((change) => (
									<li key={`${change.path}:${change.indexStatus}:${change.worktreeStatus}`}>
										<button type="button" className={selectedPath === change.path ? "is-active" : ""} onClick={() => void loadDiff(change.path)}>
											<code>{changeCode(change.indexStatus, change.worktreeStatus)}</code>
											<span title={change.path}>{change.path}</span>
										</button>
									</li>
								))}
							</ul>
						) : <p className="git-section__empty">Working tree clean.</p>}
						{selectedPath ? (
							<div className="git-diff">
								<h3 title={selectedPath}>{selectedPath}{diffLoading ? " · loading…" : ""}</h3>
								<DiffBlock title="Working tree" diff={unstagedDiff} />
								<DiffBlock title="Staged" diff={stagedDiff} />
							</div>
						) : null}
					</section>

					<section className="git-section git-worktrees">
						<h3>Worktrees <span>{worktrees.length}</span></h3>
						<form className="git-worktree-form" onSubmit={(event) => void submitWorktree(event)}>
							<input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/branch-name" spellCheck={false} disabled={mutating} />
							<label><input type="checkbox" checked={createBranch} onChange={(event) => setCreateBranch(event.target.checked)} disabled={mutating} /> Create branch</label>
							<button type="submit" disabled={mutating || !branch.trim()}>{mutating ? "Working…" : "Add worktree"}</button>
						</form>
						<ul className="git-worktree-list">
							{worktrees.map((worktree) => (
								<li key={worktree.path}>
									<div>
										<strong>{worktree.branch ?? "Detached HEAD"}</strong>
										<span title={worktree.path}>{worktree.path}</span>
										<small>
											{worktree.isMain ? <em>Main</em> : null}
											{worktree.isCurrent ? <em>Current</em> : null}
											{worktree.dirty ? <em>Dirty</em> : null}
											{worktree.locked ? <em>Locked</em> : null}
										</small>
									</div>
									<div className="git-worktree-list__actions">
										<button type="button" onClick={() => void useWorktree(worktree)} disabled={worktree.isCurrent || mutating}>Use</button>
										<button type="button" className="is-danger" onClick={() => void removeWorktree(worktree)} disabled={!canRemove(worktree) || mutating} title={canRemove(worktree) ? "Remove clean worktree" : "Main, current, dirty, locked, or prunable worktrees cannot be removed"}>Remove</button>
									</div>
								</li>
							))}
						</ul>
					</section>
				</div>
			) : null}
		</aside>
	);
}
