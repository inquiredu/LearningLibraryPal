/**
 * Synthesis Service
 * Handles Phase 2: Transforming raw research into synthesized metadata and drafts.
 */

const SynthesisService = {
  
  /**
   * Processes all research found in the database and research folder.
   * @param {string} spreadsheetId - The ID of the Project Database.
   * @param {string} researchFolderId - The ID of the 01_Research folder.
   * @param {string} draftsFolderId - The ID of the 02_Drafts folder.
   */
  synthesizeAll: function(spreadsheetId, researchFolderId, draftsFolderId) {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const urlSheet = spreadsheet.getSheetByName("Saved URLs");
    const data = urlSheet.getDataRange().getValues();
    const headers = data.shift(); // Remove headers
    
    console.log(`Starting synthesis for ${data.length} entries in spreadsheet...`);
    
    data.forEach((row, index) => {
      const [title, url, type, relevance, engagement, usedIn, notes] = row;
      
      // Only process if it hasn't been processed yet (check if Relevance is empty)
      if (url && !relevance) {
        console.log(`Processing URL: ${url}`);
        try {
          const synthesis = this.synthesizeContent(url, title);
          
          // Update Spreadsheet
          urlSheet.getRange(index + 2, 4).setValue(synthesis.relevance); // Relevance / So What
          urlSheet.getRange(index + 2, 5).setValue(synthesis.engagementLevel); // Engagement Level
          
          // Create Draft Doc
          this.createDraftDoc(draftsFolderId, title || "Untitled Resource", synthesis);
          
        } catch (e) {
          console.error(`Failed to synthesize ${url}: ${e.message}`);
          urlSheet.getRange(index + 2, 4).setValue(`Error: ${e.message}`);
        }
      }
    });

    // Also process files in the 01_Research folder that aren't in the spreadsheet
    this.processResearchFolder(researchFolderId, urlSheet, draftsFolderId);
  },

  /**
   * Extracts content from a URL/File and uses Gemini to synthesize it.
   */
  synthesizeContent: function(url, title) {
    // In a real implementation, we'd use a service to fetch the page or extract video transcript
    // For now, we'll pass the URL and Title to Gemini and ask it to provide a "likely" synthesis
    // or use its internal knowledge if it's a known resource.
    
    const prompt = `
      You are a Research Assistant. Analyze the following resource for a learning library.
      
      Resource Title: ${title || "Unknown"}
      Resource URL: ${url}
      
      Task:
      1. Provide a concise "Relevance / So What" statement (2-3 sentences). Why does this matter to someone learning about this topic?
      2. Assign an "Engagement Level": "5-minute skim", "Deep Dive", or "Interactive".
      3. Provide a brief 1-paragraph summary of the key takeaways.
      
      Output must be valid JSON:
      {
        "relevance": "string",
        "engagementLevel": "string",
        "summary": "string"
      }
    `;

    const apiKey = getGeminiApiKey();
    const payload = {
      "contents": [{ "parts": [{ "text": prompt }] }],
      "generationConfig": { "responseMimeType": "application/json" }
    };
    
    const options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    const response = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, options);
    const json = JSON.parse(response.getContentText());
    
    if (json.error) {
      throw new Error(`Gemini API Error: ${json.error.message}`);
    }
    
    const contentText = json.candidates[0].content.parts[0].text;
    const cleanText = contentText.replace(/^```(json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(cleanText);
  },

  /**
   * Processes files dropped into the 01_Research folder.
   */
  processResearchFolder: function(folderId, urlSheet, draftsFolderId) {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    
    while (files.hasNext()) {
      const file = files.next();
      const fileName = file.getName();
      
      // Check if file is already in the spreadsheet
      const sheetData = urlSheet.getDataRange().getValues();
      const alreadyInSheet = sheetData.some(row => row[1] === file.getUrl() || row[0] === fileName);
      
      if (!alreadyInSheet) {
        console.log(`Processing new file from folder: ${fileName}`);
        
        try {
          const content = getFileContent(file);
          const synthesis = this.synthesizeRawText(content, fileName);
          
          // Add to Spreadsheet
          urlSheet.appendRow([fileName, file.getUrl(), file.getMimeType(), synthesis.relevance, synthesis.engagementLevel, "", ""]);
          
          // Create Draft Doc
          this.createDraftDoc(draftsFolderId, fileName, synthesis);
        } catch (err) {
          console.error(`Failed to process ${fileName}: ${err.message}`);
          urlSheet.appendRow([fileName, file.getUrl(), file.getMimeType(), `Error: ${err.message}`, "", "", ""]);
        }
      }
    }
  },

  /**
   * Synthesizes raw text content.
   */
  synthesizeRawText: function(text, title) {
    const apiKey = getGeminiApiKey();
    const prompt = `
      Analyze this research material:
      Title: ${title}
      Content: ${text.substring(0, 10000)} // Truncate for safety
      
      Task:
      1. Relevance / So What.
      2. Engagement Level.
      3. 1-paragraph summary.
      
      Output JSON: { "relevance": "string", "engagementLevel": "string", "summary": "string" }
    `;

    const payload = {
      "contents": [{ "parts": [{ "text": prompt }] }],
      "generationConfig": { "responseMimeType": "application/json" }
    };
    
    const options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    const response = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, options);
    const json = JSON.parse(response.getContentText());
    
    if (json.error) {
      throw new Error(`Gemini API Error: ${json.error.message}`);
    }
    
    const contentText = json.candidates[0].content.parts[0].text;
    const cleanText = contentText.replace(/^```(json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(cleanText);
  },

  /**
   * Creates a formatted Google Doc in the Drafts folder.
   */
  createDraftDoc: function(folderId, title, synthesis) {
    const doc = DocumentApp.create(`DRAFT: ${title}`);
    const body = doc.getBody();
    
    body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(`Engagement Level: ${synthesis.engagementLevel}`).setHeading(DocumentApp.ParagraphHeading.SUBTITLE);
    
    body.appendParagraph("The 'So What'").setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(synthesis.relevance);
    
    body.appendParagraph("Summary").setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(synthesis.summary);
    
    doc.saveAndClose();
    
    // Move to drafts folder
    const file = DriveApp.getFileById(doc.getId());
    DriveApp.getFolderById(folderId).addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  }
};
