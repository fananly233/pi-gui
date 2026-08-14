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
