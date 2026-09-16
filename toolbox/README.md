# AJN Dev Toolbox

Read-only diagnostics and verification tools for the AJN application. The toolbox observes the repository and deployed app; it does not modify application runtime code.

## Rules

- Test exact commit SHAs in CI; do not `git pull` during CI verification.
- Never commit secrets. Copy `.env.example` to a local `.env` and keep it gitignored.
- Keep existing `.github/workflows/ajn-ci.yml` unchanged.
- Treat known environmental conditions such as an empty RSS feed as informational unless a deterministic fixture/configuration is supplied.
- Do not recursively trigger CI from CI by default.

## Local use

```bash
python toolbox/main.py
```

Headless runners can also be invoked directly. See `toolbox/runners/`.

## Current scope

The first implementation provides the runner contracts and a minimal read-only desktop shell. Application fixes remain outside the toolbox boundary.
