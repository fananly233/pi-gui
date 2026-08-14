import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
