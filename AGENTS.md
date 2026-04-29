# Repository Guidelines

## Project Structure & Module Organization
- Library source lives in `src/`, with separate signer implementations and shared session/types modules.
- Examples live in `examples/`.
- Package metadata and build scripts live in `package.json`; TS configs live in `tsconfig*.json`.
- Keep new modules focused. Prefer explicit signer or session boundaries over broad shared utility files.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run build`: bundle the library and emit type declarations.
- `npm run typecheck`: run the TypeScript compiler without emitting files.
- `npm test`: run the Vitest suite.
- `npm run test:watch`: run tests in watch mode.
- If you change the public API or example flows, update the README and example code together.

## Coding Style & Naming Conventions
- Use TypeScript throughout and keep public signer/session types explicit.
- Prefer focused modules and user-facing tests over implicit shared state or broad helper buckets.
- Keep PRs tightly scoped. Do not mix unrelated cleanup, formatting churn, or speculative refactors into the same change.
- Temporary or transitional code must include `TODO(#issue):` with the tracking issue for removal.

## Pull Request Guardrails
- PR titles must use Conventional Commit format: `type(scope): summary` or `type: summary`.
- Set the correct PR title when opening the PR. Do not rely on fixing it afterward.
- If a PR title changes after opening, verify that the semantic PR title check reruns successfully.
- PR descriptions must include a short summary, motivation, linked issue, and manual test plan.
- Changes to signer behavior, session persistence, OAuth flow, or the public API should include representative usage snippets or migration notes when helpful.

## Security & Sensitive Information
- Do not commit secrets, live tokens, private keys, or sensitive user session data.
- Public issues, PRs, branch names, screenshots, and descriptions must not mention corporate partners, customers, brands, campaign names, or other sensitive external identities unless a maintainer explicitly approves it. Use generic descriptors instead.
