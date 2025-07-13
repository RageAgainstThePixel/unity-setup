import { UnityVersion } from './unity-version';
import { FindGlobPattern } from './utility';
import core = require('@actions/core');
import path = require('path');
import os = require('os');
import fs = require('fs');

export async function ValidateInputs(): Promise<[UnityVersion[], string | undefined, string[], string | undefined, string]> {
    const modules: string[] = [];
    const architecture = core.getInput('architecture') || getInstallationArch();
    if (architecture) {
        core.info(`architecture:\n  > ${architecture}`);
    }
    const buildTargets = getArrayInput('build-targets');
    core.info(`modules:`);
    const modulesInput = getArrayInput('modules');
    if (buildTargets.length == 0 && modulesInput.length === 0) {
        modules.push(...getDefaultModules());
        for (const module of modules) {
            core.info(`  > ${module}`);
        }
    }
    for (const module of modulesInput) {
        if (module.toLowerCase() == 'none') {
            continue;
        }
        if (!modules.includes(module)) {
            modules.push(module);
            core.info(`  > ${module}`);
        }
    }
    core.info(`buildTargets:`);
    const moduleMap = getPlatformTargetModuleMap();
    for (const target of buildTargets) {
        const module = moduleMap[target];
        if (module === undefined) {
            core.warning(`${target} not a valid build target!`);
            continue;
        }
        if (!modules.includes(module)) {
            modules.push(module);
            core.info(`  > ${target} -> ${module}`);
        }
    }
    const versions = getUnityVersionsFromInput();
    const versionFilePath = await getVersionFilePath();
    const unityProjectPath = versionFilePath !== undefined ? path.join(versionFilePath, '..', '..') : undefined;
    if (versionFilePath) {
        core.info(`versionFilePath:\n  > "${versionFilePath}"`);
        core.info(`Unity Project Path:\n  > "${unityProjectPath}"`);
        const unityVersion = await getUnityVersionFromFile(versionFilePath);
        if (versions.length === 0) {
            versions.push(unityVersion);
        }
    }
    if (versions.length > 1) {
        versions.sort(UnityVersion.compare);
    }
    core.info(`Unity Versions:`);
    for (const unityVersion of versions) {
        core.info(`  > ${unityVersion.toString()}`);
    }
    let installPath = core.getInput('install-path');
    if (installPath) {
        installPath = installPath.trim();
        if (installPath.length === 0) {
            installPath = undefined;
        } else {
            core.info(`Install Path:\n  > "${installPath}"`);
        }
    }
    if (!installPath) {
        core.debug('No install path specified, using default Unity Hub install path.');
    }
    return [versions, architecture, modules, unityProjectPath, installPath];
}

function getArrayInput(key: string): string[] {
    let input = core.getInput(key);
    if (!input) { return []; }
    core.debug(`raw input | ${key}: ${input}`);
    let array = input.split(/,?\s+/).filter(Boolean);
    core.debug(`split | ${key}:`);
    for (const item of array) {
        core.debug(`  > ${item}`);
    }
    return array;
}

function getInstallationArch(): string | undefined {
    switch (os.arch()) {
        case 'arm64':
            return 'arm64';
        case 'x64':
            return undefined;
        default:
            throw Error(`${os.arch()} not supported`);
    }
}

function getPlatformTargetModuleMap(): { [key: string]: string } {
    const osType = os.type();
    let moduleMap = undefined;
    if (osType == 'Linux') {
        moduleMap = {
            "StandaloneLinux64": "linux-il2cpp",
            "Android": "android",
            "WebGL": "webgl",
            "iOS": "ios",
        };
    } else if (osType == 'Darwin') {
        moduleMap = {
            "StandaloneOSX": "mac-il2cpp",
            "iOS": "ios",
            "Android": "android",
            "tvOS": "appletv",
            "StandaloneLinux64": "linux-il2cpp",
            "WebGL": "webgl",
            "VisionOS": "visionos"
        };
    } else if (osType == 'Windows_NT') {
        moduleMap = {
            "StandaloneWindows64": "windows-il2cpp",
            "WSAPlayer": "universal-windows-platform",
            "Android": "android",
            "iOS": "ios",
            "tvOS": "appletv",
            "StandaloneLinux64": "linux-il2cpp",
            "Lumin": "lumin",
            "WebGL": "webgl",
        };
    } else {
        throw Error(`${osType} not supported`);
    }
    return moduleMap;
}

function getDefaultModules(): string[] {
    switch (process.platform) {
        case 'linux':
            return ['linux-il2cpp'];
        case 'darwin':
            return ['mac-il2cpp'];
        case 'win32':
            return ['windows-il2cpp'];
        default:
            throw Error(`${process.platform} not supported`);
    }
}

async function getVersionFilePath(): Promise<string | undefined> {
    let projectVersionPath = core.getInput('version-file');
    if (projectVersionPath !== undefined && projectVersionPath.toLowerCase() === 'none') {
        return undefined;
    }
    if (!projectVersionPath) {
        projectVersionPath = await FindGlobPattern(path.join(process.env.GITHUB_WORKSPACE, '**', 'ProjectVersion.txt'));
    }
    if (projectVersionPath) {
        try {
            await fs.promises.access(projectVersionPath, fs.constants.R_OK);
            return projectVersionPath;
        } catch (error) {
            core.debug(error);
            try {
                projectVersionPath = path.join(process.env.GITHUB_WORKSPACE, projectVersionPath);
                await fs.promises.access(projectVersionPath, fs.constants.R_OK);
                return projectVersionPath;
            } catch (error) {
                core.error(error);
                try {
                    projectVersionPath = await FindGlobPattern(path.join(process.env.GITHUB_WORKSPACE, '**', 'ProjectVersion.txt'));
                    await fs.promises.access(projectVersionPath, fs.constants.R_OK);
                    return projectVersionPath;
                } catch (error) {
                    // ignore
                }
            }
        }
    }
    core.warning(`Could not find ProjectVersion.txt in ${process.env.GITHUB_WORKSPACE}! UNITY_PROJECT_PATH will not be set.`);
    return undefined;
}

function getUnityVersionsFromInput(): UnityVersion[] {
    const versions: UnityVersion[] = [];
    const inputVersions = core.getInput('unity-version');
    if (!inputVersions || inputVersions.length == 0) {
        return versions;
    }
    // Only match full Unity version strings like 4.7.2, 2021.3.15f1, 2022.1.0b3, etc.
    // This regex requires at least major.minor.patch, and optionally a Unity suffix and changeset
    const versionRegEx = /(?<version>\d+\.\d+\.\d+(?:[abcfpx]\d+)?)(?:\s*\((?<changeset>\w+)\))?/g;
    const matches = Array.from(inputVersions.matchAll(versionRegEx));
    core.debug(`Unity Versions from input:`);
    for (const match of matches) {
        if (!match.groups || !match.groups.version) { continue; }
        const version = match.groups.version.replace(/\.$/, '');
        const changeset = match.groups.changeset;
        const unityVersion = new UnityVersion(version, changeset);
        core.debug(`${unityVersion.toString()}`);
        try {
            versions.push(unityVersion);
        } catch (e) {
            core.error(`Invalid Unity version: ${unityVersion.toString()}\nError: ${e.message}`);
        }
    }
    return versions;
}

async function getUnityVersionFromFile(versionFilePath: string): Promise<UnityVersion> {
    const versionString = await fs.promises.readFile(versionFilePath, 'utf8');
    core.debug(`ProjectSettings.txt:\n${versionString}`);
    const match = versionString.match(/m_EditorVersionWithRevision: (?<version>(?:(?<major>\d+)\.)?(?:(?<minor>\d+)\.)?(?:(?<patch>\d+[abcfpx]\d+)\b))\s?(?:\((?<changeset>\w+)\))?/);
    if (!match) {
        throw Error(`No version match found!`);
    }
    if (!match.groups.version) {
        throw Error(`No version group found!`);
    }
    if (!match.groups.changeset) {
        throw Error(`No changeset group found!`);
    }
    return new UnityVersion(match.groups.version, match.groups.changeset);
}
