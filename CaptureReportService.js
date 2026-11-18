/**
 * CaptureReportService
 * Writes the results document that captureReport_ describes into a Google Doc
 * in the session's 04_Final folder (or the session folder), and returns its
 * link. The words and numbers all come from captureReport_; this file only
 * lays them out.
 */

const CaptureReportService = {
  BLUE: '#003865',

  make: function(sessionId, report) {
    const doc = DocumentApp.create(report.title);
    const body = doc.getBody();
    body.clear();
    body.setAttributes(this.attrs_({ font: 'Arial', size: 11 }));
    const title = body.appendParagraph(report.title).setHeading(DocumentApp.ParagraphHeading.TITLE);
    title.setForegroundColor(this.BLUE);
    report.lead.forEach(text => body.appendParagraph(text));
    report.sections.forEach(section => {
      body.appendParagraph(section.heading).setHeading(section.level === 2 ? DocumentApp.ParagraphHeading.HEADING2 : DocumentApp.ParagraphHeading.HEADING1)
        .setForegroundColor(this.BLUE);
      section.blocks.forEach(block => this.block_(body, block));
    });
    // A new document starts with one empty paragraph; drop it if it is still first.
    const first = body.getChild(0);
    if (first && first.getType() === DocumentApp.ElementType.PARAGRAPH && !first.asParagraph().getText() && body.getNumChildren() > 1) first.removeFromParent();
    doc.saveAndClose();
    this.file_(sessionId, doc.getId());
    return doc.getUrl();
  },

  block_: function(body, block) {
    if (block.caption) body.appendParagraph(block.caption).setBold(true);
    if (block.p) body.appendParagraph(block.p).setBold(false);
    if (block.list) block.list.forEach(item => body.appendListItem(item).setGlyphType(DocumentApp.GlyphType.BULLET));
    if (block.table) {
      const rows = [block.table.header].concat(block.table.rows.length ? block.table.rows : [block.table.header.map((h, i) => (i ? '' : 'None'))]);
      const table = body.appendTable(rows.map(r => r.map(cell => String(cell === undefined || cell === null ? '' : cell))));
      table.setBorderColor('#B8C4CE');
      const head = table.getRow(0);
      for (let i = 0; i < head.getNumCells(); i++) {
        head.getCell(i).setBackgroundColor(this.BLUE).editAsText().setForegroundColor('#FFFFFF').setBold(true);
      }
      body.appendParagraph('');
    }
  },

  attrs_: function(o) {
    const a = {};
    a[DocumentApp.Attribute.FONT_FAMILY] = o.font;
    a[DocumentApp.Attribute.FONT_SIZE] = o.size;
    return a;
  },

  file_: function(sessionId, docId) {
    const session = SessionService.getSession(sessionId);
    const match = String(session && session.folderUrl || '').match(/folders\/([a-zA-Z0-9_-]+)/);
    if (!match) return;
    const folder = DriveApp.getFolderById(match[1]);
    const finals = folder.getFoldersByName('04_Final');
    DriveApp.getFileById(docId).moveTo(finals.hasNext() ? finals.next() : folder);
  }
};
