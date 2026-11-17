/**
 * CaptureTemplates
 * A live-capture template describes one kind of thing people write together
 * at an event: its fields, its levels and how levels route to the gallery walk.
 * Need Cards is the first. Another event adds a template here; the capture
 * page, board, wall, AI prompts and posters all read from it.
 */

const CAPTURE_TEMPLATES = {
  needCards: {
    id: 'needCards',
    name: 'Need Cards',
    noun: 'need card',
    intro: 'One entry per need card your table wrote. Please don’t include anyone’s name.',
    // A field with scope 'table' is written once per table and copied onto
    // each of that table's cards. Other fields are written on every card.
    fields: [
      {
        key: 'flip',
        label: 'Flip statement',
        hint: 'Right now…, but we need…',
        tableLabel: 'Your table’s flip statement',
        tableHint: 'The one flip statement your table chose. Every need card you add goes under it.',
        maxLength: 400,
        scope: 'table'
      },
      {
        key: 'need',
        label: 'To address this gap, schools and educators need…',
        hint: 'The need, in your table’s words',
        maxLength: 400,
        primary: true
      }
    ],
    level: {
      key: 'level',
      label: 'Addressed with',
      options: [
        { code: 'G', label: 'Guidance', hint: 'Clear direction or expectations.', route: 'vote' },
        { code: 'G+', label: 'Guidance plus', hint: 'Guidance plus a resource, PD or support.', route: 'vote' },
        { code: 'B', label: 'Beyond guidance', hint: 'Needs more than guidance: policy, funding, law.', route: 'parking' }
      ]
    },
    routes: {
      vote: 'Gallery walk',
      parking: 'Parking lot'
    },
    groupingFocus: 'the topic of the need (for example "AI literacy" or "Chatbots")',
    posterPrompt: 'Place a dot on the needs that matter most',
    // What the session's AI skills should know about the activity, and which skills to write.
    activity: 'Tables of students and adults read signals about AI in K-12 education, choose one flip statement ' +
      '("Right now…, but we need…"), and write need cards: "To address this gap, schools and educators need…", ' +
      'each marked G (guidance), G+ (guidance plus a resource, PD or support) or B (beyond guidance). Facilitators group the needs ' +
      'by topic; G and G+ topics go to a dot-voting gallery walk and B items to a parking lot.',
    skills: [
      { id: 'need-card-coach', name: 'Need Card Coach',
        role: 'For a table: helps turn a signal into one clear flip statement and specific need cards. Asks questions and offers sentence starters; the table writes the words.' },
      { id: 'guidance-sorter', name: 'Guidance Sorter',
        role: 'For a table: helps decide whether a need calls for G, G+ or B by explaining the difference with examples. Leaves the choice to the table.' },
      { id: 'next-steps-planner', name: 'Next Steps Planner',
        role: 'For facilitators after the gallery walk: turns the top G and G+ needs into concrete guidance, resources and PD next steps, and names who could act on the B items.' }
    ]
  }
};

const CAPTURE_DEFAULTS = {
  TABLES: 6,
  MAX_TABLES: 40,
  MAX_CARDS_PER_SESSION: 400,
  PHOTO_MAX_BYTES: 4 * 1024 * 1024
};

function captureTemplate_(id) {
  const template = CAPTURE_TEMPLATES[id];
  if (!template) throw new Error('Unknown capture template.');
  return template;
}
