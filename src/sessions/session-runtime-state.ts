import type { ChatActivity, ChatMessage } from "../chat/chat-types";
import type { PiModelInfo, PiThinkingLevel } from "../models/model-state";

export type SessionRuntimePhase = "starting" | "switching" | "ready" | "failed";

export function isSessionRuntimeTransitioning(phase: SessionRuntimePhase): boolean {
	return phase === "starting" || phase === "switching";
}

export type SessionRuntimeSnapshot = Readonly<{
	key: string;
	cwd: string;
	sessionPath: string | null;
	sessionId: string | null;
	sessionName: string | null;
	discovery: string;
	phase: SessionRuntimePhase;
	activity: ChatActivity;
	model: PiModelInfo | null;
	thinkingLevel: PiThinkingLevel;
	messages: ChatMessage[];
	queue: { steering: string[]; followUp: string[] };
	sending: boolean;
	aborting: boolean;
	configuringModel: boolean;
	lastError: string | null;
}>;

export type SelectionTicket = Readonly<{ key: string; epoch: number }>;

/**
 * A selection may finish after a newer click. Only the newest ticket is allowed
 * to become active; the older runtime can still finish loading in the background.
 */
export class SessionSelectionGuard {
	private epoch = 0;
	private selectedKey: string | null = null;

	get activeKey(): string | null {
		return this.selectedKey;
	}

	begin(key: string): SelectionTicket {
		this.epoch += 1;
		return { key, epoch: this.epoch };
	}

	isCurrent(ticket: SelectionTicket): boolean {
		return ticket.epoch === this.epoch;
	}

	commit(ticket: SelectionTicket): boolean {
		if (!this.isCurrent(ticket)) return false;
		this.selectedKey = ticket.key;
		return true;
	}

	invalidate(): void {
		this.epoch += 1;
		this.selectedKey = null;
	}
}

export function updateRuntimeSnapshot(
	runtimes: ReadonlyMap<string, SessionRuntimeSnapshot>,
	key: string,
	update: (snapshot: SessionRuntimeSnapshot) => SessionRuntimeSnapshot,
): Map<string, SessionRuntimeSnapshot> {
	const current = runtimes.get(key);
	if (!current) return new Map(runtimes);
	const next = new Map(runtimes);
	next.set(key, update(current));
	return next;
}

export function normalizeFsPath(value: string | null | undefined): string {
	return (value ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

export function sessionBelongsToWorkspace(sessionCwd: string | null, workspacePath: string): boolean {
	return normalizeFsPath(sessionCwd) === normalizeFsPath(workspacePath);
}

export function sessionRuntimeKey(sessionPath: string): string {
	return `session:${normalizeFsPath(sessionPath)}`;
}

export function sessionInstanceId(key: string): string {
	let hash = 2166136261;
	for (let index = 0; index < key.length; index += 1) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `session_${(hash >>> 0).toString(36)}`;
}
