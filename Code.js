/**
 * Mngaia Content Engine - Master Launchpad (Spreadsheet Bound)
 * 
 * Role: Lead Solutions Architect
 * Objective: Centralized Command Center for all content sessions.
 */

const CONFIG = {
  SUBFOLDERS: ["00_Admin", "01_Research", "02_Drafts", "03_Gems", "04_Final_Assets"],
  GEMINI_MODEL: "gemini-1.5-flash"
};

/**
 * Add custom menu when the Master Google Sheet is opened.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Mngaia Engine')
    .addItem('🚀 1. Launch New Session', 'showWizard')
    .addItem('🧠 2. Generate Decision Doc', 'triggerDecisionDoc')
    .addItem('⚙️ 3. Synthesize Research', 'triggerSynthesis')
    .addSeparator()
    .addItem('🛠️ Setup Command Center', 'setupCommandCenter')
    .addToUi();
}

/**
 * One-time setup to create the necessary tabs in the Master Sheet.
 */
function setupCommandCenter() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Setup Settings Tab
  let settingsSheet = ss.getSheetByName("Settings");
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet("Settings");
    settingsSheet.getRange("A1:B1").setValues([["Setting", "Value"]]).setFontWeight("bold");
    settingsSheet.getRange("A2:B2").setValues([["Root Folder ID (Where projects go)", "PASTE_FOLDER_ID_HERE"]]);
    settingsSheet.getRange("A3:B3").setValues([["Planning Doc Template ID", "PASTE_DOC_ID_HERE"]]);
    settingsSheet.setColumnWidth(1, 250);
    settingsSheet.setColumnWidth(2, 350);
  }

  // Setup Sessions Tab
  let sessionsSheet = ss.getSheetByName("Sessions");
  if (!sessionsSheet) {
    sessionsSheet = ss.insertSheet("Sessions", 0);
    const headers = ["Session Name", "Date", "Brand", "Format", "Audience", "Status", "Planning Doc", "Decision Doc", "Project DB", "Folder Link"];
    sessionsSheet.getRange("A1:J1").setValues([headers]).setFontWeight("bold").setBackground("#f3f3f3");
    sessionsSheet.setFrozenRows(1);
    sessionsSheet.setColumnWidth(1, 200);
    sessionsSheet.setColumnWidth(7, 150);
    sessionsSheet.setColumnWidth(8, 150);
    sessionsSheet.setColumnWidth(9, 150);
    sessionsSheet.setColumnWidth(10, 150);
  }
  
  SpreadsheetApp.getUi().alert("Command Center Setup Complete! Please fill in the 'Settings' tab with your Root Folder ID and Template Doc ID.");
}

/**
 * Helper to get settings. If missing, prompts the user to auto-create them.
 */
function getSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Settings");
  if (!sheet) {
    setupCommandCenter();
    sheet = ss.getSheetByName("Settings");
  }
  
  const ui = SpreadsheetApp.getUi();
  let rootFolderId = sheet.getRange("B2").getValue();
  let templateId = sheet.getRange("B3").getValue();
  
  // 1. Handle Missing Root Folder
  if (!rootFolderId || rootFolderId === "PASTE_FOLDER_ID_HERE") {
    const response = ui.alert(
      "Root Folder Not Set", 
      "I don't know where to save your projects. Would you like me to create a new folder named 'Mngaia Content Projects' in your Drive and use it as the Root?", 
      ui.ButtonSet.YES_NO
    );
    
    if (response == ui.Button.YES) {
      const newFolder = DriveApp.createFolder("Mngaia Content Projects");
      rootFolderId = newFolder.getId();
      sheet.getRange("B2").setValue(rootFolderId);
    } else {
      throw new Error("Action Cancelled. Please manually paste a Folder ID into the 'Settings' tab.");
    }
  }
  
  // 2. Handle Missing Template Doc
  if (!templateId || templateId === "PASTE_DOC_ID_HERE") {
    const response = ui.alert(
      "Template Not Set", 
      "You haven't selected a Brainstorm Template. Would you like me to create a default 'Mngaia Planning Template' for you to use?", 
      ui.ButtonSet.YES_NO
    );
    
    if (response == ui.Button.YES) {
      const newDoc = DocumentApp.create("Mngaia Planning Template");
      const body = newDoc.getBody();
      body.appendParagraph("Mngaia Brainstorming & Planning Template").setHeading(DocumentApp.ParagraphHeading.HEADING1);
      body.appendParagraph("Date: " + new Date().toLocaleDateString()).setHeading(DocumentApp.ParagraphHeading.SUBTITLE);
      body.appendParagraph("Raw Notes & Brainstorming").setHeading(DocumentApp.ParagraphHeading.HEADING2);
      body.appendParagraph("[Type your raw ideas, meeting notes, or paste NotebookLM exports here. When finished, go back to the Command Center and click 'Generate Decision Doc']");
      newDoc.saveAndClose();
      
      templateId = newDoc.getId();
      sheet.getRange("B3").setValue(templateId);
    } else {
      throw new Error("Action Cancelled. Please manually paste a Google Doc ID into the 'Settings' tab.");
    }
  }
  
  return { rootFolderId, templateId };
}

/**
 * Display the Wizard Dialog.
 */
function showWizard() {
  const html = HtmlService.createHtmlOutputFromFile('Wizard')
      .setWidth(450)
      .setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Launch New Session');
}

/**
 * Phase 1: Launch Session (Called from UI)
 */
function processWizardUI(options) {
  const settings = getSettings();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionsSheet = ss.getSheetByName("Sessions");
  
  // 1. Create Master Folder
  const rootFolder = DriveApp.getFolderById(settings.rootFolderId);
  const projectFolder = rootFolder.createFolder(options.sessionName);
  
  // 2. Scaffold Subfolders
  CONFIG.SUBFOLDERS.forEach(sub => projectFolder.createFolder(sub));
  const adminFolder = projectFolder.getFoldersByName("00_Admin").next();
  
  // 3. Copy Template Doc
  const templateFile = DriveApp.getFileById(settings.templateId);
  const planningDoc = templateFile.makeCopy(`PLANNING: ${options.sessionName}`, adminFolder);
  
  // 4. Create Project Database (for URLs)
  const dbUrl = createProjectDatabase(adminFolder, options.sessionName);
  
  // 5. Add Row to Master Sheet
  const newRow = [
    options.sessionName,
    options.date,
    options.brand,
    options.format,
    options.audience,
    "1. Brainstorming",
    `=HYPERLINK("${planningDoc.getUrl()}", "Open Planning Doc")`,
    "Pending",
    `=HYPERLINK("${dbUrl}", "Open Project DB")`,
    `=HYPERLINK("${projectFolder.getUrl()}", "Open Folder")`
  ];
  sessionsSheet.appendRow(newRow);
  
  return planningDoc.getUrl();
}

/**
 * Creates the Project-Specific Database for saving URLs.
 */
function createProjectDatabase(folder, sessionName) {
  const spreadsheet = SpreadsheetApp.create(`DATABASE: ${sessionName}`);
  const file = DriveApp.getFileById(spreadsheet.getId());
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  
  const sheet = spreadsheet.getSheets()[0];
  sheet.setName("Saved URLs");
  const headers = ["Title", "URL", "Type", "Relevance / So What", "Engagement Level", "Used In", "Notes"];
  sheet.getRange("A1:G1").setValues([headers]).setFontWeight("bold").setBackground("#f3f3f3");
  
  return spreadsheet.getUrl();
}

/**
 * Phase 1.5: Generate Decision Doc from the Selected Row
 */
function triggerDecisionDoc() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  
  if (sheet.getName() !== "Sessions") {
    ui.alert("Please select a row in the 'Sessions' tab.");
    return;
  }
  
  const row = sheet.getActiveCell().getRow();
  if (row === 1) {
    ui.alert("Please select a valid session row, not the header.");
    return;
  }
  
  const sessionName = sheet.getRange(row, 1).getValue();
  const brand = sheet.getRange(row, 3).getValue();
  const format = sheet.getRange(row, 4).getValue();
  const audience = sheet.getRange(row, 5).getValue();
  const planningDocFormula = sheet.getRange(row, 7).getFormula(); // =HYPERLINK("url", "text")
  const folderFormula = sheet.getRange(row, 10).getFormula();
  
  if (!planningDocFormula) {
    ui.alert("No Planning Doc found for this row.");
    return;
  }
  
  // Extract URLs from formulas
  const docUrlMatch = planningDocFormula.match(/HYPERLINK\("([^"]+)"/);
  const folderUrlMatch = folderFormula.match(/HYPERLINK\("([^"]+)"/);
  
  if (!docUrlMatch || !folderUrlMatch) {
    ui.alert("Could not extract document or folder URLs from the sheet.");
    return;
  }
  
  const docId = docUrlMatch[1].match(/[-\w]{25,}/)[0];
  const folderId = folderUrlMatch[1].match(/[-\w]{25,}/)[0];
  
  ui.alert(`Generating Decision Doc for: ${sessionName}...\nThis may take 15-30 seconds.`);
  
  try {
    // 1. Get Text
    const text = DocumentApp.openById(docId).getBody().getText();
    
    // 2. Build Options for Gemini
    const options = { format, audience, brand, tone: "Professional", calendarContext: "" };
    if (brand && typeof BRANDS !== 'undefined' && BRANDS[brand]) {
      options.brandContext = BRANDS[brand];
    } else {
      options.brandContext = "No specific brand guidelines provided.";
    }
    
    // 3. Analyze
    const analysis = GeminiService.analyzeBrainstorm(text, options);
    
    // 4. Create Decision Doc
    const adminFolder = DriveApp.getFolderById(folderId).getFoldersByName("00_Admin").next();
    const decisionDocUrl = createDecisionDocFile(adminFolder, sessionName, analysis, options);
    
    // 5. Update Sheet
    sheet.getRange(row, 8).setFormula(`=HYPERLINK("${decisionDocUrl}", "Open Decision Doc")`);
    sheet.getRange(row, 6).setValue("2. Synthesizing"); // Update Status
    
    ui.alert("✅ Decision Doc Generated successfully!");
    
  } catch (e) {
    ui.alert("❌ Error generating Decision Doc: " + e.message);
  }
}

function createDecisionDocFile(folder, sessionName, analysis, options) {
  const doc = DocumentApp.create(`DECISION: ${sessionName}`);
  const body = doc.getBody();
  
  const file = DriveApp.getFileById(doc.getId());
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  
  body.appendParagraph(`Decision Document: ${sessionName}`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(`Format: ${options.format} | Brand: ${options.brand}`).setHeading(DocumentApp.ParagraphHeading.SUBTITLE);
  
  body.appendParagraph("Executive Summary").setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(analysis.summary);
  
  body.appendParagraph("Strategic Angles (Select 1-2)").setHeading(DocumentApp.ParagraphHeading.HEADING2);
  analysis.choices.forEach(choice => {
    body.appendParagraph(`Option: ${choice.title}`).setHeading(DocumentApp.ParagraphHeading.HEADING3);
    body.appendParagraph(choice.description);
    body.appendParagraph(`Pros: ${choice.pros}`);
    body.appendParagraph(`Cons: ${choice.cons}`);
  });
  
  doc.saveAndClose();
  return doc.getUrl();
}

/**
 * Phase 2: Trigger Synthesis from the Selected Row
 */
function triggerSynthesis() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  
  if (sheet.getName() !== "Sessions") {
    ui.alert("Please select a row in the 'Sessions' tab.");
    return;
  }
  
  const row = sheet.getActiveCell().getRow();
  if (row === 1) return;
  
  const sessionName = sheet.getRange(row, 1).getValue();
  const dbFormula = sheet.getRange(row, 9).getFormula();
  const folderFormula = sheet.getRange(row, 10).getFormula();
  
  if (!dbFormula || !folderFormula) {
    ui.alert("Missing DB or Folder links for this session.");
    return;
  }
  
  const dbUrlMatch = dbFormula.match(/HYPERLINK\("([^"]+)"/);
  const folderUrlMatch = folderFormula.match(/HYPERLINK\("([^"]+)"/);
  const dbId = dbUrlMatch[1].match(/[-\w]{25,}/)[0];
  const folderId = folderUrlMatch[1].match(/[-\w]{25,}/)[0];
  
  ui.alert(`Starting Synthesis for: ${sessionName}...\nCheck the Project DB for progress.`);
  
  try {
    const projectFolder = DriveApp.getFolderById(folderId);
    const researchFolder = projectFolder.getFoldersByName("01_Research").next();
    const draftsFolder = projectFolder.getFoldersByName("02_Drafts").next();
    
    SynthesisService.synthesizeAll(dbId, researchFolder.getId(), draftsFolder.getId());
    
    sheet.getRange(row, 6).setValue("3. Synthesis Complete");
    ui.alert("✅ Synthesis Complete!");
  } catch (e) {
    ui.alert("❌ Synthesis Failed: " + e.message);
  }
}

/**
 * Helper to get API Key from Script Properties
 */
function getGeminiApiKey() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}
