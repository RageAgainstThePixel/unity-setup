import semver = require('semver');

export class UnityVersion {
  constructor(
    public version: string,
    public changeset?: string
  ) { }

  static compare(a: UnityVersion, b: UnityVersion): number {
    // Compare by version string using semver, fallback to string compare if needed
    const vA = a.version;
    const vB = b.version;
    return semver.compare(vA, vB) || vA.localeCompare(vB);
  }

}