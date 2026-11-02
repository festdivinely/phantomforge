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

/**
 * Seen: textbox "Industry" in the intro form - required to save the form,
 * though not shown on the profile. It is a pick-from-list box: typing shows
 * suggestions and one must be chosen.
 */
export const industryBox = selector('industry-box', [
  byRole('textbox-industry', 'textbox', { name: /^industry\b/i }),
  byCss('aria-label-industry', 'input[aria-label*="Industry" i], input[id*="industry" i]'),
]);

// --- Experience (seen 2026-11-01) ---------------------------------------
// The experience list has a + button that opens a menu: "Add role" /
// "Add career break". Each job has a link "Edit <title> at <organisation>".
// Both the add and edit forms carry a "Notify network" switch that is On by
// default - it is always turned off before saving.

export const addExperienceButton = selector('add-experience-button', [
  byRole('button-add-position', 'button', { name: /add a position/i }),
  byCss('aria-label-add-position', 'main [aria-label*="Add a position" i]'),
]);

export const addRoleMenuItem = selector('add-role-menu-item', [
  byRole('menuitem-add-role', 'menuitem', { name: /^add role$/i }),
  byCss('text-add-role', 'text="Add role"'),
]);

export const notifyNetworkSwitch = selector('notify-network-switch', [
  byRole('switch-notify', 'switch', { name: /notify your network/i }),
  byCss('role-switch', '[role="switch"]'),
]);

export const jobTitleBox = selector('job-title-box', [
  byRole('textbox-job-title', 'textbox', { name: /^job title/i }),
  byCss('placeholder-title', 'input[placeholder*="Product Manager" i]'),
]);

export const organisationBox = selector('organisation-box', [
  byRole('textbox-organisation', 'textbox', { name: /^(company or )?organi[sz]ation/i }),
  byCss('placeholder-organisation', 'input[placeholder*="Microsoft" i]'),
]);

export const employmentTypeSelect = selector('employment-type-select', [
  byRole('combobox-employment', 'combobox', { name: /^employment type/i }),
]);

export const locationTypeSelect = selector('location-type-select', [
  byRole('combobox-location-type', 'combobox', { name: /^location type/i }),
]);

export const startMonthSelect = selector('start-month-select', [
  byRole('combobox-start-month', 'combobox', { name: /^start month/i }),
]);

export const startYearSelect = selector('start-year-select', [
  byRole('combobox-start-year', 'combobox', { name: /^start year/i }),
]);

export const currentlyWorkHereBox = selector('currently-work-here', [
  byRole('checkbox-current', 'checkbox', { name: /currently (work|working)/i }),
]);

export const deleteButton = selector('delete-button', [
  byRole('button-delete', 'button', { name: /^delete\b/i }),
  byCss('text-delete', 'button:has-text("Delete")'),
]);
