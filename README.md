# Lift Log

Phone-first workout log. It is a static site you can add to the iPhone home screen. The program never ships in this repo: on first launch you pick a `program.json` file (or paste it). Logs stay in this browser.

Expected site: [https://hijjennings.github.io/lift-log/](https://hijjennings.github.io/lift-log/)

## Use it

1. Open the site in Safari.
2. Choose `program.json` from Files, or paste the JSON.
3. Log each set (weights are in **lb**). The app saves as you type.
4. Share → Add to Home Screen for a standalone icon. After the first online load, the app shell works in airplane mode.

Replace the program, export a CSV, or download/restore a full JSON backup from Settings.

CSV columns: `date, week, day, workout, exercise, set, weight, reps, completed_day`.

## Privacy

Do not commit a real `program.json`, excerpts, or screenshots that show real exercise names. `uploads/` and `program.json` are gitignored. The only program file in the repo is `tests/fixtures/sample-program.json`, and every exercise in it is named Sample Exercise.

## program.json

The app accepts the exported program shape, including extra fields:

- `days[]` with `week`, `day` (1 = Monday … 7 = Sunday), `titlePrinted`, `focus`, `page`, `isRest`, `restText`, `pageNote`, `footerNote`, and `exercises`.
- Rest days (`isRest: true`) show `restText` and can be checked off. **Next workout** skips them.
- `exercises[].reps` is an array of strings. One entry applies to every set. Otherwise each set uses its own line when that line exists.
- `schedule[]` rows that have no matching day (Week 13 Day 6 and Day 7 in the full program) open with the deload text.
- `deload` and `glossary` have their own screens.

## Develop

```bash
npm install
npx playwright install webkit
npm test
npm start
```

`npm start` serves `site/` at http://127.0.0.1:4173 .

To check a private program file locally without printing its text:

```bash
PROGRAM_JSON=/path/to/program.json npm run check:real
PROGRAM_JSON=/path/to/program.json npx playwright test tests/real-program.spec.js
```

## GitHub Pages

The workflow `.github/workflows/pages.yml` publishes the `site/` directory on every push to `main`.

The repository owner has to turn Pages on once (this cannot be done from the workflow file):

1. Open this repository on GitHub.
2. **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Merge the workflow to `main` (or run it with **Actions → Deploy GitHub Pages → Run workflow**).

The first run may ask you to approve the `github-pages` environment. After it succeeds, the site is at https://hijjennings.github.io/lift-log/ .
