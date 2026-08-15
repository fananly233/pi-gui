import { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi, type WorkspaceDirectory, type WorkspaceEntry } from "../api/desktop-api";

type FileExplorerProps = {
	workspaceRoot: string;
	onOpenFile: (path: string) => void;
	onMentionFile: (path: string) => void;
	canMention: boolean;
};

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" ? error : "The native file bridge returned an unknown error.";
}

function FileTreeNode({
	workspaceRoot,
	entry,
	depth,
	onOpenFile,
	onMentionFile,
	canMention,
}: {
	workspaceRoot: string;
	entry: WorkspaceEntry;
	depth: number;
	onOpenFile: (path: string) => void;
	onMentionFile: (path: string) => void;
	canMention: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [directory, setDirectory] = useState<WorkspaceDirectory | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const toggle = async () => {
		if (!entry.isDirectory) {
			onOpenFile(entry.path);
			return;
		}
		const nextOpen = !open;
		setOpen(nextOpen);
		if (!nextOpen || directory || loading) return;
		setLoading(true);
		setError(null);
		try {
			setDirectory(await desktopApi.listWorkspaceDirectory(workspaceRoot, entry.path));
		} catch (nextError) {
			setError(describeError(nextError));
		} finally {
			setLoading(false);
		}
	};

	return (
		<li className="file-tree__item" role="treeitem" aria-expanded={entry.isDirectory ? open : undefined}>
			<div className="file-tree__row" style={{ paddingLeft: `${10 + depth * 14}px` }}>
				<button type="button" className="file-tree__open" onClick={() => void toggle()} title={entry.path}>
					<span className="file-tree__chevron" aria-hidden="true">{entry.isDirectory ? (open ? "⌄" : "›") : ""}</span>
					<span className="file-tree__icon" aria-hidden="true">{entry.isDirectory ? (open ? "▾" : "▸") : "·"}</span>
					<span>{entry.name}</span>
				</button>
				{!entry.isDirectory ? (
					<button type="button" className="file-tree__mention" onClick={() => onMentionFile(entry.path)} disabled={!canMention} title={canMention ? `Insert @${entry.path} into chat` : "Select a ready Pi session before attaching files"}>
						@
					</button>
				) : null}
			</div>
			{entry.isDirectory && open ? (
				<div className="file-tree__children">
					{loading ? <p className="file-tree__note" style={{ paddingLeft: `${28 + depth * 14}px` }}>Loading…</p> : null}
					{error ? <p className="file-tree__note file-tree__note--error" style={{ paddingLeft: `${28 + depth * 14}px` }}>{error}</p> : null}
					{directory ? (
						<ul role="group">
							{directory.entries.map((child) => (
								<FileTreeNode
									key={child.path}
									workspaceRoot={workspaceRoot}
									entry={child}
									depth={depth + 1}
									onOpenFile={onOpenFile}
									onMentionFile={onMentionFile}
									canMention={canMention}
								/>
							))}
							{directory.entries.length === 0 ? <li className="file-tree__note" style={{ paddingLeft: `${28 + depth * 14}px` }}>Empty folder</li> : null}
							{directory.truncated ? <li className="file-tree__note" style={{ paddingLeft: `${28 + depth * 14}px` }}>Showing the first 2,000 entries</li> : null}
						</ul>
					) : null}
				</div>
			) : null}
		</li>
	);
}

export function FileExplorer({ workspaceRoot, onOpenFile, onMentionFile, canMention }: FileExplorerProps) {
	const [directory, setDirectory] = useState<WorkspaceDirectory | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);
	const loadSequence = useRef(0);

	const loadRoot = useCallback(async () => {
		const sequence = ++loadSequence.current;
		setLoading(true);
		setError(null);
		try {
			const next = await desktopApi.listWorkspaceDirectory(workspaceRoot);
			if (sequence === loadSequence.current) setDirectory(next);
		} catch (nextError) {
			if (sequence !== loadSequence.current) return;
			setDirectory(null);
			setError(describeError(nextError));
		} finally {
			if (sequence === loadSequence.current) setLoading(false);
		}
	}, [workspaceRoot]);

	useEffect(() => {
		void loadRoot();
		return () => {
			loadSequence.current += 1;
		};
	}, [loadRoot, refreshKey]);

	return (
		<section className="file-explorer" aria-label="Workspace files">
			<header className="file-surface__header">
				<div>
					<p className="eyebrow">Project</p>
					<strong title={workspaceRoot}>{workspaceRoot.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || workspaceRoot}</strong>
				</div>
				<button type="button" className="icon-button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} title="Refresh files">↻</button>
			</header>
			<div className="file-explorer__body" key={`${workspaceRoot}:${refreshKey}`}>
				{loading ? <p className="file-surface__empty">Loading workspace files…</p> : null}
				{error ? (
					<div className="file-surface__empty file-surface__empty--error">
						<p>{error}</p>
						<button type="button" className="button button--secondary" onClick={() => void loadRoot()}>Retry</button>
					</div>
				) : null}
				{directory ? (
					<ul className="file-tree" role="tree">
						{directory.entries.map((entry) => (
							<FileTreeNode key={entry.path} workspaceRoot={workspaceRoot} entry={entry} depth={0} onOpenFile={onOpenFile} onMentionFile={onMentionFile} canMention={canMention} />
						))}
						{directory.entries.length === 0 ? <li className="file-surface__empty">This workspace is empty.</li> : null}
					</ul>
				) : null}
				{directory?.truncated ? <p className="file-tree__limit">Showing the first 2,000 root entries.</p> : null}
			</div>
		</section>
	);
}
