# PowerSchool export for the Assessment Calendar

The Assessment Calendar checks that no student gets more than two summatives on
the same day. To do that it needs to know which students are in which classes,
and when each class meets. It reads this from one PowerSchool export.

- **Scope:** Grades 6–12, current school year, all terms.
- **Refresh:** at the start of Semester 2 (8 February), and whenever schedules
  change a lot (add/drop). Weekly is ideal if it can be automated.

Send the file to the calendar admin. It is imported into a private Google
Sheet that only the admins and the app can open.

## The export: CC, with student, teacher and course fields

The Data Export Manager export from the **CC** table that IT sent on 21
October 2026 works as it is. It is tab-separated, with one row per student per
section, and these fields:

| Field | Used for |
|---|---|
| `[1]student_number` | The student. |
| `StudentEmail` | The student's school Google account, which they sign in with. |
| `[5]Email_Addr` | The section's teacher, who books for it. |
| `[5]LastFirst` | The teacher's name, shown next to their entries. |
| `[2]Course_Name`, `Course_Number` | The class's name, and the grade (`G07ISA` → Grade 7). |
| `SectionID`, `Section_Number` | The class, and its code (`12ASL1`). |
| `Expression` | The periods and cycle days it meets, e.g. `3(A,F)`. |
| `TermID`, `DateEnrolled`, `DateLeft` | When each student is in it. |

Two small changes would make it better:

1. **Leave out `[1]lastfirst`.** The calendar never uses student names, so
   they are better kept out of its Sheet.
2. **Add `[1]Grade_Level`.** Without it, each student's grade is worked out
   from their course numbers. That works for every student in the October
   export, but would miss a student whose courses carry no grade (only AP or
   IB courses, say).

`[5]TeacherNumber` isn't needed but does no harm. Dropped enrolments (with a
negative `SectionID`) should be left out; the October export has none.

---

## Alternative: two CSV files

### File 1: `sections.csv`

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

### File 2: `enrolments.csv`

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

### Format

- CSV, UTF-8, header row as named above. Column order does not matter, and
  common PowerSchool header names such as `Sections.ID` or `Course_Number` are
  also accepted.
- One file per export. No totals or blank rows at the top.

## What happens to the data

The admin imports the file into the **Roster** tab of the calendar's private
Sheet (the two-file alternative goes into **PS_Sections** and
**PS_Enrolments**) and runs **Assessment Calendar → 3. Load the class
roster**. This checks the data (missing emails, students without a grade,
duplicates), reports any problems and replaces the previous import. Teachers
never see enrolment lists. When a booking would give some students a third
summative that day, the app tells the teacher how many students are affected
and which assessments clash. It shows student emails only to that teacher and
to SLT. Students see only their own classes.
