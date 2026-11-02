import { byCss, byRole, selector } from '../../base/selector.js';

/**
 * The owner's own profile forms. Seen on the real site (study run 2026-11-01):
 * every form opens as a dialog named after it ("Edit intro", "Edit about"),
 * the text boxes are rich-text boxes (not plain inputs), and Save sits at the
 * bottom of the dialog.
 */

/** The pencil on the top card; its link is /in/<slug>/edit/intro/. */
export const editIntroLink = selector('edit-intro-link', [
  byRole('link-edit-intro', 'link', { name: /^edit intro$/i }),
  byCss('href-edit-intro', 'main a[href*="/edit/intro"]'),
]);

/** Seen: textbox "Headline", holding the headline as a paragraph. */
export const headlineBox = selector('headline-box', [
  byRole('textbox-headline', 'textbox', { name: /^headline\b/i }),
  byCss('aria-label-headline', '[contenteditable="true"][aria-label*="Headline" i]'),
]);

/**
 * With no About yet the profile only shows an "Add a summary" card linking
 * to /edit/forms/summary/new/. Opening that address directly does not open
 * the form - it has to be clicked.
 */
export const editAboutLink = selector('edit-about-link', [
  byCss('href-summary-form', 'main a[href*="/edit/forms/summary/"]'),
  byRole('link-edit-about', 'link', { name: /^edit about$/i }),
]);

/** Seen: textbox "About", with a 2,600 character limit. */
export const aboutBox = selector('about-box', [
  byRole('textbox-about', 'textbox', { name: /^about$/i }),
  byCss('aria-label-about', '[contenteditable="true"][aria-label*="About" i]'),
]);

export const saveButton = selector('save-button', [
  byRole('button-save', 'button', { name: /^save$/i }),
  byCss('text-save', 'button:has-text("Save")'),
]);
