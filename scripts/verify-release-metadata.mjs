import fs from "node:fs";

function readJson(path) {
	return JSON.parse(fs.readFileSync(path, "utf8"));
}

function requireMatch(value, expected, label) {
	if (value !== expected) {
		throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
	}
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const indexHtml = fs.readFileSync("index.html", "utf8");
const metainfo = fs.readFileSync("src-tauri/linux/com.pi.gui.metainfo.xml", "utf8");

requireMatch(packageJson.name, "pi-gui", "npm package name");
requireMatch(packageLock.name, packageJson.name, "npm lockfile name");
requireMatch(packageLock.version, packageJson.version, "npm lockfile version");
requireMatch(packageLock.packages[""].name, packageJson.name, "npm lockfile root name");
requireMatch(packageLock.packages[""].version, packageJson.version, "npm lockfile root version");
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

const cargoName = cargoToml.match(/^name = "([^"]+)"/m)?.[1];
const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];
requireMatch(cargoName, packageJson.name, "Cargo package name");
requireMatch(cargoVersion, packageJson.version, "Cargo package version");

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

for (const staleField of ["homepage", "repository", "bugs"]) {
	if (Object.hasOwn(packageJson, staleField)) {
		throw new Error(`package.json ${staleField} must remain unset until an independent origin exists`);
	}
}

const releaseTag = process.env.RELEASE_TAG?.trim();
if (releaseTag) {
	requireMatch(releaseTag, `v${packageJson.version}`, "release tag");
}

console.log(`RELEASE_METADATA=PASS name=${packageJson.name} version=${packageJson.version} id=${tauriConfig.identifier}`);
