import assert from "node:assert/strict";
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
