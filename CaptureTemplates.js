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
    posterPrompt: 'Place a dot on the needs that matter most'
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
