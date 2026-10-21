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
3. Copy the project's **Script ID**. In the editor's address bar it is the
   long code between `projects/` and `/edit`, and it starts with `1`. It is
   also under **Project Settings** (the gear icon) → IDs. It is not the
   `AKfycb…` code in a web app link, which is a deployment ID.
4. Turn on the Apps Script API for your account at
   <https://script.google.com/home/usersettings>.
5. On a computer with Node.js 20 or later, install clasp (skip this if
   `clasp --version` already shows 3.x):

   ```sh
   npm install -g @google/clasp@3.4.1
   ```

   Then paste the lines below into Terminal, with your Script ID in place of
   `PASTE_SCRIPT_ID_HERE`. When `clasp login` opens a browser, pick the
   account from above.

   ```sh
   cd ~
   git clone https://github.com/AISA-AI-web/assessment-calendar.git
   cd ~/assessment-calendar
   clasp login
   clasp clone PASTE_SCRIPT_ID_HERE --rootDir apps_script
   git checkout -- apps_script
   find apps_script -name '*.js' -delete
   clasp push --force
   ```

   This creates an `assessment-calendar` folder in your home folder and links
   it to the project. `clasp clone` overwrites the repo's files with the
   project's copies and saves scripts as `.js`. The two lines after it restore
   the repo's files and delete those copies, because the repo uses `.gs`.
   You do this once per computer.

   Don't add `# comments` to commands you paste. On a Mac, Terminal passes
   them on as part of the command.

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
| `roster_skip_courses` | Course numbers the roster import leaves out (default: the homerooms `HHR` and `MHR`). |
| `mirror_unannounced` | `TRUE` if only staff can see the grade calendars. `FALSE` if students or parents can, so that unannounced entries stay off them. **Check this with the SLT member who owns the grade calendars.** |

The other settings (year and semester dates, the limit of 2, `BLOCK`) are
already set for 2026–27.

**Staff tab:** give role `ADMIN` to the accounts that look after the
calendar. Only they can use the Sheet menu (loading the roster, syncing,
imports), and the Sheet should be shared with them alone. Then add one row per
person who needs more than a teacher's access.
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
IT's **PowerSchool CC export**, a tab-separated file with one row per student
per class (see [POWERSCHOOL_EXPORT.md](POWERSCHOOL_EXPORT.md)). The school's
class roster export (Class Name, Course Number, Email Address, Student ID,
Student Grade, Student Email) works too. Columns are matched by name and any
others are ignored. Student names and genders are never read or stored.

All of this happens in the Google Sheet. Teachers and students never see it.
Only people with role **ADMIN** in the Staff tab can use the Sheet's menu, so
keep the Sheet shared with just the admin accounts.

1. If the file's name ends in `.text`, rename it to end in `.txt`.
2. In the calendar's Sheet, open the **Roster** tab, choose **File → Import →
   Upload** and pick the file. Set **Import location** to **Replace current
   sheet** and **Separator type** to **Detect automatically**. Untick
   **Convert text to numbers, dates, and formulas**, so that a date such as
   2/7/2027 stays 7 February and isn't read as 2 July. Click **Import data**.
3. Choose **Assessment Calendar → 3. Load the class roster from the Roster
   tab**. A summary shows how many classes, students and teachers it found,
   what it skipped (other grades, homerooms) and any problems. Click **Yes**
   to load it, or **No** to change nothing.

An Excel file instead? Open it, press **Ctrl+A** then **Ctrl+C**, click cell
**A1** of the Roster tab and paste with **Ctrl+Shift+V** (values only).

What the app takes from the CC export:

| Columns | Used for |
|---|---|
| `SectionID` | The class's ID. Bookings are tied to it, so keep using this export. |
| `Section_Number`, `[2]Course_Name` | The class's name in the app, e.g. "Arabic Second Language 12 (12ASL1)". |
| `[5]Email_Addr`, `[5]LastFirst` | The teacher, who can then book for the class. |
| `[1]student_number`, `StudentEmail` | The student, who signs in with that email. |
| `[1]Grade_Level`, or else `Course_Number` | The student's grade. Without a grade column it comes from the course numbers: `G07ISA` means Grade 7 and `11ISE` Grade 11. Codes with no two-digit grade (`IB1ENGS`, `BAPBIO`) don't count, and each student gets the grade most of their courses carry. |
| `Expression` | When the class meets: `3(A,F)` is period 3 on Days A and F. Letters A–J are Days 1–10. |
| `DateEnrolled`, `DateLeft`, `TermID` | When each student is in the class. A Semester 1 class ends when its students leave it. |

If the summary flags something, fix it and run step 3 again:

- *Students have no usable email.* Students sign in with their school account,
  so the app needs each student's email. If the Student Email column shows
  `#NAME?`, it holds a formula Excel could not work out. Copy that column as
  values from the original file, or set Settings → `student_email_pattern`
  (for example `{id}@aisa.sch.ae`, where `{id}` is the Student ID).
- *Rows for students whose course numbers carry no grade.* Ask IT to add
  `[1]Grade_Level` to the export.
- *Homerooms or other non-teaching classes appear.* Settings →
  `roster_skip_courses` lists the course numbers to leave out, as a regular
  expression. The default skips the homerooms `HHR` and `MHR` (HR / Moral
  Education).

Optional: after loading, the **CourseNames** tab lists every course number.
Type a friendly name next to any code (`IB1ENGS` → `English A SL`) and the
app uses it straight away.

Load the roster again whenever classes change: at least before Semester 2,
and after any big add/drop. A class that has bookings but is missing from the
new roster is kept, marked `RETIRED` in the Sections tab, so its entries still
show. Its students no longer count toward the limit, so if a class was only
renamed, move its bookings to the new class.

The school roster export has no meeting times, so with it the app cannot
suggest a class's next lessons or warn when a class doesn't meet on a given
day. The 2-per-day check does not need them. The CC export has them.

*Two PowerSchool files instead?* Paste `sections.csv` into **PS_Sections** and
`enrolments.csv` into **PS_Enrolments** (see
[POWERSCHOOL_EXPORT.md](POWERSCHOOL_EXPORT.md)), leave the Roster tab empty,
and run step 3.

## 6. Deploy the web app

1. In the Apps Script editor: **Deploy → New deployment → Web app**.
2. Execute as **Me**. Who has access: **Anyone within American International
   School in Abu Dhabi**.
3. Deploy, then copy the URL ending in `/exec` into Settings → `app_url`
   (emails and calendar entries link to it).

To publish a code change later, run the lines below on the computer from
step 1. Put the deployment ID in place of `PASTE_DEPLOYMENT_ID_HERE`. That is
the long code in the `/exec` link, between `/s/` and `/exec`, starting
`AKfycb` (`clasp deployments` lists it too). The link stays the same.

```sh
cd ~/assessment-calendar
git pull
find apps_script -name '*.js' -delete
clasp push --force
clasp deploy --deploymentId PASTE_DEPLOYMENT_ID_HERE --description "what changed"
```

Then reload the Sheet so its menu picks up any changes. Instead of the last
command you can use the Apps Script editor: **Deploy → Manage deployments →
Edit → Version: New version → Deploy**.

## 7. Bring in the old grade-calendar entries

Choose **4. Import entries from the grade calendars**. Every event dated from
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
- [ ] Class roster loaded (menu 3), with student emails present
- [ ] Old grade-calendar entries queued (step 7)
- [ ] Web app deployed; tried with one teacher account and one student account
- [ ] Teachers told: book here first, then tell students, then tick "Announced to students"

## Troubleshooting

### The web app link does not load

| What you see | Fix |
|---|---|
| "Sorry, unable to open the file at this time" or a Google Drive error page | You are signed in to more than one Google account and the browser picked another one. Open the link in an Incognito/Private window and sign in with only your AISA account. |
| "You need access" or "You do not have permission" | The deployment's access is not set to the school. Deploy → Manage deployments → edit → Who has access: Anyone within the AISA domain. |
| "Authorization is required to perform that action" | The deploying account has not approved the app's permissions yet. Open the Sheet → Assessment Calendar → 1. Set up, approve, then reload the link. |
| "Script function not found: doGet" | The deployment points at an old version without the code. Deploy → Manage deployments → edit (pencil) → Version: **New version** → Deploy. The link stays the same. Deploy → Test deployments gives a /dev link that always runs the latest code. |
| "The Assessment Calendar could not start" | The page says what failed. Usually Set up has not been run, or an HTML file is missing. |
| "Your account does not have access…" | You are not in the Staff tab, not a teacher in the roster and not an enrolled student. Add yourself to Staff (Set up adds the first admin automatically). |

After changing code, the /exec link keeps running the old version until you
publish a **New version** (above).

### Terminal messages

| What Terminal says | Fix |
|---|---|
| `cd: no such file or directory: assessment-calendar` or `fatal: not a git repository` | This computer has no copy of the repo yet, or it is in another folder. Do step 1.5. |
| `Project settings not found` (clasp 3) or `No valid .clasp.json project file` (clasp 2) | This folder isn't linked to the Apps Script project yet. Run the `clasp clone` line from step 1.5 in it, then the three lines after it. |
| `Project file already exists` | It is already linked. Skip `clasp clone` and run `clasp push --force`. |
| `User has not enabled the Apps Script API` | Turn it on at <https://script.google.com/home/usersettings>, wait a minute, then try again. |
| `Invalid script ID`, "not found" or "permission" | Either the ID is wrong (use the one starting `1`, not `AKfycb…`), or clasp is signed in to another account. Run `clasp login` again and pick the account that owns the Sheet. |
| `zsh: no matches found` | A `*` that matched no files. Use the `find` line above instead. |

### Other problems

| Symptom | Fix |
|---|---|
| "Your account does not have access" | The person is not in the Staff tab, not a section teacher and not an enrolled student. Add them to Staff. |
| Entry shows "Grade calendar: ERROR …" | The deploying account cannot edit that calendar, or the ID is wrong. Fix it; failed copies are retried every hour. |
| A day shows the wrong rotation day | The Internal Calendar has it wrong. Fix it there; the app follows within the hour, or straight away with menu step 2. |
| A teacher cannot see their class | The roster does not list them as its teacher, or lists an email that is not the one they sign in with. Fix the roster and load it again, or set `teachers_book_any_section` to `TRUE` for now. |
| A student gets "no access" | The roster has no usable email for them. See step 5. |

## For developers

- `npm test` runs 56 tests: the real server code against an in-memory Sheet.
- `npm run preview` builds `preview/dist/index.html`, the full app with no
  Google needed.
- `npm run screenshots` drives the preview in Chromium and checks the main
  flows.

`apps_script/` is everything that runs in Google. `support/` holds the
in-memory Sheet, fake Google services and the fictional school used by the
tests and the preview. Google services are only touched in `Svc.gs` (and
Sheets in `Store.gs`), so everything else runs unchanged in Node and the browser.

**K–5 later:** deploy the same code a second time with its own Sheet. Set
`grades` to `K,1,2,3,4,5` and swap the CalendarRules so that "Elem. Day X" is
the rotation. Enter the elementary bell times in Bells. Showing rotation days
as letters (Day A–F) needs a small change in the app.
