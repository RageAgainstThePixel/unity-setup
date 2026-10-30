import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { UnityVersion } from './unity-version';

export interface UnityEditor {
    version: UnityVersion;
    /** Full path to the editor executable. */
    editorPath: string;
    /** The editor's install directory, the parent of the Editor folder (or Unity.app on macOS). */
    editorRootPath: string;
}

/**
 * Maps build targets to the module ids that support them on this platform.
 */
export function getPlatformTargetModuleMap(): { [key: string]: string } {
    switch (os.type()) {
        case 'Linux':
            return {
                StandaloneLinux64: 'linux-il2cpp',
                Android: 'android',
                WebGL: 'webgl',
                iOS: 'ios',
            };
        case 'Darwin':
            return {
                StandaloneOSX: 'mac-il2cpp',
                iOS: 'ios',
                Android: 'android',
                tvOS: 'appletv',
                StandaloneLinux64: 'linux-il2cpp',
                WebGL: 'webgl',
                VisionOS: 'visionos',
            };
        case 'Windows_NT':
            return {
                StandaloneWindows64: 'windows-il2cpp',
                WSAPlayer: 'universal-windows-platform',
                Android: 'android',
                iOS: 'ios',
                tvOS: 'appletv',
                StandaloneLinux64: 'linux-il2cpp',
                WebGL: 'webgl',
            };
        default:
            throw new Error(`${os.type()} not supported`);
    }
}

/** Thin wrapper over the official Unity CLI. */
export class UnityCliClient {
    constructor(public readonly cliPath: string) { }

    /**
     * Sets the directory the CLI installs editors to.
     * @param installPath The directory to install editors to.
     */
    async setInstallPath(installPath: string): Promise<void> {
        await fs.promises.mkdir(installPath, { recursive: true });
        await this.exec(['editors', 'install-path', '--set', installPath]);
    }

    /** Gets the directory the CLI installs editors to. */
    async getInstallPath(): Promise<string> {
        const output = await this.execJson(['editors', 'install-path']);
        const installPath = findPath(output);
        if (!installPath) {
            throw new Error(`Unable to read the editor install path from: ${JSON.stringify(output)}`);
        }
        return installPath;
    }

    /**
     * Finds the requested editor, installing it and any missing modules when needed.
     * @param unityVersion An exact Unity version with its changeset.
     * @param modules The module ids to install with the editor.
     */
    async getEditor(unityVersion: UnityVersion, modules: string[]): Promise<UnityEditor> {
        let editor = await this.findEditor(unityVersion);
        if (!editor) {
            await this.install(unityVersion, modules);
            editor = await this.findEditor(unityVersion);
            if (!editor) {
                throw new Error(`Unity ${unityVersion.toString()} was installed, but its editor could not be found`);
            }
        } else if (modules.length > 0) {
            await this.installModules(unityVersion, modules);
        }
        await patchBeeBackend(editor.editorPath);
        return editor;
    }

    private async install(unityVersion: UnityVersion, modules: string[]): Promise<void> {
        const args = ['install', unityVersion.version];
        if (unityVersion.changeset) {
            args.push('--changeset', unityVersion.changeset);
        }
        if (modules.length > 0) {
            args.push('--module', ...modules, '--child-modules');
        }
        if (process.platform === 'darwin') {
            args.push('--architecture', unityVersion.architecture.toLowerCase());
        }
        args.push('--accept-eula', '--yes');
        await this.exec(args);
    }

    private async installModules(unityVersion: UnityVersion, modules: string[]): Promise<void> {
        await this.exec(['install-modules', '--editor-version', unityVersion.version, '--module', ...modules, '--child-modules', '--yes']);
    }

    /**
     * Looks up an installed editor with `unity editors path`, registering a restored
     * cache with `unity editors add` when the CLI does not know about it yet.
     */
    private async findEditor(unityVersion: UnityVersion): Promise<UnityEditor | undefined> {
        const args = ['editors', 'path', unityVersion.version];
        if (process.platform === 'darwin') {
            args.push('--architecture', unityVersion.architecture.toLowerCase());
        }
        const { exitCode, stdout, stderr } = await exec.getExecOutput(this.cliPath, [...args, '--format', 'json'], {
            silent: true,
            ignoreReturnCode: true,
        });
        core.debug(`unity ${args.join(' ')} [${exitCode}]:\n${stdout}${stderr}`);
        let editorPath: string | undefined;
        if (exitCode === 0) {
            editorPath = resolveEditorExecutable(findPath(parseJson(stdout)));
        }
        if (!editorPath) {
            editorPath = await this.registerExistingEditor(unityVersion);
        }
        if (!editorPath) {
            return undefined;
        }
        return {
            version: unityVersion,
            editorPath,
            editorRootPath: getEditorRootPath(editorPath),
        };
    }

    private async registerExistingEditor(unityVersion: UnityVersion): Promise<string | undefined> {
        let installPath: string;
        try {
            installPath = await this.getInstallPath();
        } catch (error) {
            core.debug(`${error}`);
            return undefined;
        }
        const candidates = [
            path.join(installPath, unityVersion.version),
            path.join(installPath, `${unityVersion.version}-${unityVersion.architecture.toLowerCase()}`),
        ];
        for (const candidate of candidates) {
            const editorPath = resolveEditorExecutable(candidate);
            if (editorPath) {
                core.info(`Registering existing Unity ${unityVersion.version} at ${editorPath}`);
                await this.exec(['editors', 'add', editorPath]);
                return editorPath;
            }
        }
        return undefined;
    }

    private async exec(args: string[]): Promise<void> {
        const exitCode = await exec.exec(this.cliPath, args, { ignoreReturnCode: true });
        if (exitCode !== 0) {
            throw new Error(`unity ${args.join(' ')} failed with exit code ${exitCode}`);
        }
    }

    private async execJson(args: string[]): Promise<unknown> {
        const { exitCode, stdout, stderr } = await exec.getExecOutput(this.cliPath, [...args, '--format', 'json'], {
            silent: true,
            ignoreReturnCode: true,
        });
        core.debug(`unity ${args.join(' ')} [${exitCode}]:\n${stdout}${stderr}`);
        if (exitCode !== 0) {
            throw new Error(`unity ${args.join(' ')} failed with exit code ${exitCode}:\n${stdout}${stderr}`);
        }
        return parseJson(stdout);
    }
}

function parseJson(output: string): unknown {
    const trimmed = output.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        // not JSON, fall back to the last line of plain text output
        const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        return lines[lines.length - 1];
    }
}

const PATH_KEYS = ['path', 'editorPath', 'installPath', 'location', 'directory', 'value'];

/** Finds the first absolute path in a CLI result, preferring well-known keys under `data`. */
function findPath(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return path.isAbsolute(value) ? value : undefined;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findPath(item);
            if (found) {
                return found;
            }
        }
        return undefined;
    }
    if (value && typeof value === 'object') {
        const record = value as { [key: string]: unknown };
        if ('data' in record) {
            const found = findPath(record.data);
            if (found) {
                return found;
            }
        }
        for (const key of PATH_KEYS) {
            const found = findPath(record[key]);
            if (found) {
                return found;
            }
        }
        for (const [key, item] of Object.entries(record)) {
            if (key === 'errors' || key === 'warnings') {
                continue;
            }
            const found = findPath(item);
            if (found) {
                return found;
            }
        }
    }
    return undefined;
}

/** Resolves an install directory, Editor folder, app bundle or executable to the editor executable. */
function resolveEditorExecutable(location: string | undefined): string | undefined {
    if (!location || !fs.existsSync(location)) {
        return undefined;
    }
    if (fs.statSync(location).isFile()) {
        return location;
    }
    let candidates: string[];
    switch (process.platform) {
        case 'darwin':
            candidates = [
                path.join(location, 'Unity.app', 'Contents', 'MacOS', 'Unity'),
                path.join(location, 'Contents', 'MacOS', 'Unity'),
            ];
            break;
        case 'win32':
            candidates = [
                path.join(location, 'Editor', 'Unity.exe'),
                path.join(location, 'Unity.exe'),
            ];
            break;
        default:
            candidates = [
                path.join(location, 'Editor', 'Unity'),
                path.join(location, 'Unity'),
            ];
            break;
    }
    return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function getEditorRootPath(editorPath: string): string {
    if (process.platform === 'darwin') {
        // <root>/Unity.app/Contents/MacOS/Unity
        return path.resolve(editorPath, '..', '..', '..', '..');
    }
    // <root>/Editor/Unity(.exe)
    return path.resolve(editorPath, '..', '..');
}

/**
 * Patches the Bee Backend for the Unity Linux Editor.
 * https://discussions.unity.com/t/linux-editor-stuck-on-loading-because-of-bee-backend-w-workaround/854480
 * @param editorPath The path to the Unity Editor executable.
 */
async function patchBeeBackend(editorPath: string): Promise<void> {
    if (process.platform !== 'linux') {
        return;
    }
    const dataPath = path.join(path.dirname(editorPath), 'Data');
    const beeBackend = path.join(dataPath, 'bee_backend');
    const dotBeeBackend = path.join(dataPath, '.bee_backend');
    if (fs.existsSync(beeBackend) && !fs.existsSync(dotBeeBackend)) {
        core.info('Patching Unity Linux Editor for Bee Backend...');
        await fs.promises.rename(beeBackend, dotBeeBackend);
        const wrapperSource = `#!/bin/bash
# https://discussions.unity.com/t/linux-editor-stuck-on-loading-because-of-bee-backend-w-workaround/854480
set -e
args=("$@")
for ((i = 0; i < "\${#args[@]}"; ++i)); do
    case \${args[i]} in
    --stdin-canary)
        unset "args[i]"
        break
        ;;
    esac
done
"$(dirname "$0")/.$(basename "$0")" "\${args[@]}"`;
        await fs.promises.writeFile(beeBackend, wrapperSource, { encoding: 'utf-8', mode: 0o755 });
    }
}
