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
   * Public routes that skip domain authentication entirely.
   * The 'library' page is always public so shared session links work for anyone.
   */
  PUBLIC_PAGES: ['library'],

  // ── App identity ──────────────────────────────────────────────────────────

  APP_NAME: 'MNGAIA Content Engine',

};
