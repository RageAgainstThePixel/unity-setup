import * as core from '@actions/core';

export type Architecture = 'X86_64' | 'ARM64';

/** The oldest Unity major version this action supports. */
export const MIN_UNITY_MAJOR = 6000;

const RELEASES_API = 'https://services.api.unity.com/unity/editor/release/v1/releases';
const FULL_VERSION_PATTERN = /^\d+\.\d+\.\d+[abcfpx]\d+$/;
const RELEASE_TYPE_ORDER: { [key: string]: number } = { a: 0, b: 1, c: 2, x: 2, f: 3, p: 4 };

export class UnityVersion {
    constructor(
        public readonly version: string,
        public readonly changeset: string | undefined,
        public readonly architecture: Architecture
    ) {
        const major = parseInt(version.split('.')[0]);
        if (isNaN(major)) {
            throw new Error(`Invalid Unity version: ${version}`);
        }
        if (major < MIN_UNITY_MAJOR) {
            throw new Error(`Unity ${version} is not supported. unity-setup v3 requires Unity 6 (${MIN_UNITY_MAJOR}) or newer, use RageAgainstThePixel/unity-setup@v2 for older editors.`);
        }
    }

    /** True when the version is an exact release such as 6000.2.1f1. */
    isFullyQualified(): boolean {
        return FULL_VERSION_PATTERN.test(this.version);
    }

    toString(): string {
        return this.changeset ? `${this.version} (${this.changeset})` : this.version;
    }

    static compare(a: UnityVersion, b: UnityVersion): number {
        return compareVersionStrings(a.version, b.version);
    }
}

export function compareVersionStrings(a: string, b: string): number {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    for (let i = 0; i < pa.length; i++) {
        if (pa[i] !== pb[i]) {
            return pa[i] - pb[i];
        }
    }
    return 0;
}

function parseVersion(version: string): number[] {
    const match = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:([abcfpx])(\d+))?/);
    if (!match) {
        return [0, 0, 0, 0, 0];
    }
    return [
        parseInt(match[1]),
        parseInt(match[2] ?? '0'),
        parseInt(match[3] ?? '0'),
        match[4] ? RELEASE_TYPE_ORDER[match[4]] : RELEASE_TYPE_ORDER.f,
        parseInt(match[5] ?? '0'),
    ];
}

/**
 * Resolves a partial or changeset-less version to an exact release using the Unity Releases API.
 * Stable (f) releases are preferred unless a pre-release is explicitly requested.
 * @param unityVersion The requested version, e.g. 6000, 6000.2, 6000.2.0 or 6000.2.1f1.
 * @returns The exact version with its changeset.
 */
export async function resolveUnityVersion(unityVersion: UnityVersion): Promise<UnityVersion> {
    if (unityVersion.isFullyQualified() && unityVersion.changeset) {
        return unityVersion;
    }
    // a partial version such as 6000.2.0 selects the whole 6000.2 line
    const query = unityVersion.isFullyQualified()
        ? unityVersion.version
        : unityVersion.version.split('.').slice(0, 2).join('.');
    const url = new URL(RELEASES_API);
    url.searchParams.set('version', query);
    url.searchParams.set('limit', '25');
    url.searchParams.set('order', 'RELEASE_DATE_DESC');
    url.searchParams.append('platform', getReleasePlatform());
    url.searchParams.append('architecture', unityVersion.architecture);
    core.debug(`GET ${url.toString()}`);
    const results = await fetchReleases(url);
    const isPrerelease = /[abcpx]\d*$/.test(unityVersion.version);
    const prefix = new RegExp(`^${query.replace(/\./g, '\\.')}(?:[.abcfpx]|$)`);
    const matches = results
        .filter(release => release.version && prefix.test(release.version))
        .filter(release => isPrerelease || release.version.includes('f'))
        .sort((a, b) => compareVersionStrings(b.version, a.version));
    if (matches.length === 0) {
        throw new Error(`No Unity releases found for ${unityVersion.version}`);
    }
    const release = matches[0];
    return new UnityVersion(release.version, release.shortRevision, unityVersion.architecture);
}

interface UnityRelease {
    version: string;
    shortRevision: string;
}

async function fetchReleases(url: URL): Promise<UnityRelease[]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }
            const body = await response.json() as { results?: UnityRelease[] };
            return body.results ?? [];
        } catch (error) {
            lastError = error;
            core.debug(`Unity Releases API attempt ${attempt} failed: ${error}`);
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        }
    }
    throw new Error(`Failed to query the Unity Releases API: ${lastError}`);
}

function getReleasePlatform(): string {
    switch (process.platform) {
        case 'darwin':
            return 'MAC_OS';
        case 'linux':
            return 'LINUX';
        case 'win32':
            return 'WINDOWS';
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}
