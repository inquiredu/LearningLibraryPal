/**
 * SitesService
 * Generates embed-ready HTML snippets for Google Sites from a session's content.
 * Output: a Google Doc in 04_Final with labelled code blocks to copy-paste.
 *
 * Google Sites embed approach: Insert → Embed → paste HTML per section.
 * Each section is self-contained with inline CSS (no shared stylesheets needed).
 */

const SitesService = {

  // ─── Public ────────────────────────────────────────────────────────────────

  /**
   * Generates site embed code for a session and saves it as a Google Doc.
   * @param {string} sessionId
   * @returns {{ docUrl: string }}
   */
  generateSiteCode: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);

    const resources = SynthesisService.getResources(sessionId);
    const gems = session.gems || [];

    // Compute the library URL for this session
    const baseUrl = typeof _getWebAppUrl === 'function' ? _getWebAppUrl() : '';
    const libraryUrl = baseUrl
      ? baseUrl + '?page=library&session=' + sessionId
      : (session.libraryUrl || '');

    // Locate 04_Final folder
    const finalFolderId = this._getFinalFolderId(session.folderUrl);

    // Build sections
    const sections = [
      { label: 'HERO BANNER',                    html: this._buildHeroSection(session) },
      { label: 'SESSION OVERVIEW',               html: this._buildOverviewSection(session) },
      { label: 'INQUIRY QUESTIONS',              html: this._buildQuestionsSection(session) },
      { label: 'RESOURCES',                      html: this._buildResourcesSection(resources) },
      { label: 'AI LEARNING GEMS',               html: this._buildGemsSection(gems, libraryUrl) },
      { label: 'LEARNING LIBRARY (FULL PAGE)',   html: this._buildLibraryEmbedSection(libraryUrl), embedUrl: libraryUrl }
    ].filter(s => s.html); // skip empty sections

    const docUrl = this._saveAsDoc(finalFolderId, 'SITES: ' + session.name, session, sections);
    return { docUrl: docUrl };
  },

  // ─── Section Builders ──────────────────────────────────────────────────────

  _buildHeroSection: function(session) {
    const brief = session.brief || {};
    const tagline = (brief.overview || '').substring(0, 160).replace(/"/g, '&quot;');
    const date = session.date ? String(session.date).substring(0, 10) : '';
    const meta = [session.theme, date, session.format].filter(Boolean).join(' · ');
    return `<div style="background:#0B2B46;padding:48px 32px 40px;text-align:center;font-family:Arial,Helvetica,sans-serif;border-radius:0;">
  <p style="color:#5DCDF5;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;margin:0 0 14px;">Learning Library Learning Community</p>
  <h1 style="color:#FFFFFF;font-size:30px;font-weight:800;line-height:1.2;margin:0 0 10px;">${this._esc(session.name)}</h1>
  ${meta ? `<p style="color:rgba(255,255,255,0.65);font-size:14px;margin:0 0 18px;">${this._esc(meta)}</p>` : ''}
  ${tagline ? `<p style="color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7;max-width:600px;margin:0 auto;">${this._esc(tagline)}</p>` : ''}
</div>`;
  },

  _buildOverviewSection: function(session) {
    const brief = session.brief || {};
    if (!brief.overview && !(brief.learningObjectives && brief.learningObjectives.length)) return null;

    const objectives = (brief.learningObjectives || [])
      .map(obj => `  <li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
    <span style="display:inline-block;width:8px;height:8px;background:#5DCDF5;border-radius:50%;margin-top:8px;flex-shrink:0;"></span>
    <span>${this._esc(obj)}</span>
  </li>`)
      .join('\n');

    return `<div style="font-family:Arial,Helvetica,sans-serif;padding:32px;background:#FFFFFF;border-radius:8px;">
  <h2 style="font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7F8FA4;margin:0 0 16px;">Session Overview</h2>
  ${brief.overview ? `<p style="font-size:15px;line-height:1.8;color:#2C3E50;margin:0 0 20px;">${this._esc(brief.overview)}</p>` : ''}
  ${objectives ? `<h3 style="font-size:13px;font-weight:700;color:#0B2B46;margin:0 0 12px;">Learning Objectives</h3>
  <ul style="list-style:none;padding:0;margin:0;">${objectives}</ul>` : ''}
</div>`;
  },

  _buildQuestionsSection: function(session) {
    const brief = session.brief || {};
    const questions = brief.inquiryQuestions || [];
    if (!questions.length) return null;

    const cards = questions.map(q => `  <div style="background:#F0F4F8;border-left:4px solid #5DCDF5;border-radius:0 8px 8px 0;padding:16px 18px;margin-bottom:12px;">
    <p style="font-size:15px;font-weight:600;color:#0B2B46;margin:0;line-height:1.5;">${this._esc(q)}</p>
  </div>`).join('\n');

    return `<div style="font-family:Arial,Helvetica,sans-serif;padding:32px;background:#FFFFFF;border-radius:8px;">
  <h2 style="font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7F8FA4;margin:0 0 16px;">Come Ready to Think About</h2>
${cards}
</div>`;
  },

  _buildResourcesSection: function(resources) {
    if (!resources || !resources.length) return null;

    const items = resources.map(r => {
      const embed = this._buildResourceEmbed(r);
      const engBadgeColor = r.engagementLevel === 'Deep Dive' ? '#004085' :
                            r.engagementLevel === 'Mid-Level'  ? '#856404' : '#155724';
      const engBadgeBg   = r.engagementLevel === 'Deep Dive' ? '#CCE5FF' :
                           r.engagementLevel === 'Mid-Level'  ? '#FFF3CD' : '#D4EDDA';
      const badge = r.engagementLevel
        ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${engBadgeBg};color:${engBadgeColor};margin-left:8px;">${this._esc(r.engagementLevel)}</span>`
        : '';

      if (embed) {
        return `  <div style="margin-bottom:28px;">
    <p style="font-size:14px;font-weight:700;color:#0B2B46;margin:0 0 6px;">
      <a href="${this._esc(r.url)}" target="_blank" style="color:#0B2B46;text-decoration:none;">${this._esc(r.title)}</a>${badge}
    </p>
    ${r.relevanceStatement ? `<p style="font-size:13px;color:#555;margin:0 0 10px;line-height:1.5;">${this._esc(r.relevanceStatement)}</p>` : ''}
    ${embed}
  </div>`;
      } else {
        return `  <div style="background:#F0F4F8;border:1px solid #DDE4ED;border-radius:8px;padding:16px 18px;margin-bottom:12px;">
    <p style="font-size:14px;font-weight:700;color:#0B2B46;margin:0 0 6px;">
      <a href="${this._esc(r.url)}" target="_blank" style="color:#0B2B46;text-decoration:none;">📄 ${this._esc(r.title)}</a>${badge}
    </p>
    ${r.relevanceStatement ? `<p style="font-size:13px;color:#555;margin:0;line-height:1.5;">${this._esc(r.relevanceStatement)}</p>` : ''}
  </div>`;
      }
    }).join('\n');

    return `<div style="font-family:Arial,Helvetica,sans-serif;padding:32px;background:#FFFFFF;border-radius:8px;">
  <h2 style="font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7F8FA4;margin:0 0 20px;">Session Resources</h2>
${items}
</div>`;
  },

  _buildGemsSection: function(gems, libraryUrl) {
    if (!gems || !gems.length) return null;

    const cards = gems.map(gem => {
      const linkBtn = gem.link
        ? `<a href="${this._esc(gem.link)}" target="_blank" style="display:inline-block;background:#5DCDF5;color:#0B2B46;padding:8px 16px;border-radius:5px;font-size:13px;font-weight:700;text-decoration:none;margin-top:10px;">Open Gem →</a>`
        : `<p style="font-size:12px;color:#7F8FA4;margin:10px 0 0;font-style:italic;">Link coming soon — check the Learning Library.</p>`;
      return `  <div style="background:#F0F4F8;border:1px solid #DDE4ED;border-radius:10px;padding:20px;margin-bottom:14px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <span style="font-size:1.5rem;">${gem.emoji || '💎'}</span>
      <div>
        <p style="font-size:15px;font-weight:700;color:#0B2B46;margin:0;">${this._esc(gem.name || gem.id)}</p>
        <p style="font-size:12px;color:#7F8FA4;margin:2px 0 0;">${this._esc(gem.role || '')}</p>
      </div>
    </div>
    ${gem.persona ? `<p style="font-size:13px;color:#555;line-height:1.6;font-style:italic;margin:0;">${this._esc(gem.persona)}</p>` : ''}
    ${linkBtn}
  </div>`;
    }).join('\n');

    const libraryNote = libraryUrl
      ? `<p style="font-size:13px;color:#7F8FA4;margin:16px 0 0;">Full instructions and conversation starters are available in the <a href="${this._esc(libraryUrl)}" target="_blank" style="color:#0B2B46;font-weight:700;">Learning Library</a>.</p>`
      : '';

    return `<div style="font-family:Arial,Helvetica,sans-serif;padding:32px;background:#FFFFFF;border-radius:8px;">
  <h2 style="font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7F8FA4;margin:0 0 8px;">AI Learning Gems</h2>
  <p style="font-size:13px;color:#7F8FA4;margin:0 0 20px;">Custom AI guides built for this session. Click to open and start exploring.</p>
${cards}${libraryNote}
</div>`;
  },

  /**
   * Returns an iframe embed for the full Learning Library page.
   * Also used as the "embedUrl" fallback — Google Sites can embed it directly by URL.
   */
  _buildLibraryEmbedSection: function(libraryUrl) {
    if (!libraryUrl) return null;
    return `<iframe src="${this._esc(libraryUrl)}" width="100%" height="900" frameborder="0" style="border:none;display:block;" allow="fullscreen"></iframe>`;
  },

  // ─── Embed Builders ────────────────────────────────────────────────────────

  /**
   * Returns an iframe HTML string for embeddable resource types, or null for plain links.
   */
  _buildResourceEmbed: function(resource) {
    const url = resource.url || '';
    const type = this._detectEmbedType(url);

    if (type === 'slides') {
      const id = this._extractDriveFileId(url);
      if (!id) return null;
      return `<iframe src="https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false&delayms=3000" width="100%" height="420" frameborder="0" allowfullscreen style="border-radius:8px;display:block;"></iframe>`;
    }

    if (type === 'youtube') {
      const vid = this._extractYouTubeId(url);
      if (!vid) return null;
      return `<iframe src="https://www.youtube.com/embed/${vid}" width="100%" height="420" frameborder="0" allowfullscreen style="border-radius:8px;display:block;"></iframe>`;
    }

    if (type === 'drive') {
      const id = this._extractDriveFileId(url);
      if (!id) return null;
      return `<iframe src="https://drive.google.com/file/d/${id}/preview" width="100%" height="420" frameborder="0" allow="autoplay" style="border-radius:8px;display:block;"></iframe>`;
    }

    if (type === 'doc') {
      const id = this._extractDriveFileId(url);
      if (!id) return null;
      return `<iframe src="https://docs.google.com/document/d/${id}/pub?embedded=true" width="100%" height="420" frameborder="0" style="border-radius:8px;border:1px solid #DDE4ED;display:block;"></iframe>`;
    }

    return null; // 'web' type or unrecognized — plain card
  },

  _detectEmbedType: function(url) {
    if (!url) return 'web';
    if (/docs\.google\.com\/presentation\/d\//i.test(url)) return 'slides';
    if (/docs\.google\.com\/document\/d\//i.test(url))     return 'doc';
    if (/drive\.google\.com\/file\/d\//i.test(url))        return 'drive';
    if (/drive\.google\.com\/open\?id=/i.test(url))        return 'drive';
    if (/youtube\.com\/watch\?/i.test(url))                return 'youtube';
    if (/youtu\.be\//i.test(url))                          return 'youtube';
    return 'web';
  },

  _extractYouTubeId: function(url) {
    var m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  },

  _extractDriveFileId: function(url) {
    var m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]{25,})/);
    if (m) return m[1];
    m = String(url || '').match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
    if (m) return m[1];
    m = String(url || '').match(/\/folders\/([a-zA-Z0-9_-]{25,})/);
    if (m) return m[1];
    // Fallback: any 25+ char alphanumeric segment
    m = String(url || '').match(/[-\w]{25,}/);
    return m ? m[0] : null;
  },

  // ─── Doc Output ────────────────────────────────────────────────────────────

  /**
   * Navigates to the 04_Final subfolder of a session's Drive folder.
   * @param {string} sessionFolderUrl - The session's top-level Drive folder URL
   * @returns {string} The folder ID of 04_Final
   */
  _getFinalFolderId: function(sessionFolderUrl) {
    var folderId = this._extractDriveFileId(sessionFolderUrl);
    if (!folderId) throw new Error('Could not determine session folder ID.');
    var sessionFolder = DriveApp.getFolderById(folderId);
    var finalIter = sessionFolder.getFoldersByName('04_Final');
    if (!finalIter.hasNext()) throw new Error('04_Final folder not found. Create a session first.');
    return finalIter.next().getId();
  },

  /**
   * Creates a Google Doc with labelled code blocks for each section.
   * Returns the doc URL.
   */
  _saveAsDoc: function(folderId, title, session, sections) {
    const doc = DocumentApp.create(title);
    const body = doc.getBody();
    body.clear();

    // Move to the correct folder
    const file = DriveApp.getFileById(doc.getId());
    DriveApp.getRootFolder().removeFile(file);
    DriveApp.getFolderById(folderId).addFile(file);

    // Title
    body.appendParagraph('Learning Library Site Code — ' + (session.name || ''))
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('Generated: ' + new Date().toLocaleDateString())
      .setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

    // Instructions
    body.appendParagraph('HOW TO USE').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(
      '1. In Google Sites, navigate to the page where you want to add content.\n' +
      '2. Click Insert → Embed in the section toolbar.\n' +
      '3. Copy the HTML code block for that section (everything between the dashes).\n' +
      '4. Paste it into the Embed dialog and click Insert.\n' +
      '5. Repeat for each section. Publish the page when done.\n\n' +
      'TIP: Add each section as a separate embed block. ' +
      'Slides and videos will render inline. Web links appear as styled cards.'
    );

    const total = sections.length;
    sections.forEach(function(section, i) {
      body.appendHorizontalRule();
      body.appendParagraph('SECTION ' + (i + 1) + ' OF ' + total + ': ' + section.label)
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);

      if (section.embedUrl) {
        // URL-embed sections (e.g. the Library page): offer both quick URL paste and iframe code
        body.appendParagraph(
          '► OPTION A — Easiest: In Google Sites, click Insert → Embed → then the "URL" tab.\n' +
          '   Paste this URL and click Insert:'
        );
        body.appendParagraph(section.embedUrl)
          .setAttributes({ [DocumentApp.Attribute.FONT_FAMILY]: 'Courier New', [DocumentApp.Attribute.FONT_SIZE]: 10 });
        body.appendParagraph(
          '► OPTION B — Custom iframe height: Copy the code below and use Insert → Embed → "Embed code" tab:'
        );
      } else {
        body.appendParagraph('Copy everything between the lines below and paste into Sites → Insert → Embed → "Embed code" tab:');
      }

      body.appendParagraph('─────────────────────────────────────────────────────────────────');
      body.appendParagraph(section.html)
        .setAttributes({ [DocumentApp.Attribute.FONT_FAMILY]: 'Courier New', [DocumentApp.Attribute.FONT_SIZE]: 9 });
      body.appendParagraph('─────────────────────────────────────────────────────────────────');
    });

    doc.saveAndClose();
    return doc.getUrl();
  },

  // ─── Utilities ─────────────────────────────────────────────────────────────

  _esc: function(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

};
