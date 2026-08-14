import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type DesktopRuntimeInfo = Readonly<{
	platform: string;
	arch: string;
	version: string;
}>;

export const desktopApi = {
	getRuntimeInfo(): Promise<DesktopRuntimeInfo> {
		return invoke<DesktopRuntimeInfo>("get_desktop_runtime_info");
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
