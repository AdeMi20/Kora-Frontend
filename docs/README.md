# Kora Frontend — Documentation

Project documentation lives here. GitHub-facing files (`CONTRIBUTING.md`, `SECURITY.md`, root `CHANGELOG.md`) stay at the repo root so tooling and policies resolve correctly.

## Guides

| Document                                  | Description                                                          |
| ----------------------------------------- | -------------------------------------------------------------------- |
| [Architecture](./architecture.md)         | Layer breakdown, data flow, wallet/contract/IPFS, Redis migration   |
| [Design System](./design-system.md)       | Semantic tokens, theming, and UI primitives                          |
| [Feature Flags](./feature-flags.md)       | All `NEXT_PUBLIC_ENABLE_*` flags, defaults, and local override paths |
| [Debtor Privacy](./debtor-privacy.md)     | Debtor display rules and privacy constraints                         |
| [Analytics Events](./analytics-events.md) | Marketplace analytics event schema (no PII)                          |
| [Testnet Nightly E2E](./testnet-nightly-e2e.md) | Opt-in live-testnet suites, real Freighter extension, CI secrets |

## Repository docs (root)

| Document                           | Description                                       |
| ---------------------------------- | ------------------------------------------------- |
| [README](../README.md)             | Overview, setup, and project structure            |
| [Contributing](../CONTRIBUTING.md) | Setup, workflow, testing, and PR checklist        |
| [Security](../SECURITY.md)         | Vulnerability reporting policy                    |
| [Changelog](../CHANGELOG.md)       | Auto-generated release history (semantic-release) |

## Changelog files

This repo intentionally keeps two changelog files:

- **`CHANGELOG.md` (root)** — semantic-release output for GitHub releases and version bumps.
- **`public/CHANGELOG.md`** — Keep a Changelog format served at `/CHANGELOG.md` for the in-app changelog modal.

When adding user-visible release notes for the app UI, update `public/CHANGELOG.md`. Release tooling manages the root file.

### Which file do I edit?

| Your change | Edit `public/CHANGELOG.md` | Edit root `CHANGELOG.md` |
|---|---|---|
| Users will notice it in the app | ✅ | ❌ never by hand |
| Refactor, test, CI, or docs only | ❌ | ❌ |
| Anything at all | — | ❌ semantic-release writes it |

The root file is generated from commit messages on every release. Editing it by
hand is not "also updating the changelog" — it is a conflict waiting for the
next release commit to overwrite it. Write a good Conventional Commit message
instead; that *is* how you edit the root changelog.

### Worked example

You added a CSV export button to the investor dashboard. Users will see it, so
it belongs in `public/CHANGELOG.md` under `[Unreleased]`.

**Before:**

```markdown
## [Unreleased]

### Added
- Command palette (Cmd/Ctrl+K) with invoice search, page navigation, and action commands.
```

**After:**

```markdown
## [Unreleased]

### Added
- Command palette (Cmd/Ctrl+K) with invoice search, page navigation, and action commands.
- Export investor positions to CSV from the dashboard toolbar.
```

Then commit with a Conventional Commit message:

```
feat(dashboard): export investor positions to CSV
```

That commit line is what semantic-release turns into the root `CHANGELOG.md`
entry at the next release. You never touch that file.

Notes on the entry itself:

- Write what the user can now do, not what you implemented. "Export investor
  positions to CSV" beats "Add `useCsvExport` hook".
- Add it under `[Unreleased]`, not under a released version heading — released
  sections are history and editing them rewrites what shipped.
- Use the Keep a Changelog headings: `Added`, `Changed`, `Deprecated`,
  `Removed`, `Fixed`, `Security`. Create the heading if `[Unreleased]` does not
  have it yet.

**Counter-example.** You split a 400-line component into three files and the UI
is pixel-identical. Nothing goes in `public/CHANGELOG.md` — there is nothing a
user could notice. `refactor(marketplace): split InvoiceCard into subcomponents`
is the whole deliverable.
