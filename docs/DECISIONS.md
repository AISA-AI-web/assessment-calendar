# Assessment Calendar: decisions log

A running record of what has been decided, what is assumed and what is still
open. Update it whenever a decision changes, so this context is not lost again.

> **This repository is public.** Keep calendar IDs, spreadsheet IDs, staff
> names, student data and credentials out of it. They belong in the Google
> Sheet and in Apps Script Script Properties.

## Scope

- **Phase 1:** Grades 6–12 (Middle and High School). **Pilot: staff PD day,
  Tuesday 20 October 2026**. Students first see it on 21 October.
- **Phase 2:** K–5. Same codebase, deployed separately with its own Sheet,
  settings (Day A–F cycle, trimesters, elementary bell times) and URL.

## Decided (10 Oct 2026)

| # | Topic | Decision |
|---|---|---|
| 1 | Front end | Apps Script web app (HtmlService) that only AISA Google accounts can open. The code lives in this repo and is pushed with `clasp`. No GitHub Pages front end. |
| 2 | Data store | One private Google Sheet per division. |
| 3 | Load unit | Per student. A PowerSchool export of student → section enrolments (student IDs, no names) lets the app count each student's summatives per day exactly. IT can produce it, including meeting patterns, teacher emails and student emails. |
| 4 | Daily limit | Max 2 summatives (including exams) per student per day. Teachers **cannot save** a booking that gives any student a 3rd. They can ask SLT, who approves or declines. SLT can also override directly, with a recorded reason. |
| 5 | Who approves | SLT and admins only. Heads of Department have the same rights as other teachers. |
| 6 | Formatives | Allowed. Shown in a lighter style and never counted. |
| 7 | Audience | Staff (read/write by role) and students (read-only). Students are on AISA Google accounts. |
| 8 | Student visibility | An entry is staff-only until its teacher ticks "Announced to students". |
| 9 | Grade calendars | Import the existing entries once (each creator claims theirs), then mirror every entry one-way to the matching grade calendar. Believed staff-only, so unannounced entries are mirrored too (`mirror_unannounced = TRUE`); **confirm with the SLT member who owns the grade calendars**. |
| 10 | Internal Calendar | Read-only overlay from "AISA (Internal Calendar)", synced hourly. |
| 11 | Roster source (21 Oct) | IT's PowerSchool **CC export** (tab-separated, one row per student per section), imported into the Roster tab as it comes. `SectionID` is the class ID, and `Section_Number` its code in the app (`12ASL1`). Until IT adds `[1]Grade_Level`, each student's grade comes from their course numbers (`G07ISA` → 7); in the 21 Oct export every student got exactly one grade this way. Expression letters A–J are taken as Days 1–10. The homerooms `HHR` and `MHR` (HR / Moral Education) are skipped. Student names in the export are ignored and never stored, and IT is asked to drop `[1]lastfirst`. The school's class roster export (Class Name …) still works, but has no meeting times. |
| 12 | Who loads the roster (21 Oct) | Only the Sheet's admins (role ADMIN in the Staff tab), from the Sheet menu, never from the web app. One step: paste into the Roster tab, then "Load the class roster", which shows a summary and asks Yes/No. |

## How it works now (built)

- **Views:** a month grid and a week grid by period (bell times, with Friday
  P1–P4 only), plus an agenda on phones. Every date shows its rotation day.
  The scope can be all grades, one grade, one class (meaning everything that
  class's students have, in every subject) or, for students, my assessments.
- **Load meter:** the busiest student's summative count against the limit, for
  the chosen scope. Filters never change it.
- **Booking:** pick class(es), date and period. The check runs as you type and
  shows the clashing assessments and their teachers, how many students are
  affected (their emails only for the class's own teachers and SLT), and the
  next clear days when the class actually meets.
- **Statuses:** ACTIVE, PENDING (waiting for SLT; not counted, not mirrored),
  DECLINED (teacher can move it and resubmit), CANCELLED.
- **Internal Calendar rules:** rotation days are read, never computed, because
  holidays skip numbers. Closures block everyone. "No assessments" days and
  exam windows block teachers. Testing and busy days (PTC, Career Fair,
  trips) warn. Timed events warn only if the booking overlaps their periods.
  Events carry grades parsed from their titles ("G6-G9", "High School",
  "Senior"), and admins can override any single event.
- **Not built (on purpose):** weekly cap and minimum notice. The prototype had
  3 per week and 5 days' notice, but neither is school policy.

## Open questions

1. Are the 7 grade calendars staff-only? (Sets `mirror_unannounced`.)
2. PowerSchool day codes are letters A–J, taken as Days 1–10 (the Internal
   Calendar's "MS/ HS Day N"). Confirm the order; if it differs, set Settings →
   `day_letter_map`.
3. Semester exam dates and IB DP exam dates are still to be added to the
   Internal Calendar, and Spring Break and Eid al-Fitr are not there yet.
4. Who owns the Sheet and the deployment long-term (a Shared Drive and a role
   account are safer than a personal account)?
5. Parents: policy 4.3 says the calendar is shared with families. Not in
   phase 1. A later option is a read-only family view or published grade
   calendars of announced entries.
6. Is Moral Education (`HHR`/`MHR`, "HR / Moral Education") assessed with
   summatives? If so, take those codes out of Settings → `roster_skip_courses`
   so teachers can book for it.
