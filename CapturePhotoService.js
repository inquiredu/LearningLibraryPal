/**
 * CapturePhotoService
 * Keeps every photo that AI reads (a card from a device, a poster or sheet
 * from the board) in the session's Drive folder, under "Live capture photos",
 * so anyone checking the audit trail can compare a reading with its source.
 * Files keep Drive's default sharing: only the library owner and people the
 * folder is shared with can open them.
 */

const CapturePhotoService = {
  FOLDER: 'Live capture photos',

  folder_: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    const match = String(session && session.folderUrl || '').match(/folders\/([a-zA-Z0-9_-]+)/);
    const parent = match ? DriveApp.getFolderById(match[1]) : DriveApp.getRootFolder();
    const found = parent.getFoldersByName(this.FOLDER);
    return found.hasNext() ? found.next() : parent.createFolder(this.FOLDER);
  },

  /** Saves a base64 photo and returns its Drive link. label names what it shows. */
  save: function(sessionId, base64, mimeType, label) {
    const ext = { 'image/png': 'png', 'image/webp': 'webp' }[mimeType] || 'jpg';
    const stamp = Utilities.formatDate(new Date(), CONFIG.DISPLAY_TIMEZONE || 'America/Chicago', 'yyyy-MM-dd HH-mm-ss');
    const name = captureCleanText_(label, 60).replace(/[\\/:*?"<>|]/g, '-') + ' ' + stamp + '.' + ext;
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, name);
    return this.folder_(sessionId).createFile(blob).getUrl();
  }
};
