import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createIsolatedPiEnvironment } from "../scripts/real-pi-gate-environment.mjs";

test("isolates mutable Pi configuration and removes copied credentials", async () => {
	const sourceAgentDir = await mkdtemp(join(tmpdir(), "pi-gui-gate-source-"));
	await writeFile(join(sourceAgentDir, "auth.json"), '{"fixture":true}\n');
	await writeFile(join(sourceAgentDir, "settings.json"), '{"defaultThinkingLevel":"max"}\n');
	const isolated = await createIsolatedPiEnvironment("pi-gui-gate-test-", sourceAgentDir);
	const root = dirname(isolated.agentDir);

	try {
		assert.notEqual(isolated.agentDir, sourceAgentDir);
		assert.equal(isolated.environment.PI_CODING_AGENT_DIR, isolated.agentDir);
		assert.equal(await readFile(join(isolated.agentDir, "auth.json"), "utf8"), '{"fixture":true}\n');
		await writeFile(join(isolated.agentDir, "settings.json"), '{"defaultThinkingLevel":"off"}\n');
		assert.equal(await readFile(join(sourceAgentDir, "settings.json"), "utf8"), '{"defaultThinkingLevel":"max"}\n');
		await isolated.dispose();
		await assert.rejects(access(root));
	} finally {
		await isolated.dispose();
		await rm(sourceAgentDir, { recursive: true, force: true });
	}
});
