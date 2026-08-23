# Icon workflow

This document defines how Pi GUI app icons are maintained and regenerated.

The first Pi GUI release uses a derivative of the Gustav icon: the Pi monogram is retained and the inherited `DESK` wordmark is replaced with `GUI`. The source remains plain SVG so the lineage and project-specific changes are reviewable.

## Source of truth

- Primary source artwork: `assets/branding/pi-gui-icon.svg`

Current source uses a handcrafted **Pi GUI** mark:
- Pi monogram in high-contrast white on near-black background
- Pixel `GUI` wordmark drawn from a fixed grid (no runtime/system font dependency)
- Square composition optimized for app launcher readability

Keep this file square, simple, and high-contrast. Avoid thin strokes, gradients, and micro-details that disappear at 32px.

## Regenerate platform icon set

From repo root:

```bash
npx tauri icon assets/branding/pi-gui-icon.svg -o src-tauri/icons
```

This regenerates:
- macOS (`icon.icns`)
- Windows (`icon.ico`, Appx Square/Store logos)
- Linux/desktop PNG sizes
- iOS / Android icon outputs used by Tauri bundles

## Validation checklist

After regenerating icons:

1. Commit both source and generated outputs:
   - `assets/branding/pi-gui-icon.svg`
   - `src-tauri/icons/**`
2. Build checks:
   - `npm run check`
   - `npm run build:frontend`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
3. Manual shell/surface checks:
   - macOS: Dock + Finder + app switcher
   - Windows: taskbar + Start Menu
   - Linux: launcher/menu
4. Capture screenshots and attach to issue/PR when icon changes are part of release scope.

## Notes

- The source icon should stay deterministic and editable as plain SVG.
- If icon concept changes significantly, document rationale in changelog/release notes.
