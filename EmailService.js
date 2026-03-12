/**
 * EmailService
 * Phase 5: Drafts and sends pre-session engagement emails.
 * Uses Gemini to draft, then sends via GmailApp.
 */

const EmailService = {

  /**
   * Drafts a pre-session email using Gemini and sends it to the recipient list.
   * @param {string} sessionId
   * @param {string[]} recipients - Array of email addresses
   * @returns {{ subject, recipientCount }}
   */
  draftAndSend: function(sessionId, recipients) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    if (!session.brief) throw new Error('No session brief. Complete the Wizard first.');

    // Get library URL for this session
    const libraryUrl = session.libraryUrl || this._buildLibraryUrl(sessionId);

    // Get top pre-reading resources — exclude Internal resources (Planning Doc, Context, etc.)
    const allResources = SynthesisService.getResources(sessionId);
    const publicResources = allResources.filter(r => r.isPublic !== false);
    const preReadingResources = publicResources
      .filter(r => r.preReading)
      .slice(0, 3)
      .map(r => ({ url: r.url, title: r.title, relevanceStatement: r.relevanceStatement }));

    // If no pre-reading flagged yet, take top 3 public resources by score
    const resources = preReadingResources.length > 0
      ? preReadingResources
      : publicResources.slice(0, 3).map(r => ({ url: r.url, title: r.title, relevanceStatement: r.relevanceStatement }));

    // Draft with Gemini
    const draft = GeminiService.draftPreSessionEmail(
      session.brief,
      resources,
      session.date,
      libraryUrl
    );

    const subject = draft.subject || 'Getting Ready for Our Next Session';
    const htmlBody = this._wrapInEmailTemplate(draft.body || '', session, libraryUrl);

    // Send to all recipients
    recipients.forEach(email => {
      GmailApp.sendEmail(email, subject, '', { htmlBody: htmlBody });
    });

    // Mark email as sent in session row
    SessionService.updateSession(sessionId, {
      EMAIL_SENT: 'Yes — ' + new Date().toLocaleDateString()
    });

    return { subject, recipientCount: recipients.length };
  },

  /**
   * Returns just the draft (subject + body) without sending.
   * Used by the web app for the human-review preview modal.
   */
  getDraft: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session || !session.brief) return null;

    const libraryUrl = session.libraryUrl || this._buildLibraryUrl(sessionId);
    const allResources = SynthesisService.getResources(sessionId);
    const publicResources = allResources.filter(r => r.isPublic !== false);
    const resources = publicResources
      .filter(r => r.preReading)
      .slice(0, 3)
      .map(r => ({ url: r.url, title: r.title, relevanceStatement: r.relevanceStatement }));

    return GeminiService.draftPreSessionEmail(
      session.brief,
      resources.length > 0 ? resources : publicResources.slice(0, 3).map(r => ({
        url: r.url, title: r.title, relevanceStatement: r.relevanceStatement
      })),
      session.date,
      libraryUrl
    );
  },

  /**
   * Returns structured newsletter draft data for the email wizard.
   * Includes AI-generated sections + session metadata + resources for client-side rendering.
   * @param {string} sessionId
   * @returns {{ subject, heroLine, intro, highlights, preReadingNote, sessionName, sessionDate, sessionFormat, sessionAudience, libraryUrl, hasGems, resources }}
   */
  getNewsletterDraft: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session || !session.brief) return null;

    const libraryUrl = session.libraryUrl || this._buildLibraryUrl(sessionId);
    const allResources = SynthesisService.getResources(sessionId);
    const publicResources = allResources.filter(r => r.isPublic !== false);
    const preReading = publicResources.filter(r => r.preReading).slice(0, 3);
    const topResources = preReading.length > 0 ? preReading : publicResources.slice(0, 3);

    const resourcesForGemini = topResources.map(r => ({
      url: r.url || '',
      title: r.title || r.name || 'Resource',
      relevanceStatement: r.relevanceStatement || ''
    }));

    // Find the main meeting link (isMain first, then first meeting-type resource)
    const meetings = allResources.filter(r => {
      if ((r.type || '').toLowerCase() === 'meeting link') return true;
      const u = (r.url || '').toLowerCase();
      return u.includes('meet.google.com') || u.includes('zoom.us') || u.includes('teams.microsoft.com');
    });
    meetings.sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0));
    const mainMeeting = meetings[0] || null;

    const sections = GeminiService.draftNewsletterSections(
      session.brief,
      resourcesForGemini,
      session.date,
      libraryUrl
    );

    return Object.assign({}, sections, {
      sessionName:     session.name,
      sessionDate:     session.date,
      sessionFormat:   session.format,
      sessionAudience: session.audience,
      libraryUrl:      libraryUrl,
      hasGems:         !!(session.gems && session.gems.length),
      resources:       resourcesForGemini,
      mainMeetingUrl:  mainMeeting ? (mainMeeting.url  || '') : '',
      mainMeetingName: mainMeeting ? (mainMeeting.title || 'Join the Session') : ''
    });
  },

  /**
   * Sends a pre-assembled full HTML email directly — no template wrapping.
   * Used by the newsletter wizard which builds its own template client-side.
   * @param {string} sessionId
   * @param {string[]} recipients
   * @param {string} subject
   * @param {string} fullHtml - Complete DOCTYPE HTML string
   */
  sendRawEmail: function(sessionId, recipients, subject, fullHtml) {
    recipients.forEach(email => {
      GmailApp.sendEmail(email, subject, '', { htmlBody: fullHtml });
    });
    SessionService.updateSession(sessionId, {
      EMAIL_SENT: 'Yes — ' + new Date().toLocaleDateString()
    });
    return { success: true, recipientCount: recipients.length };
  },

  /**
   * Sends a pre-approved draft directly (called from web app after review).
   * Applies the branded email template around the body content before sending.
   */
  sendApprovedDraft: function(sessionId, recipients, subject, bodyContent) {
    const session = SessionService.getSession(sessionId);
    const libraryUrl = session ? (session.libraryUrl || this._buildLibraryUrl(sessionId)) : '';
    const htmlBody = this._wrapInEmailTemplate(bodyContent, session || {}, libraryUrl);
    recipients.forEach(email => {
      GmailApp.sendEmail(email, subject, '', { htmlBody: htmlBody });
    });
    SessionService.updateSession(sessionId, {
      EMAIL_SENT: 'Yes — ' + new Date().toLocaleDateString()
    });
    return { success: true, recipientCount: recipients.length };
  },

  // ─── Private ────────────────────────────────────────────────────────────────

  _buildLibraryUrl: function(sessionId) {
    try {
      const base = ScriptApp.getService().getUrl();
      return base ? base + '?page=library&session=' + sessionId : '';
    } catch (e) {
      return '';
    }
  },

  _wrapInEmailTemplate: function(body, session, libraryUrl) {
    const brandColor = '#0B2B46';
    const accentColor = '#5DCDF5';
    const libraryLink = libraryUrl
      ? `<p style="text-align:center;margin:24px 0;">
           <a href="${libraryUrl}" style="background:${accentColor};color:${brandColor};padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
             Open Learning Library →
           </a>
         </p>`
      : '';

    return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:'Open Sans',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;margin-top:24px;">
    <!-- Header -->
    <div style="background:${brandColor};padding:28px 32px;">
      <p style="color:${accentColor};font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 6px;">MNGAIA Learning Community</p>
      <h1 style="color:#ffffff;font-size:22px;margin:0;">${session.name || 'Upcoming Session'}</h1>
    </div>
    <!-- Body -->
    <div style="padding:32px;color:#2d2d2d;font-size:15px;line-height:1.7;">
      ${body}
      ${libraryLink}
    </div>
    <!-- Footer -->
    <div style="background:#f5f7fa;padding:20px 32px;border-top:1px solid #e0e6ed;">
      <p style="color:#8a9bae;font-size:12px;margin:0;">
        MNGAIA Learning Community &nbsp;·&nbsp; ${session.date || ''}
      </p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

};
