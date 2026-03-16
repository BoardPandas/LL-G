---
tech: cloudflare
tags: [vite-plugin, workers, pages, deploy, wrangler, react-router, ssr]
severity: medium
---
# @cloudflare/vite-plugin builds a Worker, not a Pages project

## PROBLEM
When using `@cloudflare/vite-plugin` with React Router 7 (or any SSR framework), the build output is a Cloudflare Worker at `build/server/` with static assets at `build/client/`. Deploying with `wrangler pages deploy build/client/` only uploads static files -- SSR routes return 404, and the site appears broken.

## WRONG
```bash
# Deploys static assets only -- no SSR, routes return 404
wrangler pages deploy build/client/ --project-name=myapp
```

## RIGHT
```bash
# Build output structure:
# build/server/index.js        <- Worker entry
# build/server/wrangler.json   <- Generated config (assets: "../client")
# build/client/assets/          <- Static files

# Deploy as a Worker (includes SSR + static assets)
cd build/server
wrangler deploy --config wrangler.json
```

## NOTES
- The Vite plugin generates a `wrangler.json` in `build/server/` that references `../client` as the assets directory. The Worker serves both SSR responses and static assets.
- The Worker is deployed to `*.workers.dev` by default. Add a custom domain via the Cloudflare dashboard (Workers & Pages > Settings > Domains & Routes).
- If you created a Cloudflare Pages project by mistake, the Worker deployment is separate -- the Pages project can be deleted.
- For CI/CD, use `wrangler deploy --config wrangler.json` with `workingDirectory` set to `build/server/`.
