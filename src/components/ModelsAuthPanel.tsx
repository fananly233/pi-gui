import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	desktopApi,
	type PiAuthProviderStatus,
	type PiAuthStatus,
	type PiOAuthProviderInfo,
} from "../api/desktop-api";
import type { ChatActivity } from "../chat/chat-types";
import type { PiChatController } from "../hooks/usePiChat";
import {
	formatProviderName,
	groupModelsByProvider,
	type PiModelConfiguration,
	type PiModelInfo,
	type PiThinkingLevel,
} from "../models/model-state";

type ModelsAuthChat = Pick<
	PiChatController,
	| "sessionReady"
	| "activeRuntimeKey"
	| "activity"
	| "configuringModel"
	| "sessionRuntimes"
	| "loadModelConfiguration"
	| "setModel"
	| "setThinkingLevel"
	| "disconnect"
>;

type ModelsAuthPanelProps = {
	open: boolean;
	onClose: () => void;
	chat: ModelsAuthChat;
};

type ProviderRow = Readonly<{
	id: string;
	name: string;
	oauth: PiOAuthProviderInfo | null;
	auth: PiAuthProviderStatus | null;
	modelCount: number;
}>;

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "The operation failed with an unknown error.";
}

function sameModel(left: PiModelInfo | null, right: PiModelInfo): boolean {
	return left?.provider === right.provider && left.id === right.id;
}

function formatTokenCount(value: number | null): string | null {
	if (value === null) return null;
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M ctx`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}K ctx`;
	return `${value} ctx`;
}

function authLabel(auth: PiAuthProviderStatus | null, modelCount: number): string {
	if (auth?.source === "environment") return "Environment credential";
	if (auth?.kind === "oauth") return "OAuth stored by Pi";
	if (auth) return "API credential stored by Pi";
	if (modelCount > 0) return "Available to Pi runtime";
	return "Not signed in";
}

export function ModelsAuthPanel({ open, onClose, chat }: ModelsAuthPanelProps) {
	const [tab, setTab] = useState<"models" | "providers">("models");
	const [query, setQuery] = useState("");
	const [configuration, setConfiguration] = useState<PiModelConfiguration | null>(null);
	const [authStatus, setAuthStatus] = useState<PiAuthStatus | null>(null);
	const [oauthProviders, setOauthProviders] = useState<PiOAuthProviderInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [mutation, setMutation] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [loginGuide, setLoginGuide] = useState<string | null>(null);
	const [logoutConfirmation, setLogoutConfirmation] = useState<string | null>(null);
	const refreshEpoch = useRef(0);

	const refresh = useCallback(async () => {
		const epoch = ++refreshEpoch.current;
		setLoading(true);
		setError(null);
		const [authResult, oauthResult, modelsResult] = await Promise.allSettled([
			desktopApi.getPiAuthStatus(),
			desktopApi.getPiOAuthProviders(),
			chat.sessionReady ? chat.loadModelConfiguration() : Promise.resolve<PiModelConfiguration | null>(null),
		]);
		if (epoch !== refreshEpoch.current) return;

		const failures: string[] = [];
		if (authResult.status === "fulfilled") setAuthStatus(authResult.value);
		else {
			setAuthStatus(null);
			failures.push(`Auth status: ${describeError(authResult.reason)}`);
		}
		if (oauthResult.status === "fulfilled") setOauthProviders(oauthResult.value);
		else {
			setOauthProviders([]);
			failures.push(`Provider catalog: ${describeError(oauthResult.reason)}`);
		}
		if (modelsResult.status === "fulfilled") setConfiguration(modelsResult.value);
		else {
			setConfiguration(null);
			failures.push(`Model catalog: ${describeError(modelsResult.reason)}`);
		}
		setError(failures.length > 0 ? failures.join(" ") : null);
		setLoading(false);
	}, [chat.loadModelConfiguration, chat.sessionReady]);

	useEffect(() => {
		if (!open) return;
		setNotice(null);
		setLoginGuide(null);
		setLogoutConfirmation(null);
		void refresh();
		return () => {
			refreshEpoch.current += 1;
		};
	}, [open, chat.activeRuntimeKey, chat.sessionReady, refresh]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !mutation) onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [mutation, onClose, open]);

	const modelGroups = useMemo(
		() => groupModelsByProvider(configuration?.models ?? [], query),
		[configuration?.models, query],
	);

	const providerRows = useMemo<ProviderRow[]>(() => {
		const rows = new Map<string, ProviderRow>();
		const ensure = (id: string, name?: string) => {
			const normalized = id.trim().toLocaleLowerCase();
			if (!normalized) return null;
			const current = rows.get(normalized) ?? {
				id: normalized,
				name: name?.trim() || formatProviderName(normalized),
				oauth: null,
				auth: null,
				modelCount: 0,
			};
			rows.set(normalized, current);
			return current;
		};

		for (const oauth of oauthProviders) {
			const row = ensure(oauth.id, oauth.name);
			if (row) rows.set(row.id, { ...row, name: oauth.name, oauth });
		}
		for (const auth of authStatus?.configuredProviders ?? []) {
			const row = ensure(auth.provider);
			if (row) rows.set(row.id, { ...row, auth });
		}
		for (const model of configuration?.models ?? []) {
			const row = ensure(model.provider);
			if (row) rows.set(row.id, { ...row, modelCount: row.modelCount + 1 });
		}
		return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name));
	}, [authStatus?.configuredProviders, configuration?.models, oauthProviders]);

	const authMutationBlocked = chat.sessionRuntimes.some((runtime) =>
		runtime.phase === "starting"
		|| runtime.phase === "switching"
		|| runtime.activity !== "idle"
		|| runtime.configuringModel,
	);
	const modelMutationBlocked = !chat.sessionReady || chat.activity !== "idle" || chat.configuringModel || Boolean(mutation);

	const chooseModel = async (model: PiModelInfo) => {
		if (modelMutationBlocked || sameModel(configuration?.currentModel ?? null, model)) return;
		setMutation(`model:${model.provider}/${model.id}`);
		setError(null);
		setNotice(null);
		try {
			const result = await chat.setModel(model);
			setConfiguration((current) => current ? { ...current, ...result } : current);
			setNotice(`Using ${result.currentModel.name} for this Pi session.`);
		} catch (operationError) {
			setError(describeError(operationError));
		} finally {
			setMutation(null);
		}
	};

	const chooseThinkingLevel = async (level: PiThinkingLevel) => {
		if (modelMutationBlocked || level === configuration?.thinkingLevel) return;
		setMutation(`thinking:${level}`);
		setError(null);
		setNotice(null);
		try {
			const accepted = await chat.setThinkingLevel(level);
			setConfiguration((current) => current ? { ...current, thinkingLevel: accepted } : current);
			setNotice(`Thinking level set to ${accepted}.`);
		} catch (operationError) {
			setError(describeError(operationError));
		} finally {
			setMutation(null);
		}
	};

	const clearProvider = async (provider: string) => {
		if (authMutationBlocked || mutation) return;
		setMutation(`auth:${provider}`);
		setError(null);
		setNotice(null);
		try {
			const result = await desktopApi.clearPiProviderAuth(provider);
			if (!result.removed) throw new Error(`Pi has no stored ${provider} credential to remove.`);
			await chat.disconnect();
			setConfiguration(null);
			setAuthStatus(await desktopApi.getPiAuthStatus());
			setLogoutConfirmation(null);
			setNotice(`${formatProviderName(provider)} was removed from Pi auth. Reconnect the workspace before chatting.`);
		} catch (operationError) {
			setError(describeError(operationError));
		} finally {
			setMutation(null);
		}
	};

	if (!open) return null;

	return (
		<div className="models-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !mutation && onClose()}>
			<section className="models-modal__card" role="dialog" aria-modal="true" aria-labelledby="models-auth-title">
				<header>
					<div>
						<p className="eyebrow eyebrow--accent">Pi runtime</p>
						<h3 id="models-auth-title">Models & authentication</h3>
						<span>Model and thinking choices belong to the active Pi session. Credentials remain owned by Pi.</span>
					</div>
					<div className="models-modal__header-actions">
						<button type="button" className="button button--secondary" onClick={() => void refresh()} disabled={loading || Boolean(mutation)}>
							{loading ? "Refreshing…" : "Refresh"}
						</button>
						<button type="button" className="icon-button" onClick={onClose} aria-label="Close models and authentication" disabled={Boolean(mutation)}>×</button>
					</div>
				</header>

				<div className="models-tabs" role="tablist" aria-label="Models and providers">
					<button type="button" role="tab" aria-selected={tab === "models"} className={tab === "models" ? "is-active" : ""} onClick={() => setTab("models")}>Models</button>
					<button type="button" role="tab" aria-selected={tab === "providers"} className={tab === "providers" ? "is-active" : ""} onClick={() => setTab("providers")}>Providers & auth</button>
				</div>

				{error ? <p className="models-modal__message models-modal__message--error" role="alert">{error}</p> : null}
				{notice ? <p className="models-modal__message models-modal__message--success" role="status">{notice}</p> : null}

				{tab === "models" ? (
					<div className="models-pane">
						{configuration ? (
							<>
								<section className="current-model-card" aria-label="Current model">
									<div>
										<span>Current model</span>
										<strong>{configuration.currentModel?.name ?? "No model selected"}</strong>
										<small>{configuration.currentModel ? `${configuration.currentModel.provider}/${configuration.currentModel.id}` : "Pi did not report an active model."}</small>
									</div>
									<div className="thinking-levels" aria-label="Thinking level">
										<span>Thinking</span>
										<div>
											{configuration.thinkingLevels.map((level) => (
												<button key={level} type="button" className={level === configuration.thinkingLevel ? "is-active" : ""} disabled={modelMutationBlocked} onClick={() => void chooseThinkingLevel(level)}>{level}</button>
											))}
										</div>
									</div>
								</section>

								<input className="model-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${configuration.models.length} available models…`} aria-label="Search available models" />
								<div className="model-groups">
									{modelGroups.map((group) => (
										<section className="model-group" key={group.provider}>
											<header><strong>{group.label}</strong><span>{group.models.length}</span></header>
											<div>
												{group.models.map((model) => {
													const current = sameModel(configuration.currentModel, model);
													const context = formatTokenCount(model.contextWindow);
													return (
														<button key={`${model.provider}/${model.id}`} type="button" className={`model-option${current ? " is-active" : ""}`} disabled={modelMutationBlocked || current} onClick={() => void chooseModel(model)}>
															<span><strong>{model.name}</strong><small>{model.id}</small></span>
															<span>{model.reasoning ? "Reasoning" : "Standard"}{context ? ` · ${context}` : ""}</span>
															{current ? <b>Current</b> : null}
														</button>
													);
												})}
											</div>
										</section>
									))}
									{modelGroups.length === 0 ? <p className="models-empty">No available model matches “{query}”.</p> : null}
								</div>
							</>
						) : (
							<div className="models-empty">
								<strong>{loading ? "Reading Pi model state…" : "Select or create a session first"}</strong>
								<span>Provider authentication can still be inspected in the adjacent tab.</span>
							</div>
						)}
					</div>
				) : (
					<div className="providers-pane">
						<div className="auth-boundary-note">
							<strong>Pi owns credentials</strong>
							<span>This GUI reads provider names and credential types only. It never displays tokens or model headers.</span>
						</div>
						{providerRows.map((provider) => {
							const storedAuth = provider.auth?.source.startsWith("auth_file_") === true;
							return (
								<section className="provider-row" key={provider.id}>
									<div className="provider-row__identity"><strong>{provider.name}</strong><code>{provider.id}</code></div>
									<div className="provider-row__state"><span className={`status-dot status-dot--${provider.auth || provider.modelCount > 0 ? "ready" : "muted"}`} /><span>{authLabel(provider.auth, provider.modelCount)}</span>{provider.modelCount > 0 ? <small>{provider.modelCount} models</small> : null}</div>
									<div className="provider-row__actions">
										{storedAuth ? (
											logoutConfirmation === provider.id ? (
												<><span className="provider-row__confirm-note">Removes Pi’s stored credential and disconnects sessions.</span><button type="button" className="button button--danger" disabled={authMutationBlocked || Boolean(mutation)} onClick={() => void clearProvider(provider.id)}>{mutation === `auth:${provider.id}` ? "Removing…" : "Confirm"}</button><button type="button" className="button button--secondary" disabled={Boolean(mutation)} onClick={() => setLogoutConfirmation(null)}>Cancel</button></>
											) : <button type="button" className="button button--secondary" disabled={authMutationBlocked || Boolean(mutation)} onClick={() => setLogoutConfirmation(provider.id)}>{provider.auth?.kind === "oauth" ? "Log out" : "Remove key"}</button>
										) : provider.oauth && !provider.auth ? (
											<button type="button" className="button button--secondary" onClick={() => setLoginGuide(provider.id)}>Login guide</button>
										) : null}
									</div>
								</section>
							);
						})}
						{providerRows.length === 0 && !loading ? <p className="models-empty">Pi reported no configured or OAuth-capable providers.</p> : null}
						{authMutationBlocked ? <p className="auth-warning">Credential removal is disabled while any Pi session is starting, switching, configuring, or running.</p> : null}
						{loginGuide ? (
							<section className="login-guide" aria-label={`${formatProviderName(loginGuide)} login guide`}>
								<div><strong>Sign in to {formatProviderName(loginGuide)}</strong><button type="button" className="icon-button" aria-label="Close login guide" onClick={() => setLoginGuide(null)}>×</button></div>
								<ol><li>Open a terminal and run <code>pi</code>.</li><li>Enter <code>/login</code> and choose this provider.</li><li>Complete Pi’s interactive flow, return here, then press Refresh.</li></ol>
								<p>Pi RPC 0.84.2 does not expose interactive login. This keeps OAuth prompts and tokens inside Pi instead of adding an Electron/Node auth host.</p>
							</section>
						) : null}
					</div>
				)}
			</section>
		</div>
	);
}
