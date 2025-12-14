import * as fs from 'fs';
import core = require('@actions/core');
import cache = require('@actions/cache');
import { ValidateInputs } from './inputs';
import {
    UnityHub,
    CheckAndroidSdkInstalled,
    UnityVersion,
} from '@rage-against-the-pixel/unity-cli';
import crypto = require('crypto');

const IS_POST = !!core.getState('isPost');

async function main() {
    try {
        if (!IS_POST) {
            await setup();
            core.saveState('isPost', true);
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
function getInstallationCacheKey(versions: UnityVersion[], modules: string[]): string {
    const changesets = versions.map(v => v.changeset).sort();
    const uuid = UUID(`${changesets.join('-')}|${modules.sort().join('-')}`);
    return `unity-setup-cache-${process.platform}-${uuid}`;
}

/**
 * Generates a UUID v4 from a given string value.
 * @param value The input string to generate the UUID from.
 * @returns A UUID v4 string.
 */
function UUID(value: string): string {
    const md5 = crypto.createHash('md5');
    const hash = md5.update(value, 'utf8').digest();
    const uuid = [
        hash.subarray(0, 4).reverse().toString('hex'),
        hash.subarray(4, 6).reverse().toString('hex'),
        hash.subarray(6, 8).reverse().toString('hex'),
        hash.subarray(8, 10).toString('hex'),
        hash.subarray(10, 16).toString('hex')
    ].join('-');
    return uuid;
}

async function setup() {
    const { versions, modules, unityProjectPath, installPath } = await ValidateInputs();

    if (unityProjectPath) {
        core.info(`UNITY_PROJECT_PATH:\n  > ${unityProjectPath}`);
        core.exportVariable('UNITY_PROJECT_PATH', unityProjectPath);
        core.setOutput('unity-project-path', unityProjectPath);
    }

    let autoUpdate = core.getInput('auto-update-hub');
    const hubVersion = core.getInput('hub-version');

    if (autoUpdate === 'true' && hubVersion && hubVersion.length > 0) {
        autoUpdate = 'false';
    }

    const unityHub = new UnityHub();
    const unityHubPath = await unityHub.Install(autoUpdate === 'true', hubVersion);

    if (!unityHubPath || unityHubPath.length === 0) {
        throw new Error('Failed to install or locate Unity Hub!');
    }

    core.info(`UNITY_HUB_PATH:\n  > ${unityHubPath}`);
    core.exportVariable('UNITY_HUB_PATH', unityHubPath);
    core.setOutput('unity-hub-path', unityHubPath);

    if (installPath && installPath.length > 0) {
        await unityHub.SetInstallPath(installPath);
    }

    const cacheInstallationInput = core.getInput('cache-installation')?.toLowerCase() === 'true';

    if (cacheInstallationInput) {
        const unityInstallPath = await unityHub.GetInstallPath();
        const cacheKey = getInstallationCacheKey(versions, modules);
        core.saveState('cache-key', cacheKey);
        const restoreKey = await cache.restoreCache([unityInstallPath], cacheKey);
        core.saveState('cache-hit', restoreKey !== undefined);
    }

    const installedEditors: { version: string; path: string; }[] = [];

    for (const unityVersion of versions) {
        const unityEditor = await unityHub.GetEditor(unityVersion, modules);
        core.info(`UNITY_EDITOR_PATH:\n  > ${unityEditor.editorPath}`);
        // always sets to the latest installed editor path
        core.exportVariable('UNITY_EDITOR_PATH', unityEditor.editorPath);
        core.setOutput('unity-editor-path', unityEditor.editorPath);

        if (modules.includes('android') && unityProjectPath !== undefined) {
            await CheckAndroidSdkInstalled(unityEditor, unityProjectPath);
        }

        installedEditors.push({ version: unityVersion.version, path: unityEditor.editorPath });
    }

    if (installedEditors.length !== versions.length) {
        throw new Error(`Expected to install ${versions.length} Unity versions, but installed ${installedEditors.length}.`);
    }

    core.exportVariable('UNITY_EDITORS', JSON.stringify(installedEditors));
    core.setOutput('unity-editors', JSON.stringify(installedEditors));
    core.info('Unity Setup Complete!');
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
        core.info('Cache hit occurred, skipping cache save.');
        return;
    }

    const saveCache = cacheKey && cacheKey.length > 0 && !cacheHit;

    if (saveCache) {
        core.info('Saving Unity installation cache...');
        const unityHub = new UnityHub();
        const unityInstallPath = await unityHub.GetInstallPath();

        if (!await isInstallationPathValid(unityInstallPath)) {
            core.warning(`Unity installation path "${unityInstallPath}" is invalid, skipping cache save.`);
            return;
        }

        await cache.saveCache([unityInstallPath], cacheKey);
        core.info('Unity installation cache saved.');
    }
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
