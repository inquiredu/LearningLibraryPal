/** Explicit spreadsheet access works in both web-app and bound-Sheet execution. */
const StorageService = {
  master: function() {
    const id = PropertiesService.getScriptProperties().getProperty('MASTER_SPREADSHEET_ID');
    if (id) return SpreadsheetApp.openById(id);
    throw new Error('Library setup is incomplete. Open Initial Setup from the bound Google Sheet and save.');
  }
};
