/**
 * Skills
 * Platform-neutral AI skills for a session: instructions, starter prompts and
 * the session materials to attach, written once and usable in any assistant.
 * Each skill exports as a SKILL.md file (YAML header + Markdown), which is the
 * format Claude uses for skills and reads as plain instructions anywhere else.
 *
 * Skills replace Gemini Gems. They are stored where Gems were (the session's
 * Gems JSON column), and skillsNormalize_ reads old Gems so earlier sessions
 * still show up.
 */

/** The four companions a library session gets when no activity sets its own. */
const SKILL_LIBRARY_ROLES = [
  { id: 'session-primer', name: 'Session Primer', role: 'Before the session: brings a participant up to speed on the theme using the session materials. Warm, curious, explains plainly.' },
  { id: 'critical-lens', name: 'Critical Lens', role: 'Questions assumptions, surfaces counterarguments and other perspectives on the theme. Socratic: asks more than it tells.' },
  { id: 'synthesis-companion', name: 'Synthesis Companion', role: 'During or after the session: helps a participant connect ideas across the materials and the discussion.' },
  { id: 'reflection-catalyst', name: 'Reflection Catalyst', role: 'After the session: helps a participant put insights, tensions and concrete next steps into words. Coaching tone.' }
];

/** How to use a skill, by assistant. Fixed text, so it never depends on a model. */
const SKILL_USAGE = [
  { where: 'Claude', how: 'The file is already in Claude’s skill format: add it as a skill, or paste it into a project’s instructions and add the materials as project files.' },
  { where: 'Gemini', how: 'Paste the instructions into a custom assistant’s instructions and add the materials as its knowledge files.' },
  { where: 'ChatGPT', how: 'Paste the instructions into a project’s or custom assistant’s instructions and upload the materials.' },
  { where: 'Any other assistant', how: 'Paste the whole text at the start of a conversation, then attach the materials.' }
];

function skillsSlug_(value) {
  const slug = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug || 'skill';
}

/** Roles to generate: an activity's own skills when the session has one, otherwise the library four. */
function skillsRoles_(template) {
  return template && Array.isArray(template.skills) && template.skills.length ? template.skills : SKILL_LIBRARY_ROLES;
}

function skillsText_(value, max) {
  // Same cleaning as live capture: strip control and invisible characters.
  return captureCleanText_(value, max);
}

/**
 * Reads a stored item, old Gem or new skill, into one shape:
 * { id, name, description, purpose, instructions, starterPrompts[], materials[], link }
 */
function skillsNormalize_(item) {
  if (!item || typeof item !== 'object') return null;
  const name = skillsText_(item.name, 80);
  const instructions = skillsText_(item.instructions || item.systemInstruction || item.systemPrompt, 12000);
  if (!name && !instructions) return null;
  const list = (v, n) => (Array.isArray(v) ? v : []).map(x => skillsText_(x, 400)).filter(Boolean).slice(0, n);
  const link = String(item.link || '');
  return {
    id: skillsSlug_(item.id || name),
    name: name || 'Skill',
    description: skillsText_(item.description || item.persona, 400),
    purpose: skillsText_(item.purpose || item.persona || item.role, 600),
    instructions: instructions,
    starterPrompts: list(item.starterPrompts || item.starterQueries, 5),
    materials: list(item.materials, 10),
    link: /^https:\/\//.test(link) ? link : null
  };
}

/**
 * Turns a model's answer into the requested skills, in the requested order.
 * Ids and names come from the roles, never the model; materials must be
 * titles of the session's real resources.
 */
function skillsFromGenerated_(roles, raw, resourceTitles) {
  const items = raw && Array.isArray(raw.skills) ? raw.skills : (Array.isArray(raw) ? raw : []);
  const known = new Map((resourceTitles || []).map(t => [String(t).trim().toLowerCase(), String(t).trim()]));
  const out = [];
  roles.forEach((role, i) => {
    const got = items.find(s => s && skillsSlug_(s.id) === role.id) || items[i];
    if (!got) return;
    const skill = skillsNormalize_(Object.assign({}, got, { id: role.id, name: role.name }));
    if (!skill || !skill.instructions) return;
    skill.materials = skill.materials.map(m => known.get(m.toLowerCase())).filter(Boolean);
    out.push(skill);
  });
  return out;
}

/** The SKILL.md text for one skill. */
function skillsToMarkdown_(skill, sessionName) {
  const yaml = s => '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
  const lines = [
    '---',
    'name: ' + skill.id,
    'description: ' + yaml(skill.description || skill.purpose || skill.name),
    '---',
    '',
    '# ' + skill.name + (sessionName ? ' — ' + sessionName : ''),
    ''
  ];
  if (skill.purpose) lines.push(skill.purpose, '');
  lines.push(skill.instructions, '');
  if (skill.starterPrompts.length) {
    lines.push('## Starter prompts', '');
    skill.starterPrompts.forEach(p => lines.push('- ' + p));
    lines.push('');
  }
  if (skill.materials.length) {
    lines.push('## Materials to add', '');
    skill.materials.forEach(m => lines.push('- ' + m));
    lines.push('');
  }
  return lines.join('\n');
}
