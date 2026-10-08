// APK verification (CI job "apk-verify"). Usage: node tests/apk/verify-apk.mjs <dist-dir>
// Asserts package id, version, SDK levels, permissions, debuggable flag, signature, bundled URLs and size.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXPECTED_PACKAGE = 'app.sweetcascade.game';
const EXPECTED_MIN_SDK = 24;
const EXPECTED_TARGET_SDK = 36;
const MAX_APK_BYTES = 25 * 1024 * 1024;
// Normal-protection permissions only. INTERNET is intentionally absent (the game is fully offline).
const ALLOWED_PERMISSIONS = new Set([
  'android.permission.VIBRATE',
  `${EXPECTED_PACKAGE}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
]);
const ALLOWED_NAMESPACE_URL_PREFIXES = ['http://www.w3.org/', 'http://schemas.android.com/'];

const dist_dir = process.argv[2] || 'dist';
const build_info = JSON.parse(fs.readFileSync(path.join(dist_dir, 'build-info.json'), 'utf8'));
const package_json = JSON.parse(fs.readFileSync('package.json', 'utf8'));

let failure_count = 0;
const result_rows = [];
function check(label, passed, detail) {
  result_rows.push(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ->  ' + detail : ''}`);
  if (!passed) failure_count += 1;
}

function findBuildTool(tool_name) {
  const sdk_root = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk_root) throw new Error('ANDROID_HOME is not set');
  const versions = fs.readdirSync(path.join(sdk_root, 'build-tools'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (let index = versions.length - 1; index >= 0; index -= 1) {
    const candidate = path.join(sdk_root, 'build-tools', versions[index], tool_name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${tool_name} not found in ${sdk_root}/build-tools`);
}

function run(tool_path, args) {
  return execFileSync(tool_path, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function readBadging(apk_path) {
  const badging = run(findBuildTool('aapt2'), ['dump', 'badging', apk_path]);
  const package_line = badging.split('\n').find((line) => line.startsWith('package:')) || '';
  const attribute = (line, name) => {
    const match = line.match(new RegExp(`${name}='([^']*)'`));
    return match ? match[1] : null;
  };
  const sdk_line = badging.split('\n').find((line) => line.startsWith('sdkVersion:')) || '';
  const target_line = badging.split('\n').find((line) => line.startsWith('targetSdkVersion:')) || '';
  const permissions = [...badging.matchAll(/^uses-permission: name='([^']+)'/gm)].map((match) => match[1]);
  return {
    raw: badging,
    package_name: attribute(package_line, 'name'),
    version_code: Number(attribute(package_line, 'versionCode')),
    version_name: attribute(package_line, 'versionName'),
    min_sdk: Number((sdk_line.match(/'(\d+)'/) || [])[1]),
    target_sdk: Number((target_line.match(/'(\d+)'/) || [])[1]),
    permissions,
    debuggable: /^application-debuggable/m.test(badging),
  };
}

function listZipEntries(apk_path) {
  return run('unzip', ['-Z1', apk_path]).split('\n').filter(Boolean);
}

function extractAssets(apk_path) {
  const extract_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-assets-'));
  execFileSync('unzip', ['-q', '-o', apk_path, 'assets/*', '-d', extract_dir]);
  return extract_dir;
}

function walkFiles(directory) {
  const found_files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entry_path = path.join(directory, entry.name);
    if (entry.isDirectory()) found_files.push(...walkFiles(entry_path));
    else found_files.push(entry_path);
  }
  return found_files;
}

function isCommentLine(line, match_index) {
  const before = line.slice(0, match_index);
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || before.includes('//') || before.includes('/*');
}

function scanUrls(asset_root) {
  const offending_urls = [];
  const framework_comment_urls = [];
  for (const file_path of walkFiles(asset_root)) {
    if (!/\.(html|js|css|json|txt|svg|xml|webmanifest)$/i.test(file_path)) continue;
    const relative_path = path.relative(asset_root, file_path);
    const is_framework_file = relative_path === path.join('assets', 'native-bridge.js');
    const lines = fs.readFileSync(file_path, 'utf8').split('\n');
    lines.forEach((line, line_index) => {
      for (const match of line.matchAll(/https?:\/\/[^\s"'`<>)\\]+/g)) {
        const url = match[0];
        if (ALLOWED_NAMESPACE_URL_PREFIXES.some((prefix) => url.startsWith(prefix))) continue;
        const location = `${relative_path}:${line_index + 1} ${url}`;
        if (is_framework_file && isCommentLine(line, match.index)) framework_comment_urls.push(location);
        else offending_urls.push(location);
      }
    });
  }
  return { offending_urls, framework_comment_urls };
}

// ---------------------------------------------------------------- release APK
const release_apk_path = path.join(dist_dir, build_info.apk);
const debug_apk_path = path.join(dist_dir, 'test-only-debug-build.apk');
check('release APK exists', fs.existsSync(release_apk_path), release_apk_path);

const release_badging = readBadging(release_apk_path);
check('package id', release_badging.package_name === EXPECTED_PACKAGE, release_badging.package_name);
check('versionName matches package.json', release_badging.version_name === package_json.version, release_badging.version_name);
check('versionCode equals CI run number', release_badging.version_code === Number(build_info.versionCode) && release_badging.version_code > 0, String(release_badging.version_code));
check('minSdk', release_badging.min_sdk === EXPECTED_MIN_SDK, String(release_badging.min_sdk));
check('targetSdk', release_badging.target_sdk === EXPECTED_TARGET_SDK, String(release_badging.target_sdk));
const unexpected_permissions = release_badging.permissions.filter((permission) => !ALLOWED_PERMISSIONS.has(permission));
check('no dangerous or unexpected permissions', unexpected_permissions.length === 0, `declared: ${release_badging.permissions.join(', ') || '(none)'}`);
check('INTERNET permission absent', !release_badging.permissions.includes('android.permission.INTERNET'));
check('release build is not debuggable', !release_badging.debuggable);

const manifest_tree = run(findBuildTool('aapt2'), ['dump', 'xmltree', '--file', 'AndroidManifest.xml', release_apk_path]);
check('manifest has no android:debuggable=true', !/debuggable\(0x0101000f\)=(true|\(type 0x12\)0xffffffff|-1)/.test(manifest_tree));
check('activity locked to portrait', /screenOrientation\(0x0101001e\)=(1|\(type 0x10\)0x1)\b/.test(manifest_tree), (manifest_tree.match(/screenOrientation[^\n]*/) || ['(missing)'])[0].trim());

let signer_output = '';
let signature_ok = false;
try {
  signer_output = run(findBuildTool('apksigner'), ['verify', '--verbose', '--print-certs', release_apk_path]);
  signature_ok = /Verifies/.test(signer_output) && /Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(signer_output);
} catch (signer_error) {
  signer_output = String(signer_error.stdout || signer_error.message);
}
check('apksigner verify (v2 signature)', signature_ok);
const signer_dn = (signer_output.match(/Signer #1 certificate DN: (.*)/) || [])[1] || '?';
const signer_sha256 = (signer_output.match(/Signer #1 certificate SHA-256 digest: (.*)/) || [])[1] || '?';

const release_entries = listZipEntries(release_apk_path);
check('game bundled (assets/public/index.html)', release_entries.includes('assets/public/index.html'));
check('test hook absent from release APK', !release_entries.some((entry) => entry.includes('test-hook')));

const release_assets_dir = extractAssets(release_apk_path);
const capacitor_config = JSON.parse(fs.readFileSync(path.join(release_assets_dir, 'assets', 'capacitor.config.json'), 'utf8'));
check('no remote server.url in capacitor config', !(capacitor_config.server && capacitor_config.server.url), JSON.stringify(capacitor_config.server || {}));
const url_scan = scanUrls(release_assets_dir);
check('no external http(s) URLs in bundled assets', url_scan.offending_urls.length === 0, url_scan.offending_urls.slice(0, 10).join(' | '));

const release_size_bytes = fs.statSync(release_apk_path).size;
check('APK size under 25 MB', release_size_bytes < MAX_APK_BYTES, `${(release_size_bytes / 1048576).toFixed(2)} MB`);

// ---------------------------------------------------------------- debug (test-only) APK
if (fs.existsSync(debug_apk_path)) {
  const debug_badging = readBadging(debug_apk_path);
  check('test-only debug APK is debuggable', debug_badging.debuggable);
  check('test hook present in test-only debug APK', listZipEntries(debug_apk_path).includes('assets/public/test-hook.js'));
}

console.log('================ APK VERIFICATION ================');
console.log(`APK:            ${build_info.apk}`);
console.log(`Package:        ${release_badging.package_name}`);
console.log(`Version:        ${release_badging.version_name} (versionCode ${release_badging.version_code})`);
console.log(`SDK:            min ${release_badging.min_sdk}, target ${release_badging.target_sdk}`);
console.log(`Permissions:    ${release_badging.permissions.join(', ') || '(none)'}`);
console.log(`Signing mode:   ${build_info.signing}`);
console.log(`Signer DN:      ${signer_dn}`);
console.log(`Signer SHA-256: ${signer_sha256}`);
console.log(`APK size:       ${release_size_bytes} bytes (${(release_size_bytes / 1048576).toFixed(2)} MB)`);
if (url_scan.framework_comment_urls.length) {
  console.log(`Note: ${url_scan.framework_comment_urls.length} documentation link(s) inside comments of Capacitor's own native-bridge.js (never requested):`);
  url_scan.framework_comment_urls.forEach((location) => console.log(`  ${location}`));
}
console.log('--------------------------------------------------');
result_rows.forEach((row) => console.log(row));
console.log('--------------------------------------------------');
console.log(failure_count === 0 ? 'APK VERIFY: ALL PASSED' : `APK VERIFY: ${failure_count} FAILED`);
process.exit(failure_count === 0 ? 0 : 1);
