import type { MouseEvent } from "react";
import { desktopApi } from "../api/desktop-api";
import type { Theme } from "../theme";

type TitleBarProps = {
	theme: Theme;
	onToggleTheme: () => void;
};

function runWindowAction(action: () => Promise<void>): void {
	void action().catch((error: unknown) => {
		console.error("[pi-gui] window action failed", error);
	});
}

export function TitleBar({ theme, onToggleTheme }: TitleBarProps) {
	const startDragging = (event: MouseEvent<HTMLElement>) => {
		if (event.button !== 0 || event.detail !== 1) return;
		runWindowAction(desktopApi.startDragging);
	};

	const toggleMaximize = () => {
		runWindowAction(desktopApi.toggleMaximize);
	};

	return (
		<header className="titlebar">
			<div className="titlebar__brand" onMouseDown={startDragging} onDoubleClick={toggleMaximize}>
				<span className="brand-mark" aria-hidden="true">π</span>
				<span className="brand-name">Pi GUI</span>
				<span className="brand-badge">React shell</span>
			</div>

			<div className="titlebar__actions">
				<button
					type="button"
					className="theme-toggle"
					onClick={onToggleTheme}
					aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
					aria-pressed={theme === "dark"}
				>
					<span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
					<span>{theme === "dark" ? "Light" : "Dark"}</span>
				</button>

				<div className="window-controls" aria-label="Window controls">
					<button type="button" onClick={() => runWindowAction(desktopApi.minimize)} aria-label="Minimize">
						<span aria-hidden="true">−</span>
					</button>
					<button type="button" onClick={() => runWindowAction(desktopApi.toggleMaximize)} aria-label="Maximize or restore">
						<span className="maximize-icon" aria-hidden="true" />
					</button>
					<button className="window-control--close" type="button" onClick={() => runWindowAction(desktopApi.close)} aria-label="Close">
						<span aria-hidden="true">×</span>
					</button>
				</div>
			</div>
		</header>
	);
}
