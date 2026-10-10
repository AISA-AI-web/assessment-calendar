# Assessment Calendar: decisions log

A running record of what has been decided, what is assumed and what is still
open. Update it whenever a decision changes, so this context is not lost again.

> **This repository is public.** Keep calendar IDs, spreadsheet IDs, staff
> names, student data and credentials out of it. They belong in the Google
> Sheet and in Apps Script Script Properties.

## Scope

- **Phase 1:** Grades 6–12 (Middle and High School).
- **Phase 2:** K–5. Same codebase, deployed separately with its own Sheet,
  settings (Day A–F cycle, trimesters, elementary bell times) and URL.

## Decided (10 Oct 2026)

| # | Topic | Decision |
|---|---|---|
| 1 | Front end | Apps Script web app (HtmlService) that only AISA Google accounts can open. The code lives in this repo and is pushed with `clasp`. No GitHub Pages front end. |
| 2 | Data store | One private Google Sheet per division. |
| 3 | Load unit | Per student. A PowerSchool export of student → section enrolments (student IDs, no names) lets the app count each student's summatives per day exactly. |
| 4 | Daily limit | Max 2 summatives per student per day. Teachers **cannot save** a booking that gives any student a 3rd. SLT can override, and the reason is recorded. |
| 5 | Formatives | Allowed. Shown in a lighter style and never counted toward the limit. |
| 6 | Audience | Staff (read/write by role) and students (read-only). |
| 7 | Student visibility | An entry is staff-only until its teacher ticks "Announced to students". |
| 8 | Grade calendars | Import the existing entries once, with each entry's creator confirming its section. From then on the app mirrors every entry one-way to the matching grade calendar, and teachers stop adding to those calendars directly. |
| 9 | Internal Calendar | Read-only overlay from "AISA (Internal Calendar)". See below. |

## Defaults (assumed until someone says otherwise)

- **Views:** the week view is a period grid built from the bell times below,
  and the month view is a day grid. Every date shows its rotation day (Day 1–10).
  There are views per grade, per section, "my classes" (teacher) and "my
  assessments" (student).
- **Booking form:** pick section(s), then date and period(s). Grade, subject
  and teacher come from the PowerSchool export, not free text. Category is
  Summative or Exam (counted) or Formative (not counted). Format (test, essay,
  lab, project, presentation, oral) is a separate field.
- **Override flow:** a blocked teacher can press "Request override". The entry
  is saved as Pending, and SLT is emailed. Until approved it is visible to staff
  only, not mirrored, and not counted.
- **Days:** nobody can book a no-student day from the Internal Calendar (breaks,
  PD days, holidays, Eid). Flagged weeks (PTC, Career Week, testing windows)
  show a warning.
- **No weekly cap and no minimum-notice rule.** The prototype had 3 per week
  and 5 days' notice, but neither is school policy. Both exist as settings,
  switched off.
- **Roles:** Admin; SLT (overrides, edits everything); Teacher (edits entries
  for their own sections); Student (read-only, announced entries only). The
  staff list and roles live in a Staff tab, seeded from the active staff list.
- **Exams:** SLT enters the semester exam (G9–12) and IB mock timetables.
  Regular summatives are blocked inside exam windows.
- **Bell schedules** are date-ranged in Settings, so Ramadan timings can be added.
- **UI:** keep the prototype's look and interaction: AISA purple `#21076C`,
  gold `#D8B664`, DM Sans. Its client source can be recovered from the
  generated preview bundle (`bbaki-ai/sample-assessment-calendar`,
  `index.html`). The backend is rebuilt.
- **Limits:** the web app runs as the deploying account for about 700 users.
  Each page load makes one server call (data inlined into the page), and
  computed load is cached.

## Internal Calendar overlay

A time-driven trigger syncs the calendar into a cache tab. Events are sorted
into categories by keyword rules in Settings, with per-event overrides, because
the titles are typed by hand.

| What appears on the calendar | Treatment |
|---|---|
| `MS/ HS Day N` all-day events | Rotation day shown on each date; used to match section meeting patterns |
| Breaks, PD "NO STUDENTS", holidays, Eid | No-student day: booking blocked |
| MAP, CAT4, PIRLS, ABT, SAT, IB exams/mocks | External testing: shown as context, with a warning |
| Parent-Teacher Conferences, Career Week/Fair, trips, grade events | Shown as context; warning when flagged |
| Staff meetings, after-school events, `Elem. Day X` | Hidden in the secondary app |

Quirks seen on 10 Oct 2026: titles carry trailing tabs and spaces. The rotation
goes from Day 10 (Fri 9 Oct) to Day 3 (Wed 21 Oct) after the mid-term break
and PD days, so rotation days must be read from the calendar, not computed.

## Secondary bell times

| Period | Mon–Thu | Fri |
|---|---|---|
| 1 | 7:55–8:45 | 7:40–8:30 |
| 2 | 8:50–9:40 | 8:35–9:25 |
| 3 | 9:45–10:35 | 9:45–10:35 |
| 4 | 11:00–11:50 | 10:40–11:30 |
| 5 | 11:55–12:45 | — |
| 6 | 1:10–2:00 | — |
| 7 | 2:05–2:55 | — |

Mon–Thu: homeroom 7:40–7:50, recess 10:35–10:55, lunch 12:45–1:05.
Fri: no homeroom, recess 9:25–9:40, 4 periods only.

## Open questions

1. Are students in the same Google Workspace domain as staff?
2. PowerSchool export: who runs it, and can it include each section's meeting
   pattern (cycle days + period), teacher email and student email?
3. Who can see the 7 grade calendars? If students or parents can, only
   announced entries are mirrored.
4. Target date for a pilot.
5. Should the Sheet and script live in a Shared Drive rather than a personal
   account?
