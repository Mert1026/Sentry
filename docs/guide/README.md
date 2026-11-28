# User guide (English and Bulgarian)

| Language  | Source          | PDF                      | Screenshots |
| --------- | --------------- | ------------------------ | ----------- |
| English   | `guide.en.html` | `Sentry-guide.pdf`       | `img/en/`   |
| Bulgarian | `guide.bg.html` | `Sentry-ръководство.pdf` | `img/`      |

```
node docs/guide/build.mjs        # both PDFs
node docs/guide/build.mjs en     # English only
node docs/guide/build.mjs bg     # Bulgarian only
```

The build prints the pages with headless Chrome or Edge (set `CHROME` to use another browser).

- `guide.css` — the print layout (A4, page numbers, notes, tables). `guide.en.css` only changes
  the English page footer.
- `annotate.js` — places the numbered markers and arrows on screenshots. A marker is
  `<i class="pin" data-x data-y data-dx data-dy>`: `x`/`y` is the point in % of the screenshot,
  `dx`/`dy` moves the badge away from it in mm. `data-crop="x,y,w,h"` (in %) shows part of a
  screenshot; give its height/width as `data-ratio`.
- The screenshots were taken at 2× from the Windows app with the demo project `online-shop` and
  paid OpenCode runs (Fast, Full and a Re-test), once with the app in each language.
