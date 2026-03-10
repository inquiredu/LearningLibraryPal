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
    .addItem('📅  Authorize Calendar Access', 'triggerCalendarAuth')
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
  const result = SessionService.setupSession(params);
  CacheService.getScriptCache().remove('dashboard_v2');
  return result;
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

function triggerCalendarAuth() {
  var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  if (authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    var authUrl = authInfo.getAuthorizationUrl();
    var html = HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><body style="font-family:\'Google Sans\',Arial,sans-serif;padding:20px;">' +
      '<p style="margin:0 0 14px;color:#444;font-size:13px;">Calendar access requires re-authorization.<br>Click the button below to grant access.</p>' +
      '<a href="' + authUrl + '" target="_blank" ' +
        'style="display:inline-block;background:#0B2B46;color:#fff;padding:10px 22px;border-radius:6px;' +
        'text-decoration:none;font-size:13px;font-weight:700;">Authorize Calendar Access &rarr;</a>' +
      '<p style="margin-top:12px;font-size:0.75rem;color:#888;">After authorizing, reload the web app. The dashboard will load without delays.</p>' +
      '</body></html>'
    ).setWidth(380).setHeight(180);
    SpreadsheetApp.getUi().showModalDialog(html, 'Calendar Authorization Required');
  } else {
    // Already authorized — confirm it works
    try {
      CalendarApp.getDefaultCalendar();
      SpreadsheetApp.getUi().alert('✅ Calendar access is already authorized. Reload the web app — the dashboard should load normally.');
    } catch (e) {
      SpreadsheetApp.getUi().alert('Calendar check failed: ' + e.message);
    }
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
  const safeUrl = url.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const html = HtmlService.createHtmlOutput(
    `<!DOCTYPE html><html><body style="font-family:'Google Sans',Arial,sans-serif;margin:0;padding:20px 24px;background:#fff;">
    <div style="border:1px solid #DDE4ED;border-radius:8px;overflow:hidden;">
      <div style="background:#0B2B46;padding:10px 16px;">
        <span style="color:#5DCDF5;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">MNGAIA</span>
        <span style="color:rgba(255,255,255,0.6);font-size:10px;margin-left:8px;">Content Engine</span>
      </div>
      <div style="padding:16px;text-align:center;">
        <p style="margin:0 0 16px;color:#444;font-size:13px;">Dashboard is opening in a new tab.</p>
        <a href="${safeUrl}" target="_blank"
           style="display:inline-block;background:#0B2B46;color:#fff;padding:10px 28px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:.3px;">
          Open Dashboard &rarr;
        </a>
      </div>
    </div>
    <script>window.open('${safeUrl}', '_blank');<\/script>
    </body></html>`
  ).setWidth(340).setHeight(170);
  SpreadsheetApp.getUi().showModalDialog(html, 'Open Dashboard');
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
