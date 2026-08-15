import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
	normalizePiModel,
	normalizePiModels,
	normalizeThinkingLevel,
	normalizeThinkingLevels,
	type PiModelInfo,
	type PiThinkingLevel,
} from "../models/model-state";
import { normalizePiCommands, type PiCommandInfo } from "./ecosystem";
import type { JsonObject } from "./event-normalizer";

export type StreamingBehavior = "steer" | "followUp";

export type PiImageInput = Readonly<{
	type: "image";
	data: string;
	mimeType: string;
}>;

export type PiStartOptions = Readonly<{
	cwd: string;
	provider?: string;
	model?: string;
	piPath?: string;
}>;

export type PiAdapterEvent =
	| { type: "rpc_event"; event: JsonObject }
	| { type: "rpc_disconnected"; reason: string }
	| { type: "rpc_protocol_error"; line: string }
	| { type: "rpc_stderr"; line: string };

export type PiSessionState = Readonly<{
	model: PiModelInfo | null;
	thinkingLevel: PiThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	messageCount: number;
	pendingMessageCount: number;
}>;

export type PiForkOption = Readonly<{
	entryId: string;
	text: string;
}>;

type RpcLinePayload = {
	instance_id?: string;
	instanceId?: string;
	generation?: number;
	line?: string;
};

type RpcClosedPayload = {
	instance_id?: string;
	instanceId?: string;
	generation?: number;
	reason?: string;
};

type RpcStartResult = {
	discovery: string;
	generation: number;
};

type PendingRequest = {
	resolve: (response: JsonObject) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
};

type BufferedEnvelope =
	| { kind: "line"; payload: RpcLinePayload }
	| { kind: "closed"; payload: RpcClosedPayload }
	| { kind: "stderr"; payload: RpcLinePayload };

function payloadInstanceId(payload: RpcLinePayload | RpcClosedPayload): string {
	return (payload.instance_id ?? payload.instanceId ?? "default").trim() || "default";
}

function payloadGeneration(payload: RpcLinePayload | RpcClosedPayload): number | null {
	return typeof payload.generation === "number" && Number.isFinite(payload.generation) ? payload.generation : null;
}

function describeRpcError(response: JsonObject): string {
	if (typeof response.error === "string") return response.error;
	if (response.error && typeof response.error === "object" && "message" in response.error) {
		const message = (response.error as { message?: unknown }).message;
		if (typeof message === "string") return message;
	}
	return `Pi rejected ${String(response.command ?? "the command")}.`;
}

export class PiAdapter {
	private readonly instanceId: string;
	private requestSequence = 0;
	private currentGeneration: number | null = null;
	private connected = false;
	private starting = false;
	private buffered: BufferedEnvelope[] = [];
	private subscribers = new Set<(event: PiAdapterEvent) => void>();
	private pending = new Map<string, PendingRequest>();
	private listenersPromise: Promise<void> | null = null;
	private unlisteners: UnlistenFn[] = [];

	constructor(instanceId = "core-chat") {
		this.instanceId = instanceId;
	}

	get id(): string {
		return this.instanceId;
	}

	get isConnected(): boolean {
		return this.connected;
	}

	onEvent(subscriber: (event: PiAdapterEvent) => void): () => void {
		this.subscribers.add(subscriber);
		return () => this.subscribers.delete(subscriber);
	}

	async start(options: PiStartOptions): Promise<RpcStartResult> {
		if (this.starting) throw new Error("Pi RPC is already starting.");
		await this.ensureListeners();
		this.starting = true;
		this.buffered = [];

		try {
			const result = await invoke<RpcStartResult>("rpc_start", {
				options: {
					cli_path: null,
					pi_path: options.piPath?.trim() || null,
					cwd: options.cwd,
					provider: options.provider?.trim() || null,
					model: options.model?.trim() || null,
					env: null,
				},
				instanceId: this.instanceId,
			});

			this.currentGeneration = result.generation;
			this.connected = true;
			this.starting = false;
			const buffered = this.buffered;
			this.buffered = [];
			for (const envelope of buffered) this.processEnvelope(envelope);
			if (!this.connected) throw new Error("Pi RPC exited during startup.");
			return result;
		} catch (error) {
			this.starting = false;
			this.buffered = [];
			this.connected = false;
			throw error;
		}
	}

	async stop(): Promise<void> {
		this.connected = false;
		this.rejectPending("Pi RPC stopped.");
		await invoke("rpc_stop", { instanceId: this.instanceId });
		this.currentGeneration = null;
	}

	prompt(message: string, images: readonly PiImageInput[] = []): Promise<void> {
		return this.request({ type: "prompt", message, ...(images.length ? { images } : {}) });
	}

	steer(message: string, images: readonly PiImageInput[] = []): Promise<void> {
		return this.request({ type: "steer", message, ...(images.length ? { images } : {}) });
	}

	followUp(message: string, images: readonly PiImageInput[] = []): Promise<void> {
		return this.request({ type: "follow_up", message, ...(images.length ? { images } : {}) });
	}

	abort(): Promise<void> {
		return this.request({ type: "abort" });
	}

	newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
		return this.request({ type: "new_session", ...(parentSession ? { parentSession } : {}) });
	}

	async getState(): Promise<PiSessionState> {
		const state = await this.request<Record<string, unknown>>({ type: "get_state" });
		return {
			model: normalizePiModel(state.model),
			thinkingLevel: normalizeThinkingLevel(state.thinkingLevel),
			isStreaming: state.isStreaming === true,
			isCompacting: state.isCompacting === true,
			...(typeof state.sessionFile === "string" ? { sessionFile: state.sessionFile } : {}),
			sessionId: typeof state.sessionId === "string" ? state.sessionId : "",
			...(typeof state.sessionName === "string" ? { sessionName: state.sessionName } : {}),
			messageCount: typeof state.messageCount === "number" ? state.messageCount : 0,
			pendingMessageCount: typeof state.pendingMessageCount === "number" ? state.pendingMessageCount : 0,
		};
	}

	getAvailableModels(): Promise<PiModelInfo[]> {
		return this.request<{ models?: unknown }>({ type: "get_available_models" })
			.then((data) => normalizePiModels(data.models));
	}

	async setModel(provider: string, modelId: string): Promise<PiModelInfo> {
		const normalizedProvider = provider.trim();
		const normalizedModelId = modelId.trim();
		if (!normalizedProvider || !normalizedModelId) throw new Error("Choose a valid Pi model.");
		const model = normalizePiModel(await this.request({
			type: "set_model",
			provider: normalizedProvider,
			modelId: normalizedModelId,
		}));
		if (!model) throw new Error("Pi returned an invalid model after switching.");
		return model;
	}

	getAvailableThinkingLevels(): Promise<PiThinkingLevel[]> {
		return this.request<{ levels?: unknown }>({ type: "get_available_thinking_levels" })
			.then((data) => normalizeThinkingLevels(data.levels));
	}

	setThinkingLevel(level: PiThinkingLevel): Promise<void> {
		return this.request({ type: "set_thinking_level", level });
	}

	getMessages(): Promise<JsonObject[]> {
		return this.request<{ messages: JsonObject[] }>({ type: "get_messages" }).then((data) => data.messages);
	}

	getCommands(): Promise<PiCommandInfo[]> {
		return this.request<{ commands?: unknown }>({ type: "get_commands" })
			.then((data) => normalizePiCommands(data.commands));
	}

	switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
		return this.request({ type: "switch_session", sessionPath });
	}

	setSessionName(name: string): Promise<void> {
		return this.request({ type: "set_session_name", name });
	}

	getForkMessages(): Promise<PiForkOption[]> {
		return this.request<{ messages: PiForkOption[] }>({ type: "get_fork_messages" }).then((data) => data.messages);
	}

	fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		return this.request({ type: "fork", entryId });
	}

	async dispose(): Promise<void> {
		try {
			if (this.connected) await this.stop();
		} finally {
			for (const unlisten of this.unlisteners.splice(0)) unlisten();
			this.subscribers.clear();
			this.listenersPromise = null;
		}
	}

	private emit(event: PiAdapterEvent): void {
		for (const subscriber of this.subscribers) subscriber(event);
	}

	private matchesActiveProcess(payload: RpcLinePayload | RpcClosedPayload): boolean {
		if (payloadInstanceId(payload) !== this.instanceId) return false;
		const generation = payloadGeneration(payload);
		return generation === null || this.currentGeneration === null || generation === this.currentGeneration;
	}

	private receive(envelope: BufferedEnvelope): void {
		if (payloadInstanceId(envelope.payload) !== this.instanceId) return;
		if (this.starting) {
			this.buffered.push(envelope);
			return;
		}
		this.processEnvelope(envelope);
	}

	private processEnvelope(envelope: BufferedEnvelope): void {
		if (!this.connected) return;
		if (!this.matchesActiveProcess(envelope.payload)) return;
		if (envelope.kind === "closed") {
			this.connected = false;
			const reason = envelope.payload.reason?.trim() || "Pi RPC process closed.";
			this.rejectPending(reason);
			this.emit({ type: "rpc_disconnected", reason });
			return;
		}

		const line = envelope.payload.line;
		if (!line) return;
		if (envelope.kind === "stderr") {
			console.debug(`[pi stderr:${this.instanceId}]`, line);
			this.emit({ type: "rpc_stderr", line });
			return;
		}
		this.handleLine(line);
	}

	private handleLine(line: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			this.emit({ type: "rpc_protocol_error", line });
			return;
		}

		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			this.emit({ type: "rpc_protocol_error", line });
			return;
		}
		const event = parsed as JsonObject;
		if (event.type === "response" && typeof event.id === "string") {
			const request = this.pending.get(event.id);
			if (request) {
				clearTimeout(request.timeout);
				this.pending.delete(event.id);
				request.resolve(event);
				return;
			}
		}
		this.emit({ type: "rpc_event", event });
	}

	private async request<T = void>(command: JsonObject): Promise<T> {
		if (!this.connected) throw new Error("Connect Pi before sending a command.");
		await this.ensureListeners();
		const id = `gui-${++this.requestSequence}`;
		const line = JSON.stringify({ ...command, id });
		if (line.includes("\n") || line.includes("\r")) throw new Error("RPC command must be one LF-delimited JSON record.");

		const response = await new Promise<JsonObject>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for Pi to accept ${String(command.type)}.`));
			}, 35_000);
			this.pending.set(id, { resolve, reject, timeout });
			invoke("rpc_send", { command: line, instanceId: this.instanceId }).catch((error) => {
				clearTimeout(timeout);
				this.pending.delete(id);
				reject(new Error(`Failed to write Pi RPC command: ${String(error)}`));
			});
		});

		if (response.success === false) throw new Error(describeRpcError(response));
		return response.data as T;
	}

	private rejectPending(reason: string): void {
		for (const request of this.pending.values()) {
			clearTimeout(request.timeout);
			request.reject(new Error(reason));
		}
		this.pending.clear();
	}

	private async ensureListeners(): Promise<void> {
		if (this.unlisteners.length > 0) return;
		if (this.listenersPromise) return this.listenersPromise;

		this.listenersPromise = (async () => {
			const unlisteners: UnlistenFn[] = [];
			try {
				unlisteners.push(await listen<RpcLinePayload>("rpc-event", (event) => this.receive({ kind: "line", payload: event.payload })));
				unlisteners.push(await listen<RpcClosedPayload>("rpc-closed", (event) => this.receive({ kind: "closed", payload: event.payload })));
				unlisteners.push(await listen<RpcLinePayload>("rpc-stderr", (event) => this.receive({ kind: "stderr", payload: event.payload })));
				this.unlisteners = unlisteners;
			} catch (error) {
				for (const unlisten of unlisteners) unlisten();
				throw error;
			} finally {
				this.listenersPromise = null;
			}
		})();

		return this.listenersPromise;
	}
}

export const piAdapter = new PiAdapter();
