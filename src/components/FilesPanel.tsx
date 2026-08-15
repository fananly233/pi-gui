import { useCallback, useEffect, useState } from "react";
import { FileExplorer } from "./FileExplorer";
import { FileViewer } from "./FileViewer";

type FilesPanelProps = {
	workspaceRoot: string | null;
	selectedPath: string | null;
	onSelectPath: (path: string | null) => void;
	onMentionFile: (path: string) => void;
	canMention: boolean;
	onClose: () => void;
	onDirtyStateChange: (dirty: boolean) => void;
};

export function FilesPanel({ workspaceRoot, selectedPath, onSelectPath, onMentionFile, canMention, onClose, onDirtyStateChange }: FilesPanelProps) {
	const [dirty, setDirty] = useState(false);

	useEffect(() => {
		setDirty(false);
		onDirtyStateChange(false);
	}, [selectedPath, workspaceRoot]);

	useEffect(() => () => onDirtyStateChange(false), [onDirtyStateChange]);

	const onDirtyChange = useCallback((value: boolean) => {
		setDirty(value);
		onDirtyStateChange(value);
	}, [onDirtyStateChange]);
	const close = () => {
		if (!dirty || window.confirm("Discard unsaved file changes and close the Files panel?")) onClose();
	};

	return (
		<aside className="workspace-tool-panel files-panel" aria-label="Project files">
			<button type="button" className="files-panel__close" onClick={close} title="Close files panel">×</button>
			{!workspaceRoot ? (
				<div className="file-surface__empty">
					<h3>Connect a workspace</h3>
					<p>The native file bridge only opens files inside the connected project.</p>
				</div>
			) : selectedPath ? (
				<FileViewer workspaceRoot={workspaceRoot} path={selectedPath} onBack={() => onSelectPath(null)} onMentionFile={onMentionFile} canMention={canMention} onDirtyChange={onDirtyChange} />
			) : (
				<FileExplorer workspaceRoot={workspaceRoot} onOpenFile={onSelectPath} onMentionFile={onMentionFile} canMention={canMention} />
			)}
		</aside>
	);
}
