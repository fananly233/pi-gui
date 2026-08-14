import { useCallback, useEffect, useState } from "react";
import { desktopApi, type DesktopRuntimeInfo } from "./api/desktop-api";
import { AppShell, type RuntimeState } from "./components/AppShell";

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "The native bridge returned an unknown error.";
}

export function App() {
	const [runtimeState, setRuntimeState] = useState<RuntimeState>({ status: "loading" });

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

	return <AppShell runtimeState={runtimeState} onRetryRuntime={loadRuntimeInfo} />;
}
