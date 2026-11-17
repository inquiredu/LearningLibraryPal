/**
 * CaptureTemplates
 * A live-capture template describes one kind of event activity: its stages,
 * what tables and people write at each stage, the levels a need can be tagged
 * with, how voting works and what the AI skills should know. Need Cards follows
 * the Learner-Centered AI in Education Retreat agenda. Another event adds a
 * template here; the phone page, board, wall, AI prompts and posters read it.
 */

const CAPTURE_TEMPLATES = {
  needCards: {
    id: 'needCards',
    name: 'Need Cards',
    noun: 'need card',
    intro: 'One need per card. Please don’t include anyone’s name.',

    // Who is writing or voting. Kept on signals, cards, dots and votes so results can be split.
    roles: [
      { code: 'S', label: 'Student' },
      { code: 'A', label: 'Adult' }
    ],

    // The facilitator moves the room through these when it is ready; phones and the wall
    // follow. No clock times: a gathering keeps its own pace.
    stages: [
      { id: 'welcome', label: 'Welcome', phone: 'Pick your table and say whether you’re a student or an adult.' },
      { id: 'signals', label: 'Signals', phone: 'Jot one signal per entry.' },
      { id: 'flips', label: 'The Flip', phone: 'Write your table’s 3–4 flip statements.' },
      { id: 'flipdots', label: 'Gallery dots', phone: 'Add dots to the flip statements.' },
      { id: 'needs', label: 'Need cards', phone: 'Pick your top flip statement and write need cards.' },
      { id: 'synthesis', label: 'Synthesis', phone: 'The synthesis team is grouping the needs.' },
      { id: 'vote', label: 'Vote', phone: 'Vote for the needs to address first.' },
      { id: 'results', label: 'Read-out', phone: 'See the ranked priorities.' },
      { id: 'testdrive', label: 'Test drive', phone: 'Test current guidance against your table’s priority.' },
      { id: 'close', label: 'Close', phone: 'Thank you.' }
    ],

    signal: {
      label: 'Signal',
      hint: 'Something you’ve noticed about AI: in school, outside school, or in the news. One per entry.',
      maxLength: 300
    },

    // What each table writes several of, and every card belongs to one of.
    parent: {
      key: 'flip',
      label: 'Flip statement',
      plural: 'flip statements',
      hint: 'Right now…, but we want…',
      maxLength: 400,
      perTableMax: 6
    },

    // Gallery walk dots on flip statements.
    flipDots: [
      { code: 'green', label: 'Resonates' },
      { code: 'blue', label: 'Surprising' },
      { code: 'yellow', label: 'Missing or mislabeled' }
    ],
    flipDotsPerPerson: 9,

    // Written on every card.
    fields: [
      {
        key: 'need',
        label: 'To close this gap, students and educators need…',
        hint: 'One need per card, in your own words.',
        maxLength: 400,
        primary: true
      }
    ],

    level: {
      key: 'level',
      label: 'Which lever can address it?',
      levers: 'Levers include guidance, funding, training and policy.',
      options: [
        { code: 'G', label: 'Guidance', hint: 'Guidance can address it.', route: 'vote' },
        { code: 'G+', label: 'Guidance plus', hint: 'Guidance plus something else: funding, training or policy.', route: 'vote' },
        { code: 'B', label: 'Beyond guidance', hint: 'It needs more than guidance.', route: 'parking' }
      ]
    },
    routes: {
      vote: 'Priorities',
      parking: 'Parking lot'
    },

    vote: {
      perPerson: 3,
      prompt: 'Which of these need to be addressed first?',
      note: 'You have 3 votes. Put them all on one, or spread them out.'
    },

    testDrive: {
      intro: 'Compare current Minnesota guidance with your table’s assigned need.',
      prompts: [
        { key: 'change', label: 'Change', hint: 'What in the current guidance should change?' },
        { key: 'add', label: 'Add', hint: 'What is missing that should be added?' },
        { key: 'cut', label: 'Cut', hint: 'What should be removed?' },
        { key: 'beyond', label: 'Beyond guidance', hint: 'What else is needed that guidance alone can’t do?' }
      ],
      maxLength: 600
    },

    groupingFocus: 'the topic of the need (for example "AI literacy" or "Chatbots")',
    posterPrompt: 'Which of these need to be addressed first?',

    // What the session's AI skills should know about the activity, and which skills to write.
    activity: 'A retreat on learner-centered AI in K-12 education. Tables of students and adults share signals about AI, ' +
      'flip them into statements ("Right now…, but we want…"), and pick their top flip statement. Each person writes need cards: ' +
      '"To close this gap, students and educators need…", tagged G (guidance can address it), G+ (guidance plus something else) or ' +
      'B (beyond guidance). A synthesis team clusters the needs in G, G+ and B columns; everyone votes with 3 votes; the top six G and G+ ' +
      'clusters go one to each table, which tests current Minnesota guidance against it (change, add, cut, beyond guidance).',
    skills: [
      { id: 'need-card-coach', name: 'Need Card Coach',
        role: 'For a table: helps turn signals into clear flip statements and specific need cards. Asks questions and offers sentence starters; the table writes the words.' },
      { id: 'guidance-sorter', name: 'Guidance Sorter',
        role: 'For a table: helps decide whether a need is G, G+ or B by explaining the levers (guidance, funding, training, policy) with examples. Leaves the choice to the table.' },
      { id: 'guidance-test-drive', name: 'Guidance Test Drive',
        role: 'For a table at the test drive: compares current Minnesota guidance with the table’s assigned need and helps it say what to change, add or cut, and what goes beyond guidance. Quotes the guidance it is given rather than inventing text.' },
      { id: 'next-steps-planner', name: 'Next Steps Planner',
        role: 'For facilitators after the retreat: turns the ranked G and G+ priorities and the tables’ test-drive notes into concrete next steps, and names who could act on the parking lot.' }
    ]
  }
};

const CAPTURE_DEFAULTS = {
  TABLES: 6,
  MAX_TABLES: 40,
  MAX_CARDS_PER_SESSION: 400,
  MAX_SIGNALS_PER_SESSION: 600,
  PHOTO_MAX_BYTES: 4 * 1024 * 1024
};

function captureTemplate_(id) {
  const template = CAPTURE_TEMPLATES[id];
  if (!template) throw new Error('Unknown capture template.');
  return template;
}

function captureStageIds_(template) {
  return template.stages.map(s => s.id);
}
