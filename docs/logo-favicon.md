# Favicon / logo

The site favicon is referenced once, in `src/layouts/Base.astro`:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

`public/favicon.svg` currently holds a placeholder **"F3"** monogram in the
brand red (`#AD0C02`) on the dark `--color-ink` square. I couldn't download the
official F3 logo from the build environment (outbound network is restricted to
an allowlist), so swap it in when you have the asset.

## To use the official F3 logo

1. Drop the file into `public/`, e.g. `public/favicon.svg` (preferred — crisp at
   every size) or `public/favicon.png`.
2. If you use a PNG instead of SVG, update the link in `Base.astro` to
   `type="image/png"` and the matching `href`.
3. Replace the legacy `public/favicon.ico` too — some browsers request
   `/favicon.ico` directly regardless of the `<link>` tag, and the stock Astro
   icon still lives there.
4. (Optional) add an Apple touch icon for home-screen bookmarks:
   `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />` with a
   180×180 PNG in `public/`.
