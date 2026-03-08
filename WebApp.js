/**
 * Web App Configuration & Backend Handlers
 */

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Mngaia Command Center')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // Required to embed in Google Sites
}

/**
 * Returns session data to the Web App frontend.
 */
function getDashboardData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Could not connect to database spreadsheet.");
  
  const sheet = ss.getSheetByName("Sessions");
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // Only headers
  
  const headers = data.shift();
  return data.map((row, index) => {
    return {
      rowNumber: index + 2, // 1-based index + 1 for header
      sessionName: row[0],
      date: row[1],
      brand: row[2],
      format: row[3],
      audience: row[4],
      status: row[5],
      planningDocUrl: extractUrlFromFormula(row[6]),
      decisionDocUrl: extractUrlFromFormula(row[7]),
      dbUrl: extractUrlFromFormula(row[8]),
      folderUrl: extractUrlFromFormula(row[9])
    };
  }).reverse(); // Show newest first
}

function extractUrlFromFormula(formula) {
  if (!formula || typeof formula !== 'string') return null;
  const match = formula.match(/HYPERLINK\("([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Trigger Decision Doc from Web App
 */
function webTriggerDecisionDoc(rowNumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Sessions");
  
  const sessionName = sheet.getRange(rowNumber, 1).getValue();
  const brand = sheet.getRange(rowNumber, 3).getValue();
  const format = sheet.getRange(rowNumber, 4).getValue();
  const audience = sheet.getRange(rowNumber, 5).getValue();
  const planningDocFormula = sheet.getRange(rowNumber, 7).getFormula();
  const folderFormula = sheet.getRange(rowNumber, 10).getFormula();
  
  if (!planningDocFormula) throw new Error("No Planning Doc found.");
  
  const docUrl = extractUrlFromFormula(planningDocFormula);
  const folderUrl = extractUrlFromFormula(folderFormula);
  
  if (!docUrl || !folderUrl) throw new Error("Could not extract URLs.");
  
  const docId = docUrl.match(/[-\w]{25,}/)[0];
  const folderId = folderUrl.match(/[-\w]{25,}/)[0];
  
  // 1. Get Text
  const text = DocumentApp.openById(docId).getBody().getText();
  
  // 2. Build Options
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
  const decisionDocUrl = createDecisionDocFile(adminFolder, sessionName, analysis, options); // Call existing Code.js func
  
  // 5. Update Sheet
  sheet.getRange(rowNumber, 8).setFormula(`=HYPERLINK("${decisionDocUrl}", "Open Decision Doc")`);
  sheet.getRange(rowNumber, 6).setValue("2. Synthesizing");
  
  return decisionDocUrl;
}

/**
 * Trigger Synthesis from Web App
 */
function webTriggerSynthesis(rowNumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Sessions");
  
  const sessionName = sheet.getRange(rowNumber, 1).getValue();
  const dbFormula = sheet.getRange(rowNumber, 9).getFormula();
  const folderFormula = sheet.getRange(rowNumber, 10).getFormula();
  
  if (!dbFormula || !folderFormula) throw new Error("Missing DB or Folder links.");
  
  const dbUrl = extractUrlFromFormula(dbFormula);
  const folderUrl = extractUrlFromFormula(folderFormula);
  
  const dbId = dbUrl.match(/[-\w]{25,}/)[0];
  const folderId = folderUrl.match(/[-\w]{25,}/)[0];
  
  const projectFolder = DriveApp.getFolderById(folderId);
  const researchFolder = projectFolder.getFoldersByName("01_Research").next();
  const draftsFolder = projectFolder.getFoldersByName("02_Drafts").next();
  
  SynthesisService.synthesizeAll(dbId, researchFolder.getId(), draftsFolder.getId());
  
  sheet.getRange(rowNumber, 6).setValue("3. Synthesis Complete");
  return true;
}
