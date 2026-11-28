# User guide (Bulgarian)

`guide.bg.html` is the source of the printed user guide; `Sentry-ръководство.pdf` is built from it.

```
node docs/guide/build.mjs
```

The build prints the page with headless Chrome or Edge (set `CHROME` to use another browser).

- `guide.css` — the print layout (A4, page numbers, notes, tables).
- `annotate.js` — places the numbered markers and arrows on screenshots. A marker is
  `<i class="pin" data-x data-y data-dx data-dy>`: `x`/`y` is the point in % of the screenshot,
  `dx`/`dy` moves the badge away from it in mm. `data-crop="x,y,w,h"` (in %) shows part of a
  screenshot; give its height/width as `data-ratio`.
- `img/` — the screenshots. They were taken at 2× from the Windows release 2.0.4 with the
  demo project `online-shop` and paid OpenCode runs (Fast, Full and a Re-test).
