import { invoke } from "@tauri-apps/api/core";
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

function mapWorkspaceFile(file: NativeWorkspaceTextFile): WorkspaceTextFile {
	return {
		path: file.path,
		content: file.content,
		size: file.size,
		modifiedAt: file.modified_at,
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
