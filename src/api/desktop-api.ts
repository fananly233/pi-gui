import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

export type DesktopRuntimeInfo = Readonly<{
	platform: string;
	arch: string;
	version: string;
}>;

export type DesktopSessionInfo = Readonly<{
	id: string;
	name: string | null;
	path: string;
	cwd: string | null;
	createdAt: number;
	modifiedAt: number;
	tokens: number;
	cost: number;
}>;

type NativeSessionInfo = Readonly<{
	id: string;
	name: string | null;
	path: string;
	cwd: string | null;
	created_at: number;
	modified_at: number;
	tokens: number;
	cost: number;
}>;

export type PiAuthProviderStatus = Readonly<{
	provider: string;
	source: "auth_file_oauth" | "auth_file_api_key" | "environment" | string;
	kind: string;
}>;

export type PiAuthStatus = Readonly<{
	agentDir: string | null;
	authFile: string | null;
	authFileExists: boolean;
	configuredProviders: PiAuthProviderStatus[];
}>;

type NativePiAuthStatus = Readonly<{
	agent_dir: string | null;
	auth_file: string | null;
	auth_file_exists: boolean;
	configured_providers: PiAuthProviderStatus[];
}>;

export type PiOAuthProviderInfo = Readonly<{
	id: string;
	name: string;
	source: string;
}>;

export type PiProviderAuthClearResult = Readonly<{
	provider: string;
	removed: boolean;
	source: string;
}>;

export type PiPackageScope = "user" | "project";

export type PiPackageInfo = Readonly<{
	source: string;
	scope: PiPackageScope;
	installedPath: string | null;
	filtered: boolean;
}>;

type NativePiPackageInfo = Readonly<{
	source: string;
	scope: PiPackageScope;
	installed_path: string | null;
	filtered: boolean;
}>;

type NativePiPackageListResult = Readonly<{
	packages: NativePiPackageInfo[];
}>;

export type PiPackageMutationResult = Readonly<{
	message: string;
}>;

export type PiThemeInfo = Readonly<{
	name: string;
	path: string | null;
	scope: "builtin" | "user" | "project";
}>;

export type WorkspaceEntry = Readonly<{
	name: string;
	path: string;
	isDirectory: boolean;
	size: number;
	modifiedAt: number;
}>;

export type WorkspaceDirectory = Readonly<{
	path: string;
	entries: WorkspaceEntry[];
	truncated: boolean;
}>;

type NativeWorkspaceEntry = Readonly<{
	name: string;
	path: string;
	is_dir: boolean;
	size: number;
	modified_at: number;
}>;

type NativeWorkspaceDirectory = Readonly<{
	path: string;
	entries: NativeWorkspaceEntry[];
	truncated: boolean;
}>;

export type WorkspaceFileIndex = Readonly<{
	files: string[];
	truncated: boolean;
}>;

export type WorkspaceTextFile = Readonly<{
	path: string;
	content: string;
	size: number;
	modifiedAt: number;
}>;

type NativeWorkspaceTextFile = Readonly<{
	path: string;
	content: string;
	size: number;
	modified_at: number;
}>;

export type TerminalStartInfo = Readonly<{
	terminalId: string;
	shell: string;
	pid: number | null;
}>;

type NativeTerminalStartInfo = Readonly<{
	terminal_id: string;
	shell: string;
	pid: number | null;
}>;

export type TerminalOutputEvent = Readonly<{
	terminal_id: string;
	data: number[];
}>;

export type TerminalExitEvent = Readonly<{
	terminal_id: string;
	exit_code: number | null;
	reason: string;
}>;

export type GitChange = Readonly<{
	path: string;
	indexStatus: string;
	worktreeStatus: string;
}>;

export type GitWorkspaceStatus = Readonly<{
	repositoryRoot: string;
	branch: string;
	upstream: string | null;
	ahead: number;
	behind: number;
	changes: GitChange[];
}>;

type NativeGitWorkspaceStatus = Readonly<{
	repository_root: string;
	branch: string;
	upstream: string | null;
	ahead: number;
	behind: number;
	changes: ReadonlyArray<{
		path: string;
		index_status: string;
		worktree_status: string;
	}>;
}>;

export type GitDiffResult = Readonly<{
	content: string;
	truncated: boolean;
}>;

export type GitWorktree = Readonly<{
	path: string;
	branch: string | null;
	head: string;
	isMain: boolean;
	isCurrent: boolean;
	dirty: boolean;
	locked: boolean;
	prunable: boolean;
}>;

type NativeGitWorktree = Readonly<{
	path: string;
	branch: string | null;
	head: string;
	is_main: boolean;
	is_current: boolean;
	dirty: boolean;
	locked: boolean;
	prunable: boolean;
}>;

function mapWorkspaceFile(file: NativeWorkspaceTextFile): WorkspaceTextFile {
	return {
		path: file.path,
		content: file.content,
		size: file.size,
		modifiedAt: file.modified_at,
	};
}

function mapGitWorktree(worktree: NativeGitWorktree): GitWorktree {
	return {
		path: worktree.path,
		branch: worktree.branch,
		head: worktree.head,
		isMain: worktree.is_main,
		isCurrent: worktree.is_current,
		dirty: worktree.dirty,
		locked: worktree.locked,
		prunable: worktree.prunable,
	};
}

export const desktopApi = {
	getRuntimeInfo(): Promise<DesktopRuntimeInfo> {
		return invoke<DesktopRuntimeInfo>("get_desktop_runtime_info");
	},

	async listSessions(): Promise<DesktopSessionInfo[]> {
		const sessions = await invoke<NativeSessionInfo[]>("list_sessions");
		return sessions.map((session) => ({
			id: session.id,
			name: session.name,
			path: session.path,
			cwd: session.cwd,
			createdAt: session.created_at,
			modifiedAt: session.modified_at,
			tokens: session.tokens,
			cost: session.cost,
		}));
	},

	deleteSession(sessionPath: string): Promise<boolean> {
		return invoke<boolean>("delete_session", { sessionPath });
	},

	async getPiAuthStatus(): Promise<PiAuthStatus> {
		const status = await invoke<NativePiAuthStatus>("get_pi_auth_status");
		return {
			agentDir: status.agent_dir,
			authFile: status.auth_file,
			authFileExists: status.auth_file_exists,
			configuredProviders: status.configured_providers,
		};
	},

	getPiOAuthProviders(): Promise<PiOAuthProviderInfo[]> {
		return invoke<PiOAuthProviderInfo[]>("get_pi_oauth_providers");
	},

	clearPiProviderAuth(provider: string): Promise<PiProviderAuthClearResult> {
		return invoke<PiProviderAuthClearResult>("clear_pi_provider_auth", { provider });
	},

	async listPiPackages(workspaceRoot: string, approveProject = false): Promise<PiPackageInfo[]> {
		const result = await invoke<NativePiPackageListResult>("list_pi_packages", { workspaceRoot, approveProject });
		return result.packages.map((entry) => ({
			source: entry.source,
			scope: entry.scope,
			installedPath: entry.installed_path,
			filtered: entry.filtered,
		}));
	},

	installPiPackage(workspaceRoot: string, source: string, scope: PiPackageScope): Promise<PiPackageMutationResult> {
		return invoke<PiPackageMutationResult>("install_pi_package", { workspaceRoot, source, scope });
	},

	removePiPackage(workspaceRoot: string, source: string, scope: PiPackageScope): Promise<PiPackageMutationResult> {
		return invoke<PiPackageMutationResult>("remove_pi_package", { workspaceRoot, source, scope });
	},

	updatePiPackages(workspaceRoot: string, source: string | null = null, approveProject = false): Promise<PiPackageMutationResult> {
		return invoke<PiPackageMutationResult>("update_pi_packages", { workspaceRoot, source, approveProject });
	},

	listPiThemes(workspaceRoot: string): Promise<PiThemeInfo[]> {
		return invoke<PiThemeInfo[]>("list_pi_themes", { workspaceRoot });
	},

	async chooseWorkspace(): Promise<string | null> {
		const selected = await openDialog({ directory: true, multiple: false });
		return Array.isArray(selected) ? selected[0] ?? null : selected;
	},

	async listWorkspaceDirectory(workspaceRoot: string, relativePath = ""): Promise<WorkspaceDirectory> {
		const directory = await invoke<NativeWorkspaceDirectory>("list_workspace_directory", {
			workspaceRoot,
			relativePath,
		});
		return {
			path: directory.path,
			truncated: directory.truncated,
			entries: directory.entries.map((entry) => ({
				name: entry.name,
				path: entry.path,
				isDirectory: entry.is_dir,
				size: entry.size,
				modifiedAt: entry.modified_at,
			})),
		};
	},

	indexWorkspaceFiles(workspaceRoot: string): Promise<WorkspaceFileIndex> {
		return invoke<WorkspaceFileIndex>("index_workspace_files", { workspaceRoot });
	},

	async readWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<WorkspaceTextFile> {
		return mapWorkspaceFile(await invoke<NativeWorkspaceTextFile>("read_workspace_file", {
			workspaceRoot,
			relativePath,
		}));
	},

	async writeWorkspaceFile(
		workspaceRoot: string,
		relativePath: string,
		content: string,
		expectedContent: string,
	): Promise<WorkspaceTextFile> {
		return mapWorkspaceFile(await invoke<NativeWorkspaceTextFile>("write_workspace_file", {
			workspaceRoot,
			relativePath,
			content,
			expectedContent,
		}));
	},

	async startTerminal(workspaceRoot: string, cols: number, rows: number): Promise<TerminalStartInfo> {
		const started = await invoke<NativeTerminalStartInfo>("terminal_start", { workspaceRoot, cols, rows });
		return {
			terminalId: started.terminal_id,
			shell: started.shell,
			pid: started.pid,
		};
	},

	writeTerminal(terminalId: string, data: string): Promise<void> {
		return invoke<void>("terminal_write", { terminalId, data });
	},

	resizeTerminal(terminalId: string, cols: number, rows: number): Promise<void> {
		return invoke<void>("terminal_resize", { terminalId, cols, rows });
	},

	stopTerminal(terminalId: string): Promise<boolean> {
		return invoke<boolean>("terminal_stop", { terminalId });
	},

	onTerminalOutput(callback: (payload: TerminalOutputEvent) => void): Promise<UnlistenFn> {
		return listen<TerminalOutputEvent>("terminal-output", (event) => callback(event.payload));
	},

	onTerminalExit(callback: (payload: TerminalExitEvent) => void): Promise<UnlistenFn> {
		return listen<TerminalExitEvent>("terminal-exit", (event) => callback(event.payload));
	},

	async getGitWorkspaceStatus(workspaceRoot: string): Promise<GitWorkspaceStatus> {
		const status = await invoke<NativeGitWorkspaceStatus>("get_git_workspace_status", { workspaceRoot });
		return {
			repositoryRoot: status.repository_root,
			branch: status.branch,
			upstream: status.upstream,
			ahead: status.ahead,
			behind: status.behind,
			changes: status.changes.map((change) => ({
				path: change.path,
				indexStatus: change.index_status,
				worktreeStatus: change.worktree_status,
			})),
		};
	},

	getGitDiff(workspaceRoot: string, relativePath: string | null, staged: boolean): Promise<GitDiffResult> {
		return invoke<GitDiffResult>("get_git_diff", { workspaceRoot, relativePath, staged });
	},

	async listGitWorktrees(workspaceRoot: string): Promise<GitWorktree[]> {
		return (await invoke<NativeGitWorktree[]>("list_git_worktrees", { workspaceRoot })).map(mapGitWorktree);
	},

	async createGitWorktree(workspaceRoot: string, branch: string, createBranch: boolean): Promise<GitWorktree> {
		return mapGitWorktree(await invoke<NativeGitWorktree>("create_git_worktree", {
			workspaceRoot,
			branch,
			createBranch,
		}));
	},

	removeGitWorktree(workspaceRoot: string, worktreePath: string): Promise<boolean> {
		return invoke<boolean>("remove_git_worktree", { workspaceRoot, worktreePath });
	},

	minimize(): Promise<void> {
		return getCurrentWindow().minimize();
	},

	toggleMaximize(): Promise<void> {
		return getCurrentWindow().toggleMaximize();
	},

	startDragging(): Promise<void> {
		return getCurrentWindow().startDragging();
	},

	close(): Promise<void> {
		return getCurrentWindow().close();
	},
} as const;
