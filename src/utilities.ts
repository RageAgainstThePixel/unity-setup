import * as fs from 'fs';
import * as path from 'path';
import * as glob from '@actions/glob';

/**
 * Resolves path segments that may include glob patterns to the first readable match.
 * @param globs Path segments, e.g. [workspace, '**', 'ProjectVersion.txt'].
 * @returns The first readable match, or undefined when nothing matches.
 */
export async function resolveGlobToPath(globs: string[]): Promise<string | undefined> {
    const pattern = path.join(...globs).split(path.sep).join('/');
    const globber = await glob.create(pattern, { matchDirectories: true });
    for await (const match of globber.globGenerator()) {
        try {
            await fs.promises.access(match, fs.constants.R_OK);
            return match;
        } catch {
            // keep looking
        }
    }
    return undefined;
}
