import { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi, type DesktopSessionInfo } from "../api/desktop-api";
import type { ChatActivity, ChatDelivery, ChatMessage, PiConnectionState } from "../chat/chat-types";
import { EventNormalizer, type NormalizedPiEvent } from "../pi/event-normalizer";
import { PiAdapter, type PiAdapterEvent, type PiForkOption } from "../pi/pi-adapter";
import { parseSessionMessages } from "../sessions/session-message-parser";
import {
	SessionSelectionGuard,
	isSessionRuntimeTransitioning,
	normalizeFsPath,
	sessionBelongsToWorkspace,
	sessionInstanceId,
	sessionRuntimeKey,
	type SessionRuntimeSnapshot,
} from "../sessions/session-runtime-state";

type SessionRuntimeRecord = {
	key: string;
	adapter: PiAdapter;
	normalizer: EventNormalizer;
	snapshot: SessionRuntimeSnapshot;
	unlisten: () => void;
	intentionalStop: boolean;
	readyPromise: Promise<SessionRuntimeRecord> | null;
};

type SessionAction = Readonly<{
	type: "rename" | "delete" | "fork";
	path: string;
}>;

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "Pi returned an unknown error.";
}

function replaceMessage(messages: ChatMessage[], id: string, update: (message: ChatMessage) => ChatMessage): ChatMessage[] {
	const index = messages.findIndex((message) => message.id === id);
	if (index === -1) return messages;
	const next = [...messages];
	next[index] = update(next[index]);
	return next;
}

function createSnapshot(key: string, cwd: string, phase: SessionRuntimeSnapshot["phase"]): SessionRuntimeSnapshot {
	return {
		key,
		cwd,
		sessionPath: null,
		sessionId: null,
		sessionName: null,
		discovery: "",
		phase,
		activity: "idle",
		messages: [],
		queue: { steering: [], followUp: [] },
		sending: false,
		aborting: false,
		lastError: null,
	};
}

function applyNormalizedEvent(snapshot: SessionRuntimeSnapshot, event: NormalizedPiEvent): SessionRuntimeSnapshot {
	switch (event.type) {
		case "run_started":
			return { ...snapshot, activity: "running", lastError: null };
		case "run_settled":
			return {
				...snapshot,
				activity: "idle",
				aborting: false,
				messages: snapshot.messages.map((message) =>
					message.role === "assistant" && message.status === "streaming" ? { ...message, status: "complete" } : message,
				),
			};
		case "retry_started":
			return { ...snapshot, activity: "retrying", lastError: event.message };
		case "assistant_started":
			if (snapshot.messages.some((message) => message.id === event.messageId)) return snapshot;
			return {
				...snapshot,
				messages: [...snapshot.messages, { id: event.messageId, role: "assistant", text: "", thinking: "", status: "streaming" }],
			};
		case "assistant_text_delta":
			return {
				...snapshot,
				messages: replaceMessage(snapshot.messages, event.messageId, (message) =>
					message.role === "assistant" ? { ...message, text: message.text + event.delta } : message,
				),
			};
		case "assistant_thinking_delta":
			return {
				...snapshot,
				messages: replaceMessage(snapshot.messages, event.messageId, (message) =>
					message.role === "assistant" ? { ...message, thinking: message.thinking + event.delta } : message,
				),
			};
		case "assistant_reconciled": {
			const messages = !event.text && !event.thinking && event.status === "complete"
				? snapshot.messages.filter((message) => message.id !== event.messageId)
				: replaceMessage(snapshot.messages, event.messageId, (message) =>
						message.role === "assistant"
							? {
									...message,
									text: event.text,
									thinking: event.thinking,
									status: event.status,
									...(event.error ? { error: event.error } : {}),
							  }
							: message,
				  );
			return { ...snapshot, messages, ...(event.error ? { lastError: event.error } : {}) };
		}
		case "tool_started": {
			const tool = {
				id: event.toolCallId,
				role: "tool" as const,
				name: event.name,
				args: event.args,
				output: "",
				status: "running" as const,
			};
			return {
				...snapshot,
				messages: snapshot.messages.some((message) => message.id === event.toolCallId)
					? replaceMessage(snapshot.messages, event.toolCallId, () => tool)
					: [...snapshot.messages, tool],
			};
		}
		case "tool_updated":
			return {
				...snapshot,
				messages: replaceMessage(snapshot.messages, event.toolCallId, (message) =>
					message.role === "tool" ? { ...message, output: event.output } : message,
				),
			};
		case "tool_finished":
			return {
				...snapshot,
				messages: replaceMessage(snapshot.messages, event.toolCallId, (message) =>
					message.role === "tool"
						? { ...message, output: event.output || message.output, status: event.isError ? "error" : "complete" }
						: message,
				),
			};
		case "queue_updated":
			return { ...snapshot, queue: { steering: event.steering, followUp: event.followUp } };
		case "extension_error":
			return { ...snapshot, lastError: event.message };
	}
}

function defaultForkName(session: DesktopSessionInfo): string {
	const base = session.name?.trim() || "session";
	return `fork-${base}`.slice(0, 80);
}

export function usePiChat() {
	const mounted = useRef(true);
	const runtimesRef = useRef(new Map<string, SessionRuntimeRecord>());
	const selection = useRef(new SessionSelectionGuard());
	const workspaceRef = useRef<string | null>(null);
	const listEpoch = useRef(0);
	const connectionEpoch = useRef(0);
	const draftSequence = useRef(0);
	const userSequence = useRef(0);
	const composerSequence = useRef(0);
	const [connection, setConnection] = useState<PiConnectionState>({ status: "disconnected" });
	const [runtimeSnapshots, setRuntimeSnapshots] = useState(new Map<string, SessionRuntimeSnapshot>());
	const [activeRuntimeKey, setActiveRuntimeKey] = useState<string | null>(null);
	const [selectingRuntimeKey, setSelectingRuntimeKey] = useState<string | null>(null);
	const [sessions, setSessions] = useState<DesktopSessionInfo[]>([]);
	const [sessionsLoading, setSessionsLoading] = useState(false);
	const [sessionsError, setSessionsError] = useState<string | null>(null);
	const [sessionAction, setSessionAction] = useState<SessionAction | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [composerSeed, setComposerSeed] = useState<{ id: number; text: string } | null>(null);

	const publishRuntime = useCallback((record: SessionRuntimeRecord) => {
		if (!mounted.current) return;
		setRuntimeSnapshots((current) => {
			const next = new Map(current);
			next.set(record.key, record.snapshot);
			return next;
		});
	}, []);

	const updateRuntime = useCallback(
		(key: string, update: (snapshot: SessionRuntimeSnapshot) => SessionRuntimeSnapshot) => {
			const record = runtimesRef.current.get(key);
			if (!record) return;
			record.snapshot = update(record.snapshot);
			publishRuntime(record);
		},
		[publishRuntime],
	);

	const loadSessions = useCallback(async (workspace: string, showLoading: boolean) => {
		const requestEpoch = ++listEpoch.current;
		if (showLoading && mounted.current) setSessionsLoading(true);
		if (mounted.current) setSessionsError(null);
		try {
			const allSessions = await desktopApi.listSessions();
			if (requestEpoch !== listEpoch.current || normalizeFsPath(workspaceRef.current) !== normalizeFsPath(workspace)) return;
			const workspaceSessions = allSessions.filter((session) => sessionBelongsToWorkspace(session.cwd, workspace));
			setSessions(workspaceSessions);
		} catch (error) {
			if (requestEpoch !== listEpoch.current) return;
			setSessionsError(describeError(error));
			throw error;
		} finally {
			if (requestEpoch === listEpoch.current && mounted.current) setSessionsLoading(false);
		}
	}, []);

	const refreshSessions = useCallback(async () => {
		const workspace = workspaceRef.current;
		if (!workspace) return;
		try {
			await loadSessions(workspace, false);
		} catch {
			// The current list remains usable and the refresh error is displayed in the sidebar.
		}
	}, [loadSessions]);

	const syncRuntimeIdentity = useCallback(
		async (key: string) => {
			const record = runtimesRef.current.get(key);
			if (!record || !record.adapter.isConnected) return;
			try {
				const state = await record.adapter.getState();
				if (runtimesRef.current.get(key) !== record) return;
				updateRuntime(key, (snapshot) => ({
					...snapshot,
					sessionPath: state.sessionFile ?? snapshot.sessionPath,
					sessionId: state.sessionId || snapshot.sessionId,
					sessionName: state.sessionName ?? snapshot.sessionName,
					activity: state.isStreaming ? "running" : snapshot.activity,
				}));
				await refreshSessions();
			} catch (error) {
				if (runtimesRef.current.get(key) === record) {
					updateRuntime(key, (snapshot) => ({ ...snapshot, lastError: describeError(error) }));
				}
			}
		},
		[refreshSessions, updateRuntime],
	);

	const handleAdapterEvent = useCallback(
		(key: string, adapterEvent: PiAdapterEvent) => {
			const record = runtimesRef.current.get(key);
			if (!record) return;
			if (adapterEvent.type === "rpc_event") {
				const normalized = record.normalizer.normalize(adapterEvent.event);
				for (const event of normalized) updateRuntime(key, (snapshot) => applyNormalizedEvent(snapshot, event));
				if (normalized.some((event) => event.type === "run_settled")) void syncRuntimeIdentity(key);
				return;
			}
			if (adapterEvent.type === "rpc_protocol_error") {
				updateRuntime(key, (snapshot) => ({ ...snapshot, lastError: `Pi emitted invalid JSONL: ${adapterEvent.line.slice(0, 160)}` }));
				return;
			}
			if (adapterEvent.type === "rpc_disconnected" && !record.intentionalStop) {
				updateRuntime(key, (snapshot) => ({
					...snapshot,
					phase: "failed",
					activity: "idle",
					aborting: false,
					lastError: adapterEvent.reason,
				}));
			}
		},
		[syncRuntimeIdentity, updateRuntime],
	);

	const createRuntime = useCallback(
		(key: string, cwd: string, phase: SessionRuntimeSnapshot["phase"] = "starting") => {
			const adapter = new PiAdapter(sessionInstanceId(key));
			const record: SessionRuntimeRecord = {
				key,
				adapter,
				normalizer: new EventNormalizer(),
				snapshot: createSnapshot(key, cwd, phase),
				unlisten: () => undefined,
				intentionalStop: false,
				readyPromise: null,
			};
			record.unlisten = adapter.onEvent((event) => handleAdapterEvent(key, event));
			runtimesRef.current.set(key, record);
			publishRuntime(record);
			return record;
		},
		[handleAdapterEvent, publishRuntime],
	);

	const removeRuntime = useCallback(async (record: SessionRuntimeRecord) => {
		if (runtimesRef.current.get(record.key) !== record) return;
		runtimesRef.current.delete(record.key);
		record.intentionalStop = true;
		record.unlisten();
		if (mounted.current) {
			setRuntimeSnapshots((current) => {
				const next = new Map(current);
				next.delete(record.key);
				return next;
			});
		}
		await record.adapter.dispose().catch(() => undefined);
	}, []);

	const disposeAllRuntimes = useCallback(async () => {
		const records = [...runtimesRef.current.values()];
		runtimesRef.current.clear();
		for (const record of records) {
			record.intentionalStop = true;
			record.unlisten();
		}
		if (mounted.current) setRuntimeSnapshots(new Map());
		await Promise.all(records.map((record) => record.adapter.dispose().catch(() => undefined)));
	}, []);

	const findRuntimeByPath = useCallback((sessionPath: string): SessionRuntimeRecord | null => {
		const normalized = normalizeFsPath(sessionPath);
		for (const record of runtimesRef.current.values()) {
			if (normalizeFsPath(record.snapshot.sessionPath) === normalized) return record;
		}
		return null;
	}, []);

	const initializePersistedRuntime = useCallback(
		(record: SessionRuntimeRecord, session: DesktopSessionInfo) => {
			const initialize = (async () => {
				try {
					const start = await record.adapter.start({ cwd: record.snapshot.cwd });
					updateRuntime(record.key, (snapshot) => ({ ...snapshot, discovery: start.discovery, phase: "switching" }));
					const switched = await record.adapter.switchSession(session.path);
					if (switched.cancelled) throw new Error("Pi cancelled the session switch.");
					const [state, rawMessages] = await Promise.all([record.adapter.getState(), record.adapter.getMessages()]);
					if (runtimesRef.current.get(record.key) !== record) throw new Error("Session runtime was replaced while loading.");
					if (normalizeFsPath(state.sessionFile) !== normalizeFsPath(session.path)) {
						throw new Error(`Pi opened a different session than requested: ${state.sessionFile ?? "unknown"}`);
					}
					record.normalizer.reset();
					updateRuntime(record.key, (snapshot) => ({
						...snapshot,
						phase: "ready",
						sessionPath: state.sessionFile ?? session.path,
						sessionId: state.sessionId || session.id,
						sessionName: state.sessionName ?? session.name,
						activity: state.isStreaming ? "running" : "idle",
						messages: parseSessionMessages(rawMessages),
						lastError: null,
					}));
					return record;
				} catch (error) {
					if (runtimesRef.current.get(record.key) === record) {
						updateRuntime(record.key, (snapshot) => ({ ...snapshot, phase: "failed", lastError: describeError(error) }));
					}
					throw error;
				}
			})();
			record.readyPromise = initialize;
			return initialize;
		},
		[updateRuntime],
	);

	const ensurePersistedRuntime = useCallback(
		async (session: DesktopSessionInfo): Promise<SessionRuntimeRecord> => {
			let record = findRuntimeByPath(session.path) ?? runtimesRef.current.get(sessionRuntimeKey(session.path)) ?? null;
			if (record?.snapshot.phase === "ready" && record.adapter.isConnected) return record;
			if (record?.readyPromise && record.snapshot.phase !== "failed") return record.readyPromise;
			if (record) await removeRuntime(record);

			const workspace = workspaceRef.current;
			const cwd = session.cwd?.trim() || workspace;
			if (!cwd) throw new Error("The session has no working directory.");
			record = createRuntime(sessionRuntimeKey(session.path), cwd);
			return initializePersistedRuntime(record, session);
		},
		[createRuntime, findRuntimeByPath, initializePersistedRuntime, removeRuntime],
	);

	const connect = useCallback(
		async (cwd: string) => {
			const workspace = cwd.trim();
			if (!workspace) {
				setConnection({ status: "error", message: "Choose a working directory before connecting Pi." });
				return;
			}

			const epoch = ++connectionEpoch.current;
			selection.current.invalidate();
			workspaceRef.current = workspace;
			setActiveRuntimeKey(null);
			setSelectingRuntimeKey(null);
			setActionError(null);
			setComposerSeed({ id: ++composerSequence.current, text: "" });
			setConnection({ status: "connecting" });
			setSessions([]);
			await disposeAllRuntimes();

			try {
				await loadSessions(workspace, true);
				if (epoch !== connectionEpoch.current || normalizeFsPath(workspaceRef.current) !== normalizeFsPath(workspace)) return;
				setConnection({ status: "connected", discovery: "Pi session index ready" });
			} catch (error) {
				if (epoch === connectionEpoch.current) setConnection({ status: "error", message: describeError(error) });
			}
		},
		[disposeAllRuntimes, loadSessions],
	);

	const disconnect = useCallback(async () => {
		connectionEpoch.current += 1;
		listEpoch.current += 1;
		selection.current.invalidate();
		workspaceRef.current = null;
		setActiveRuntimeKey(null);
		setSelectingRuntimeKey(null);
		setSessionAction(null);
		setActionError(null);
		setComposerSeed({ id: ++composerSequence.current, text: "" });
		setSessions([]);
		setSessionsError(null);
		setSessionsLoading(false);
		await disposeAllRuntimes();
		if (mounted.current) setConnection({ status: "disconnected" });
	}, [disposeAllRuntimes]);

	const selectSession = useCallback(
		async (session: DesktopSessionInfo) => {
			if (!workspaceRef.current) return;
			const key = sessionRuntimeKey(session.path);
			const ticket = selection.current.begin(key);
			setSelectingRuntimeKey(key);
			setActionError(null);
			try {
				const record = await ensurePersistedRuntime(session);
				if (!selection.current.commit(ticket)) return;
				setActiveRuntimeKey(record.key);
				setComposerSeed({ id: ++composerSequence.current, text: "" });
				setConnection({ status: "connected", discovery: record.snapshot.discovery || "Pi session ready" });
			} catch (error) {
				if (selection.current.isCurrent(ticket)) setActionError(describeError(error));
			} finally {
				if (selection.current.isCurrent(ticket)) setSelectingRuntimeKey(null);
			}
		},
		[ensurePersistedRuntime],
	);

	const newSession = useCallback(async () => {
		const workspace = workspaceRef.current;
		if (!workspace || sessionsLoading) return;
		const key = `draft:${Date.now().toString(36)}:${++draftSequence.current}`;
		const ticket = selection.current.begin(key);
		const record = createRuntime(key, workspace);
		setSelectingRuntimeKey(key);
		setActionError(null);

		try {
			const start = await record.adapter.start({ cwd: workspace });
			updateRuntime(key, (snapshot) => ({ ...snapshot, discovery: start.discovery, phase: "switching" }));
			const created = await record.adapter.newSession();
			if (created.cancelled) throw new Error("Pi cancelled the new session.");
			const [state, rawMessages] = await Promise.all([record.adapter.getState(), record.adapter.getMessages()]);
			record.normalizer.reset();
			updateRuntime(key, (snapshot) => ({
				...snapshot,
				phase: "ready",
				sessionPath: state.sessionFile ?? null,
				sessionId: state.sessionId || null,
				sessionName: state.sessionName ?? null,
				messages: parseSessionMessages(rawMessages),
				lastError: null,
			}));
			if (selection.current.commit(ticket)) {
				setActiveRuntimeKey(key);
				setComposerSeed({ id: ++composerSequence.current, text: "" });
				setConnection({ status: "connected", discovery: start.discovery });
			}
			await refreshSessions();
		} catch (error) {
			updateRuntime(key, (snapshot) => ({ ...snapshot, phase: "failed", lastError: describeError(error) }));
			if (selection.current.isCurrent(ticket)) setActionError(describeError(error));
		} finally {
			if (selection.current.isCurrent(ticket)) setSelectingRuntimeKey(null);
		}
	}, [createRuntime, refreshSessions, sessionsLoading, updateRuntime]);

	const renameSession = useCallback(
		async (session: DesktopSessionInfo, nextName: string) => {
			const name = nextName.trim();
			if (!name) throw new Error("Session name cannot be empty.");
			setSessionAction({ type: "rename", path: session.path });
			setActionError(null);
			try {
				const record = await ensurePersistedRuntime(session);
				await record.adapter.setSessionName(name);
				updateRuntime(record.key, (snapshot) => ({ ...snapshot, sessionName: name }));
				setSessions((current) => current.map((entry) => (normalizeFsPath(entry.path) === normalizeFsPath(session.path) ? { ...entry, name } : entry)));
				await refreshSessions();
			} catch (error) {
				setActionError(describeError(error));
				throw error;
			} finally {
				setSessionAction(null);
			}
		},
		[ensurePersistedRuntime, refreshSessions, updateRuntime],
	);

	const deleteSession = useCallback(
		async (session: DesktopSessionInfo) => {
			setSessionAction({ type: "delete", path: session.path });
			setActionError(null);
		try {
			const record = findRuntimeByPath(session.path);
			if (record && (record.snapshot.activity !== "idle" || isSessionRuntimeTransitioning(record.snapshot.phase))) {
				throw new Error("Wait for this session to finish opening or running before deleting it.");
			}
				if (record) {
					if (activeRuntimeKey === record.key) {
						selection.current.invalidate();
						setActiveRuntimeKey(null);
						setComposerSeed({ id: ++composerSequence.current, text: "" });
					}
					await removeRuntime(record);
				}
				await desktopApi.deleteSession(session.path);
				setSessions((current) => current.filter((entry) => normalizeFsPath(entry.path) !== normalizeFsPath(session.path)));
				await refreshSessions();
			} catch (error) {
				setActionError(describeError(error));
				throw error;
			} finally {
				setSessionAction(null);
			}
		},
		[activeRuntimeKey, findRuntimeByPath, refreshSessions, removeRuntime],
	);

	const loadForkOptions = useCallback(
		async (session: DesktopSessionInfo): Promise<PiForkOption[]> => {
			setActionError(null);
			try {
				const record = await ensurePersistedRuntime(session);
				if (record.snapshot.activity !== "idle") throw new Error("Wait for this session to finish before forking it.");
				return await record.adapter.getForkMessages();
			} catch (error) {
				setActionError(describeError(error));
				throw error;
			}
		},
		[ensurePersistedRuntime],
	);

	const forkSession = useCallback(
		async (session: DesktopSessionInfo, option: PiForkOption) => {
			const workspace = session.cwd?.trim() || workspaceRef.current;
			if (!workspace) throw new Error("The source session has no working directory.");
			const key = `fork:${Date.now().toString(36)}:${++draftSequence.current}`;
			const ticket = selection.current.begin(key);
			const record = createRuntime(key, workspace);
			setSelectingRuntimeKey(key);
			setSessionAction({ type: "fork", path: session.path });
			setActionError(null);

			try {
				const start = await record.adapter.start({ cwd: workspace });
				updateRuntime(key, (snapshot) => ({ ...snapshot, discovery: start.discovery, phase: "switching" }));
				const switched = await record.adapter.switchSession(session.path);
				if (switched.cancelled) throw new Error("Pi cancelled the source session switch.");
				const forked = await record.adapter.fork(option.entryId);
				if (forked.cancelled) throw new Error("Pi cancelled the session fork.");
				const forkName = defaultForkName(session);
				await record.adapter.setSessionName(forkName);
				const [state, rawMessages] = await Promise.all([record.adapter.getState(), record.adapter.getMessages()]);
				record.normalizer.reset();
				updateRuntime(key, (snapshot) => ({
					...snapshot,
					phase: "ready",
					sessionPath: state.sessionFile ?? null,
					sessionId: state.sessionId || null,
					sessionName: state.sessionName ?? forkName,
					messages: parseSessionMessages(rawMessages),
					lastError: null,
				}));
				if (selection.current.commit(ticket)) {
					setActiveRuntimeKey(key);
					setConnection({ status: "connected", discovery: start.discovery });
					setComposerSeed({ id: ++composerSequence.current, text: forked.text || option.text });
				}
				await refreshSessions();
			} catch (error) {
				updateRuntime(key, (snapshot) => ({ ...snapshot, phase: "failed", lastError: describeError(error) }));
				if (selection.current.isCurrent(ticket)) setActionError(describeError(error));
				throw error;
			} finally {
				if (selection.current.isCurrent(ticket)) setSelectingRuntimeKey(null);
				setSessionAction(null);
			}
		},
		[createRuntime, refreshSessions, updateRuntime],
	);

	const send = useCallback(
		async (text: string, requestedDelivery: ChatDelivery) => {
			const key = selection.current.activeKey;
			const record = key ? runtimesRef.current.get(key) : null;
			const message = text.trim();
			if (!key || !record || record.snapshot.phase !== "ready" || !message) return;
			const delivery: ChatDelivery = record.snapshot.activity === "idle"
				? "prompt"
				: requestedDelivery === "prompt"
					? "steer"
					: requestedDelivery;
			const id = `user-${++userSequence.current}`;
			updateRuntime(key, (snapshot) => ({
				...snapshot,
				messages: [...snapshot.messages, { id, role: "user", text: message, delivery, status: "accepted" }],
				lastError: null,
				sending: true,
				activity: delivery === "prompt" ? "running" : snapshot.activity,
			}));

			try {
				if (delivery === "steer") await record.adapter.steer(message);
				else if (delivery === "followUp") await record.adapter.followUp(message);
				else await record.adapter.prompt(message);
			} catch (error) {
				updateRuntime(key, (snapshot) => ({
					...snapshot,
					messages: replaceMessage(snapshot.messages, id, (entry) => (entry.role === "user" ? { ...entry, status: "failed" } : entry)),
					lastError: describeError(error),
					activity: delivery === "prompt" ? "idle" : snapshot.activity,
				}));
			} finally {
				updateRuntime(key, (snapshot) => ({ ...snapshot, sending: false }));
			}
		},
		[updateRuntime],
	);

	const abort = useCallback(async () => {
		const key = selection.current.activeKey;
		const record = key ? runtimesRef.current.get(key) : null;
		if (!key || !record || record.snapshot.phase !== "ready" || record.snapshot.activity === "idle") return;
		updateRuntime(key, (snapshot) => ({ ...snapshot, aborting: true, lastError: null }));
		try {
			await record.adapter.abort();
		} catch (error) {
			updateRuntime(key, (snapshot) => ({ ...snapshot, aborting: false, lastError: describeError(error) }));
		}
	}, [updateRuntime]);

	const clearError = useCallback(() => {
		setActionError(null);
		const key = selection.current.activeKey;
		if (key) updateRuntime(key, (snapshot) => ({ ...snapshot, lastError: null }));
	}, [updateRuntime]);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			connectionEpoch.current += 1;
			listEpoch.current += 1;
			selection.current.invalidate();
			void disposeAllRuntimes();
		};
	}, [disposeAllRuntimes]);

	const activeSnapshot = activeRuntimeKey ? runtimeSnapshots.get(activeRuntimeKey) ?? null : null;
	const activity: ChatActivity = activeSnapshot?.activity ?? "idle";
	const activeSessionPath = activeSnapshot?.sessionPath ?? null;
	const listedActiveSession = activeSessionPath
		? sessions.find((session) => normalizeFsPath(session.path) === normalizeFsPath(activeSessionPath)) ?? null
		: null;
	const activeSessionName = activeSnapshot?.sessionName
		?? listedActiveSession?.name
		?? (listedActiveSession
			? `Session ${listedActiveSession.id.slice(0, 8)}`
			: activeRuntimeKey?.startsWith("draft:")
				? "New session"
				: null);
	const sessionReady = connection.status === "connected" && activeSnapshot?.phase === "ready";
	const sessionRuntimes = [...runtimeSnapshots.values()].map((snapshot) => ({
		key: snapshot.key,
		sessionPath: snapshot.sessionPath,
		phase: snapshot.phase,
		activity: snapshot.activity,
	}));

	return {
		connection,
		activity,
		messages: activeSnapshot?.messages ?? [],
		queue: activeSnapshot?.queue ?? { steering: [], followUp: [] },
		sending: activeSnapshot?.sending ?? false,
		aborting: activeSnapshot?.aborting ?? false,
		lastError: activeSnapshot?.lastError ?? actionError,
		workspacePath: workspaceRef.current,
		sessions,
		sessionsLoading,
		sessionsError,
		sessionActionError: actionError,
		sessionAction,
		sessionRuntimes,
		selectingRuntimeKey,
		activeRuntimeKey,
		activeSessionPath,
		activeSessionName,
		activeRuntimePhase: activeSnapshot?.phase ?? null,
		sessionReady,
		composerSeed,
		connect,
		disconnect,
		refreshSessions,
		newSession,
		selectSession,
		renameSession,
		deleteSession,
		loadForkOptions,
		forkSession,
		send,
		abort,
		clearError,
	};
}

export type PiChatController = ReturnType<typeof usePiChat>;
