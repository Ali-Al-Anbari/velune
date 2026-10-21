# Velune

A mobile-first Progressive Web App foundation for a future shift and earnings tracker. The current app is a coming-soon landing screen; it does not store shifts or calculate earnings.

## Get started

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

## Checks

```sh
npm run lint
npm run typecheck
npm run test:run
npm run build
```

Preview the production PWA with `npm run preview`. Install and offline behavior require localhost or HTTPS. The service worker precaches only generated static app assets. A new worker waits for a later session; the app never forces an active page to reload.

## Environment

`.env.example` reserves `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for future integration. No Supabase client is installed or initialized. Values with the `VITE_` prefix are exposed to the browser, so never put a secret service key there.
