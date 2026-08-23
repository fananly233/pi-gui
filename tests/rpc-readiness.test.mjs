import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	PI_RPC_REQUEST_TIMEOUT_MS,
	PI_RPC_STARTUP_TIMEOUT_MS,
	waitForPiRpcReady,
} from "../src/pi/rpc-readiness.ts";

test("startup readiness uses a real get_state handshake with an extended timeout", async () => {
	let observed = null;
	await waitForPiRpcReady(async (command, timeoutMs) => {
		observed = { command, timeoutMs };
		await new Promise((resolve) => setTimeout(resolve, 5));
	});

	assert.deepEqual(observed, {
		command: { type: "get_state" },
		timeoutMs: PI_RPC_STARTUP_TIMEOUT_MS,
	});
	assert.ok(PI_RPC_STARTUP_TIMEOUT_MS > PI_RPC_REQUEST_TIMEOUT_MS);
});

test("startup readiness preserves probe failures", async () => {
	await assert.rejects(
		waitForPiRpcReady(async () => {
			throw new Error("startup probe failed");
		}),
		/startup probe failed/,
	);
});

test("PiAdapter keeps a distinct start lock through the readiness handshake", async () => {
	const source = await readFile(new URL("../src/pi/pi-adapter.ts", import.meta.url), "utf8");
	const guard = source.indexOf("if (this.startupInFlight)");
	const acquire = source.indexOf("this.startupInFlight = true", guard);
	const handshake = source.indexOf("await waitForPiRpcReady", acquire);
	const release = source.indexOf("this.startupInFlight = false", handshake);

	assert.ok(guard >= 0, "missing concurrent-start guard");
	assert.ok(acquire > guard, "start lock must be acquired after the guard");
	assert.ok(handshake > acquire, "readiness handshake must run while the start lock is held");
	assert.ok(release > handshake, "start lock must be released after the readiness handshake");
});
