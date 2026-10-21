# Setting up the Assessment Calendar

This guide takes you from an empty Google Sheet to a working web app. Allow
about an hour, plus the time IT needs for the PowerSchool export.

The app is one Google Sheet with an Apps Script project bound to it. The Sheet
holds the data, and the script serves the web page. People open the web app
link; nobody but admins needs to open the Sheet.

**Keep IDs out of GitHub.** This repository is public. Calendar IDs, the Sheet
URL and staff lists go into the Sheet, never into the code.

---

## 1. Create the Sheet and push the code

Use an account that will stay with the school. The web app runs as the person
who deploys it. If you can, create the Sheet in a Shared Drive owned by
Teaching & Learning.

1. Create a new Google Sheet called **AISA Assessment Calendar (6–12)**.
2. **Extensions → Apps Script**. Name the project the same way.
3. In the Apps Script editor, open **Project Settings** (the gear icon) and
   copy the **Script ID**.
4. Turn on the Apps Script API for your account at
   <https://script.google.com/home/usersettings>.
5. On a computer with Node.js, run:

   ```sh
   npm install -g @google/clasp@2.4.2
   git clone https://github.com/AISA-AI-web/assessment-calendar.git
   cd assessment-calendar
   clasp login                                  # sign in with the account from above
   clasp clone <SCRIPT_ID> --rootDir apps_script
   git checkout -- apps_script/appsscript.json  # clone overwrote it with the default
   rm -f apps_script/Code.js
   clasp push --force
   ```

   No Node.js? In the Apps Script editor, tick **Project Settings → Show
   "appsscript.json"**. Then, for every file in `apps_script/`, create a file
   with the same name (Script for `.gs`, HTML for `.html`) and paste its
   contents in. Replace `appsscript.json` too.

## 2. Run Set up

1. Reload the Sheet. A menu called **Assessment Calendar** appears.
2. Choose **1. Set up or repair this Sheet** and approve the permissions. The
   app needs Sheets, Calendar, Mail and triggers.

Set up creates the tabs and fills in default settings. It also adds the CalendarRules and secondary Bells tabs, and makes you ADMIN in the Staff tab. If you subscribe to the AISA (Internal Calendar), it finds that calendar's ID, and it starts an hourly sync. You can run it again at any time: it never overwrites what you have entered.

## 3. Fill in Settings and Staff

**Settings tab** (column `value`):

| Key | What to put |
|---|---|
| `grade_calendar_6` … `grade_calendar_12` | The Calendar ID of each grade's assessment calendar. Find it under Google Calendar → the calendar's settings → **Integrate calendar**. |
| `internal_calendar_id` | Only if Set up did not find it. |
| `support_email` | Who people should contact, e.g. the T&L inbox. |
| `slt_notify_emails` | Optional. Who gets "approval needed" emails. If blank, everyone with role SLT gets them. |
| `student_email_pattern` | Only if the roster's student emails are missing: how to build them, e.g. `{id}@aisa.sch.ae`. |
| `roster_skip_courses` | Course numbers the roster import leaves out (default: homerooms like `HHR`). |
| `mirror_unannounced` | `TRUE` if only staff can see the grade calendars. `FALSE` if students or parents can, so that unannounced entries stay off them. **Check this with the SLT member who owns the grade calendars.** |

The other settings (year and semester dates, the limit of 2, `BLOCK`) are
already set for 2026–27.

**Staff tab:** add one row per person who needs more than a teacher's access.
Use role `SLT` for those who approve requests and can override the limit
(Head of T&L, Secondary Principal, Secondary SLT) and `ADMIN` for whoever runs
the Sheet. Use `VIEWER` for staff who should see the calendar without booking,
such as counsellors. Teachers do not need a row: anyone listed as a section
teacher in the PowerSchool export is a teacher automatically. Heads of
Department have the same rights as teachers.

The account that deploys the web app must have **Make changes to events** on
all seven grade calendars, and must be able to see the Internal Calendar.

## 4. Sync the Internal Calendar

Choose **2. Sync the Internal Calendar now**, then look over the
**InternalEvents** tab. Each event has a `category`:

| Category | Effect |
|---|---|
| `ROTATION` | "MS/ HS Day N": the rotation day shown on each date |
| `CLOSED` | No school: nobody can book (on a day with a rotation day it becomes `NO_ASSESSMENTS`) |
| `NO_ASSESSMENTS` | Teachers cannot book; SLT can override |
| `EXAM_WINDOW` | Only exams can be booked |
| `TESTING`, `CAUTION` | Teachers see a warning |
| `EVENT` | Shown for information |
| `DEADLINE` | Shown to staff only |
| `HIDDEN` | Not shown |

The `grades` column says which grades an event concerns (`ALL` means
everyone). To correct one event, fill in `override_category` and/or
`override_grades`; the hourly sync keeps your corrections. To change how a
kind of event is treated, edit the **CalendarRules** tab instead (patterns are
case-insensitive, and the first match wins).

Things to check before the pilot:
- **End-of-Year Semester Exams** applies to G9–12 only: set
  `override_grades` to `9,10,11,12`.
- **PIRLS** and other elementary-only tests with no grade in the title: set
  `override_category` to `HIDDEN`.
- **Spring Break and Eid al-Fitr** are not on the Internal Calendar yet. Until
  they are, weekdays without a rotation day show "No rotation day listed" and
  teachers get a warning. Ask the calendar owner to add them.

## 5. Load the class roster

The app needs to know which students are in which class. It reads this from
the school's **class roster**: one row per student per class per teacher, with
the columns Class Name, Course Number, Email Address (or User Name) and
Instructor First/Last Name for the teacher, Student ID, Student Grade, and
Student Email. Other columns are ignored. Student names and genders are never
read or stored.

1. **Save the roster as CSV.** In Excel: **File → Save As → CSV UTF-8**. Only
   the open worksheet is saved, so open the roster sheet first. If the roster
   is a Google Sheet, you can instead copy every cell and paste it into the
   **Roster** tab with **Paste special → Values only**, then skip step 2.
2. **Import it into the Roster tab.** Open the **Roster** tab → **File →
   Import → Upload** → choose the CSV → Import location **Replace current
   sheet** → **untick "Convert text to numbers, dates, and formulas"** →
   Import data.
3. **Check it.** Choose **3. Check the class roster (changes nothing)**. The
   report says how many classes, students and teachers it found. It also lists
   what it skipped (other grades, homerooms) and any problems.
4. **Fix what the report flags**, then check again:
   - *Students have no usable email.* Students sign in with their school
     account, so the app needs each student's email. If the Student Email
     column shows `#NAME?`, it holds a formula Excel could not work out. Copy
     that column as values from the original file, or set Settings →
     `student_email_pattern` (for example `{id}@aisa.sch.ae`, where `{id}` is
     the Student ID).
   - *Homerooms or other non-teaching classes appear.* Settings →
     `roster_skip_courses` lists the course numbers to leave out, as a
     regular expression. The default skips homerooms such as `HHR`.
5. **Load it.** Choose **4. Load the class roster**. This replaces the
   previous roster.
6. **Optional:** the **CourseNames** tab now lists every course number. Type a
   friendly name next to any code (`IB1ENGS` → `English A SL`) and the app
   uses it straight away.

Load the roster again whenever classes change: at least before Semester 2, and
after any big add/drop. A class that has bookings but is missing from the new
roster is kept, marked `RETIRED` in the Sections tab, so its entries still
show. Its students no longer count toward the limit, so if a class was only
renamed, move its bookings to the new class.

The roster has no meeting times, so the app cannot suggest a class's next
lessons or warn when it does not meet on a given day. The 2-per-day check does
not need them. If IT can add PowerSchool's `Expression` and `Term` columns to
the roster, those features switch on.

*Two PowerSchool files instead?* Import `sections.csv` into **PS_Sections** and
`enrolments.csv` into **PS_Enrolments** the same way (see
[POWERSCHOOL_EXPORT.md](POWERSCHOOL_EXPORT.md)), leave the Roster tab empty,
and use steps 3 and 4.

## 6. Deploy the web app

1. In the Apps Script editor: **Deploy → New deployment → Web app**.
2. Execute as **Me**. Who has access: **Anyone within American International
   School in Abu Dhabi**.
3. Deploy, then copy the URL ending in `/exec` into Settings → `app_url`
   (emails and calendar entries link to it).

To publish a code change later: `git pull`, `clasp push`, then **Deploy →
Manage deployments → Edit → Version: New version → Deploy**. The URL stays
the same.

## 7. Bring in the old grade-calendar entries

Choose **5. Import entries from the grade calendars**. Every event dated from
today (or from Settings → `import_from`) is queued. Each teacher sees their
own under **From the old calendars** in the app. They either add one properly
(the old event is then replaced by the standard one) or mark it "not an
assessment". SLT can handle anyone's.

From then on, teachers should book only in the app. The grade calendars become
a read-only copy, and anything typed straight into them is not counted.

---

## Pilot checklist (staff PD day, 20 October)

- [ ] IT has the export request (mid-term break is 12–16 Oct)
- [ ] Settings: seven grade calendar IDs, `support_email`, `mirror_unannounced` confirmed with the grade calendars' owner
- [ ] Staff tab: SLT and admins
- [ ] Internal Calendar synced and InternalEvents checked
- [ ] Class roster checked (step 3) and loaded (step 4), with student emails present
- [ ] Old grade-calendar entries queued (step 7)
- [ ] Web app deployed; tried with one teacher account and one student account
- [ ] Teachers told: book here first, then tell students, then tick "Announced to students"

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Your account does not have access" | The person is not in the Staff tab, not a section teacher and not an enrolled student. Add them to Staff. |
| Entry shows "Grade calendar: ERROR …" | The deploying account cannot edit that calendar, or the ID is wrong. Fix it; failed copies are retried every hour. |
| A day shows the wrong rotation day | The Internal Calendar has it wrong. Fix it there; the app follows within the hour, or straight away with menu step 2. |
| A teacher cannot see their class | The roster does not list them as its teacher, or lists an email that is not the one they sign in with. Fix the roster and load it again, or set `teachers_book_any_section` to `TRUE` for now. |
| A student gets "no access" | The roster has no usable email for them. See step 5. |

## For developers

```sh
npm test              # 44 tests: the real server code against an in-memory Sheet
npm run preview       # builds preview/dist/index.html: the full app, no Google needed
npm run screenshots   # drives the preview in Chromium and checks the main flows
```

`apps_script/` is everything that runs in Google. `support/` holds the
in-memory Sheet, fake Google services and the fictional school used by the
tests and the preview. Google services are only touched in `Svc.gs` (and
Sheets in `Store.gs`), so everything else runs unchanged in Node and the browser.

**K–5 later:** deploy the same code a second time with its own Sheet. Set
`grades` to `K,1,2,3,4,5` and swap the CalendarRules so that "Elem. Day X" is
the rotation. Enter the elementary bell times in Bells. Showing rotation days
as letters (Day A–F) needs a small change in the app.
