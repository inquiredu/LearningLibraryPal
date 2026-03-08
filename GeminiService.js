/**
 * Gemini Service
 * Handles interactions with the Gemini API via AI Studio.
 */

const GeminiService = {
  
  /**
   * Analyzes raw brainstorm text to extract strategic choices.
   * @param {string} text - The raw text from the Google Doc.
   * @param {Object} options - UI options for format, audience, and tone.
   * @returns {Object} - Structured JSON with summary and choices.
   */
  analyzeBrainstorm: function(text, options) {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY not found in Script Properties.");
    }

    const formatContext = options ? `
      Target Format: ${options.format}
      Target Audience: ${options.audience}
      Tone & Style: ${options.tone}
      Timeline / Calendar Context: ${options.calendarContext || 'None provided'}
      
      Brand Guidelines & Design:
      ${options.brandContext || 'No specific brand guidelines provided.'}
    ` : "Target Format: Standard Project";

    const prompt = `
      You are an expert Content Strategist, Multi-modal Producer, and Designer.
      Analyze the following brainstorm notes for a content project.
      
      ${formatContext}
      
      Task:
      1. Summarize the core theme, ensuring it fits the Target Format requested. If they requested rich media or a multimodal format, reflect that in the summary. Include any relevant timeline/calendar context mentioned.
      2. Identify 3 distinct strategic directions or "angles" we could take to produce this content. Detail how rich media or multimodal elements (e.g., embedded video, AI interactive tools, polls) could be integrated. 
         - If a calendar was provided, weave the timeline into how these assets would be deployed.
         - Incorporate the Brand Guidelines into your strategic angles. Suggest specific color usages (e.g., "Use Midnight Lake for the background"), typography, and imagery alignments that match the provided brand voice and identity.
      3. For each angle, provide Pros and Cons.
      
      Output must be valid JSON with this exact schema:
      {
        "summary": "string",
        "choices": [
          {
            "title": "string",
            "description": "string",
            "pros": "string",
            "cons": "string"
          }
        ]
      }
      
      Brainstorm Notes:
      ${text}
    `;

    const payload = {
      "contents": [{
        "parts": [{"text": prompt}]
      }],
      "generationConfig": {
        "temperature": 0.7,
        "responseMimeType": "application/json"
      }
    };

    const optionsHttp = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    try {
      const response = UrlFetchApp.fetch(url, optionsHttp);
      const json = JSON.parse(response.getContentText());
      
      if (json.error) {
        throw new Error(`Gemini API Error: ${json.error.message}`);
      }
      
      const contentText = json.candidates[0].content.parts[0].text;
      
      // Robustly strip Markdown codeblocks if Gemini added them
      const cleanText = contentText.replace(/^```(json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      return JSON.parse(cleanText);
      
    } catch (e) {
      console.error("Gemini Analysis Failed", e);
      throw e;
    }
  }
};