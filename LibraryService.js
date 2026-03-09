/**
 * LibraryService
 * Phase 4: Assembles the complete learning library data payload for a session.
 * This is what the LibraryPage.html client fetches and renders.
 */

const LibraryService = {

  /**
   * Builds the full library data object for a session.
   * Aggregates: session metadata, brief, resources, gems.
   * @param {string} sessionId
   * @returns {Object} Complete library payload
   */
  buildLibraryData: function(sessionId) {
    const session = SessionService.getSession(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);

    const resources = SynthesisService.getResources(sessionId);
    const gems = GemsService.getGems(sessionId);
    const brief = session.brief || {};

    // Top 3 pre-reading picks
    const preReading = resources
      .filter(r => r.preReading)
      .slice(0, 3);

    // NotebookLM-ready resources
    const notebookLMResources = resources
      .filter(r => r.notebookLMReady)
      .slice(0, 6);

    // Pre-session checklist
    const checklist = this._buildChecklist(brief, preReading, gems, session.date);

    return {
      meta: {
        sessionId: session.id,
        name: session.name,
        theme: session.theme,
        date: session.date,
        format: session.format,
        audience: session.audience,
        folderUrl: session.folderUrl,
        dbUrl: session.dbUrl,
        generatedAt: new Date().toISOString()
      },
      brief: {
        overview: brief.overview || '',
        learningObjectives: brief.learningObjectives || [],
        inquiryQuestions: brief.inquiryQuestions || [],
        notebookLMStarterPrompt: brief.notebookLMStarterPrompt || ''
      },
      resources: resources,
      preReading: preReading,
      gems: gems,
      notebookLM: {
        resources: notebookLMResources,
        starterPrompt: brief.notebookLMStarterPrompt || '',
        guide: this._buildNotebookLMGuide(notebookLMResources, session.theme)
      },
      checklist: checklist
    };
  },

  // ─── Private ────────────────────────────────────────────────────────────────

  _buildChecklist: function(brief, preReading, gems, sessionDate) {
    const items = [
      {
        id: 'read-overview',
        label: 'Read the session overview',
        detail: 'Understand the theme and why it matters',
        done: false
      },
      {
        id: 'read-objectives',
        label: 'Review the learning objectives',
        detail: 'Know what you\'ll explore and take away',
        done: false
      }
    ];

    if (preReading.length > 0) {
      items.push({
        id: 'pre-reading',
        label: 'Complete pre-reading (' + preReading.length + ' resource' + (preReading.length > 1 ? 's' : '') + ')',
        detail: preReading.map(r => r.title).join(', '),
        done: false
      });
    }

    items.push({
      id: 'reflection-questions',
      label: 'Sit with 1-2 inquiry questions',
      detail: brief.inquiryQuestions && brief.inquiryQuestions[0]
        ? '"' + brief.inquiryQuestions[0] + '"'
        : 'See Inquiry Questions section below',
      done: false
    });

    if (gems.length > 0) {
      items.push({
        id: 'use-gem',
        label: 'Explore the Deep Researcher Gem',
        detail: 'Use the prompt in the Gems Workshop to go deeper before the session',
        done: false
      });
    }

    items.push({
      id: 'notebooklm',
      label: 'Set up NotebookLM (optional but powerful)',
      detail: 'Upload pre-reading resources and use the starter prompt',
      done: false
    });

    return items;
  },

  _buildNotebookLMGuide: function(resources, theme) {
    if (!resources.length) {
      return 'No resources have been flagged as NotebookLM-ready yet. Run Synthesis first.';
    }
    const resourceList = resources.map((r, i) => (i + 1) + '. ' + r.title).join('\n');
    return 'To use NotebookLM for "' + theme + '":\n\n' +
      '1. Go to notebooklm.google.com and create a new notebook\n' +
      '2. Upload or add links to these resources:\n' + resourceList + '\n\n' +
      '3. Once indexed, paste the starter prompt below into the chat to begin';
  }

};
