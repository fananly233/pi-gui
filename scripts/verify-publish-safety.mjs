import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const DERIVATIVE_BASE = "5d698433864fbebafa24e141da0ea56297766cfe";
const LOCAL_PROMPT = "Pi Desktop Tauri 整合迁移 — Codex 主控提示词.md";

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
	encoding: "utf8",
}).trim();

function git(args) {
	return execFileSync("git", args, {
		cwd: repositoryRoot,
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

const failures = [];
const warnings = [];
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);

const candidateFiles = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
	.split("\0")
	.filter(Boolean);
const forbiddenFileName = /(^|\/)(?:\.env(?:\..+)?|auth\.json|credentials\.json|secrets\.json|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx))$/i;

for (const path of candidateFiles) {
	const normalized = path.replaceAll("\\", "/");
	if (!normalized.endsWith(".env.example") && forbiddenFileName.test(normalized)) {
		fail(`tracked private-config filename: ${normalized}`);
	}
}

const secretPatterns = [
	{
		name: "private key",
		content: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/g,
		history: "-----BEGIN( [A-Z0-9]+)? PRIVATE KEY-----",
	},
	{
		name: "GitHub token",
		content: /gh[pousr]_[A-Za-z0-9]{30,}/g,
		history: "gh[pousr]_[A-Za-z0-9]{30,}",
	},
	{
		name: "OpenAI-style key",
		content: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
		history: "sk-(proj-)?[A-Za-z0-9_-]{20,}",
	},
	{
		name: "Anthropic key",
		content: /sk-ant-[A-Za-z0-9_-]{20,}/g,
		history: "sk-ant-[A-Za-z0-9_-]{20,}",
	},
	{
		name: "AWS access key",
		content: /AKIA[0-9A-Z]{16}/g,
		history: "AKIA[0-9A-Z]{16}",
	},
	{
		name: "Slack token",
		content: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
		history: "xox[baprs]-[A-Za-z0-9-]{10,}",
	},
	{
		name: "Google API key",
		content: /AIza[0-9A-Za-z_-]{30,}/g,
		history: "AIza[0-9A-Za-z_-]{30,}",
	},
	{
		name: "credential-bearing URL",
		content: /https?:\/\/[^/\s:@]+:[^/\s@]+@/g,
		history: "https?://[^/[:space:]:@]+:[^/[:space:]@]+@",
	},
	{
		name: "long bearer token",
		content: /Bearer\s+[A-Za-z0-9._~-]{24,}/gi,
		history: "[Bb][Ee][Aa][Rr][Ee][Rr][[:space:]]+[A-Za-z0-9._~-]{24,}",
	},
];

const localHomes = new Set([
	homedir(),
	homedir().replaceAll("\\", "/"),
].map((value) => value.toLowerCase()).filter(Boolean));

for (const path of candidateFiles) {
	let bytes;
	try {
		bytes = readFileSync(resolve(repositoryRoot, path));
	} catch {
		continue;
	}
	if (bytes.includes(0)) continue;
	const content = bytes.toString("utf8");
	for (const pattern of secretPatterns) {
		pattern.content.lastIndex = 0;
		if (pattern.content.test(content)) fail(`${pattern.name} pattern in tracked file: ${path}`);
	}
	const lowerContent = content.toLowerCase();
	for (const home of localHomes) {
		if (home && lowerContent.includes(home)) fail(`local home path in tracked file: ${path}`);
	}
}

for (const pattern of secretPatterns) {
	const files = git([
		"log",
		"HEAD",
		"--format=",
		"--name-only",
		`-G${pattern.history}`,
		"--",
		".",
	]).split(/\r?\n/).filter(Boolean);
	for (const path of new Set(files)) fail(`${pattern.name} pattern in current-branch history: ${path}`);
}

try {
	git(["merge-base", "--is-ancestor", DERIVATIVE_BASE, "HEAD"]);
	const records = git([
		"log",
		`${DERIVATIVE_BASE}..HEAD`,
		"--format=%H%x00%ae%x00%ce%x1e",
	]).split("\x1e").filter((record) => record.trim());
	let unsafeMetadata = 0;
	for (const record of records) {
		const [, authorEmail = "", committerEmail = ""] = record.trim().split("\0");
		if (![authorEmail, committerEmail].every((email) => /@users\.noreply\.github\.com$/i.test(email))) {
			unsafeMetadata += 1;
		}
	}
	if (unsafeMetadata) {
		fail(`${unsafeMetadata} post-fork commit(s) use non-noreply author or committer email metadata`);
	}

	const messageEmails = git(["log", `${DERIVATIVE_BASE}..HEAD`, "--format=%B%x00"])
		.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
	if (messageEmails.some((email) => !/@users\.noreply\.github\.com$/i.test(email))) {
		fail("post-fork commit messages contain non-noreply email addresses");
	}
} catch {
	fail("unable to verify the fixed Gustav derivative base against HEAD");
}

const remoteLines = git(["remote", "-v"]);
if (/https?:\/\/[^/\s:@]+:[^/\s@]+@/i.test(remoteLines) || /gh[pousr]_[A-Za-z0-9]{20,}/.test(remoteLines)) {
	fail("a Git remote URL appears to contain credentials");
}

if (git(["ls-files", "--", LOCAL_PROMPT]).trim()) {
	fail("the local migration control prompt is tracked");
}

const readme = readFileSync(resolve(repositoryRoot, "README.md"), "utf8");
const notices = readFileSync(resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
for (const source of ["github.com/gustavonline/pi-desktop", "github.com/DLYZZT/pi-desktop"]) {
	if (!readme.includes(source) || !notices.includes(source)) fail(`missing derivative-work source declaration: ${source}`);
}

if (!git(["remote"]).split(/\r?\n/).includes("origin")) {
	warn("no independent origin is configured; no push target was changed");
}

try {
	git(["show-ref", "--verify", "refs/heads/archive/electron-mvp"]);
	warn("archive/electron-mvp is local-only; push the reviewed Pi GUI branch, never --all or --mirror");
} catch {
	// The optional local archive does not exist in every clone.
}

console.log(`Publish-safety scan: ${candidateFiles.length} tracked/non-ignored candidate files, current HEAD history, Git metadata, and remotes.`);
for (const message of warnings) console.warn(`WARN: ${message}`);

if (failures.length) {
	for (const message of failures) console.error(`FAIL: ${message}`);
	console.error(`Publish-safety scan failed with ${failures.length} issue(s). No suspected secret values were printed.`);
	process.exit(1);
}

console.log("Publish-safety scan passed.");
