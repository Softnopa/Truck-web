#!/usr/bin/env node
/**
 * Puts the install metadata into the exported `index.html`.
 *
 * A browser will not offer to install a site whose document does not link a
 * manifest, and with `web.output: "single"` there is no way to reach the
 * `<head>` from inside the app: Expo Router's `app/+html.tsx` is only consulted
 * when rendering statically, and the single-page export writes its own shell
 * from a fixed template. (That was tried first, and produced an HTML file with
 * none of this in it.)
 *
 * So the shell is edited after the fact. The files it points at — the manifest
 * and the icon — come from `public/`, which Expo copies to the export root
 * verbatim and does not need any of this.
 *
 * Idempotent: running it twice leaves one copy of the tags, so a rebuilt or
 * re-deployed directory is safe.
 *
 * Usage: node scripts/inject-pwa.js [outputDir]   (default: dist)
 */
const fs = require('fs');
const path = require('path');

const MARKER = 'manifest.webmanifest';

const TAGS = `
    <!-- Injected by scripts/inject-pwa.js — see that file for why. -->
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#0B0F14" />
    <link rel="icon" type="image/png" href="/icon.png" />
    <link rel="apple-touch-icon" href="/icon.png" />
    <!-- iOS cannot be prompted, but "Add to Home Screen" reads these; without
         them it saves a bookmark rather than something with its own window. -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Truck" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
`;

const outputDir = process.argv[2] || 'dist';
const indexPath = path.join(outputDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error(`inject-pwa: no ${indexPath} — did the export run?`);
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');

if (html.includes(MARKER)) {
  console.log('inject-pwa: already present, nothing to do');
  process.exit(0);
}

if (!html.includes('</head>')) {
  // Better to fail the build than to ship a page that silently cannot be
  // installed — that failure is invisible until someone goes looking for the
  // install button that never appears.
  console.error('inject-pwa: no </head> in the exported HTML; template changed?');
  process.exit(1);
}

fs.writeFileSync(indexPath, html.replace('</head>', `${TAGS}  </head>`), 'utf8');
console.log(`inject-pwa: install metadata added to ${indexPath}`);
