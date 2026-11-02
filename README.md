# Lift Log

Phone-first workout log for one person. It is a static site you can add to the iPhone home screen. The real program is stored only as `site/program.enc.json`. Logs stay on the phone.

Expected site: [https://hijjennings.github.io/lift-log/](https://hijjennings.github.io/lift-log/)

## Use it

Open the personal link (`https://hijjennings.github.io/lift-log/#k=…`) in Safari. The fragment is the decryption key. It is not sent to the server. Lift Log downloads the encrypted program, unlocks it on the phone, and opens the next workout.

To keep it on the Home Screen: from that Safari page, tap Share, then Add to Home Screen, then open the icon once while online. The icon’s start URL carries the same fragment, so the Home Screen app (which does not share Safari’s storage) can unlock the program into its own storage. After that, the app opens straight to the next workout, including offline.

Workouts follow program order. Rest days are optional. Log any day whenever you do it, and edit the performed date if you need to back-date a session. There is no missed-day state.

Settings has export (CSV and a JSON backup), restore, units, and the rest-timer sound. Settings → Advanced can still load a program file. That picker is not on the first screen.

CSV columns: `date, week, day, workout, exercise, set, weight, reps, completed_day`.

The rest timer rings while the app is open. An iPhone Home Screen web app cannot vibrate, and it will not reliably notify you if you leave or lock the phone.

## Privacy

Do not commit a real `program.json`, excerpts, or screenshots that show real exercise names. `uploads/` and `program.json` are gitignored. `site/program.enc.json` is AES-256-GCM ciphertext (`{v, alg, iv, ct}`, no AAD). The only plaintext program in the repo is `tests/fixtures/sample-program.json`, and every exercise in it is named Sample Exercise.

## program.json

The app accepts the exported program shape, including extra fields:

- `days[]` with `week`, `day` (1 = Monday … 7 = Sunday), `titlePrinted`, `focus`, `page`, `isRest`, `restText`, `pageNote`, `footerNote`, optional `flag` (a short warning string), and `exercises`.
- Rest days (`isRest: true`) show `restText` and can be checked off. **Up next** skips them. Leaving them unchecked changes nothing.
- `exercises[].reps` is an array of strings. One entry applies to every set. Otherwise each set uses its own line when that line exists.
- Notes may say warm-up, `Can Substitute W/ …`, drop set, or superset. The app shows those and keeps warm-ups out of PRs.
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

The workflow `.github/workflows/pages.yml` publishes the `site/` directory on every push to `main`. Merging to `main` publishes the site. Do not merge a branch until you mean to ship it.

The repository owner has to turn Pages on once (this cannot be done from the workflow file):

1. Open this repository on GitHub.
2. **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Merge the workflow to `main` (or run it with **Actions → Deploy GitHub Pages → Run workflow**).

The first run may ask you to approve the `github-pages` environment. After it succeeds, the site is at https://hijjennings.github.io/lift-log/ .
