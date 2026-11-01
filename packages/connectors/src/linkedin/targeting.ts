/**
 * Who the owner wants to connect with (decided 2026-10-29): people who are
 * actively looking for connections themselves - "like minds willing to grow" -
 * not CEOs, founders, senior executives or tech professionals. Those accept
 * strangers less and are not the audience for now.
 *
 * Everything here works on what a search result shows: name, headline,
 * location. Pure functions, so they can be tested without a browser.
 */

/** Searches that surface people who say they want connections. One is picked per run. */
export const DEFAULT_SEARCHES = ['#opentoconnect', 'open to connect', '#letsconnect', 'LION open networker', '#networking'];

/** Headline words that show someone is asking for connections. */
export const OPEN_SIGNAL =
  /open\s*to\s*connect|#?opentoconnect|let'?s\s*connect|#?letsconnect|\blion\b|open\s*networker|growing (my|our) network|connect with me|follow back|#?networking/i;

/** Executives and business owners - left out for now. */
export const EXECUTIVE =
  /\b(ceo|cto|cfo|coo|cmo|cio|chief|founder|co-?founder|owner|president|vice[\s-]?president|vp|managing director|executive director|director|head of|partner at|chairman|chairwoman|board member|investor|entrepreneur in residence)\b/i;

/** Tech professionals - left out for now. */
export const TECH =
  /\b(software|developer|engineer(ing)?|programmer|devops|data scien\w*|data analyst|machine learning|\bml\b|\bai\b engineer|front[\s-]?end|back[\s-]?end|full[\s-]?stack|web dev\w*|cyber\s?security|cloud|\bqa\b|tester|solutions? architect|blockchain|web3|coder|\bit\b (support|specialist|consultant)|sysadmin|prototype developer|python|sql|javascript|typescript|react(\.?js)?|node\.?js|java|kotlin|golang|power ?bi|tableau|boomi|salesforce (developer|admin)|sap (consultant|abap))\b/i;

/** Company or brand pages that show up in people search. */
export const ORGANISATION =
  /\b(ltd|limited|inc|llc|plc|gmbh|group|solutions|agency|official|insights?|company|enterprises?|consult(ing|ancy)|trading|services|btb|b2b)\b/i;

export interface Candidate {
  name: string;
  headline: string;
  location: string;
  profileUrl: string;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

export function judge(c: Candidate, opts: { requireOpenSignal: boolean }): Verdict {
  if (ORGANISATION.test(c.name)) return { ok: false, reason: 'looks like a company, not a person' };
  if (EXECUTIVE.test(c.headline)) return { ok: false, reason: 'executive / business owner' };
  if (TECH.test(c.headline)) return { ok: false, reason: 'tech professional' };
  if (opts.requireOpenSignal && !OPEN_SIGNAL.test(c.headline)) {
    return { ok: false, reason: 'headline does not say they want connections' };
  }
  return { ok: true };
}

/** https://www.linkedin.com/in/jane-doe-123/en/?x=y -> https://www.linkedin.com/in/jane-doe-123/ */
export function normaliseProfileUrl(href: string): string | null {
  try {
    const u = new URL(href, 'https://www.linkedin.com');
    const slug = /^\/in\/([^/]+)/.exec(u.pathname)?.[1];
    return slug ? `https://www.linkedin.com/in/${slug}/` : null;
  } catch {
    return null;
  }
}
