# Releasing Switch Botbase MCP

Release Please owns `CHANGELOG.md`, `package.json`, the release manifest, tags
and generated release notes. Use Conventional Commits: `feat:` produces a minor
release before 1.0, `fix:` produces a patch, and `docs:`/`ci:` alone do not normally
release. Do not manually bump versions or create tags in the normal flow.

1. Merge the feature/fix commits to `main`.
2. Review and merge Release Please’s generated release PR.
3. Release Please creates a tag and draft release with commit-linked changelog.
4. The reusable release workflow runs typechecking and software-only tests on
   macOS and Linux at that tag, then publishes the draft with its notes intact.

The initial bootstrap is the existing v0.1.0 commit, so previously released work
will not be repeated in the first generated changelog. The workflow uses the
repository’s built-in GITHUB_TOKEN. Actions must be permitted to create pull
requests in the repository workflow settings. Bot-created PR events do not start
other workflows, so the release build is called directly rather than relying on
a tag event. No PAT or cross-repository token is required.

A failed check leaves the draft unpublished. Retry failed jobs, or publish the
same existing draft after checks by dispatching the release workflow:

```sh
gh workflow run release.yml --repo makp0/switch-botbase-mcp -f tag=v0.2.0
```

Use the actual draft’s tag. Published tags/releases are never rewritten. Correct
a published release with another Conventional Commit and release.

Releases contain GitHub’s source archives; install the selected release into a
separate directory and run `bun install --frozen-lockfile`. Keep local MCP
settings outside the archive and point the client at its `src/index.ts`. Changing
releases does not require or automatically run hardware tests. Hardware tests
remain opt-in and are excluded from CI and release checks.
