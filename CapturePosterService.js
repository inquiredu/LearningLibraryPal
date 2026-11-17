/**
 * CapturePosterService
 * Builds the gallery-walk deck from the facilitators' groups: one poster per
 * topic routed to the gallery walk, with room for dots, then parking-lot
 * pages listing every card whose level routes there, word for word.
 * The deck is saved in the session's 04_Final folder.
 */

const CapturePosterService = {
  W: 720,
  H: 405,
  INK: '#1A1A1A',
  MUTED: '#5F6B78',
  NAVY: '#0B2B46',
  PARKING_PER_PAGE: 7,

  make: function(sessionId, template, config, cards, groups) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found.');
    const live = cards.filter(c => !c.hidden);
    const ordered = captureOrderGroups_(template, live, groups).filter(g => g.stats.route === 'vote');
    const parking = captureParkingLot_(template, live);
    if (!ordered.length && !parking.length) throw new Error('Group the cards before making posters.');

    const stamp = Utilities.formatDate(new Date(), CONFIG.DISPLAY_TIMEZONE, 'MMM d, h:mm a');
    const deck = SlidesApp.create((config.title || template.name) + ' — Gallery walk (' + stamp + ')');
    const first = deck.getSlides()[0];

    ordered.forEach(group => this.poster_(deck, template, group));
    for (let i = 0; i < parking.length; i += this.PARKING_PER_PAGE) {
      this.parkingPage_(deck, template, parking.slice(i, i + this.PARKING_PER_PAGE),
        Math.floor(i / this.PARKING_PER_PAGE) + 1, Math.ceil(parking.length / this.PARKING_PER_PAGE));
    }
    first.remove();
    deck.saveAndClose();
    this.file_(session, deck.getId());
    return deck.getUrl();
  },

  poster_: function(deck, template, group) {
    const slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    this.text_(slide, template.posterPrompt.toUpperCase(), 30, 20, 660, 22, 12, this.MUTED, true);
    this.text_(slide, group.topic, 30, 44, 660, 112, 44, this.INK, true);
    const levels = template.level.options
      .filter(o => o.route === 'vote')
      .map(o => o.code + ' ' + group.stats.levels[o.code])
      .join('  ·  ');
    const tables = group.stats.tableCount === 1 ? '1 table' : group.stats.tableCount + ' tables';
    const column = template.level.options.find(o => o.code === group.stats.column) || { code: '', label: '' };
    this.text_(slide, column.code + ' · ' + column.label + (group.stats.contested ? ' (?)' : '') + '  ·  Raised by ' + tables + '  ·  ' + levels, 30, 160, 660, 28, 18, this.MUTED, false);
    const box = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 30, 198, 660, 182);
    box.getFill().setSolidFill('#FFFFFF');
    box.getBorder().setWeight(2).setDashStyle(SlidesApp.DashStyle.DASH).getLineFill().setSolidFill('#9AA5B1');
  },

  parkingPage_: function(deck, template, cards, page, pages) {
    const slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    const title = template.routes.parking + (pages > 1 ? ' (' + page + ' of ' + pages + ')' : '');
    this.text_(slide, title, 30, 20, 660, 44, 30, this.INK, true);
    const parkingCodes = template.level.options.filter(o => o.route === 'parking').map(o => o.code + ' — ' + o.label);
    this.text_(slide, parkingCodes.join(', ') + '. Not part of dot voting; kept for follow-up.', 30, 64, 660, 24, 13, this.MUTED, false);
    const primary = template.fields.find(f => f.primary) || template.fields[0];
    const body = cards.map(c => c.fields[primary.key] + '  (Table ' + c.table + ')').join('\n');
    const shape = this.text_(slide, body, 30, 98, 660, 290, 16, this.INK, false);
    shape.getText().getListStyle().applyListPreset(SlidesApp.ListPreset.DISC_CIRCLE_SQUARE);
  },

  text_: function(slide, text, left, top, width, height, size, color, bold) {
    const shape = slide.insertTextBox(text, left, top, width, height);
    const style = shape.getText().getTextStyle();
    style.setFontSize(size).setForegroundColor(color).setBold(!!bold);
    return shape;
  },

  file_: function(session, deckId) {
    try {
      const match = String(session.folderUrl || '').match(/folders\/([a-zA-Z0-9_-]+)/);
      if (!match) return;
      const folder = DriveApp.getFolderById(match[1]);
      const finals = folder.getFoldersByName('04_Final');
      const target = finals.hasNext() ? finals.next() : folder;
      DriveApp.getFileById(deckId).moveTo(target);
    } catch (e) {
      console.error('Could not file the poster deck; it stays in My Drive.', e);
    }
  }
};
