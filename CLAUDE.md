# MediaPipe games (for a 4-year-old)

Static GitHub Pages site, no build step. Each game is a folder; the root `index.html` is the hub.

- **New game or camera / MediaPipe work:** read `docs/NEW_GAME.md` first.
  - Start from `template/`.
  - Use `common/` (`shell.js`, `tracking.js`, `fx.js`, `kit.css`) instead of writing camera, MediaPipe, start-screen or sound code again.
- **Which games use `common/`:** `shapes/`, `cooking/` and `arabic/` do. `arcade/` and `ride/` are older and have their own code.
- **Git:** commit and push straight to `main`; it is the only branch.
- **Artwork:** use original characters and art only, nothing from TV shows.
- **Testing:** Playwright with fake-camera flags and a stub `vision_bundle.mjs` (see "Testing" in `docs/NEW_GAME.md`). Serve with `python3 -m http.server`.
