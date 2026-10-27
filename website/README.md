# Open Forensic website

This directory is the portable static product website and complete documentation. It is not attached to a hosting provider. The browser app is built separately from the repository root.

## Serve locally

```bash
python3 -m http.server 4175 --directory website
```

Open `http://localhost:4175/` and `http://localhost:4175/docs/`. No build step is required for this directory.

## Production hosting

- Serve the contents of `website/` at the **root** of the product-site origin over HTTPS. The `/docs/` route is `docs/index.html`; configure directory indexes or a `/docs/` rewrite if your server does not provide them automatically.
- Keep the paths to `/styles.css`, `/site.js`, `/logo-mark.svg`, `/docs/`, and `/images/` intact.
- The browser workspace is a separate static export: from the repository root, run `pnpm install --frozen-lockfile` and `pnpm export:app`, then serve `out/` at the root of its own HTTPS origin. The current export and service worker assume an origin root, so do not put it under the product site's `/app/` path without changing the app build.
- After the browser workspace is reachable, update the product site's main CTA and documentation to use its new origin. Until then, the site links only to the verified GitHub desktop release and its local docs.
- Set the canonical and social `og:url` tags to the final product-site URL after the server address is known.

The four app screenshots in `images/` are synthetic-data captures from the actual workspace. Keep them with the site when deploying.
