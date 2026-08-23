import fs from "node:fs";

function readJson(path) {
	return JSON.parse(fs.readFileSync(path, "utf8"));
}

function requireMatch(value, expected, label) {
	if (value !== expected) {
		throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
	}
}

function requireIncludes(value, expected, label) {
	if (!value.includes(expected)) {
		throw new Error(`${label}: missing ${JSON.stringify(expected)}`);
	}
}

function rejectIncludes(value, rejected, label) {
	if (value.includes(rejected)) {
		throw new Error(`${label}: contains forbidden marker ${JSON.stringify(rejected)}`);
	}
}

function requireOrder(value, markers, label) {
	let previousIndex = -1;
	for (const marker of markers) {
		const index = value.indexOf(marker);
		if (index < 0) {
			throw new Error(`${label}: missing ${JSON.stringify(marker)}`);
		}
		if (index <= previousIndex) {
			throw new Error(`${label}: ${JSON.stringify(marker)} is out of order`);
		}
		previousIndex = index;
	}
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const indexHtml = fs.readFileSync("index.html", "utf8");
const metainfo = fs.readFileSync("src-tauri/linux/com.pi.gui.metainfo.xml", "utf8");
const iconSourcePath = "assets/branding/pi-gui-icon.svg";
const inheritedIconSourcePath = "assets/branding/pi-desktop-icon.svg";
const releaseWorkflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
const cleanMachineWorkflow = fs.readFileSync(".github/workflows/windows-clean-machine.yml", "utf8");
const releaseTemplate = fs.readFileSync(".github/RELEASE_TEMPLATE.md", "utf8");
const readme = fs.readFileSync("README.md", "utf8");
const distributionPolicy = fs.readFileSync("docs/SIGNING.md", "utf8");
const repositoryUrl = "https://github.com/fananly233/pi-gui";

requireMatch(packageJson.name, "pi-gui", "npm package name");
requireMatch(packageLock.name, packageJson.name, "npm lockfile name");
requireMatch(packageLock.version, packageJson.version, "npm lockfile version");
requireMatch(packageLock.packages[""].name, packageJson.name, "npm lockfile root name");
requireMatch(packageLock.packages[""].version, packageJson.version, "npm lockfile root version");
requireMatch(packageJson.homepage, `${repositoryUrl}#readme`, "npm homepage");
requireMatch(packageJson.repository?.type, "git", "npm repository type");
requireMatch(packageJson.repository?.url, `git+${repositoryUrl}.git`, "npm repository URL");
requireMatch(packageJson.bugs?.url, `${repositoryUrl}/issues`, "npm issue tracker");
requireMatch(tauriConfig.$schema, "https://schema.tauri.app/config/2", "Tauri schema");
requireMatch(tauriConfig.productName, "Pi GUI", "Tauri product name");
requireMatch(tauriConfig.identifier, "com.pi.gui", "Tauri identifier");
requireMatch(tauriConfig.version, packageJson.version, "Tauri version");
requireMatch(tauriConfig.bundle.publisher, "Pi GUI contributors", "bundle publisher");
requireMatch(tauriConfig.bundle.windows.allowDowngrades, false, "Windows downgrade policy");
requireMatch(tauriConfig.bundle.windows.nsis.installMode, "currentUser", "NSIS install mode");
requireMatch(
	tauriConfig.bundle.windows.webviewInstallMode.type,
	"downloadBootstrapper",
	"WebView2 install mode",
);
requireMatch(
	tauriConfig.bundle.windows.wix.upgradeCode,
	"bc684a49-735f-5100-8ea3-5bb516c8f702",
	"WiX upgrade code",
);
for (const property of ["certificateThumbprint", "timestampUrl", "signCommand"]) {
	if (Object.hasOwn(tauriConfig.bundle.windows, property)) {
		throw new Error(`source-only policy forbids checked-in Windows signing property: ${property}`);
	}
}

const cargoName = cargoToml.match(/^name = "([^"]+)"/m)?.[1];
const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];
const cargoLicense = cargoToml.match(/^license = "([^"]+)"/m)?.[1];
const cargoHomepage = cargoToml.match(/^homepage = "([^"]+)"/m)?.[1];
const cargoRepository = cargoToml.match(/^repository = "([^"]+)"/m)?.[1];
requireMatch(cargoName, packageJson.name, "Cargo package name");
requireMatch(cargoVersion, packageJson.version, "Cargo package version");
requireMatch(cargoLicense, packageJson.license, "Cargo package license");
requireMatch(cargoHomepage, repositoryUrl, "Cargo homepage");
requireMatch(cargoRepository, repositoryUrl, "Cargo repository");

if (!indexHtml.includes("<title>Pi GUI</title>")) {
	throw new Error("index.html title is not Pi GUI");
}
if (!metainfo.includes("<id>com.pi.gui</id>")) {
	throw new Error("Linux metainfo identifier is not com.pi.gui");
}
if (!metainfo.includes("<name>Pi GUI</name>")) {
	throw new Error("Linux metainfo product name is not Pi GUI");
}
if (!metainfo.includes(`<release version="${packageJson.version}" />`)) {
	throw new Error(`Linux metainfo does not declare version ${packageJson.version}`);
}
for (const url of [repositoryUrl, `${repositoryUrl}/issues`]) {
	if (!metainfo.includes(`>${url}</url>`)) {
		throw new Error(`Linux metainfo does not declare ${url}`);
	}
}

if (!fs.existsSync(iconSourcePath)) {
	throw new Error(`Pi GUI icon source is missing: ${iconSourcePath}`);
}
if (fs.existsSync(inheritedIconSourcePath)) {
	throw new Error(`inherited icon source filename is still present: ${inheritedIconSourcePath}`);
}
const iconSource = fs.readFileSync(iconSourcePath, "utf8");
if (!iconSource.includes("GUI wordmark") || iconSource.includes("DESK wordmark")) {
	throw new Error("Pi GUI icon source does not contain the reviewed GUI wordmark");
}

if (fs.existsSync(".github/workflows/release-smoke.yml")) {
	throw new Error("source-only policy forbids a binary release-smoke workflow");
}
requireOrder(
	releaseWorkflow,
	["Validate source policy and repository", "Create or update source-only draft"],
	"source-only release workflow",
);
for (const marker of [
	"name: Source-only Release",
	'"pi-gui-v*"',
	"^pi-gui-v",
	"npm run check:publish",
	"npm run check:release",
	"--verify-tag",
	"--draft",
	"--json assets",
	"Source-only draft",
]) {
	requireIncludes(releaseWorkflow, marker, "source-only release workflow");
}
for (const marker of [
	"actions/upload-artifact",
	"actions/download-artifact",
	"gh release upload",
	"tauri -- build",
	"--bundles",
	"WINDOWS_CERTIFICATE",
	"WINDOWS_SIGNING_MODE",
	"WINDOWS_EXPECTED_SIGNER_SUBJECT",
	"WINDOWS_TIMESTAMP_URL",
	"certificateThumbprint",
	"signCommand",
]) {
	rejectIncludes(releaseWorkflow, marker, "source-only release workflow");
}
for (const marker of ["actions/upload-artifact", "gh release download", "previous_tag"]) {
	rejectIncludes(cleanMachineWorkflow, marker, "ephemeral clean-machine workflow");
}
for (const [content, marker, label] of [
	[releaseTemplate, "This release contains source code only.", "release template"],
	[releaseTemplate, "zero attached assets", "release template"],
	[readme, "仅发布源码", "README source-only notice"],
	[distributionPolicy, "Source-only", "distribution policy"],
]) {
	requireIncludes(content, marker, label);
}

const releaseTag = process.env.RELEASE_TAG?.trim();
if (releaseTag) {
	requireMatch(releaseTag, `pi-gui-v${packageJson.version}`, "release tag");
}

console.log(
	`RELEASE_METADATA=PASS name=${packageJson.name} version=${packageJson.version} id=${tauriConfig.identifier} distribution=source-only binaryAssets=forbidden credentials=not-read`,
);
