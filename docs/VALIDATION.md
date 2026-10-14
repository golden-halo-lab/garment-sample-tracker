# Validation record

Date: **12 October 2026**. Public portfolio edition.

## Automated checks

Command: `npm test` using Node.js 24.19.0 on Linux.

Three test groups cover:

1. Deadline colour boundaries, calendar validation, timezone handling and completed samples.
2. Shared workflows, permissions, stale-edit conflicts, attachments, live notifications, exports, backups, disabled accounts and persistence after restart.
3. Empty-workspace setup, one-time administrator creation and absence of default production accounts.

The supplied demo usernames and passwords are test fixtures for fictional local records.

## Browser evidence

The images in `docs/images` show the actual local prototype using fictional demonstration data. Browser checks cover sign-in, overview, sample detail, readiness and the four-role account view. The public copy omits the internal draft's unimplemented camera-AI planning page.

## Still to verify in the factory

- Backend installation and shared access from factory laptops.
- Staff acceptance of the workflow and deadline rules.
- VM and host restart recovery, unattended startup and off-device backup restoration.
- Load and concurrency under the actual pilot workload.
- Native desktop packaging of this public edition on Windows and macOS.

These development checks do not constitute a production security audit or evidence of measured business savings.
