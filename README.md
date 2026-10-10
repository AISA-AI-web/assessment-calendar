# AISA Assessment Calendar

Before scheduling a test, a teacher should be able to see what their students
already have that day. This app shows every assessment by grade and class, by
month or by week. It also enforces the school rule of **no more than two
summatives per student per day**.

- **Built for Grades 6–12** (pilot: 20 October 2026). K–5 follows as a second
  deployment of the same code.
- **Google Apps Script web app** backed by a Google Sheet, open to AISA Google
  accounts only.
- **Reads the AISA Internal Calendar:** rotation days (Day 1–10), holidays,
  testing weeks and school events.
- **Counts load per student** from a PowerSchool enrolment export, so a girls'
  test never blocks the boys' class, and electives are counted properly.
- **Mirrors every entry to the grade assessment calendars**, so existing
  subscribers keep seeing them.
- **Students see their own announced assessments**, read-only.

| Doc | For |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Installing, configuring, deploying, pilot checklist |
| [docs/POWERSCHOOL_EXPORT.md](docs/POWERSCHOOL_EXPORT.md) | What to ask IT for (forwardable) |
| [docs/DECISIONS.md](docs/DECISIONS.md) | What was decided, and what is still open |

## Try it without Google

```sh
npm run preview      # writes preview/dist/index.html
```

Open `preview/dist/index.html?as=teacher` (or `slt`, `admin`, `student`,
`viewer`). It runs the real app against a fictional school, and its changes
last for the browser tab, so you can book as a teacher, switch to SLT and
approve.

## Code

```
apps_script/   everything that runs in Google (pushed with clasp)
  WebApp.gs      page, Sheet menu, Set up, hourly trigger
  Api.gs         functions the browser calls
  Entries.gs     bookings, approvals, who sees what
  Rules.gs       per-student load and the booking rules
  Days.gs        Internal Calendar sync, rotation days, bell times
  Directory.gs   roles, classes, enrolments
  Import.gs      PowerSchool CSV import
  Mirror.gs      copies to the grade calendars; old-entry import
  Store.gs       the Sheet as tables      Svc.gs  other Google services
  Index.html, Styles.html, App.html   the page
support/       in-memory Sheet, fake Google services, fictional school
tests/         npm test (node:test)
preview/       browser preview and Chromium checks (npm run screenshots)
```
