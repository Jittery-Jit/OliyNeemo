# Security notes

## Dependency audit policy

`pnpm audit` must pass before deployment. Patched transitive dependencies are pinned in `package.json` instead of waiting for upstream package ranges to move.

### CVE-2026-14257

The registry advisory currently describes only `brace-expansion` 5.0.8 as patched and therefore flags every lower-major version by semver. The maintainer also published compatible backports 1.1.17 and 2.1.3. Those packages contain the same `EXPANSION_MAX_LENGTH` bound and explicitly identify CVE-2026-14257 in their implementation.

Neemo pins each dependency line to its compatible patched release:

- 1.x → 1.1.17
- 2.x → 2.1.3
- 5.x → 5.0.8

The CVE is listed under `pnpm.auditConfig.ignoreCves` only to account for the registry advisory's lower-major version range. Do not remove the three overrides while the ignore remains. Remove both the overrides and ignore together once every upstream consumer accepts 5.0.8 or the advisory recognizes the backports.
