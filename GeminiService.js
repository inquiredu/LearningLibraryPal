/**
 * GeminiService
 * Central AI layer — all Gemini API interactions live here.
 * Model: gemini-2.0-flash (fast, structured JSON output)
 */

const GeminiService = {

  // ─── Core API call ─────────────────────────────────────────────────────────

  _call: function(prompt, temperature) {
    const apiKey = getGeminiApiKey();
    if (!apiKey) throw new Error('GEMINI_API_KEY not found in Script Properties.');

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: temperature || 0.7,
        responseMimeType: 'application/json'
      }
    };

    const response = UrlFetchApp.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }
    );

    const json = JSON.parse(response.getContentText());
    if (json.error) throw new Error(`Gemini API Error: ${json.error.message}`);

    const raw = json.candidates[0].content.parts[0].text;
    const clean = raw.replace(/^```(json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(clean);
  },

  // ─── Phase 1: Session Brief ─────────────────────────────────────────────────

  /**
   * Generates the session brief from the facilitator's theme input.
   * @returns {{ overview, learningObjectives, inquiryQuestions, notebookLMStarterPrompt }}
   */
  generateSessionBrief: function(theme, format, audience) {
    const prompt = `
You are an expert learning designer and facilitator for collaborative community sessions.

A facilitator is preparing a 2-hour collaborative monthly session with the following details:
- Theme: ${theme}
- Format: ${format}
- Audience: ${audience}

Your task is to generate a structured session brief that will anchor all preparation and engagement materials.

Return valid JSON with this exact schema:
{
  "overview": "2-3 sentence framing of the theme — why it matters now, what makes it compelling for this audience",
  "learningObjectives": [
    "Objective 1 — what participants will understand or be able to do",
    "Objective 2",
    "Objective 3"
  ],
  "inquiryQuestions": [
    "Open-ended question 1 — designed to provoke genuine thinking",
    "Open-ended question 2",
    "Open-ended question 3",
    "Open-ended question 4",
    "Open-ended question 5"
  ],
  "notebookLMStarterPrompt": "A single prompt participants can paste into NotebookLM after uploading pre-reading resources to begin a generative dialogue about the theme"
}

The inquiry questions should be genuinely open, invite multiple perspectives, and work for a diverse group. Avoid yes/no questions.
    `.trim();
    return this._call(prompt, 0.8);
  },

  // ─── Phase 2: Resource Analysis ─────────────────────────────────────────────

  /**
   * Analyzes a resource (URL content or extracted text) for session relevance.
   * sessionContext = { overview, objectives[] } from the session brief.
   * @returns {{ title, relevanceScore, relevanceStatement, engagementLevel, keyConceptTags, notebookLMReady, summary }}
   */
  analyzeResource: function(content, theme, audience, sessionContext) {
    const ctx = sessionContext || {};
    const objectivesText = ctx.objectives && ctx.objectives.length
      ? '\nLearning Objectives:\n- ' + ctx.objectives.join('\n- ')
      : '';
    const overviewText = ctx.overview
      ? '\nSession Overview: ' + ctx.overview
      : '';

    const prompt = `
You are a learning curator preparing resources for a collaborative session.

Session Theme: "${theme}"
Audience: ${audience}${overviewText}${objectivesText}

Analyze the following resource content. Score and describe its relevance specifically to THIS session's theme and objectives — not just the topic in general.

Resource Content:
---
${content.substring(0, 7000)}
---

Return valid JSON with this exact schema:
{
  "title": "Inferred or extracted title of the resource",
  "relevanceScore": 4,
  "relevanceStatement": "1-2 sentences explaining how this specific resource connects to the session theme and objectives",
  "engagementLevel": "Accessible",
  "keyConceptTags": ["tag1", "tag2", "tag3"],
  "notebookLMReady": true,
  "summary": "3-4 sentence summary of the resource's key ideas and why they matter for this session"
}

Rules:
- relevanceScore: integer 1-5 (5 = directly addresses the session theme/objectives; 1 = tangential)
- engagementLevel: exactly one of "Accessible", "Intermediate", "Deep"
- keyConceptTags: exactly 3 short tags
- notebookLMReady: true if rich enough to upload to NotebookLM for generative dialogue
    `.trim();
    return this._call(prompt, 0.3);
  },

  // ─── Phase 3: Gems Instruction Sets ─────────────────────────────────────────

  /**
   * Generates 4 Gem instruction sets — ready-to-paste system instructions for
   * Google AI Studio Gems, personalized to the session and its resources.
   *
   * @param {string} sessionName
   * @param {{ overview, learningObjectives, inquiryQuestions }} brief
   * @param {Object[]} resources - Top synthesized resources [{title, summary, relevanceStatement}]
   * @returns {Object[]} Array of 4 Gem objects
   */
  generateGemInstructions: function(sessionName, brief, resources) {
    const objectivesList = (brief.learningObjectives || []).join('\n- ');
    const questionsList  = (brief.inquiryQuestions   || []).join('\n- ');
    const resourceLines  = (resources || []).slice(0, 6).map(function(r) {
      return '• ' + (r.title || 'Resource') + (r.summary ? ': ' + r.summary.substring(0, 120) : '');
    }).join('\n');

    const prompt = `
You are an expert AI experience designer creating Gemini Gems (custom AI personas) for a collaborative learning session.

Session: "${sessionName}"
Theme: ${brief.overview || ''}

Learning Objectives:
- ${objectivesList}

Inquiry Questions:
- ${questionsList}

Key Resources for this session:
${resourceLines}

Generate 4 Gems. Each Gem has a specific role in the participant learning journey. For each Gem, produce:
1. A rich, personalized system instruction (300-500 words) that references the session theme, objectives, and resource content — ready to paste directly into Google AI Studio without any editing
2. Concrete setup steps a facilitator follows to create the Gem in AI Studio
3. 3 conversation starters participants can use

The system instruction must:
- Address the AI in second person ("You are...")
- Reference the specific session name, theme, and key concepts from the resources
- Give the AI a clear voice, operating style, and boundaries
- Be immediately usable without any editing

Return valid JSON — an array of exactly 4 objects:
[
  {
    "id": "session-primer",
    "name": "Session Primer",
    "emoji": "📚",
    "persona": "1-2 sentence description of what this Gem does and who it's for",
    "systemInstruction": "Full 300-500 word instruction text ready to paste into AI Studio",
    "setupSteps": [
      "Go to gemini.google.com → tap your profile → Gems → Create a Gem",
      "Name: 'Session Primer — ${sessionName}'",
      "Instructions: paste the system instruction above",
      "Knowledge: upload the pre-reading files from 01_Research in your session Drive folder",
      "Model: Gemini 1.5 Pro (recommended for richer responses)",
      "Save, then Share → Anyone with the link → copy the link",
      "Paste the link in your Mngaia dashboard under Set Gem Links"
    ],
    "starterQueries": [
      "Conversation starter 1 a participant might use",
      "Conversation starter 2",
      "Conversation starter 3"
    ],
    "link": null
  }
]

The 4 Gems must have these exact ids and purposes:
1. "session-primer" — Pre-session: brings participants up to speed on the theme using the session resources; warm, curious, explanatory tone
2. "critical-lens" — Challenges assumptions; surfaces counterarguments and alternative perspectives on the theme's dominant narratives; Socratic tone
3. "synthesis-companion" — During/after session: helps participants connect ideas across the resources and session discussion; pattern-finding, bridge-building tone
4. "reflection-catalyst" — Post-session: helps participants articulate personal insights, tensions, and concrete next steps; reflective, coaching tone
    `.trim();

    const result = this._call(prompt, 0.85);
    // Result might be wrapped in { gems: [...] } or be the array directly
    return Array.isArray(result) ? result : (result.gems || result);
  },

  // ─── Phase 5: Email Drafting ────────────────────────────────────────────────

  /**
   * Drafts the pre-session engagement email.
   * @returns {{ subject, body, previewText }}
   */
  draftPreSessionEmail: function(sessionBrief, preReadingResources, sessionDate, libraryUrl) {
    const resourceLines = preReadingResources.map((r, i) =>
      `${i + 1}. ${r.title} — ${r.relevanceStatement} [Link: ${r.url}]`
    ).join('\n');

    const prompt = `
You are a warm, intellectually curious community facilitator writing a pre-session email to engage participants before a collaborative monthly gathering.

Session Details:
- Date: ${sessionDate}
- Theme Overview: ${sessionBrief.overview}
- Learning Objectives: ${sessionBrief.learningObjectives.join('; ')}
- Full Learning Library URL: ${libraryUrl}

Curated Pre-Reading Resources:
${resourceLines}

Two "come ready to think about" questions to include:
- ${sessionBrief.inquiryQuestions[0]}
- ${sessionBrief.inquiryQuestions[1]}

Write a pre-session engagement email. The tone should be: warm, intellectually curious, not corporate.
It should feel like it's coming from a thoughtful facilitator, not a marketing team.

Return valid JSON with this exact schema:
{
  "subject": "Email subject line (compelling, 8-12 words)",
  "previewText": "Preview/teaser text shown in email clients (max 90 chars)",
  "body": "Full HTML email body — use simple HTML: <p>, <b>, <a>, <ul>, <li> tags only. No inline styles. No external links except the ones provided. Include: greeting, session overview (1 para), 2 framing questions (bulleted), pre-reading section with the 3 resources linked, a call-to-action to visit the learning library, and a warm closing. Keep it under 400 words."
}
    `.trim();
    return this._call(prompt, 0.75);
  },

  // ─── Legacy: Brainstorm Analysis (kept for menu compatibility) ──────────────

  analyzeBrainstorm: function(text, options) {
    const brandContext = options && options.brandContext ? options.brandContext : 'No specific brand guidelines.';
    const prompt = `
You are an expert Content Strategist and Multi-modal Producer.
Analyze these brainstorm notes and provide 3 strategic content angles.

Format: ${options && options.format || 'Standard'}
Audience: ${options && options.audience || 'General'}
Brand Context: ${brandContext}

Return valid JSON:
{
  "summary": "Core theme summary string",
  "choices": [
    { "title": "string", "description": "string", "pros": "string", "cons": "string" }
  ]
}

Brainstorm Notes:
${text}
    `.trim();
    return this._call(prompt, 0.7);
  }

};
