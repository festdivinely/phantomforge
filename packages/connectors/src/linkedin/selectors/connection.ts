import { byCss, byRole, byTestId, selector } from '../../base/selector.js';

/**
 * LinkedIn selectors, ordered most-durable-first.
 *
 * Rule for this file: accessibility roles and stable data attributes come
 * before CSS class names, because class names are generated and change without
 * notice. When a low-ranked strategy starts winning in telemetry, that is the
 * early warning that LinkedIn shipped a redesign - fix it before runs fail.
 */

// Seen on the real site (study run 2026-11-01): Connect is labelled
// "Invite <name> to connect" - a link on search results and profiles, a
// button on My Network. Never just "Connect".
export const connectButton = selector('connect-button', [
  byRole('link-invite-to-connect', 'link', { name: /^invite .+ to connect$/i }),
  byRole('button-invite-to-connect', 'button', { name: /^invite .+ to connect$/i }),
  byCss('aria-label-invite-connect', '[aria-label^="Invite" i][aria-label$="to connect" i]'),
  byTestId('data-testid-connect', 'connect-button'),
]);

export const addNoteButton = selector('add-note-button', [
  byRole('aria-add-note', 'button', { name: /add a note/i }),
  byCss('aria-label-add-note', 'button[aria-label*="Add a note" i]'),
]);

export const noteTextarea = selector('note-textarea', [
  byCss('id-custom-message', 'textarea#custom-message'),
  byRole('role-textbox', 'textbox', { name: /message/i }),
]);

export const sendInviteButton = selector('send-invite-button', [
  byRole('aria-send', 'button', { name: /^send(\s+(invitation|now))?$/i }),
  byCss('aria-label-send', 'button[aria-label*="Send" i]'),
]);

/**
 * The owner's rule: send without a note unless LinkedIn insists on one.
 * Not yet seen on the real site (nothing was clicked in the study) - the
 * first real send captures the dialog so these get confirmed.
 */
export const sendWithoutNoteButton = selector('send-without-note-button', [
  byRole('aria-send-without-note', 'button', { name: /send without a note/i }),
  byCss('aria-label-send-without-note', 'button[aria-label*="without a note" i]'),
]);

/** LinkedIn sometimes asks for the person's email to prove you know them. */
export const inviteEmailField = selector('invite-email-field', [
  byRole('role-email', 'textbox', { name: /email/i }),
  byCss('type-email', 'input[type="email"], input[name*="email" i]'),
]);

export const dialogDismissButton = selector('dialog-dismiss-button', [
  byRole('aria-dismiss', 'button', { name: /^(dismiss|close|cancel)\b/i }),
  byCss('aria-label-dismiss', 'button[aria-label*="Dismiss" i], button[aria-label*="Close" i]'),
]);

// On the invitation manager the accessible name is the full aria-label -
// seen on the real site as "Accept invitation for <name>" - so match the
// start, not the whole name.
// Every strategy is tied to an invitation, so no fallback can ever click some
// other "Accept" on the page (a cookie banner, a terms dialog).
export const acceptInviteButton = selector('accept-invite-button', [
  byRole('aria-accept-invitation', 'button', { name: /^accept\b.*invitation/i }),
  byCss('aria-label-accept-invitation', 'button[aria-label^="Accept" i][aria-label*="invitation" i]'),
  byCss('invitation-card-accept', '[class*="invitation-card"] button:has-text("Accept")'),
]);

/** The invitation manager's "nothing here" state, so empty is not mistaken for a broken page. */
export const noInvitationsMessage = selector('no-invitations-message', [
  {
    name: 'text-no-invitations',
    // Seen: "No sent invitations"; also covers "No pending invitations".
    locate: (scope) => scope.getByText(/^no\b.*invitations$/i),
  },
]);

export const ignoreInviteButton = selector('ignore-invite-button', [
  // Seen: "Ignore invitation for <name>".
  byRole('aria-ignore', 'button', { name: /^ignore\b.*invitation/i }),
  byCss('aria-label-ignore', 'button[aria-label*="Ignore" i]'),
]);

export const globalNav = selector('global-nav', [
  byCss('id-global-nav', '#global-nav'),
  byRole('role-navigation', 'navigation', { name: /primary/i }),
]);
