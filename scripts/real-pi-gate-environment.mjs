import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const copiedConfigFiles = ["auth.json", "settings.json", "models.json"];

export const isolatedDiscoveryArgs = [
	"--no-extensions",
	"--no-skills",
	"--no-prompt-templates",
	"--no-themes",
	"--no-context-files",
	"--no-approve",
];

async function optionalHash(path) {
	try {
		return createHash("sha256").update(await readFile(path)).digest("hex");
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

async function snapshotConfig(agentDir) {
	return Object.fromEntries(
		await Promise.all(copiedConfigFiles.map(async (name) => [name, await optionalHash(join(agentDir, name))])),
	);
}

export async function createIsolatedPiEnvironment(prefix, sourceAgentDir) {
	const sourceDir = sourceAgentDir || process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	const sourceSnapshot = await snapshotConfig(sourceDir);
	const root = await mkdtemp(join(tmpdir(), prefix));
	const agentDir = join(root, "agent");

	try {
		await mkdir(agentDir, { recursive: true });
		for (const name of copiedConfigFiles) {
			if (sourceSnapshot[name] !== null) await copyFile(join(sourceDir, name), join(agentDir, name));
		}
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		throw error;
	}

	let disposed = false;
	return {
		agentDir,
		environment: { ...process.env, PI_CODING_AGENT_DIR: agentDir, NO_COLOR: "1" },
		async dispose() {
			if (disposed) return;
			disposed = true;
			let verificationError = null;
			try {
				const after = await snapshotConfig(sourceDir);
				for (const name of copiedConfigFiles) {
					if (after[name] !== sourceSnapshot[name]) {
						throw new Error(`Real Pi ${name} changed while an isolated gate was running.`);
					}
				}
			} catch (error) {
				verificationError = error;
			}

			let cleanupError = null;
			try {
				await rm(root, { recursive: true, force: true });
			} catch (error) {
				cleanupError = error;
			}

			if (verificationError) throw verificationError;
			if (cleanupError) throw cleanupError;
		},
	};
}
