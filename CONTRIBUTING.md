# Contributing

## Workspace rules

- Keep domain logic inside the owning service or package.
- Cross-service communication uses versioned HTTP, event, or job contracts.
- PostgreSQL is authoritative; projections must be rebuildable.
- Add unit and contract tests with every public behavior change.
- Do not commit secrets, local volumes, generated output, or provider credentials.

## Local checks

```powershell
npm.cmd install
npm.cmd run validate:structure
npm.cmd run build
npm.cmd run format:check
```

The `family-local` profile is the reference local environment. Optional providers stay disabled
until their adapter and privacy policy are implemented.
