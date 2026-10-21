/**
 * A fictional secondary school for the tests and the preview. Every name,
 * email, course and timetable here is invented. The calendar copies the
 * STRUCTURE of the real Internal Calendar: rotation days that keep counting
 * through PD days and one-off holidays (so Day 5 and Day 10 stay on Fridays),
 * breaks that pause the rotation, and event titles with grade hints in them.
 *
 * Deterministic: the same seed always builds the same school.
 * Needs the server's U (apps_script/Util.gs) to be loaded first.
 */
(function (root) {
  'use strict';

  var DOMAIN = 'school.example';
  var TODAY = '2026-10-21';
  var YEAR_START = '2026-08-31';
  var ROTATION_PUBLISHED_UNTIL = '2027-04-02';

  var BREAKS = [
    ['2026-10-12', '2026-10-16', 'Mid Term Break'],
    ['2026-12-14', '2027-01-01', 'Winter Break'],
    ['2027-04-05', '2027-04-09', 'Spring Break']
  ];
  var CLOSURES = [
    ['2026-10-19', '2026-10-20', 'Professional Development Day - NO STUDENTS'],
    ['2026-12-02', '2026-12-03', 'Eid Al Etihad - TBD'],
    ['2027-03-15', '2027-03-15', 'Professional Development Day - NO STUDENTS']
  ];

  /** [start, end, title, startTime, endTime, description] */
  var EVENTS = [
    ['2026-09-28', '2026-10-07', 'Secondary Summatives'],
    ['2026-10-05', '2026-10-05', 'World Teacher Day'],
    ['2026-10-05', '2026-10-05', 'Secondary Building Meeting -Flex', '15:10', '16:25'],
    ['2026-10-06', '2026-10-06', 'IB Information Morning with Grade 10', '08:50', '09:40'],
    ['2026-10-26', '2026-10-26', 'G3 CAT4 Assessment'],
    ['2026-10-26', '2026-10-30', 'School Photography Week'],
    ['2026-10-28', '2026-10-28', 'MS October Assembly', '08:50', '09:40'],
    ['2026-10-29', '2026-10-29', 'HS October Assembly', '08:50', '09:40'],
    ['2026-10-29', '2026-10-29', 'Secondary Fall Festival'],
    ['2026-10-30', '2026-10-30', 'Elementary Fall Festival'],
    ['2026-11-02', '2026-11-02', 'WINTER ASA Registration Begins'],
    ['2026-11-09', '2026-11-09', 'Parent-Teacher Conferences'],
    ['2026-11-10', '2026-11-13', 'Secondary Career Exploration Week'],
    ['2026-11-11', '2026-11-11', 'Secondary Career Fair G6-G9'],
    ['2026-11-12', '2026-11-12', 'University Fair', '11:55', '14:00', 'University Fair (P5–6) G10-G12 Big Gym'],
    ['2026-11-18', '2026-11-18', 'HS Musical performance', '18:30', '20:30'],
    ['2026-11-26', '2026-11-26', 'Eid Al Etihad', '', '', 'Full Day, School-wide Celebration'],
    ['2026-11-26', '2026-11-26', 'MS & HS National Day Celebration Time TBD'],
    ['2026-12-07', '2026-12-07', 'Term 1 Grades DUE'],
    ['2026-12-10', '2026-12-10', 'HS Assembly', '08:50', '09:40'],
    ['2027-01-15', '2027-01-15', 'High School Sports Day'],
    ['2027-01-25', '2027-02-05', 'IB Mock Exams', '', '', 'Grades 11-12'],
    ['2027-01-29', '2027-01-29', 'Middle School Sports Day'],
    ['2027-02-01', '2027-02-05', 'WINTER MAP TESTING WEEK'],
    ['2027-02-01', '2027-02-05', 'Semester 1 Exams G9-G10'],
    ['2027-06-23', '2027-06-25', 'End-of-Year Semester Exams']
  ];

  var FIRST = ['Maya', 'Omar', 'Lena', 'Karim', 'Sofia', 'Yusuf', 'Hana', 'Daniel', 'Aisha', 'Tomas',
    'Noor', 'Felix', 'Rania', 'Samir', 'Clara', 'Idris', 'Mariam', 'Leo', 'Salma', 'Adam',
    'Zara', 'Hugo', 'Layla', 'Ravi', 'Nadia', 'Peter', 'Amal', 'Jonas', 'Ines', 'Malik'];
  var LAST = ['Haddad', 'Farouk', 'Ortiz', 'Mansour', 'Bianchi', 'Rahman', 'Kim', 'Novak', 'Saleh', 'Costa',
    'Yilmaz', 'Brandt', 'Aziz', 'Khoury', 'Meyer', 'Bakr', 'Nasser', 'Silva', 'Hamdan', 'Wright',
    'Qureshi', 'Lindgren', 'Varga', 'Patel', 'Fares', 'Moreau', 'Hassan', 'Weber', 'Laurent', 'Odeh'];

  var BANDS = [
    {
      key: 'MS', grades: ['6', '7', '8'], dept: 'Middle School',
      subjects: [['ENG', 'English', 7, 'English'], ['MATH', 'Mathematics', 7, 'Mathematics'],
        ['SCI', 'Science', 6, 'Science'], ['SS', 'Social Studies', 5, 'Humanities'], ['ARA', 'Arabic', 6, 'Arabic'],
        ['ISL', 'Islamic Studies', 3, 'Arabic'], ['FRE', 'French', 4, 'Languages'], ['PE', 'Physical Education', 3, 'PE'],
        ['ART', 'Visual Arts', 3, 'Arts']]
    },
    {
      key: 'HS', grades: ['9', '10'],
      subjects: [['ENG', 'English', 7, 'English'], ['IM', 'Integrated Math', 7, 'Mathematics'],
        ['BIO', 'Biology', 6, 'Science'], ['HIST', 'History', 5, 'Humanities'], ['ARA', 'Arabic', 6, 'Arabic'],
        ['ISL', 'Islamic Studies', 3, 'Arabic'], ['SPA', 'Spanish', 4, 'Languages'], ['PE', 'Physical Education', 3, 'PE'],
        ['ART', 'Visual Arts', 3, 'Arts']]
    },
    {
      key: 'DP', grades: ['11', '12'],
      subjects: [['ENG', 'English A', 6, 'English'], ['MATH', 'Mathematics AA', 6, 'Mathematics'],
        ['ARA', 'Arabic B', 5, 'Arabic'], ['ISL', 'Islamic Studies', 3, 'Arabic'], ['PE', 'Physical Education', 2, 'PE'],
        ['TOK', 'Theory of Knowledge', 2, 'Humanities']],
      blocks: [
        [['BIOHL', 'IB Biology HL', 'Science'], ['ECOHL', 'IB Economics HL', 'Humanities']],
        [['CHMSL', 'IB Chemistry SL', 'Science'], ['VASL', 'IB Visual Arts SL', 'Arts']]
      ],
      blockSize: 6
    }
  ];

  var TITLES = {
    ENG: ['Persuasive essay', 'Poetry analysis', 'Narrative writing task', 'Reading comprehension test'],
    MATH: ['Unit 3 test: ratios', 'Algebra checkpoint', 'Statistics investigation'],
    IM: ['Unit 3 test: linear functions', 'Systems of equations quiz', 'Modelling task'],
    SCI: ['Forces practical', 'Ecosystems test', 'Lab report: density'],
    BIO: ['Cells unit test', 'Enzyme practical', 'Genetics problem set'],
    SS: ['Map skills test', 'Source analysis', 'Research presentation'],
    HIST: ['Source analysis', 'Essay: causes of WWI', 'Document-based question'],
    ARA: ['Dictation and grammar', 'Reading aloud assessment', 'Writing task'],
    ISL: ['Unit assessment', 'Recitation'],
    FRE: ['Speaking assessment', 'Listening test'],
    SPA: ['Oral presentation', 'Vocabulary test'],
    ART: ['Portfolio review', 'Studio piece critique'],
    TOK: ['Exhibition draft'],
    BIOHL: ['Paper 2 practice', 'Internal assessment draft'],
    ECOHL: ['Data response', 'Macroeconomics essay'],
    CHMSL: ['Stoichiometry test', 'Titration practical'],
    VASL: ['Comparative study check-in']
  };

  function U() { return root.U; }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function inRanges(d, list) { return list.some(function (r) { return d >= r[0] && d <= r[1]; }); }

  function allDay(start, end, title, description) {
    return { title: title, description: description || '', allDay: true, startDate: start, endDate: U().addDays(end, 1) };
  }

  function timed(date, start, end, title, description) {
    return { title: title, description: description || '', allDay: false, startDate: date, endDate: date, startTime: start, endTime: end };
  }

  /** The Internal Calendar, as plain events (see apps_script/Svc.gs). */
  function internalCalendar() {
    var u = U();
    var out = [];
    var rotation = {};
    var n = 0;
    var elem = 0;
    u.range(YEAR_START, ROTATION_PUBLISHED_UNTIL).forEach(function (d) {
      if (u.isoDow(d) > 5 || inRanges(d, BREAKS)) return;
      n = n % 10 + 1;
      elem = elem % 6 + 1;
      if (inRanges(d, CLOSURES)) return;
      rotation[d] = n;
      out.push(allDay(d, d, 'MS/ HS Day ' + n));
      if (d >= '2026-10-01' && d < '2026-11-01') out.push(allDay(d, d, 'Elem. Day ' + 'ABCDEF'.charAt(elem - 1)));
    });
    BREAKS.concat(CLOSURES).forEach(function (r) { out.push(allDay(r[0], r[1], r[2])); });
    EVENTS.forEach(function (e) {
      out.push(e[3] ? timed(e[0], e[3], e[4], e[2], e[5]) : allDay(e[0], e[1], e[2], e[5]));
    });
    return { events: out, rotation: rotation };
  }

  function slots() {
    var out = [];
    for (var d = 1; d <= 10; d++) {
      var max = d === 5 || d === 10 ? 4 : 7;
      for (var p = 1; p <= max; p++) out.push({ day: d, period: p });
    }
    return out;
  }

  /** PowerSchool-style expression, e.g. '3(1,4,7) 5(9)'. */
  function expression(list) {
    var byP = {};
    list.forEach(function (s) { (byP[s.period] = byP[s.period] || []).push(s.day); });
    return Object.keys(byP).sort(function (a, b) { return a - b; }).map(function (p) {
      return p + '(' + byP[p].sort(function (a, b) { return a - b; }).join(',') + ')';
    }).join(' ');
  }

  function build(seed) {
    var u = U();
    var rand = rng(seed || 20261021);
    var cal = internalCalendar();

    /* ---- people ---- */
    var staff = [
      { email: 'admin@' + DOMAIN, name: 'Calendar Admin', role: 'ADMIN', notes: '' },
      { email: 'head.secondary@' + DOMAIN, name: 'Head of Secondary', role: 'SLT', notes: '' },
      { email: 'tl.head@' + DOMAIN, name: 'Head of Teaching & Learning', role: 'SLT', notes: '' },
      { email: 'deputy.secondary@' + DOMAIN, name: 'Deputy Head, Secondary', role: 'SLT', notes: '' },
      { email: 'counsellor@' + DOMAIN, name: 'Secondary Counsellor', role: 'VIEWER', notes: '' }
    ];
    var teacherIx = 0;
    var teacherOf = {};
    var teachers = [];
    function teacherFor(key) {
      if (teacherOf[key]) return teacherOf[key];
      var i = teacherIx++;
      var t = { email: FIRST[i].toLowerCase() + '.' + LAST[i].toLowerCase() + '@' + DOMAIN, name: FIRST[i] + ' ' + LAST[i] };
      teachers.push(t);
      teacherOf[key] = t;
      return t;
    }

    /* ---- sections, timetables, students ---- */
    var sections = [];
    var enrolments = [];
    var meetings = {};          // section_id → [{day, period}]
    var members = {};           // section_id → [student numbers]
    var groupOf = {};           // student → { grade, gender }
    var nextId = 41001;

    function addSection(o, slotList) {
      var id = String(nextId++);
      var sec = {
        section_id: id, course_number: o.course, course_name: o.name, section_number: '1',
        teacher_emails: o.teacher.email, teacher_names: o.teacher.name, expression: expression(slotList),
        term: o.term || 'Year', department: o.dept, grades: o.grade, student_count: 0
      };
      sections.push(sec);
      meetings[id] = slotList;
      members[id] = [];
      return sec;
    }

    BANDS.forEach(function (band) {
      band.grades.forEach(function (grade) {
        var free = shuffle(slots(), rand);
        var blockSections = [];
        (band.blocks || []).forEach(function (block) {
          var taken = free.splice(0, band.blockSize);
          blockSections.push(block.map(function (opt) {
            return addSection({
              course: pad2(+grade) + opt[0], name: opt[1] + ' (Grade ' + grade + ')', dept: opt[2],
              teacher: teacherFor(band.key + opt[0]), grade: grade
            }, taken);
          }));
        });
        ['G', 'B'].forEach(function (gender) {
          var mine = free.slice();
          var core = band.subjects.map(function (sub) {
            var taken = mine.splice(0, sub[2]);
            var term = band.key === 'MS' && grade === '6' && sub[0] === 'ART' ? 'S1' : 'Year';
            return addSection({
              course: gender + pad2(+grade) + sub[0], name: sub[1] + ' ' + grade + (gender === 'G' ? ' Girls' : ' Boys'),
              dept: sub[3], teacher: teacherFor(band.key + sub[0]), grade: grade, term: term
            }, taken);
          });
          for (var i = 0; i < 18; i++) {
            var num = String(+grade * 1000 + (gender === 'G' ? 0 : 500) + i + 1);
            groupOf[num] = { grade: grade, gender: gender };
            var mineSecs = core.slice();
            blockSections.forEach(function (opts, b) { mineSecs.push(opts[(i >> b) % 2]); });
            mineSecs.forEach(function (sec) {
              members[sec.section_id].push(num);
              enrolments.push({
                student_number: num, student_email: 's' + num + '@' + DOMAIN, grade: grade,
                section_id: sec.section_id, date_enrolled: YEAR_START, date_left: ''
              });
            });
          }
        });
      });
    });
    sections.forEach(function (s) { s.student_count = members[s.section_id].length; });

    var byCourse = {};
    sections.forEach(function (s) { byCourse[s.course_number] = s; });

    /* ---- assessments ---- */
    var assessments = [];
    var load = {};              // date|student → count of counted entries
    var seq = 0;

    function meetsOn(sec, date) {
      var r = cal.rotation[date];
      if (!r) return null;
      var fri = u.isoDow(date) === 5;
      var ps = meetings[sec.section_id].filter(function (m) { return m.day === r && (!fri || m.period <= 4); })
        .map(function (m) { return String(m.period); });
      return ps.length ? ps : null;
    }

    function fits(sec, date) {
      return members[sec.section_id].every(function (s) { return (load[date + '|' + s] || 0) < 2; });
    }

    function add(sec, date, category, title, extra) {
      extra = extra || {};
      var periods = extra.periods || meetsOn(sec, date) || [];
      seq++;
      var teacher = sec.teacher_emails;
      var created = u.addDays(date, -(5 + (seq % 9)));
      if (created > TODAY) created = TODAY;
      var row = {
        id: 'A' + (100000 + seq), group_id: 'G' + (100000 + seq), status: extra.status || 'ACTIVE',
        category: category, format: extra.format || (category === 'FORMATIVE' ? 'Quiz' : 'Test'), title: title,
        notes: extra.notes || '', section_id: sec.section_id, grade: '', date: date, periods: periods.join(','),
        announced: extra.announced === undefined ? true : extra.announced, teacher_email: teacher,
        created_by: teacher, created_at: created + 'T07:30:00', updated_by: teacher, updated_at: created + 'T07:30:00',
        request_reason: extra.request_reason || '', override_reason: '', override_by: '', decided_by: '',
        decided_at: '', decision_note: '', mirror: '', mirror_status: '', source: 'APP', source_ref: ''
      };
      assessments.push(row);
      if (row.status === 'ACTIVE' && category !== 'FORMATIVE') {
        members[sec.section_id].forEach(function (s) { load[date + '|' + s] = (load[date + '|' + s] || 0) + 1; });
      }
      return row;
    }

    // The scripted cases the preview and tests rely on.
    add(byCourse.G09ENG, '2026-10-27', 'SUMMATIVE', 'Persuasive essay', { format: 'Essay / written task' });
    add(byCourse.G09IM, '2026-10-27', 'SUMMATIVE', 'Unit 3 test: linear functions');
    add(byCourse.B10ENG, '2026-10-29', 'SUMMATIVE', 'Poetry analysis', { format: 'Essay / written task' });
    add(byCourse.B10IM, '2026-10-29', 'SUMMATIVE', 'Systems of equations test');
    add(byCourse.B10HIST, '2026-10-29', 'SUMMATIVE', 'Source analysis', {
      status: 'PENDING', announced: false,
      request_reason: 'Moved from last week after the assembly took P2; students already prepared for this date.'
    });
    add(byCourse['11BIOHL'], '2026-11-04', 'SUMMATIVE', 'Paper 2 practice', { announced: false });

    // Background load: about one summative and one formative per class before winter break.
    var days = u.range(TODAY, '2026-12-10').filter(function (d) { return cal.rotation[d]; });
    shuffle(sections.slice(), rand).forEach(function (sec) {
      var code = sec.course_number.replace(/^[GB]?\d\d/, '');
      if (code === 'PE' || code === 'TOK') return;
      var titles = TITLES[code] || ['Unit assessment'];
      var options = shuffle(days.filter(function (d) { return meetsOn(sec, d); }), rand);
      var summative = null;
      options.some(function (d) {
        if (d === '2026-10-27' || d === '2026-10-29' || !fits(sec, d)) return false;
        summative = add(sec, d, 'SUMMATIVE', titles[Math.floor(rand() * titles.length)], {
          announced: u.daysBetween(TODAY, d) <= 14 ? rand() < 0.8 : rand() < 0.3
        });
        return true;
      });
      var formativeDay = options.filter(function (d) { return !summative || d !== summative.date; })[0];
      if (formativeDay && rand() < 0.6) add(sec, formativeDay, 'FORMATIVE', 'Check-in: ' + titles[0].toLowerCase(), { announced: true });
    });

    /* ---- the old grade calendars, with a few teacher-made events ---- */
    var bio = teacherOf.HSBIO;
    var gradeCalendars = [];
    ['6', '7', '8', '9', '10', '11', '12'].forEach(function (g) {
      var events = [];
      if (g === '9') {
        events.push({ id: 'old-g9-1@fake', title: 'G9 Girls Biology formative ', allDay: true, startDate: '2026-11-04', endDate: '2026-11-05', creators: [bio.email] });
        events.push({ id: 'old-g9-2@fake', title: 'B9 Biology summative (cells)', allDay: false, startDate: '2026-11-05', endDate: '2026-11-05', startTime: '09:45', endTime: '10:35', creators: [bio.email] });
      }
      gradeCalendars.push({ id: 'grade' + g + '@fake', name: 'Grade ' + g + ' Assessment Calendar', events: events });
    });
    var importQueue = [
      { import_id: 'I1', grade: '9', event_id: 'old-g9-1@fake', title: 'G9 Girls Biology formative', date: '2026-11-04', end_date: '2026-11-04', start_time: '', end_time: '', all_day: true, creator_email: bio.email, guess_category: 'FORMATIVE', status: 'OPEN', assessment_ids: '', handled_by: '', handled_at: '' },
      { import_id: 'I2', grade: '9', event_id: 'old-g9-2@fake', title: 'B9 Biology summative (cells)', date: '2026-11-05', end_date: '2026-11-05', start_time: '09:45', end_time: '10:35', all_day: false, creator_email: bio.email, guess_category: 'SUMMATIVE', status: 'OPEN', assessment_ids: '', handled_by: '', handled_at: '' }
    ];

    var settings = [
      { key: 'internal_calendar_id', value: 'internal@fake', notes: '' },
      { key: 'support_email', value: 'tl.head@' + DOMAIN, notes: '' }
    ];
    ['6', '7', '8', '9', '10', '11', '12'].forEach(function (g) {
      settings.push({ key: 'grade_calendar_' + g, value: 'grade' + g + '@fake', notes: '' });
    });

    var g9girl = enrolments.filter(function (e) { return e.grade === '9' && +e.student_number < 9500; })[0];

    return {
      today: TODAY,
      tables: {
        Settings: settings, Staff: staff, Sections: sections, Enrolments: enrolments,
        Assessments: assessments, ImportQueue: importQueue, InternalEvents: [], CalendarRules: [], Bells: [], Log: []
      },
      calendars: [{ id: 'internal@fake', name: 'AISA (Internal Calendar)', events: cal.events }].concat(gradeCalendars),
      rotation: cal.rotation,
      people: {
        admin: 'admin@' + DOMAIN,
        slt: 'tl.head@' + DOMAIN,
        viewer: 'counsellor@' + DOMAIN,
        teacher: bio.email,
        teacherName: bio.name,
        historyTeacher: teacherOf.HSHIST.email,
        student: g9girl.student_email,
        teachers: teachers
      },
      courses: byCourse
    };
  }

  root.Fixtures = { TODAY: TODAY, DOMAIN: DOMAIN, build: build, internalCalendar: internalCalendar };
})(typeof globalThis !== 'undefined' ? globalThis : this);
