import * as fs from 'fs';
import * as core from '@actions/core';
import * as cache from '@actions/cache';
import { ValidateInputs } from './inputs';
import { setupUnityCli } from './unity-cli';
import { UnityCliClient } from './unity-editor';
import { UnityVersion, resolveUnityVersion } from './unity-version';
import { checkAndroidSdkInstalled } from './android-sdk';

const IS_POST = !!core.getState('isPost');

async function main() {
    try {
        if (!IS_POST) {
            await setup();
        } else {
            await post();
        }
    } catch (error) {
        core.setFailed(error.stack);
    }
}

main();

/**
 * Generates a cache key for Unity installation based on versions and modules.
 * @param versions Array of UnityVersion objects.
 * @param modules Array of module names.
 * @returns A string representing the cache key.
 */
function getInstallationCacheKey(versions: UnityVersion[], modules: string[]): InstallationCacheKeys {
    let cacheKey = `unity-setup-${process.platform}`;
    let restoreKeys: string[] = [];

    for (const version of versions) {
        cacheKey += `-${version.version}`;
        restoreKeys.push(`${cacheKey}`);
    }

    for (const module of modules) {
        cacheKey += `-${module}`;
        restoreKeys.push(`${cacheKey}`);
    }

    return {
        primaryKey: cacheKey,
        restoreKeys: restoreKeys
    };
}

interface InstallationCacheKeys {
    primaryKey: string;
    restoreKeys: string[];
}

async function setup() {
    const { versions, modules, unityProjectPath, installPath } = await ValidateInputs();

    if (unityProjectPath) {
        core.info(`UNITY_PROJECT_PATH:\n  > ${unityProjectPath}`);
        core.exportVariable('UNITY_PROJECT_PATH', unityProjectPath);
        core.setOutput('unity-project-path', unityProjectPath);
    }

    const unityCli = await setupUnityCli(core.getInput('unity-cli-version') || undefined);
    core.info(`UNITY_CLI_PATH:\n  > ${unityCli.path}`);
    core.setOutput('unity-cli-path', unityCli.path);
    core.setOutput('unity-cli-version', unityCli.version);
    core.saveState('unity-cli-path', unityCli.path);
    // kept for workflows written against v2, the CLI replaces Unity Hub
    core.exportVariable('UNITY_HUB_PATH', unityCli.path);
    core.setOutput('unity-hub-path', unityCli.path);

    const client = new UnityCliClient(unityCli.path);

    if (installPath) {
        await client.setInstallPath(installPath);
    }

    const resolvedVersions: UnityVersion[] = [];

    for (const unityVersion of versions) {
        const resolved = await resolveUnityVersion(unityVersion);
        core.info(`Resolved Unity ${unityVersion.toString()}:\n  > ${resolved.toString()}`);
        resolvedVersions.push(resolved);
    }

    const cacheInstallationInput = core.getInput('cache-installation')?.toLowerCase() === 'true';

    if (cacheInstallationInput && resolvedVersions.length > 0) {
        const unityInstallPath = await client.getInstallPath();
        const cacheKey = getInstallationCacheKey(resolvedVersions, modules);
        core.saveState('cache-key', cacheKey.primaryKey);
        core.info(`unity installation cache key: ${cacheKey.primaryKey}`);
        const restoreKey = await cache.restoreCache([unityInstallPath], cacheKey.primaryKey, cacheKey.restoreKeys);
        const cacheHit = restoreKey === cacheKey.primaryKey;

        if (!cacheHit) {
            core.info('No unity installation cache found. Installation will be saved in post step.');
        }

        core.saveState('cache-hit', cacheHit);
    }

    const installedEditors: { version: string; path: string; }[] = [];

    for (const unityVersion of resolvedVersions) {
        const unityEditor = await client.getEditor(unityVersion, modules);
        core.info(`UNITY_EDITOR_PATH:\n  > ${unityEditor.editorPath}`);
        // always sets to the latest installed editor path
        core.exportVariable('UNITY_EDITOR_PATH', unityEditor.editorPath);
        core.setOutput('unity-editor-path', unityEditor.editorPath);

        if (modules.includes('android') && unityProjectPath !== undefined) {
            await checkAndroidSdkInstalled(unityEditor, unityProjectPath);
        }

        installedEditors.push({ version: unityVersion.version, path: unityEditor.editorPath });
    }

    if (installedEditors.length !== versions.length) {
        throw new Error(`Expected to install ${versions.length} Unity versions, but installed ${installedEditors.length}.`);
    }

    core.exportVariable('UNITY_EDITORS', JSON.stringify(installedEditors));
    core.setOutput('unity-editors', JSON.stringify(installedEditors));
    core.info('Unity Setup Complete!');
    core.saveState('isPost', true);
    process.exit(0);
}

async function post() {
    const cacheKey = core.getState('cache-key');

    if (!cacheKey) {
        core.info('No cache key found, skipping cache save.');
        return;
    }

    const cacheHit = core.getState('cache-hit') === 'true';

    if (cacheHit) {
        core.info(`Cache hit for ${cacheKey}, skipping cache save.`);
        return;
    }

    core.info('Saving Unity installation cache...');
    const client = new UnityCliClient(core.getState('unity-cli-path'));
    const unityInstallPath = await client.getInstallPath();

    if (!await isInstallationPathValid(unityInstallPath)) {
        core.warning(`Unity installation path "${unityInstallPath}" is invalid, skipping cache save.`);
        return;
    }

    await cache.saveCache([unityInstallPath], cacheKey);
    core.info(`Unity installation cache saved with key: ${cacheKey}`);
    process.exit(0);
}

async function isInstallationPathValid(path: string): Promise<boolean> {
    if (!path || path.length === 0) {
        return false;
    }

    try {
        await fs.promises.access(path, fs.constants.R_OK);
    } catch {
        return false;
    }

    return true;
}
