import { useCallback, useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { desktopApi, type DesktopRuntimeInfo } from "./api/desktop-api";
import { AppShell, type RuntimeState } from "./components/AppShell";
import { usePiChat } from "./hooks/usePiChat";

const WORKSPACE_STORAGE_KEY = "pi-desktop.phase2.workspace";

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "The native bridge returned an unknown error.";
}

export function App() {
	const [runtimeState, setRuntimeState] = useState<RuntimeState>({ status: "loading" });
	const [workspacePath, setWorkspacePath] = useState(() => localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? "");
	const chat = usePiChat();

	const loadRuntimeInfo = useCallback(async () => {
		setRuntimeState({ status: "loading" });
		try {
			const info: DesktopRuntimeInfo = await desktopApi.getRuntimeInfo();
			setRuntimeState({ status: "ready", info });
		} catch (error) {
			setRuntimeState({ status: "error", message: describeError(error) });
		}
	}, []);

	useEffect(() => {
		void loadRuntimeInfo();
	}, [loadRuntimeInfo]);

	useEffect(() => {
		if (workspacePath) return;
		let cancelled = false;
		void homeDir().then((path) => {
			if (!cancelled) setWorkspacePath(path);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (workspacePath.trim()) localStorage.setItem(WORKSPACE_STORAGE_KEY, workspacePath.trim());
	}, [workspacePath]);

	return (
		<AppShell
			runtimeState={runtimeState}
			onRetryRuntime={loadRuntimeInfo}
			workspacePath={workspacePath}
			onWorkspacePathChange={setWorkspacePath}
			onConnect={() => chat.connect(workspacePath)}
			chat={chat}
		/>
	);
}
