import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { desktopApi, type TerminalExitEvent, type TerminalOutputEvent } from "../api/desktop-api";
import type { Theme } from "../theme";

type TerminalPanelProps = {
	workspaceRoot: string | null;
	theme: Theme;
	onClose: () => void;
};

type TerminalState =
	| { phase: "idle" | "starting" }
	| { phase: "running"; shell: string; pid: number | null }
	| { phase: "exited"; message: string }
	| { phase: "error"; message: string };

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "The native terminal bridge returned an unknown error.";
}

function terminalTheme(theme: Theme) {
	return theme === "dark"
		? {
			background: "#17130f",
			foreground: "#eadfd1",
			cursor: "#df7b4f",
			selectionBackground: "#70422f88",
			black: "#211b16",
			red: "#e06c75",
			green: "#98c379",
			yellow: "#e5c07b",
			blue: "#61afef",
			magenta: "#c678dd",
			cyan: "#56b6c2",
			white: "#d8cbbd",
		}
		: {
			background: "#fffaf4",
			foreground: "#3f342b",
			cursor: "#b64f28",
			selectionBackground: "#e2b39b88",
			black: "#40352c",
			red: "#b53d42",
			green: "#557d37",
			yellow: "#9a681d",
			blue: "#326da8",
			magenta: "#81539a",
			cyan: "#347a7d",
			white: "#f4e8da",
		};
}

export function TerminalPanel({ workspaceRoot, theme, onClose }: TerminalPanelProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const [restartKey, setRestartKey] = useState(0);
	const [state, setState] = useState<TerminalState>({ phase: "idle" });

	useEffect(() => {
		if (terminalRef.current) terminalRef.current.options.theme = terminalTheme(theme);
	}, [theme]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host || !workspaceRoot) {
			setState({ phase: "idle" });
			return;
		}

		let disposed = false;
		let terminalId: string | null = null;
		let unlistenOutput: (() => void) | null = null;
		let unlistenExit: (() => void) | null = null;
		let pendingOutput: TerminalOutputEvent[] = [];
		const pendingExits: TerminalExitEvent[] = [];

		const terminal = new Terminal({
			allowProposedApi: false,
			convertEol: false,
			cursorBlink: true,
			fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
			fontSize: 12,
			lineHeight: 1.18,
			scrollback: 5_000,
			theme: terminalTheme(theme),
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(host);
		terminalRef.current = terminal;

		const fit = () => {
			if (disposed) return;
			try {
				fitAddon.fit();
				if (terminalId) void desktopApi.resizeTerminal(terminalId, terminal.cols, terminal.rows).catch(() => undefined);
			} catch {
				// The panel can briefly have zero dimensions while it opens or closes.
			}
		};

		const resizeObserver = new ResizeObserver(fit);
		resizeObserver.observe(host);
		const input = terminal.onData((data) => {
			if (terminalId) {
				void desktopApi.writeTerminal(terminalId, data).catch((error) => {
					if (!disposed) setState({ phase: "error", message: describeError(error) });
				});
			}
		});

		setState({ phase: "starting" });
		void (async () => {
			try {
				unlistenOutput = await desktopApi.onTerminalOutput((payload) => {
					if (!terminalId) pendingOutput.push(payload);
					else if (payload.terminal_id === terminalId) terminal.write(Uint8Array.from(payload.data));
				});
				if (disposed) {
					unlistenOutput();
					unlistenOutput = null;
					return;
				}
				unlistenExit = await desktopApi.onTerminalExit((payload) => {
					if (!terminalId) pendingExits.push(payload);
					else if (payload.terminal_id === terminalId && !disposed) {
						setState({ phase: "exited", message: payload.reason });
					}
				});
				if (disposed) {
					unlistenOutput();
					unlistenExit();
					unlistenOutput = null;
					unlistenExit = null;
					return;
				}
				fit();
				const started = await desktopApi.startTerminal(workspaceRoot, terminal.cols, terminal.rows);
				if (disposed) {
					void desktopApi.stopTerminal(started.terminalId);
					return;
				}
				terminalId = started.terminalId;
				for (const payload of pendingOutput) {
					if (payload.terminal_id === terminalId) terminal.write(Uint8Array.from(payload.data));
				}
				pendingOutput = [];
				const earlyExit = pendingExits.find((payload) => payload.terminal_id === terminalId);
				if (earlyExit) {
					setState({ phase: "exited", message: earlyExit.reason });
				} else {
					setState({ phase: "running", shell: started.shell, pid: started.pid });
					fit();
					terminal.focus();
				}
			} catch (error) {
				unlistenOutput?.();
				unlistenExit?.();
				unlistenOutput = null;
				unlistenExit = null;
				if (!disposed) setState({ phase: "error", message: describeError(error) });
			}
		})();

		return () => {
			disposed = true;
			resizeObserver.disconnect();
			input.dispose();
			unlistenOutput?.();
			unlistenExit?.();
			if (terminalId) void desktopApi.stopTerminal(terminalId);
			terminal.dispose();
			if (terminalRef.current === terminal) terminalRef.current = null;
		};
	}, [restartKey, workspaceRoot]);

	const status = state.phase === "running"
		? `${state.shell}${state.pid ? ` · PID ${state.pid}` : ""}`
		: state.phase === "starting"
			? "Starting native PTY…"
			: state.phase === "exited"
				? `Exited · ${state.message}`
				: state.phase === "error"
					? state.message
					: "Choose a workspace to start a terminal.";

	return (
		<aside className="workspace-tool-panel terminal-panel" aria-label="Workspace terminal">
			<header className="tool-panel__header">
				<div>
					<p className="eyebrow">Terminal</p>
					<strong title={status}>{status}</strong>
				</div>
				<div className="tool-panel__actions">
					<button type="button" onClick={() => terminalRef.current?.clear()} disabled={!workspaceRoot}>Clear</button>
					<button type="button" onClick={() => setRestartKey((value) => value + 1)} disabled={!workspaceRoot || state.phase === "starting"}>Restart</button>
					<button type="button" className="tool-panel__close" onClick={onClose} title="Close terminal">×</button>
				</div>
			</header>
			{workspaceRoot ? <div className="terminal-panel__viewport" ref={hostRef} /> : <div className="tool-panel__empty">Choose a working directory first.</div>}
			{state.phase === "error" ? <p className="tool-panel__error" role="alert">{state.message}</p> : null}
		</aside>
	);
}
