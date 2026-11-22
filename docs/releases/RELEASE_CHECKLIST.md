# Windows stable release procedure

This is a reusable procedure, not a completed historical checklist. The published
[v1.0.0 Release](https://github.com/Mert1026/Sentry/releases/tag/v1.0.0) and
[v1.0.1 Release](https://github.com/Mert1026/Sentry/releases/tag/v1.0.1) retain their
immutable sources and assets. See [history](../history.md) for original gate results.

1. Obtain an approved exact source/target/platform and version/protocol. Fetch and
   inspect refs, worktrees, tags, CI and releases; preserve owner work and refuse
   an unexpected existing version tag or Release.
2. Verify a clean committed build input, component versions, dependency lock,
   required security/recovery behavior and [test gates](../development/testing.md).
   Distinguish capable-host trust proof from hosted skips.
3. On Windowsx64 run pnpm distribution:build windows-x64. The archive must identify
   the actual approved source; never rename another commit's archive. Record ZIP,
   sidecar, manifest, inventory and source hashes privately.
   Publish the ZIP that the distribution workflow built and attested on the release
   commit (download its workflow artifact and check it with
   `gh attestation verify <zip> --repo Mert1026/Sentry`), so `sentry update <archive.zip>`
   can verify who built it. A ZIP built only on a workstation has no attestation: the
   notes must then tell people to pass `-SkipAttestation` and accept a checksum-only check.
4. Externally extract and validate complete inventory/component identities. Exercise
   prepared-host packaged setup, visible launch, matching Linux runtime, shutdown,
   restart and essential disposable workflows. Keep limitations explicit.
5. Review public notes, prerequisites, unsigned/online-bootstrap requirements,
   payload privacy, provider charges, updates and recovery. Obtain explicit owner
   authorization for those exact bytes and immutable annotated tag.
6. Recheck source/assets/tag absence and authentication. Create/push the annotated
   tag normally; independently verify the remote tag object and peeled source.
7. Create one non-prerelease draft with the verified tag/notes. Upload only approved
   Windows ZIP and sidecar without overwriting assets. Authenticated-download both
   draft assets and revalidate approved bytes, complete manifest and source.
8. Publish that verified draft as stable. Independently fetch the live public page
   and both assets without credentials; verify checksums, extraction/inventory and
   embedded identity before claiming publication success.
9. Prepare reviewed main→dev propagation and owner-approved post-release maintenance
   PRs. Do not reset/force-push dev or self-merge. Keep tags, release assets and
   relevant historical evidence immutable; no automatic artifact/branch deletion.

Stop on unexpected identity, security, packaging or delivery failures. Do not
silently replace published bytes or move a tag. No test procedure itself authorizes
paid QA, real owner-data restoration or elevated compaction.

## Required CLI and upgrade documentation for the next release

Follow the [next Windows release requirements](../development/next-windows-release.md).
Do not advertise CLI availability until the exact extracted archive supports the
[documented command examples](../beta/cli.md#command-examples) through its installed
command. Public notes, help and examples must use generic automation terminology.
Every future Release page must contain separate PowerShell sections for fresh
installation and updating an existing installation, with exact asset/checksum
identity, retained user data and post-update verification. Validate the upgrade
from the preceding stable version before claiming it works.

Since v2.0.2 the packaged launcher has `sentry update <archive.zip>`: it verifies the ZIP against its
`.sha256` file (and the GitHub attestation when `gh` is installed), extracts beside the current install,
refuses the same or an older version, backs up the data and runs the new archive's own setup. Before a
release, run it from the previous stable archive's successor on a disposable host and confirm the refusal
of an older ZIP, the backup folder, and that a failed setup leaves the previous install untouched. The
Release page and the notes must also say that a release older than v2.0.2 has no `sentry update <zip>` and
is updated with the Release page's update block.
