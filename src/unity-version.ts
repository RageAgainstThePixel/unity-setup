import semver = require('semver');

export class UnityVersion {
  constructor(
    public version: string,
    public changeset?: string
  ) { }

  static compare(a: UnityVersion, b: UnityVersion): number {
    const vA = a.version;
    const vB = b.version;
    return semver.compare(vA, vB, true);
  }

  toString(): string {
    return this.changeset ? `${this.version} (${this.changeset})` : this.version;
  }
}