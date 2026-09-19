# Aftershock development

- Use Node.js 22.18 or newer and pnpm 10.17.1.
- Install dependencies with `pnpm install`.
- Run focused package checks with `pnpm --filter <package> typecheck` and `pnpm --filter <package> test`.
- Run all required checks with `pnpm check`.
- Keep Browserbase access inside `packages/browser`; other packages communicate through schemas and events from `packages/schema`.
- Never commit `.env` files or API keys.
