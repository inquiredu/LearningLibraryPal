/**
 * PageBuilderService
 * Converts a visual block configuration array into a Google Sites–ready HTML document.
 *
 * Block types:
 *   Auto-populated (use session data): hero, overview, questions, resources, gems, library-embed
 *   Custom (user-edited):              text, image-text, card-grid, cta, divider
 *
 * Reuses SitesService's section builders, _saveAsDoc, _getFinalFolderId, and _esc.
 */

const PageBuilderService = {

  /**
   * Generates HTML for all blocks and saves the result as a Google Doc in 04_Final.
   * @param {string} sessionId
   * @param {Object[]} blocks - [{ id, type, config }]
   * @returns {{ docUrl: string, blockCount: number }}
   */
  generateFromBlocks: function(sessionId, blocks) {
    if (!blocks || !blocks.length) throw new Error('No blocks on canvas. Add at least one block before generating.');

    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);

    const resources = SynthesisService.getResources(sessionId);
    const sections  = [];
    const self = this;

    blocks.forEach(function(block) {
      try {
        var html = self._renderBlock(block, session, resources);
        if (html) {
          var sec = { label: self._blockLabel(block.type), html: html };
          // Library embed: also expose the URL so _saveAsDoc can offer the "URL" option
          if (block.type === 'library-embed') sec.embedUrl = session.libraryUrl || '';
          sections.push(sec);
        }
      } catch (e) {
        console.error('PageBuilderService: error rendering block "' + block.type + '": ' + e.message);
      }
    });

    if (!sections.length) throw new Error('No renderable blocks found. Check that custom blocks have content.');

    const finalFolderId = SitesService._getFinalFolderId(session.folderUrl);
    const docUrl = SitesService._saveAsDoc(finalFolderId, 'PAGE DESIGN: ' + session.name, session, sections);
    return { docUrl: docUrl, blockCount: sections.length };
  },

  // ─── Router ────────────────────────────────────────────────────────────────

  _blockLabel: function(type) {
    var labels = {
      'hero':          'HERO BANNER',
      'overview':      'SESSION OVERVIEW',
      'questions':     'INQUIRY QUESTIONS',
      'resources':     'RESOURCES',
      'gems':          'AI LEARNING GEMS',
      'library-embed': 'LEARNING LIBRARY (FULL PAGE)',
      'text':          'TEXT BLOCK',
      'image-text':    'IMAGE + TEXT',
      'card-grid':     'CARD GRID',
      'cta':           'CTA BUTTON',
      'divider':       'DIVIDER'
    };
    return labels[type] || type.toUpperCase();
  },

  _renderBlock: function(block, session, resources) {
    const cfg = block.config || {};
    switch (block.type) {
      case 'hero':          return this._renderHero(cfg, session);
      case 'overview':      return SitesService._buildOverviewSection(session);
      case 'questions':     return SitesService._buildQuestionsSection(session);
      case 'resources':     return SitesService._buildResourcesSection(resources);
      case 'gems':          return SitesService._buildGemsSection(session.gems || [], session.libraryUrl || '');
      case 'library-embed': return SitesService._buildLibraryEmbedSection(session.libraryUrl || '');
      case 'text':          return this._renderText(cfg);
      case 'image-text':    return this._renderImageText(cfg);
      case 'card-grid':     return this._renderCardGrid(cfg);
      case 'cta':           return this._renderCta(cfg);
      case 'divider':       return '<hr style="border:none;border-top:2px solid #e0e6ed;margin:32px 0;">';
      default:              return null;
    }
  },

  // ─── Custom Block Renderers ─────────────────────────────────────────────────

  /**
   * Hero block with user-editable title, subtitle, background colour, and optional image.
   */
  _renderHero: function(cfg, session) {
    const title    = SitesService._esc(cfg.title    || session.name  || '');
    const subtitle = SitesService._esc(cfg.subtitle || session.theme || '');
    const bgColor  = /^#[0-9a-fA-F]{3,6}$/.test(cfg.bgColor || '') ? cfg.bgColor : '#0B2B46';
    const date     = session.date ? String(session.date).substring(0, 10) : '';
    const dateStr  = date ? '<p style="color:rgba(255,255,255,0.55);font-size:13px;margin:10px 0 0;">' + SitesService._esc(date) + '</p>' : '';

    if (cfg.imageUrl) {
      // Full-bleed image with dark overlay
      return '<div style="background:url(' + SitesService._esc(cfg.imageUrl) + ') center/cover no-repeat;padding:64px 32px 56px;text-align:center;font-family:Arial,Helvetica,sans-serif;position:relative;">' +
        '<div style="position:absolute;inset:0;background:' + bgColor + 'CC;"></div>' +
        '<div style="position:relative;z-index:1;">' +
          '<p style="color:#5DCDF5;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;margin:0 0 14px;">MNGAIA Learning Community</p>' +
          '<h1 style="color:#FFFFFF;font-size:32px;font-weight:800;line-height:1.2;margin:0 0 12px;">' + title + '</h1>' +
          (subtitle ? '<p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0;">' + subtitle + '</p>' : '') +
          dateStr +
        '</div>' +
      '</div>';
    }

    return '<div style="background:' + bgColor + ';padding:56px 32px 48px;text-align:center;font-family:Arial,Helvetica,sans-serif;">' +
      '<p style="color:#5DCDF5;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;margin:0 0 14px;">MNGAIA Learning Community</p>' +
      '<h1 style="color:#FFFFFF;font-size:32px;font-weight:800;line-height:1.2;margin:0 0 12px;">' + title + '</h1>' +
      (subtitle ? '<p style="color:rgba(255,255,255,0.8);font-size:16px;margin:0;">' + subtitle + '</p>' : '') +
      dateStr +
    '</div>';
  },

  /**
   * Simple text block with optional heading and body.
   */
  _renderText: function(cfg) {
    if (!cfg.body && !cfg.heading) return null;
    var heading = cfg.heading
      ? '<h2 style="font-size:20px;font-weight:700;color:#0B2B46;margin:0 0 14px;">' + SitesService._esc(cfg.heading) + '</h2>'
      : '';
    var body = cfg.body
      ? '<p style="font-size:15px;line-height:1.8;color:#2C3E50;margin:0;">' + SitesService._esc(cfg.body).replace(/\n/g, '<br>') + '</p>'
      : '';
    return '<div style="font-family:Arial,Helvetica,sans-serif;padding:32px;background:#FFFFFF;border-radius:8px;max-width:760px;margin:0 auto;">' +
      heading + body +
    '</div>';
  },

  /**
   * Two-column image + text block with configurable image side.
   */
  _renderImageText: function(cfg) {
    if (!cfg.imageUrl && !cfg.body && !cfg.heading) return null;
    var isLeft  = cfg.imagePosition !== 'right';
    var heading = cfg.heading
      ? '<h2 style="font-size:20px;font-weight:700;color:#0B2B46;margin:0 0 12px;">' + SitesService._esc(cfg.heading) + '</h2>'
      : '';
    var body = cfg.body
      ? '<p style="font-size:15px;line-height:1.8;color:#2C3E50;margin:0;">' + SitesService._esc(cfg.body).replace(/\n/g, '<br>') + '</p>'
      : '';
    var img = cfg.imageUrl
      ? '<img src="' + SitesService._esc(cfg.imageUrl) + '" alt="" style="width:100%;border-radius:8px;display:block;">'
      : '<div style="width:100%;padding-top:56.25%;background:#E8EDF2;border-radius:8px;"></div>';
    var imageCol = '<div style="flex:1;min-width:200px;">' + img + '</div>';
    var textCol  = '<div style="flex:1.4;min-width:200px;">' + heading + body + '</div>';
    var cols = isLeft ? imageCol + textCol : textCol + imageCol;
    return '<div style="font-family:Arial,Helvetica,sans-serif;padding:32px;background:#FFFFFF;border-radius:8px;">' +
      '<div style="display:flex;gap:28px;align-items:center;flex-wrap:wrap;">' + cols + '</div>' +
    '</div>';
  },

  /**
   * Responsive card grid with optional heading.
   */
  _renderCardGrid: function(cfg) {
    var cards = cfg.cards || [];
    if (!cards.length) return null;
    var heading = cfg.heading
      ? '<h2 style="font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7F8FA4;margin:0 0 20px;">' + SitesService._esc(cfg.heading) + '</h2>'
      : '';
    var cardHtml = cards.map(function(c) {
      return '<div style="background:#F0F4F8;border:1px solid #DDE4ED;border-radius:10px;padding:20px;flex:1;min-width:200px;">' +
        (c.emoji ? '<p style="font-size:1.8rem;margin:0 0 10px;">' + SitesService._esc(c.emoji) + '</p>' : '') +
        (c.title ? '<p style="font-size:15px;font-weight:700;color:#0B2B46;margin:0 0 8px;">' + SitesService._esc(c.title) + '</p>' : '') +
        (c.body  ? '<p style="font-size:13px;color:#555;line-height:1.6;margin:0;">' + SitesService._esc(c.body) + '</p>' : '') +
      '</div>';
    }).join('\n');
    return '<div style="font-family:Arial,Helvetica,sans-serif;padding:32px;background:#FFFFFF;border-radius:8px;">' +
      heading +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;">' + cardHtml + '</div>' +
    '</div>';
  },

  /**
   * Centred CTA button block with optional above-button heading.
   */
  _renderCta: function(cfg) {
    if (!cfg.label) return null;
    var bgColor   = /^#[0-9a-fA-F]{3,6}$/.test(cfg.bgColor || '') ? cfg.bgColor : '#5DCDF5';
    var textColor = (bgColor === '#5DCDF5') ? '#0B2B46' : '#FFFFFF';
    var url       = cfg.url || '#';
    return '<div style="font-family:Arial,Helvetica,sans-serif;padding:32px;text-align:center;background:#FFFFFF;border-radius:8px;">' +
      (cfg.heading ? '<p style="font-size:16px;color:#2C3E50;margin:0 0 18px;">' + SitesService._esc(cfg.heading) + '</p>' : '') +
      '<a href="' + SitesService._esc(url) + '" target="_blank" style="display:inline-block;background:' + bgColor + ';color:' + textColor + ';padding:14px 36px;border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;">' +
        SitesService._esc(cfg.label) +
      '</a>' +
    '</div>';
  }

};
