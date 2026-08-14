export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "pi-theme";

export function readStoredTheme(): Theme {
	try {
		return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
	} catch {
		return "light";
	}
}

export function applyTheme(theme: Theme): void {
	document.documentElement.classList.toggle("dark", theme === "dark");
	document.documentElement.style.colorScheme = theme;
}

export function storeTheme(theme: Theme): void {
	try {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// Persistence can be unavailable in restricted webview contexts.
	}
}
