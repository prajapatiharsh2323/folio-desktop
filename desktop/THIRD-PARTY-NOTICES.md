# Third-party notices

Licences of the runtime dependencies shipped inside Folio Desktop's webview.
All are used unmodified, as installed from their npm packages. This file
lists only what is bundled at runtime; build-time tooling is not
redistributed and is therefore not listed.

| Package            | Version | Licence      |
| ------------------ | ------- | ------------ |
| react, react-dom   | 18.3.x  | MIT          |
| zustand            | 4.5.x   | MIT          |
| @readium/navigator | 2.14.x  | BSD-3-Clause |
| @readium/shared    | 2.8.x   | BSD-3-Clause |
| fflate             | 0.8.x   | MIT          |
| pdfjs-dist         | 6.5.438 | Apache-2.0   |

## pdf.js (pdfjs-dist)

Copyright Mozilla and pdf.js contributors. Licensed under the Apache License,
Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Used for PDF
parsing, rendering and text extraction, pinned to an exact version; the
security advisory history is tracked in
`docs/development/plans/implementations/I-20261114-01-pdf-support.md`.

The bundled pdf.js runtime also carries these third-party components, whose
licences ship inside `node_modules/pdfjs-dist` (`cmaps/`, `standard_fonts/`,
`wasm/` are copied into the application bundle by the build):

- Adobe CMaps (`cmaps/*.bcmap`) — Adobe Systems licensing terms.
- Standard font data (`standard_fonts/*`) — see the `LICENSE_*` files.
- JBIG2 / OpenJPEG / QCMS / QuickJS WASM decoders (`wasm/*`) — see the
  `LICENSE_*` files in `pdfjs-dist/wasm/`.

## Readium web toolkit (@readium/navigator, @readium/shared)

Copyright (c) Readium Foundation and contributors. BSD 3-Clause License
(https://opensource.org/licenses/BSD-3-Clause).

## fflate

Copyright (c) 2021 Arjun Barrett. MIT License.

## zustand

Copyright (c) 2019 Paul Armstrong. MIT License.

## react / react-dom

Copyright (c) Meta Platforms, Inc. and affiliates. MIT License.
