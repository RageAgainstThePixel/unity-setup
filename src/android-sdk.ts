import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { UnityEditor } from './unity-editor';
import { resolveGlobToPath } from './utilities';

/**
 * Installs the Android target SDK the project asks for when the editor's bundled SDK does not have it.
 * @param editor The installed Unity Editor.
 * @param projectPath The path to the Unity project.
 */
export async function checkAndroidSdkInstalled(editor: UnityEditor, projectPath: string): Promise<void> {
    core.info(`Checking Android SDK installation for:\n  > Editor: ${editor.editorRootPath}\n  > Project: ${projectPath}`);
    const projectSettingsPath = path.join(projectPath, 'ProjectSettings', 'ProjectSettings.asset');
    const projectSettings = await fs.promises.readFile(projectSettingsPath, 'utf8');
    const match = projectSettings.match(/(?<=AndroidTargetSdkVersion: )\d+/);
    const androidTargetSdk = match ? parseInt(match[0]) : 0;
    core.info(`AndroidTargetSdkVersion:\n  > ${androidTargetSdk}`);
    if (!androidTargetSdk) {
        return;
    }
    let sdkPath = await getAndroidSdkPath(editor, androidTargetSdk);
    if (sdkPath) {
        core.info(`Target Android SDK android-${androidTargetSdk} installed in:\n  > "${sdkPath}"`);
        return;
    }
    await createRepositoryCfg();
    core.info(`Installing Android Target SDK:\n  > android-${androidTargetSdk}`);
    const binary = process.platform === 'win32' ? 'sdkmanager.bat' : 'sdkmanager';
    const sdkManagerPath = await resolveGlobToPath([editor.editorRootPath, '**', 'AndroidPlayer', '**', 'cmdline-tools', '**', binary]);
    if (!sdkManagerPath) {
        throw new Error(`Failed to resolve ${binary} in ${editor.editorRootPath}`);
    }
    const jdkPath = await resolveGlobToPath([editor.editorRootPath, '**', 'AndroidPlayer', 'OpenJDK/']);
    if (!jdkPath) {
        throw new Error(`Failed to resolve OpenJDK in ${editor.editorRootPath}`);
    }
    await execSdkManager(sdkManagerPath, jdkPath, ['--licenses']);
    await execSdkManager(sdkManagerPath, jdkPath, ['--update']);
    await execSdkManager(sdkManagerPath, jdkPath, ['platform-tools', `platforms;android-${androidTargetSdk}`]);
    sdkPath = await getAndroidSdkPath(editor, androidTargetSdk);
    if (!sdkPath) {
        throw new Error(`Failed to install android-${androidTargetSdk} in ${editor.editorRootPath}`);
    }
    core.info(`Target Android SDK installed in:\n  > "${sdkPath}"`);
}

async function createRepositoryCfg(): Promise<void> {
    const androidPath = path.join(os.homedir(), '.android');
    await fs.promises.mkdir(androidPath, { recursive: true });
    const cfgPath = path.join(androidPath, 'repositories.cfg');
    if (!fs.existsSync(cfgPath)) {
        await fs.promises.writeFile(cfgPath, '');
    }
}

async function getAndroidSdkPath(editor: UnityEditor, androidTargetSdk: number): Promise<string | undefined> {
    return await resolveGlobToPath([editor.editorRootPath, '**', 'PlaybackEngines', 'AndroidPlayer', 'SDK', 'platforms', `android-${androidTargetSdk}/`]);
}

async function execSdkManager(sdkManagerPath: string, jdkPath: string, args: string[]): Promise<void> {
    const env = {
        ...process.env,
        JAVA_HOME: jdkPath,
        JDK_HOME: jdkPath,
        SKIP_JDK_VERSION_CHECK: 'true',
    } as { [key: string]: string };
    const input = Buffer.from(Array(10).fill('y').join(os.EOL), 'utf8');
    let exitCode: number;
    if (process.platform === 'win32') {
        exitCode = await exec.exec('cmd.exe', ['/c', sdkManagerPath, ...args], { env, input, ignoreReturnCode: true });
    } else {
        exitCode = await exec.exec(sdkManagerPath, args, { env, input, ignoreReturnCode: true });
    }
    if (exitCode !== 0) {
        throw new Error(`${sdkManagerPath} ${args.join(' ')} failed with exit code ${exitCode}`);
    }
}
