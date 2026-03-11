/**
 * Config.js
 * Central configuration for this deployment.
 *
 * SETUP INSTRUCTIONS (for new adopters):
 *  1. Set ALLOWED_DOMAIN to your Google Workspace domain (e.g. 'school.org').
 *     Users whose Google account email ends with @ALLOWED_DOMAIN can access the
 *     dashboard and wizard. The Learning Library page is always public.
 *
 *  2. Set ALLOWED_DOMAIN to '' to allow ANY signed-in Google account to access
 *     the dashboard (useful for personal/Gmail deployments).
 *
 *  3. Set APP_NAME to whatever name you want shown in the browser title and
 *     authorization error page.
 *
 *  4. After editing, do `clasp push` then create a new deployment version in the
 *     GAS Editor (Deploy → Manage deployments → Edit → New version → Deploy).
 *     In the deploy dialog, set "Who has access" to "Anyone" so that public
 *     Library links work without requiring a Google sign-in.
 */

const CONFIG = {

  // ── Access control ────────────────────────────────────────────────────────

  /**
   * Google Workspace domain allowed to access protected routes (dashboard, wizard).
   * Example: 'ai4mn.org'  →  only foo@ai4mn.org accounts are allowed.
   * Set to '' to allow any authenticated Google account (Gmail included).
   */
  ALLOWED_DOMAIN: 'ai4mn.org',

  /**
   * Specific email addresses allowed access regardless of domain.
   * Useful for testing with a personal Gmail, or granting access to
   * external collaborators who don't have an @ai4mn.org account.
   * Example: ['you@gmail.com', 'partner@otherdomain.org']
   */
  ALLOWED_EMAILS: [],

  /**
   * Public routes that skip domain authentication entirely.
   * The 'library' page is always public so shared session links work for anyone.
   */
  PUBLIC_PAGES: ['library'],

  // ── Display timezone ──────────────────────────────────────────────────────

  /**
   * IANA timezone name used to display all session times consistently.
   * Times in the Learning Library and input modals are always shown in this
   * timezone, regardless of the viewer's local timezone — important for
   * public Library links shared with attendees in different locations.
   * Example: 'America/Chicago' (Central), 'America/New_York' (Eastern),
   *          'America/Los_Angeles' (Pacific), 'America/Denver' (Mountain)
   */
  DISPLAY_TIMEZONE: 'America/Chicago',

  /** Short label shown after formatted times, e.g. "9:00 AM CT" */
  TIMEZONE_LABEL: 'CT',

  // ── App identity ──────────────────────────────────────────────────────────

  APP_NAME: 'MNGAIA Content Engine',

};
