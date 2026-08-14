import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventNormalizer } from "../src/pi/event-normalizer.ts";

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

class RealPiHarness {
	constructor() {
		this.child = null;
		this.stdoutBuffer = "";
		this.stderr = "";
		this.requestSequence = 0;
		this.pending = new Map();
		this.rawEvents = [];
		this.normalizedEvents = [];
		this.normalizer = new EventNormalizer();
		this.failure = null;
		this.exited = null;
		this.exitPromise = null;
	}

	start() {
		const piArgs = ["--mode", "rpc", "--no-session", "--provider", provider, "--model", model];
		const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "pi";
		const args = process.platform === "win32" ? ["/d", "/s", "/c", "pi.cmd", ...piArgs] : piArgs;

		this.child = spawn(command, args, {
			cwd,
			env: { ...process.env, NO_COLOR: "1" },
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

		this.rawEvents.push(event);
		for (const normalized of this.normalizer.normalize(event)) this.normalizedEvents.push(normalized);
	}

	fail(error) {
		this.failure = error instanceof Error ? error : new Error(String(error));
		for (const request of this.pending.values()) {
			clearTimeout(request.timeout);
			request.reject(this.failure);
		}
		this.pending.clear();
	}

	mark() {
		return { raw: this.rawEvents.length, normalized: this.normalizedEvents.length };
	}

	async request(command, timeoutMs = 35_000) {
		if (!this.child || !this.child.stdin.writable) throw new Error("Pi RPC stdin is unavailable.");
		const id = `gate-${++this.requestSequence}`;
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

	async waitFor(historyName, startIndex, predicate, label, timeoutMs = 90_000) {
		const history = historyName === "raw" ? this.rawEvents : this.normalizedEvents;
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (this.failure) throw this.failure;
			const found = history.slice(startIndex).find(predicate);
			if (found) return found;
			if (this.exited) throw new Error(`Pi exited before ${label}.`);
			await delay(25);
		}
		throw new Error(`Timed out waiting for ${label}.`);
	}

	async promptAndSettle(message) {
		const mark = this.mark();
		await this.request({ type: "prompt", message });
		await this.waitFor("normalized", mark.normalized, (event) => event.type === "run_settled", "agent_settled");
		return {
			raw: this.rawEvents.slice(mark.raw),
			normalized: this.normalizedEvents.slice(mark.normalized),
		};
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

const harness = new RealPiHarness();

try {
	console.log(`[gate] starting real Pi RPC with ${provider}/${model}`);
	harness.start();
	const stateResponse = await harness.request({ type: "get_state" });
	assert.equal(stateResponse.data?.model?.provider, provider);
	assert.equal(stateResponse.data?.model?.id, model);
	await harness.request({ type: "set_thinking_level", level: "off" });
	console.log("[gate] startup and correlated responses: PASS");

	const firstRun = await harness.promptAndSettle("Reply with exactly PI_GUI_FIRST_OK. Do not use tools.");
	const firstText = firstRun.normalized
		.filter((event) => event.type === "assistant_reconciled")
		.map((event) => event.text)
		.join("\n");
	assert.match(firstText, /PI_GUI_FIRST_OK/);
	assert.ok(firstRun.normalized.some((event) => event.type === "assistant_text_delta"), "Expected a real streaming text delta.");
	console.log("[gate] first prompt and delta-only stream: PASS");

	const secondRun = await harness.promptAndSettle(
		"Use the bash tool exactly once to run: node -e \"process.stdout.write('PI_GUI_TOOL_OK')\". After it succeeds, reply with exactly PI_GUI_SECOND_OK.",
	);
	const secondText = secondRun.normalized
		.filter((event) => event.type === "assistant_reconciled")
		.map((event) => event.text)
		.join("\n");
	const toolStarts = secondRun.normalized.filter((event) => event.type === "tool_started");
	const toolFinishes = secondRun.normalized.filter((event) => event.type === "tool_finished");
	assert.ok(toolStarts.length > 0, "Expected a real tool invocation.");
	assert.ok(toolFinishes.some((event) => !event.isError), "Expected a successful tool result.");
	assert.ok(
		toolStarts.some((event) => JSON.stringify(event.args).includes("PI_GUI_TOOL_OK")) ||
			toolFinishes.some((event) => event.output.includes("PI_GUI_TOOL_OK")),
		"Expected the tool marker in arguments or output.",
	);
	assert.match(secondText, /PI_GUI_SECOND_OK/);
	console.log("[gate] tool invocation and second prompt: PASS");

	const abortMark = harness.mark();
	await harness.request({
		type: "prompt",
		message:
			"Use the bash tool to run: node -e \"setTimeout(() => process.stdout.write('PI_GUI_ABORT_TOO_LATE'), 30000)\". Then explain the output.",
	});
	await harness.waitFor("normalized", abortMark.normalized, (event) => event.type === "tool_started", "abort test tool start");
	await harness.request({ type: "steer", message: "If execution continues, reply with STEER_QUEUE_OK." });
	await harness.waitFor(
		"normalized",
		abortMark.normalized,
		(event) => event.type === "queue_updated" && event.steering.includes("If execution continues, reply with STEER_QUEUE_OK."),
		"steering queue update",
	);
	await harness.request({ type: "follow_up", message: "After completion, reply with FOLLOW_UP_QUEUE_OK." });
	await harness.waitFor(
		"normalized",
		abortMark.normalized,
		(event) => event.type === "queue_updated" && event.followUp.includes("After completion, reply with FOLLOW_UP_QUEUE_OK."),
		"follow-up queue update",
	);
	await harness.request({ type: "abort" });
	await harness.waitFor("normalized", abortMark.normalized, (event) => event.type === "run_settled", "settled state after abort");
	const abortRaw = harness.rawEvents.slice(abortMark.raw);
	assert.ok(
		abortRaw.some((event) => event?.type === "message_end" && event.message?.stopReason === "aborted") ||
			abortRaw.some((event) => event?.type === "tool_execution_end" && event.isError === true),
		"Expected an aborted assistant message or interrupted tool result.",
	);
	console.log("[gate] steer/follow-up queues, in-flight abort, and settled state: PASS");
	console.log("[gate] REAL PI RPC GATE: PASS");
} catch (error) {
	console.error(`[gate] REAL PI RPC GATE: FAIL\n${error instanceof Error ? error.stack : String(error)}`);
	if (harness.stderr.trim()) console.error(`[gate] pi stderr:\n${harness.stderr.trim().slice(-4000)}`);
	process.exitCode = 1;
} finally {
	await harness.stop();
}
