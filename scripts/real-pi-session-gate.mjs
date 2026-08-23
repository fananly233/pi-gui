import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
	createIsolatedPiEnvironment,
	isolatedDiscoveryArgs,
	requestRealPiStartupState,
} from "./real-pi-gate-environment.mjs";

const provider = process.env.PI_GUI_GATE_PROVIDER || "deepseek";
const model = process.env.PI_GUI_GATE_MODEL || "deepseek-v4-flash";
const cwd = process.env.PI_GUI_GATE_CWD || process.cwd();
const safeModelName = /^[a-zA-Z0-9._:/~-]+$/;

if (!safeModelName.test(provider) || !safeModelName.test(model)) {
	throw new Error("Gate provider and model may only contain model identifier characters.");
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function listJsonlFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await listJsonlFiles(path)));
		else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".jsonl")) files.push(path);
	}
	return files;
}

class PersistentPiHarness {
	constructor(sessionDir, environment) {
		this.sessionDir = sessionDir;
		this.environment = environment;
		this.child = null;
		this.stdoutBuffer = "";
		this.stderr = "";
		this.requestSequence = 0;
		this.pending = new Map();
		this.events = [];
		this.failure = null;
		this.exited = null;
		this.exitPromise = null;
	}

	start() {
		const piArgs = ["--mode", "rpc", "--session-dir", this.sessionDir, "--provider", provider, "--model", model, ...isolatedDiscoveryArgs];
		const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "pi";
		const args = process.platform === "win32" ? ["/d", "/s", "/c", "pi.cmd", ...piArgs] : piArgs;

		this.child = spawn(command, args, {
			cwd,
			env: this.environment,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.child.stdout.setEncoding("utf8");
		this.child.stderr.setEncoding("utf8");
		this.child.stdout.on("data", (chunk) => this.consumeStdout(chunk));
		this.child.stderr.on("data", (chunk) => {
			this.stderr += chunk;
		});
		this.child.on("error", (error) => this.fail(error));
		this.exitPromise = new Promise((resolve) => {
			this.child.once("exit", (code, signal) => {
				this.exited = { code, signal };
				if (code !== 0 && !this.failure) this.fail(new Error(`Pi RPC exited with code ${code ?? "null"} (${signal ?? "no signal"}).`));
				resolve(this.exited);
			});
		});
	}

	consumeStdout(chunk) {
		this.stdoutBuffer += chunk;
		while (true) {
			const newlineIndex = this.stdoutBuffer.indexOf("\n");
			if (newlineIndex === -1) return;
			let line = this.stdoutBuffer.slice(0, newlineIndex);
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (line) this.consumeLine(line);
		}
	}

	consumeLine(line) {
		let event;
		try {
			event = JSON.parse(line);
		} catch (error) {
			this.fail(new Error(`Pi emitted invalid LF JSONL: ${line.slice(0, 180)}`, { cause: error }));
			return;
		}
		if (event?.type === "response" && typeof event.id === "string") {
			const request = this.pending.get(event.id);
			if (request) {
				clearTimeout(request.timeout);
				this.pending.delete(event.id);
				request.resolve(event);
			}
		}
		this.events.push(event);
	}

	fail(error) {
		this.failure = error instanceof Error ? error : new Error(String(error));
		for (const request of this.pending.values()) {
			clearTimeout(request.timeout);
			request.reject(this.failure);
		}
		this.pending.clear();
	}

	async request(command, timeoutMs = 35_000) {
		if (!this.child || !this.child.stdin.writable) throw new Error("Pi RPC stdin is unavailable.");
		const id = `session-gate-${++this.requestSequence}`;
		const line = JSON.stringify({ ...command, id });
		assert.equal(line.includes("\n"), false, "RPC command must remain one LF-delimited record");
		assert.equal(line.includes("\r"), false, "RPC command must not contain a raw CR delimiter");

		const responsePromise = new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for ${command.type} response.`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timeout });
		});
		this.child.stdin.write(`${line}\n`);
		const response = await responsePromise;
		if (response.success === false) throw new Error(typeof response.error === "string" ? response.error : `Pi rejected ${command.type}.`);
		return response;
	}

	async waitFor(startIndex, predicate, label, timeoutMs = 90_000) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (this.failure) throw this.failure;
			const found = this.events.slice(startIndex).find(predicate);
			if (found) return found;
			if (this.exited) throw new Error(`Pi exited before ${label}.`);
			await delay(25);
		}
		throw new Error(`Timed out waiting for ${label}.`);
	}

	async promptAndSettle(message) {
		const startIndex = this.events.length;
		await this.request({ type: "prompt", message });
		await this.waitFor(startIndex, (event) => event.type === "agent_settled", "agent_settled");
		return this.events.slice(startIndex);
	}

	async stop() {
		if (!this.child) return;
		if (this.child.stdin.writable) this.child.stdin.end();
		await Promise.race([this.exitPromise, delay(5_000)]);
		if (!this.exited) {
			if (process.platform === "win32") {
				spawnSync("taskkill.exe", ["/PID", String(this.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
			} else {
				this.child.kill("SIGTERM");
			}
			await Promise.race([this.exitPromise, delay(2_000)]);
		}
	}
}

const requestedSessionDir = process.env.PI_GUI_GATE_SESSION_DIR?.trim();
const keepSessionDir = process.env.PI_GUI_GATE_KEEP_SESSIONS === "1";
const ownsSessionDir = !requestedSessionDir;
const sessionDir = requestedSessionDir || (await mkdtemp(join(tmpdir(), "pi-gui-phase3-")));
if (requestedSessionDir) await mkdir(sessionDir, { recursive: true });
const isolatedPi = await createIsolatedPiEnvironment("pi-gui-phase9-sessions-");
const harness = new PersistentPiHarness(sessionDir, isolatedPi.environment);
let restartedHarness = null;

try {
	console.log(`[session-gate] isolated session dir: ${sessionDir}`);
	harness.start();
	const initialState = await requestRealPiStartupState(harness);
	assert.equal(initialState.data?.model?.provider, provider);
	assert.equal(initialState.data?.model?.id, model);
	await harness.request({ type: "set_thinking_level", level: "off" });

	const created = await harness.request({ type: "new_session" });
	assert.equal(created.data?.cancelled, false);
	await harness.request({ type: "set_session_name", name: "phase3-source" });
	const sourceState = await harness.request({ type: "get_state" });
	const sourcePath = sourceState.data?.sessionFile;
	assert.equal(typeof sourcePath, "string");
	assert.equal(sourceState.data?.sessionName, "phase3-source");
	console.log("[session-gate] new + rename: PASS");

	const promptText = "Reply with exactly PI_SESSION_SOURCE_OK. Do not use tools.";
	const sourceRun = await harness.promptAndSettle(promptText);
	const sourceAssistantText = sourceRun
		.filter((event) => event.type === "message_end" && event.message?.role === "assistant")
		.flatMap((event) => event.message.content || [])
		.filter((block) => block?.type === "text")
		.map((block) => block.text)
		.join("\n");
	assert.match(sourceAssistantText, /PI_SESSION_SOURCE_OK/);
	const sourceMessages = await harness.request({ type: "get_messages" });
	assert.ok(sourceMessages.data?.messages?.some((message) => message.role === "user"));
	assert.ok(sourceMessages.data?.messages?.some((message) => message.role === "assistant"));
	console.log("[session-gate] persisted prompt + message restore: PASS");

	const forkPromptText = "Reply with exactly PI_SESSION_FORK_TARGET_OK. Do not use tools.";
	const forkTargetRun = await harness.promptAndSettle(forkPromptText);
	const forkTargetAssistantText = forkTargetRun
		.filter((event) => event.type === "message_end" && event.message?.role === "assistant")
		.flatMap((event) => event.message.content || [])
		.filter((block) => block?.type === "text")
		.map((block) => block.text)
		.join("\n");
	assert.match(forkTargetAssistantText, /PI_SESSION_FORK_TARGET_OK/);

	const forkOptions = await harness.request({ type: "get_fork_messages" });
	const sourceFork = forkOptions.data?.messages?.find((option) => option.text === forkPromptText);
	assert.ok(sourceFork?.entryId, "Expected the real source prompt to be forkable.");
	const forked = await harness.request({ type: "fork", entryId: sourceFork.entryId });
	assert.equal(forked.data?.cancelled, false);
	assert.equal(forked.data?.text, forkPromptText);
	await harness.request({ type: "set_session_name", name: "phase3-fork" });
	const forkState = await harness.request({ type: "get_state" });
	const forkPath = forkState.data?.sessionFile;
	assert.equal(typeof forkPath, "string");
	assert.notEqual(forkPath, sourcePath);
	assert.equal(forkState.data?.sessionName, "phase3-fork");
	console.log("[session-gate] get_fork_messages + fork: PASS");

	const fresh = await harness.request({ type: "new_session", parentSession: sourcePath });
	assert.equal(fresh.data?.cancelled, false);
	await harness.request({ type: "set_session_name", name: "phase3-new" });
	const freshRun = await harness.promptAndSettle("Reply with exactly PI_SESSION_NEW_OK. Do not use tools.");
	const freshAssistantText = freshRun
		.filter((event) => event.type === "message_end" && event.message?.role === "assistant")
		.flatMap((event) => event.message.content || [])
		.filter((block) => block?.type === "text")
		.map((block) => block.text)
		.join("\n");
	assert.match(freshAssistantText, /PI_SESSION_NEW_OK/);
	const freshState = await harness.request({ type: "get_state" });
	assert.notEqual(freshState.data?.sessionFile, sourcePath);
	assert.notEqual(freshState.data?.sessionFile, forkPath);

	const switchedSource = await harness.request({ type: "switch_session", sessionPath: sourcePath });
	assert.equal(switchedSource.data?.cancelled, false);
	const restoredSource = await harness.request({ type: "get_state" });
	assert.equal(restoredSource.data?.sessionName, "phase3-source");
	const restoredMessages = await harness.request({ type: "get_messages" });
	assert.ok(restoredMessages.data?.messages?.some((message) => message.role === "assistant"));

	const switchedFork = await harness.request({ type: "switch_session", sessionPath: forkPath });
	assert.equal(switchedFork.data?.cancelled, false);
	const restoredFork = await harness.request({ type: "get_state" });
	assert.equal(restoredFork.data?.sessionName, "phase3-fork");
	console.log("[session-gate] new + switch + resume: PASS");

	await harness.stop();
	const files = await listJsonlFiles(sessionDir);
	assert.ok(files.length >= 3, `Expected at least three persisted session files, found ${files.length}.`);

	restartedHarness = new PersistentPiHarness(sessionDir, isolatedPi.environment);
	restartedHarness.start();
	const restartedState = await requestRealPiStartupState(restartedHarness);
	assert.equal(restartedState.data?.model?.provider, provider);
	assert.equal(restartedState.data?.model?.id, model);
	const resumedAfterRestart = await restartedHarness.request({ type: "switch_session", sessionPath: sourcePath });
	assert.equal(resumedAfterRestart.data?.cancelled, false);
	const restartedSource = await restartedHarness.request({ type: "get_state" });
	assert.equal(restartedSource.data?.sessionName, "phase3-source");
	const restartedMessages = await restartedHarness.request({ type: "get_messages" });
	assert.ok(restartedMessages.data?.messages?.some((message) => message.role === "assistant"));
	await restartedHarness.stop();
	console.log(`[session-gate] persisted files (${files.length}) + process restart boundary: PASS`);
	console.log("[session-gate] REAL PI SESSION GATE: PASS");
} catch (error) {
	console.error(`[session-gate] REAL PI SESSION GATE: FAIL\n${error instanceof Error ? error.stack : String(error)}`);
	if (harness.stderr.trim()) console.error(`[session-gate] pi stderr:\n${harness.stderr.trim().slice(-4000)}`);
	process.exitCode = 1;
} finally {
	try {
		await harness.stop();
		await restartedHarness?.stop();
		if (keepSessionDir || !ownsSessionDir) console.log(`[session-gate] preserved isolated sessions: ${sessionDir}`);
		else await rm(sessionDir, { recursive: true, force: true });
	} finally {
		await isolatedPi.dispose();
	}
}
