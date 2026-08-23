import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { desktopApi, type WorkspaceTextFile } from "../api/desktop-api";

type FileViewerProps = {
	workspaceRoot: string;
	path: string;
	onBack: () => void;
	onMentionFile: (path: string) => void;
	canMention: boolean;
	onDirtyChange: (dirty: boolean) => void;
};

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" ? error : "The native file bridge returned an unknown error.";
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function FileViewer({ workspaceRoot, path, onBack, onMentionFile, canMention, onDirtyChange }: FileViewerProps) {
	const [file, setFile] = useState<WorkspaceTextFile | null>(null);
	const [draft, setDraft] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const loadSequence = useRef(0);
	const dirty = file !== null && draft !== file.content;

	const load = useCallback(async () => {
		const sequence = ++loadSequence.current;
		setLoading(true);
		setError(null);
		try {
			const next = await desktopApi.readWorkspaceFile(workspaceRoot, path);
			if (sequence !== loadSequence.current) return;
			setFile(next);
			setDraft(next.content);
		} catch (nextError) {
			if (sequence !== loadSequence.current) return;
			setFile(null);
			setDraft("");
			setError(describeError(nextError));
		} finally {
			if (sequence === loadSequence.current) setLoading(false);
		}
	}, [path, workspaceRoot]);

	useEffect(() => {
		void load();
		return () => {
			loadSequence.current += 1;
		};
	}, [load]);

	useEffect(() => {
		onDirtyChange(dirty);
		return () => onDirtyChange(false);
	}, [dirty, onDirtyChange]);

	const save = async () => {
		if (!file || !dirty || saving) return;
		setSaving(true);
		setError(null);
		try {
			const saved = await desktopApi.writeWorkspaceFile(workspaceRoot, path, draft, file.content);
			setFile(saved);
			setDraft(saved.content);
		} catch (nextError) {
			setError(describeError(nextError));
		} finally {
			setSaving(false);
		}
	};

	const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
		event.preventDefault();
		void save();
	};

	const name = path.split("/").at(-1) ?? path;
	const back = async () => {
		if (!dirty || await desktopApi.confirmAction("Discard unsaved changes and return to the file list?", "Discard")) onBack();
	};
	return (
		<section className="file-viewer" aria-label={`File ${path}`}>
			<header className="file-surface__header file-viewer__header">
				<button type="button" className="icon-button" onClick={() => void back()} title="Back to files">←</button>
				<div>
					<p className="eyebrow" title={path}>{path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "Workspace"}</p>
					<strong>{name}</strong>
				</div>
				<div className="file-viewer__actions">
					<button type="button" className="button button--secondary" onClick={() => onMentionFile(path)} disabled={!canMention} title={canMention ? "Insert this file into chat" : "Select a ready Pi session first"}>Attach</button>
					<button type="button" className="button button--primary" onClick={() => void save()} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</button>
				</div>
			</header>
			{file ? <div className="file-viewer__status"><span>{formatBytes(file.size)}</span><span>{dirty ? "Unsaved changes" : "Saved"}</span><span>Ctrl+S</span></div> : null}
			{error ? (
				<div className="file-viewer__error" role="alert">
					<span>{error}</span>
					<button type="button" onClick={() => void load()}>Reload</button>
				</div>
			) : null}
			{loading ? <p className="file-surface__empty">Loading file…</p> : null}
			{file ? (
				<textarea
					className="file-viewer__editor"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={onEditorKeyDown}
					spellCheck={false}
					aria-label={`Edit ${name}`}
				/>
			) : null}
		</section>
	);
}
