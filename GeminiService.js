/**
 * GeminiService
 * Central AI layer — all Gemini API interactions live here.
 * Model: gemini-1.5-flash (fast, structured JSON output)
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
   * @returns {{ title, relevanceScore, relevanceStatement, engagementLevel, keyConceptTags, notebookLMReady, summary }}
   */
  analyzeResource: function(content, theme, audience) {
    const prompt = `
You are a learning curator preparing resources for a collaborative session on: "${theme}"
Audience: ${audience}

Analyze the following resource content and return a structured metadata object.

Resource Content:
---
${content.substring(0, 6000)}
---

Return valid JSON with this exact schema:
{
  "title": "Inferred or extracted title of the resource",
  "relevanceScore": 4,
  "relevanceStatement": "1-2 sentences explaining how this resource connects to the session theme",
  "engagementLevel": "Accessible",
  "keyConceptTags": ["tag1", "tag2", "tag3"],
  "notebookLMReady": true,
  "summary": "3-4 sentence summary of the resource's key ideas"
}

Rules:
- relevanceScore: integer 1-5 (5 = directly on theme, essential; 1 = tangential)
- engagementLevel: exactly one of "Accessible", "Intermediate", "Deep"
- keyConceptTags: exactly 3 short tags
- notebookLMReady: true if resource would be valuable to upload to NotebookLM for dialogue
    `.trim();
    return this._call(prompt, 0.3);
  },

  // ─── Phase 3: Gems Generation ───────────────────────────────────────────────

  /**
   * Generates 4 AI Gem prompt structures for the session.
   * @returns {{ gems: GemObject[] }}
   */
  generateGemsPrompts: function(theme, objectives, inquiryQuestions) {
    const objectivesList = objectives.join('\n- ');
    const questionsList = inquiryQuestions.join('\n- ');

    const prompt = `
You are an expert AI prompt architect designing specialized AI personas ("Gems") for a collaborative learning session.

Session Theme: "${theme}"

Learning Objectives:
- ${objectivesList}

Inquiry Questions:
- ${questionsList}

Create 4 distinct Gems — each is an AI persona with a specific role in the learning cycle.

Return valid JSON with this exact schema:
{
  "gems": [
    {
      "id": "deep-researcher",
      "name": "Deep Researcher",
      "emoji": "🔭",
      "role": "Pre-session exploration",
      "persona": "1-2 sentence description of who this AI is and how it behaves",
      "systemPrompt": "The full system prompt text a participant would paste into a new Gemini Gem to configure this AI persona. Should be 150-250 words, written in second person to the AI.",
      "starterQueries": [
        "Starter question 1 a participant might ask",
        "Starter question 2",
        "Starter question 3"
      ],
      "notebookLMPrompt": "A prompt to paste into NotebookLM after uploading pre-reading materials"
    }
  ]
}

The 4 Gems must be exactly:
1. id: "deep-researcher" — For pre-session deep exploration of the theme
2. id: "synthesis-companion" — For during-session real-time connection of ideas
3. id: "facilitation-guide" — For the facilitator (session flow, probing questions, timing)
4. id: "reflection-catalyst" — For post-session personal insight distillation

Each systemPrompt should be rich, specific to the theme, and give the AI a clear voice and operating style.
    `.trim();
    return this._call(prompt, 0.85);
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
