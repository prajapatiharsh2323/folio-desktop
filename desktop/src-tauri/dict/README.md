# Dictionary pack (build-time asset)

Folio Desktop ships the same offline English→Hindi pack as the Android app:

```
mobile/tools/build_dict.py  →  folio-eng-hin.sqlite   (~5 MB, 25,450 entries)
```

Drop the generated files here before `pnpm tauri:build`:

- `folio-eng-hin.sqlite` — the SQLite pack
- `folio-eng-hin.sha256` — optional checksum file (`<hex>  folio-eng-hin.sqlite`)

`tauri.conf.json` bundles `dict/*` as resources. On first run the Rust core
copies the pack to `%APPDATA%/Folio/dict/`, verifies the sha256 when the
`.sha256` file is present, and refuses a mismatched pack (06 §5). The same
verification is exposed by `dict_status`.

Until the pack is present the reader shows “The offline dictionary pack is not
installed.” — the Settings → About attribution is always visible.

License: the pack is FreeDict English→Hindi, **GPL-2.0**. The attribution must
remain in Settings → About and on the meaning card.
