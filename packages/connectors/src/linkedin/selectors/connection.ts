import { byCss, byRole, byTestId, selector } from '../../base/selector.js';

/**
 * LinkedIn selectors, ordered most-durable-first.
 *
 * Rule for this file: accessibility roles and stable data attributes come
 * before CSS class names, because class names are generated and change without
 * notice. When a low-ranked strategy starts winning in telemetry, that is the
 * early warning that LinkedIn shipped a redesign - fix it before runs fail.
 */

export const connectButton = selector('connect-button', [
  byRole('aria-connect', 'button', { name: /^connect$/i }),
  byTestId('data-testid-connect', 'connect-button'),
  byCss('aria-label-connect', 'button[aria-label*="Invite" i][aria-label*="connect" i]'),
  byCss('class-fallback', '.pvs-profile-actions button:has-text("Connect")'),
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

// On the invitation manager the accessible name is the full aria-label,
// e.g. "Accept Jane Doe's invitation", so match the start, not the whole name.
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
    locate: (scope) => scope.getByText(/no (pending|new)? ?invitations/i),
  },
]);

export const ignoreInviteButton = selector('ignore-invite-button', [
  byRole('aria-ignore', 'button', { name: /^ignore$/i }),
  byCss('aria-label-ignore', 'button[aria-label*="Ignore" i]'),
]);

export const globalNav = selector('global-nav', [
  byCss('id-global-nav', '#global-nav'),
  byRole('role-navigation', 'navigation', { name: /primary/i }),
]);
