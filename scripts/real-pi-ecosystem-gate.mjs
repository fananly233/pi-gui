import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function optionalHash(path) {
	try {
		return createHash("sha256").update(await readFile(path)).digest("hex");
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

function piProcess(args, options = {}) {
	const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "pi";
	const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "pi.cmd", ...args] : args;
	return { command, commandArgs, options };
}

function runPi(args, cwd, environment) {
	const { command, commandArgs } = piProcess(args);
	const result = spawnSync(command, commandArgs, {
		cwd,
		env: environment,
		encoding: "utf8",
		maxBuffer: 2 * 1024 * 1024,
		timeout: 60_000,
		windowsHide: true,
	});
	if (result.error) throw result.error;
	assert.equal(
		result.status,
		0,
		`pi ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
	);
	return { stdout: result.stdout, stderr: result.stderr };
}

class CommandsHarness {
	constructor(cwd, environment) {
		this.cwd = cwd;
		this.environment = environment;
		this.child = null;
		this.buffer = "";
		this.stderr = "";
		this.pending = new Map();
		this.sequence = 0;
		this.exitPromise = null;
		this.exited = false;
	}

	start() {
		const { command, commandArgs } = piProcess(["--mode", "rpc", "--no-session", "--no-approve"]);
		this.child = spawn(command, commandArgs, {
			cwd: this.cwd,
			env: this.environment,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.child.stdout.setEncoding("utf8");
		this.child.stderr.setEncoding("utf8");
		this.child.stdout.on("data", (chunk) => this.consume(chunk));
		this.child.stderr.on("data", (chunk) => {
			this.stderr += chunk;
		});
		this.exitPromise = new Promise((resolve) => {
			this.child.once("exit", (code, signal) => {
				this.exited = true;
				for (const pending of this.pending.values()) pending.reject(new Error(`Pi RPC exited with ${code ?? signal}.`));
				this.pending.clear();
				resolve();
			});
		});
	}

	consume(chunk) {
		this.buffer += chunk;
		while (true) {
			const index = this.buffer.indexOf("\n");
			if (index === -1) return;
			const line = this.buffer.slice(0, index).replace(/\r$/, "");
			this.buffer = this.buffer.slice(index + 1);
			if (!line) continue;
			const response = JSON.parse(line);
			if (response?.type !== "response" || typeof response.id !== "string") continue;
			const pending = this.pending.get(response.id);
			if (!pending) continue;
			clearTimeout(pending.timeout);
			this.pending.delete(response.id);
			pending.resolve(response);
		}
	}

	async request(command) {
		const id = `ecosystem-gate-${++this.sequence}`;
		const line = JSON.stringify({ ...command, id });
		assert.equal(/[\r\n]/.test(line), false);
		const responsePromise = new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for ${command.type}.`));
			}, 35_000);
			this.pending.set(id, { resolve, reject, timeout });
		});
		this.child.stdin.write(`${line}\n`);
		const response = await responsePromise;
		if (response.success === false) throw new Error(response.error || `Pi rejected ${command.type}.`);
		return response.data;
	}

	async stop() {
		if (!this.child || this.exited) return;
		this.child.stdin.end();
		await Promise.race([this.exitPromise, delay(3_000)]);
		if (this.exited) return;
		if (process.platform === "win32") {
			spawnSync("taskkill.exe", ["/PID", String(this.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
		} else {
			this.child.kill("SIGTERM");
		}
		await Promise.race([this.exitPromise, delay(2_000)]);
	}
}

const root = await mkdtemp(join(tmpdir(), "pi-gui-phase7-"));
const workspace = join(root, "workspace");
const agentDir = join(root, "agent");
const packageDir = join(workspace, "phase7-package");
const actualAgentDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
const actualSettings = join(actualAgentDir, "settings.json");
const settingsHashBefore = await optionalHash(actualSettings);
const environment = {
	...process.env,
	PI_CODING_AGENT_DIR: agentDir,
	NO_COLOR: "1",
	CI: "1",
};
let harness = null;

try {
	await mkdir(join(packageDir, "skills", "phase7-gate-skill"), { recursive: true });
	await mkdir(join(packageDir, "prompts"), { recursive: true });
	await mkdir(join(packageDir, "themes"), { recursive: true });
	await writeFile(join(packageDir, "package.json"), JSON.stringify({
		name: "pi-desktop-phase7-gate",
		version: "1.0.0",
		private: true,
		pi: {
			skills: ["./skills"],
			prompts: ["./prompts"],
			themes: ["./themes"],
		},
	}, null, 2));
	await writeFile(join(packageDir, "skills", "phase7-gate-skill", "SKILL.md"), "---\nname: phase7-gate-skill\ndescription: Isolated Phase 7 verification skill.\n---\n\nUse only for the Phase 7 gate.\n");
	await writeFile(join(packageDir, "prompts", "phase7-gate.md"), "---\ndescription: Isolated Phase 7 verification prompt.\n---\n\nReply with the supplied arguments.\n");
	await writeFile(join(packageDir, "themes", "phase7-gate.json"), JSON.stringify({ name: "phase7-gate", colors: {} }));

	assert.match(runPi(["list", "--no-approve"], workspace, environment).stdout, /No packages installed/);
	runPi(["install", packageDir, "--no-approve"], workspace, environment);
	const userList = runPi(["list", "--no-approve"], workspace, environment).stdout;
	assert.match(userList, /User packages:/);
	assert.match(userList, /phase7-package/);
	runPi(["update", "--extension", packageDir, "--no-approve"], workspace, environment);
	console.log("[ecosystem-gate] isolated user install + list + update: PASS");

	harness = new CommandsHarness(workspace, environment);
	harness.start();
	const commands = (await harness.request({ type: "get_commands" })).commands;
	assert.ok(commands.some((entry) => entry.name === "phase7-gate" && entry.source === "prompt"));
	assert.ok(commands.some((entry) => entry.name === "skill:phase7-gate-skill" && entry.source === "skill"));
	assert.ok(commands.every((entry) => entry.sourceInfo && typeof entry.sourceInfo.path === "string"));
	await harness.stop();
	console.log("[ecosystem-gate] real RPC get_commands with sourceInfo: PASS");

	runPi(["remove", packageDir, "--no-approve"], workspace, environment);
	assert.match(runPi(["list", "--no-approve"], workspace, environment).stdout, /No packages installed/);
	console.log("[ecosystem-gate] isolated user remove: PASS");

	runPi(["install", packageDir, "-l", "--approve"], workspace, environment);
	const hiddenProjectList = runPi(["list", "--no-approve"], workspace, environment).stdout;
	assert.match(hiddenProjectList, /No packages installed/);
	assert.doesNotMatch(hiddenProjectList, /phase7-package/);
	const projectList = runPi(["list", "--approve"], workspace, environment).stdout;
	assert.match(projectList, /Project packages:/);
	assert.match(projectList, /phase7-package/);
	runPi(["update", "--extension", packageDir, "--approve"], workspace, environment);
	runPi(["remove", packageDir, "-l", "--approve"], workspace, environment);
	assert.match(runPi(["list", "--approve"], workspace, environment).stdout, /No packages installed/);
	console.log("[ecosystem-gate] isolated project trust gate + install + list + update + remove: PASS");

	assert.equal(await optionalHash(actualSettings), settingsHashBefore, "The real Pi settings file must remain unchanged.");
	console.log("[ecosystem-gate] actual Pi settings unchanged: PASS");
	console.log("[ecosystem-gate] REAL PI ECOSYSTEM GATE: PASS");
} catch (error) {
	console.error(`[ecosystem-gate] REAL PI ECOSYSTEM GATE: FAIL\n${error instanceof Error ? error.stack : String(error)}`);
	if (harness?.stderr.trim()) console.error(`[ecosystem-gate] pi stderr:\n${harness.stderr.trim().slice(-4000)}`);
	process.exitCode = 1;
} finally {
	await harness?.stop();
	await rm(root, { recursive: true, force: true });
}
