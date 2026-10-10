# PowerSchool export for the Assessment Calendar

The Assessment Calendar checks that no student gets more than two summatives on
the same day. To do that it needs to know which students are in which classes.
It gets this from two CSV exports from PowerSchool, described below.

- **Scope:** Grades 6–12, current school year, both semesters.
- **No student names.** Student number and school email only.
- **First export needed by:** Monday 19 October 2026 (pilot on 20 October).
- **Refresh:** at the start of Semester 2 (8 February), and whenever schedules
  change a lot (add/drop). Weekly is ideal if it can be automated.

Send both files to the calendar admin. They are imported into a private Google
Sheet that only the admin and the app can open.

---

## File 1: `sections.csv`

One row per class section.

| Column | Required | Example | PowerSchool source (hint) |
|---|---|---|---|
| `section_id` | yes | `41237` | `Sections.ID` (must match `section_id` in file 2) |
| `course_number` | yes | `G09ART` | `Sections.Course_Number` |
| `course_name` | yes | `Visual Arts 9` | `Courses.Course_Name` |
| `section_number` | yes | `1` | `Sections.Section_Number` |
| `teacher_email` | yes | `teacher@aisa.sch.ae` | lead teacher's `Teachers.Email_Addr` |
| `teacher_name` | no | `Doe, Jane` | lead teacher's `Teachers.LastFirst`, shown next to their entries |
| `co_teacher_emails` | no | `a@aisa.sch.ae;b@aisa.sch.ae` | other teachers on the section (`SectionTeacher`), separated by `;` |
| `expression` | yes | `3(1,4,7) 5(9)` | `Sections.Expression`: periods and cycle days the class meets |
| `term` | yes | `S1` | `Terms.Abbreviation` (`S1`, `S2`, or the full-year code) |
| `department` | no | `Arts` | `Courses.CreditType` or department, used for filtering |

About `expression`: export it exactly as PowerSchool shows it. The app reads
the usual forms, such as `3(1,4,7)`, `3(D1,D4,D7)`, `1-2(A-C)` and `P3(1-5)`.
If cycle days are letters, say which letter is which day (for example
`A` = Day 1 … `J` = Day 10).

## File 2: `enrolments.csv`

One row per student per section they are enrolled in.

| Column | Required | Example | PowerSchool source (hint) |
|---|---|---|---|
| `student_number` | yes | `202415` | `Students.Student_Number` |
| `student_email` | yes | `student@aisa.sch.ae` | the student's school Google account |
| `grade_level` | yes | `9` | `Students.Grade_Level` |
| `section_id` | yes | `41237` | `CC.SectionID` |
| `date_enrolled` | no | `2026-08-31` | `CC.DateEnrolled` |
| `date_left` | no | `2027-02-05` | `CC.DateLeft` |

Please leave out dropped enrolments. In `CC` these have a negative
`SectionID`. Dates can be `YYYY-MM-DD` or `MM/DD/YYYY`.

---

## Format

- CSV, UTF-8, header row as named above. Column order does not matter, and
  common PowerSchool header names such as `Sections.ID` or `Course_Number` are
  also accepted.
- One file per export. No totals or blank rows at the top.

## What happens to the data

The admin imports both files into the calendar's private Sheet and runs
**Assessment Calendar → Process PowerSchool import**. This checks the files
(unknown sections, missing emails, duplicates), reports any problems and
replaces the previous import. Teachers never see enrolment lists. When a
booking would give some students a third summative that day, the app tells
the teacher how many students are affected and which assessments clash. It
shows student emails only to that teacher and to SLT. Students see only their
own classes.
