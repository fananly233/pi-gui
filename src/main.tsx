import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";
import { applyTheme, readStoredTheme } from "./theme";

applyTheme(readStoredTheme());

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing");

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
