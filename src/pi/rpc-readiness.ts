export const PI_RPC_REQUEST_TIMEOUT_MS = 35_000;
export const PI_RPC_STARTUP_TIMEOUT_MS = 300_000;

type StartupProbe = (
	command: Readonly<{ type: "get_state" }>,
	timeoutMs: number,
) => Promise<unknown>;

/**
 * Pi may install configured packages before it starts consuming RPC stdin.
 * A real command/response handshake keeps callers in the starting state until
 * that initialization is complete instead of failing the first session action.
 */
export async function waitForPiRpcReady(probe: StartupProbe): Promise<void> {
	await probe({ type: "get_state" }, PI_RPC_STARTUP_TIMEOUT_MS);
}
