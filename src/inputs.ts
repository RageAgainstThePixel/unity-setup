import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as core from '@actions/core';
import { getPlatformTargetModuleMap } from './unity-editor';
import { Architecture, UnityVersion } from './unity-version';
import { resolveGlobToPath } from './utilities';

export async function ValidateInputs(): Promise<{
    versions: UnityVersion[],
    modules: string[],
    unityProjectPath: string | undefined,
    installPath: string | undefined
}> {
    const modules: string[] = [];
    const architectureInput = core.getInput('architecture') || getInstallationArch();
    let architecture: Architecture;

    switch (architectureInput.toLowerCase()) {
        case 'arm64':
            architecture = 'ARM64';
            break;
        default:
            architecture = 'X86_64';
            break;
    }

    core.info(`architecture:\n  > ${architecture.toLowerCase()}`);

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

    const moduleMap = getPlatformTargetModuleMap();

    for (const target of buildTargets) {
        const module = moduleMap[target];

        if (module === undefined) {
            if (target.toLowerCase() !== 'none') {
                core.warning(`${target} is not a valid build target for ${os.type()}`);
            }
            continue;
        }

        if (!modules.includes(module)) {
            modules.push(module);
            core.info(`  > ${target} -> ${module}`);
        }
    }

    if (modules.length === 0) {
        core.info(`  > None`);
    }

    const versions = getUnityVersionsFromInput(architecture);
    const versionFilePath = await getVersionFilePath();
    const unityProjectPath = versionFilePath !== undefined ? path.join(versionFilePath, '..', '..') : undefined;

    if (versionFilePath) {
        core.info(`versionFilePath:\n  > "${versionFilePath}"`);
        core.info(`Unity Project Path:\n  > "${unityProjectPath}"`);
        if (versions.length === 0) {
            versions.push(await getUnityVersionFromFile(versionFilePath, architecture));
        }
    }

    if (versions.length > 1) {
        versions.sort(UnityVersion.compare);
    }

    core.info(`Unity Versions:`);

    for (const unityVersion of versions) {
        core.info(`  > ${unityVersion.toString()}`);
    }

    if (versions.length === 0) {
        core.info(`  > None`);
    }

    let installPath: string | undefined = core.getInput('install-path')?.trim();

    if (installPath) {
        installPath = path.normalize(installPath);
        core.info(`Install Path:\n  > "${installPath}"`);
    } else {
        installPath = undefined;
        core.debug('No install path specified, using the default Unity CLI install path.');
    }

    return { versions, modules, unityProjectPath, installPath };
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

function getInstallationArch(): string {
    switch (os.arch()) {
        case 'arm64':
            return 'arm64';
        case 'x64':
            return 'x86_64';
        default:
            throw Error(`${os.arch()} not supported`);
    }
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

    if (projectVersionPath &&
        projectVersionPath.toLowerCase() === 'none') {
        return undefined;
    }

    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const candidates: string[] = [];

    if (projectVersionPath) {
        candidates.push(projectVersionPath, path.join(workspace, projectVersionPath));
    }

    for (const candidate of candidates) {
        try {
            await fs.promises.access(candidate, fs.constants.R_OK);
            return candidate;
        } catch (error) {
            core.debug(`${error}`);
        }
    }

    const found = await resolveGlobToPath([workspace, '**', 'ProjectVersion.txt']);

    if (found) {
        return found;
    }

    core.warning(`Could not find ProjectVersion.txt in ${workspace}! UNITY_PROJECT_PATH will not be set.`);
    return undefined;
}

function getUnityVersionsFromInput(architecture: Architecture): UnityVersion[] {
    const versions: UnityVersion[] = [];
    const inputVersions = core.getInput('unity-version');

    if (!inputVersions || inputVersions.length == 0) {
        return versions;
    }

    if (inputVersions.toLowerCase() === 'none') {
        core.debug('No Unity Versions Specified...')
        return versions;
    }

    // Accepts versions like 6000, 6000.x, 6000.*, 6000.2, 6000.2.0, 6000.2.x, 6000.2.*, 6000.2.1f1, 6000.2.1f1 (c7b5465681fb)
    const versionRegEx = /(?<version>\d+(?:\.(?:\d+|x|\*)){0,2}(?:[abcfpx]\d+)?)(?:\s*\((?<changeset>\w+)\))?/g;
    const matches = Array.from(inputVersions.matchAll(versionRegEx));
    core.debug(`Regex version matches from input:`);

    for (const match of matches) {
        if (!match.groups || !match.groups.version) { continue; }

        let version = match.groups.version.replace(/\.$/, '');
        version = version.replace(/(\.(x|\*))+$/, '');
        const unityVersion = new UnityVersion(version, match.groups.changeset, architecture);
        core.debug(`  > ${unityVersion.toString()}`);
        versions.push(unityVersion);
    }

    if (versions.length === 0) {
        throw Error('Failed to parse Unity versions from input!');
    }

    return versions;
}

async function getUnityVersionFromFile(versionFilePath: string, architecture: Architecture): Promise<UnityVersion> {
    const versionString = await fs.promises.readFile(versionFilePath, 'utf8');
    core.debug(`ProjectVersion.txt:\n${versionString}`);
    const match = versionString.match(/m_EditorVersionWithRevision: (?<version>(?:(?<major>\d+)\.)?(?:(?<minor>\d+)\.)?(?:(?<patch>\d+[abcfpx]\d+)\b))\s?(?:\((?<changeset>\w+)\))?/);

    if (!match) {
        throw Error(`No version match found!`);
    }

    if (!match.groups?.version) {
        throw Error(`No version group found!`);
    }

    if (!match.groups?.changeset) {
        throw Error(`No changeset group found!`);
    }

    return new UnityVersion(match.groups.version, match.groups.changeset, architecture);
}
