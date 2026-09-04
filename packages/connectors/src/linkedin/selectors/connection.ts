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

export const acceptInviteButton = selector('accept-invite-button', [
  byRole('aria-accept', 'button', { name: /^accept$/i }),
  byCss('aria-label-accept', 'button[aria-label*="Accept" i]'),
]);

export const ignoreInviteButton = selector('ignore-invite-button', [
  byRole('aria-ignore', 'button', { name: /^ignore$/i }),
  byCss('aria-label-ignore', 'button[aria-label*="Ignore" i]'),
]);

export const globalNav = selector('global-nav', [
  byCss('id-global-nav', '#global-nav'),
  byRole('role-navigation', 'navigation', { name: /primary/i }),
]);
