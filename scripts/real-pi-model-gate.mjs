import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createIsolatedPiEnvironment, isolatedDiscoveryArgs } from "./real-pi-gate-environment.mjs";

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

class ModelPiHarness {
	constructor(label, environment) {
		this.label = label;
		this.environment = environment;
		this.child = null;
		this.stdoutBuffer = "";
		this.stderr = "";
		this.requestSequence = 0;
		this.pending = new Map();
		this.failure = null;
		this.exited = null;
		this.exitPromise = null;
	}

	start() {
		const piArgs = ["--mode", "rpc", "--no-session", "--provider", provider, "--model", model, ...isolatedDiscoveryArgs];
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
			if (!line) continue;
			let response;
			try {
				response = JSON.parse(line);
			} catch (error) {
				this.fail(new Error(`Pi emitted invalid LF JSONL: ${line.slice(0, 180)}`, { cause: error }));
				continue;
			}
			if (response?.type !== "response" || typeof response.id !== "string") continue;
			const request = this.pending.get(response.id);
			if (!request) continue;
			clearTimeout(request.timeout);
			this.pending.delete(response.id);
			request.resolve(response);
		}
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
		const id = `${this.label}-${++this.requestSequence}`;
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

const isolatedPi = await createIsolatedPiEnvironment("pi-gui-phase9-models-");
const first = new ModelPiHarness("models-first", isolatedPi.environment);
let initialState = null;
let restored = false;

try {
	console.log(`[gate] starting real Pi model RPC with ${provider}/${model}`);
	first.start();
	initialState = (await first.request({ type: "get_state" })).data;
	assert.equal(initialState?.model?.provider, provider);
	assert.equal(initialState?.model?.id, model);

	const models = (await first.request({ type: "get_available_models" })).data?.models;
	assert.ok(Array.isArray(models) && models.length > 0, "Pi must return at least one available model.");
	assert.ok(models.some((entry) => entry?.provider === provider && entry?.id === model), "Startup model must be present in the available model catalog.");
	const alternate = models.find((entry) => entry?.provider === provider && entry?.id !== model)
		?? models.find((entry) => entry?.provider && entry?.id && (entry.provider !== provider || entry.id !== model));
	const target = alternate ?? initialState.model;
	const switched = await first.request({ type: "set_model", provider: target.provider, modelId: target.id });
	assert.equal(switched.data?.provider, target.provider);
	assert.equal(switched.data?.id, target.id);
	const switchedState = (await first.request({ type: "get_state" })).data;
	assert.equal(switchedState?.model?.provider, target.provider);
	assert.equal(switchedState?.model?.id, target.id);
	console.log(`[gate] catalog and model switch${alternate ? ` to ${target.provider}/${target.id}` : " (single-model no-op)"}: PASS`);

	await first.request({ type: "set_model", provider, modelId: model });
	const levels = (await first.request({ type: "get_available_thinking_levels" })).data?.levels;
	assert.ok(Array.isArray(levels) && levels.length > 0, "Pi must return thinking levels for the restored model.");
	const originalThinking = initialState.thinkingLevel;
	assert.ok(levels.includes(originalThinking), `Original thinking level '${originalThinking}' must be supported.`);
	const alternateThinking = levels.find((level) => level !== originalThinking);
	if (alternateThinking) {
		await first.request({ type: "set_thinking_level", level: alternateThinking });
		assert.equal((await first.request({ type: "get_state" })).data?.thinkingLevel, alternateThinking);
	}
	await first.request({ type: "set_thinking_level", level: originalThinking });
	const restoredState = (await first.request({ type: "get_state" })).data;
	assert.equal(restoredState?.model?.provider, provider);
	assert.equal(restoredState?.model?.id, model);
	assert.equal(restoredState?.thinkingLevel, originalThinking);
	restored = true;
	console.log(`[gate] thinking levels (${levels.join(", ")}) and restoration: PASS`);
	await first.stop();

	const restarted = new ModelPiHarness("models-restart", isolatedPi.environment);
	try {
		restarted.start();
		const restartedState = (await restarted.request({ type: "get_state" })).data;
		assert.equal(restartedState?.model?.provider, provider);
		assert.equal(restartedState?.model?.id, model);
		console.log("[gate] clean Pi process restart with requested model: PASS");
	} finally {
		await restarted.stop();
	}
	console.log("[gate] REAL PI MODEL CONFIGURATION GATE: PASS");
} catch (error) {
	console.error(`[gate] REAL PI MODEL CONFIGURATION GATE: FAIL\n${error instanceof Error ? error.stack : String(error)}`);
	if (first.stderr.trim()) console.error(`[gate] pi stderr:\n${first.stderr.trim().slice(-4000)}`);
	process.exitCode = 1;
} finally {
	if (initialState && !restored && first.child?.stdin?.writable) {
		try {
			await first.request({ type: "set_model", provider: initialState.model.provider, modelId: initialState.model.id });
			await first.request({ type: "set_thinking_level", level: initialState.thinkingLevel });
		} catch {
			// The process may already have exited; shutdown still runs below.
		}
	}
	try {
		await first.stop();
	} finally {
		await isolatedPi.dispose();
	}
}
