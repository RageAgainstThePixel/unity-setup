import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as path from 'path';

/** The Unity CLI version this action is tested against. Bump on purpose. */
export const DEFAULT_UNITY_CLI_VERSION = '1.0.0-beta.14';

const TOOL_NAME = 'unity-cli';
const IS_WINDOWS = process.platform === 'win32';
const EXE_NAME = IS_WINDOWS ? 'unity.exe' : 'unity';

export interface UnityCli {
    /** Full path to the unity executable. */
    path: string;
    /** The version reported by `unity --version`. */
    version: string;
}

/**
 * Makes the Unity CLI available on the PATH.
 * Reuses an installed CLI when its version matches, otherwise installs it
 * with Unity's install script and pins it with `unity self-update --target`.
 * @param version An exact version such as 1.0.0-beta.14, or `latest`. Defaults to {@link DEFAULT_UNITY_CLI_VERSION}.
 */
export async function setupUnityCli(version?: string): Promise<UnityCli> {
    const requested = normalizeVersion(version || DEFAULT_UNITY_CLI_VERSION);
    const isLatest = requested === 'latest';
    configureEnvironment();
    // 1. already on the PATH (setup-unity-cli step, self-hosted runner, or an earlier step in this job)
    const existing = await io.which('unity', false);
    if (existing) {
        const existingVersion = await getVersion(existing);
        if (isLatest || existingVersion === requested) {
            core.info(`Using Unity CLI ${existingVersion} at ${existing}`);
            return exportCli(existing, existingVersion);
        }
        core.info(`Found Unity CLI ${existingVersion} at ${existing}, but ${requested} was requested`);
    }
    // 2. tool cache from an earlier job on this runner
    if (!isLatest) {
        const cached = tc.find(TOOL_NAME, requested);
        if (cached) {
            const cachedPath = path.join(cached, EXE_NAME);
            const cachedVersion = await getVersion(cachedPath);
            if (cachedVersion === requested) {
                core.info(`Using cached Unity CLI ${cachedVersion}`);
                core.addPath(cached);
                return exportCli(cachedPath, cachedVersion);
            }
            core.warning(`Cached Unity CLI reports ${cachedVersion}, expected ${requested}, reinstalling`);
        }
    }
    // 3. install
    return await installUnityCli(requested);
}

async function installUnityCli(requested: string): Promise<UnityCli> {
    const cliHome = path.join(getTempDir(), `${TOOL_NAME}-${Date.now()}`);
    await io.mkdirP(cliHome);
    core.info(`Installing Unity CLI ${requested}...`);
    const env = { ...process.env, UNITY_CLI_HOME: cliHome } as { [key: string]: string };
    if (IS_WINDOWS) {
        await exec.exec('powershell', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://unity.com/install.ps1 | iex'], { env });
    } else {
        await exec.exec('bash', ['-c', 'set -o pipefail; curl -fsSL https://unity.com/install.sh | bash'], { env });
    }
    const binDir = path.join(cliHome, 'bin');
    let cliPath = path.join(binDir, EXE_NAME);
    if (!fs.existsSync(cliPath)) {
        throw new Error(`Unity CLI install script did not create ${cliPath}`);
    }
    let installed = await getVersion(cliPath);
    // the install script always installs the latest release, so pin the requested one
    if (requested !== 'latest' && installed !== requested) {
        core.info(`Install script installed ${installed}, switching to ${requested}...`);
        await exec.exec(cliPath, ['self-update', '--target', requested], { env });
        installed = await getVersion(cliPath);
        if (installed !== requested) {
            throw new Error(`Failed to install Unity CLI ${requested}, found ${installed}`);
        }
    }
    const cachedDir = await tc.cacheDir(binDir, TOOL_NAME, installed);
    core.addPath(cachedDir);
    cliPath = path.join(cachedDir, EXE_NAME);
    core.info(`Installed Unity CLI ${installed}`);
    return exportCli(cliPath, installed);
}

/** Runs `unity --version` and returns the trimmed version string. */
export async function getVersion(cliPath: string): Promise<string> {
    const { exitCode, stdout, stderr } = await exec.getExecOutput(cliPath, ['--version'], {
        silent: true,
        ignoreReturnCode: true,
    });
    if (exitCode !== 0) {
        throw new Error(`${cliPath} --version failed with exit code ${exitCode}: ${stderr.trim()}`);
    }
    const match = stdout.match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
    if (!match) {
        throw new Error(`Unable to parse Unity CLI version from: ${stdout.trim()}`);
    }
    return match[1];
}

function normalizeVersion(version: string): string {
    const trimmed = version.trim();
    if (trimmed.toLowerCase() === 'latest') {
        return 'latest';
    }
    const normalized = trimmed.replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
        throw new Error(`Invalid Unity CLI version: ${version}. Use an exact version such as ${DEFAULT_UNITY_CLI_VERSION}, or latest.`);
    }
    return normalized;
}

/** Keeps the CLI from prompting or updating itself mid-job. */
function configureEnvironment(): void {
    const vars = {
        UNITY_NON_INTERACTIVE: '1',
        UNITY_NO_UPDATE_CHECK: '1',
        UNITY_NO_CONSENT_PROMPT: '1',
    };
    for (const [name, value] of Object.entries(vars)) {
        if (!process.env[name]) {
            core.exportVariable(name, value);
        }
    }
}

function exportCli(cliPath: string, version: string): UnityCli {
    core.exportVariable('UNITY_CLI_PATH', cliPath);
    core.exportVariable('UNITY_CLI_VERSION', version);
    return { path: cliPath, version };
}

function getTempDir(): string {
    const tempDir = process.env.RUNNER_TEMP;
    if (!tempDir) {
        throw new Error('RUNNER_TEMP is not set');
    }
    return tempDir;
}
