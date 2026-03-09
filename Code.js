/**
 * MNGAIA Dynamic Content Engine — Master Orchestration
 * Spreadsheet-bound. All top-level GAS entry points live here.
 */

// ─── Menu ────────────────────────────────────────────────────────────────────

function onOpen() {
  SessionService.ensureMasterSheet();
  SpreadsheetApp.getUi()
    .createMenu('MNGAIA Engine')
    .addItem('🚀  Launch New Session', 'showWizard')
    .addSeparator()
    .addItem('🔬  Synthesize Research', 'menuTriggerSynthesis')
    .addItem('💎  Generate Gems', 'menuTriggerGems')
    .addItem('📧  Draft & Send Pre-Session Email', 'menuTriggerEmail')
    .addItem('🌐  Generate Site Code', 'menuTriggerSiteCode')
    .addSeparator()
    .addItem('🌐  Open Dashboard', 'openDashboard')
    .addItem('⚙️   Settings', 'showSettings')
    .addToUi();
}

// ─── Wizard / Session Launch ─────────────────────────────────────────────────

function showWizard() {
  const html = HtmlService.createHtmlOutputFromFile('Wizard')
    .setWidth(500)
    .setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, '🚀 Launch New Session');
}

/**
 * Called from Wizard.html via google.script.run.
 * @param {Object} params - { name, theme, date, format, audience, brand }
 * @returns {Object} - { sessionId, folderUrl, dbUrl, brief }
 */
function processWizardSubmit(params) {
  return SessionService.setupSession(params);
}

// ─── Menu Triggers (row-selected operations) ─────────────────────────────────

function menuTriggerSynthesis() {
  const { sessionId, session } = _getSelectedSession();
  if (!sessionId) return;
  const ui = SpreadsheetApp.getUi();
  try {
    ui.alert(`Starting Synthesis for: ${session.name}\nThis may take 30–60 seconds...`);
    const count = SynthesisService.synthesizeAll(sessionId);
    ui.alert(`✅ Synthesis complete! ${count} resource(s) analyzed.`);
  } catch (e) {
    ui.alert('❌ Synthesis failed: ' + e.message);
  }
}

function menuTriggerGems() {
  const { sessionId, session } = _getSelectedSession();
  if (!sessionId) return;
  const ui = SpreadsheetApp.getUi();
  try {
    ui.alert(`Generating Gems for: ${session.name}\nThis may take 20–40 seconds...`);
    GemsService.generateGems(sessionId);
    ui.alert('✅ Gems generated! View them in the Dashboard or Learning Library.');
  } catch (e) {
    ui.alert('❌ Gems generation failed: ' + e.message);
  }
}

function menuTriggerEmail() {
  const { sessionId, session } = _getSelectedSession();
  if (!sessionId) return;
  const ui = SpreadsheetApp.getUi();
  const recipientsInput = ui.prompt(
    'Pre-Session Email',
    `Enter recipient emails for "${session.name}" (comma-separated):`,
    ui.ButtonSet.OK_CANCEL
  );
  if (recipientsInput.getSelectedButton() !== ui.Button.OK) return;
  const recipients = recipientsInput.getResponseText()
    .split(',').map(e => e.trim()).filter(Boolean);
  if (!recipients.length) {
    ui.alert('No recipients entered.');
    return;
  }
  try {
    ui.alert('Drafting email with AI... (~15 seconds)');
    const result = EmailService.draftAndSend(sessionId, recipients);
    ui.alert(`✅ Email sent to ${recipients.length} recipient(s)!\nSubject: ${result.subject}`);
  } catch (e) {
    ui.alert('❌ Email failed: ' + e.message);
  }
}

function menuTriggerSiteCode() {
  const { sessionId, session } = _getSelectedSession();
  if (!sessionId) return;
  const ui = SpreadsheetApp.getUi();
  try {
    ui.alert(`Generating site code for: ${session.name}...\nThis takes ~10 seconds.`);
    const result = SitesService.generateSiteCode(sessionId);
    ui.alert(`✅ Site code created!\n\nOpen the doc to copy each section:\n${result.docUrl}`);
  } catch (e) {
    ui.alert('❌ Site code failed: ' + e.message);
  }
}

function openDashboard() {
  // Read the URL cached when doGet() first ran — that is always the live /exec URL.
  // Calling ScriptApp.getService().getUrl() from a menu trigger returns the /dev URL,
  // which only works for script editors and appears "not available" to everyone else.
  var url = '';
  try { url = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || ''; } catch(e) {}
  if (!url) {
    // Fallback if the web app hasn't been opened yet since last deploy
    try { url = ScriptApp.getService().getUrl() || ''; } catch(e) {}
  }
  if (!url) {
    SpreadsheetApp.getUi().alert(
      '⚠️  Dashboard URL not found.\n\n' +
      'Open the web app once in your browser (Deploy → Manage deployments → copy the /exec URL), ' +
      'then return here and the menu item will work automatically.'
    );
    return;
  }
  SpreadsheetApp.getUi().alert('📊  Facilitator Dashboard\n\nCopy and open in browser:\n\n' + url);
}

function showSettings() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const currentKey = props.getProperty('GEMINI_API_KEY') ? '(set)' : '(not set)';
  const result = ui.prompt(
    '⚙️ Settings',
    `Gemini API Key is currently: ${currentKey}\n\nPaste your Gemini API Key to update (leave blank to keep current):`,
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  const newKey = result.getResponseText().trim();
  if (newKey) {
    props.setProperty('GEMINI_API_KEY', newKey);
    ui.alert('✅ API Key saved to Script Properties.');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Gets the session corresponding to the currently selected row in the Sessions sheet.
 */
function _getSelectedSession() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== 'Sessions') {
    ui.alert('Please navigate to the Sessions tab and select a session row.');
    return {};
  }
  const row = sheet.getActiveCell().getRow();
  if (row <= 1) {
    ui.alert('Please select a session row (not the header).');
    return {};
  }
  const sessionId = sheet.getRange(row, 1).getValue();
  const session = SessionService.getSession(sessionId);
  if (!session) {
    ui.alert('Could not find session data for row ' + row);
    return {};
  }
  return { sessionId, session };
}

/**
 * Returns the Gemini API key from Script Properties.
 * Used by GeminiService.
 */
function getGeminiApiKey() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}

/**
 * Returns the current user's OAuth token for the Google Drive Picker.
 * Called from Wizard.html and Index.html via google.script.run.
 */
function getOAuthToken() {
  return ScriptApp.getOAuthToken();
}
