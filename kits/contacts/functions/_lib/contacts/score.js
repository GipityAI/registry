// contacts kit - OPTIONAL fit-from-title heuristic, ported from LeadPester. The
// kit never auto-applies this: scoring POLICY belongs to the consuming app. It's
// here only so an app can opt in to a cheap first-pass ranking of an imported
// list (founders/builders above recruiters/students) before any LLM enrichment.
// Use it in the app, then persist via contact-write { action: 'score' }.
const RULES = [
  // Disqualifying roles first, so e.g. "Technical Recruiter" scores low not high.
  [/(recruit|talent|human resources|\bhr\b|student|intern|assistant|seeking|open to work|retired|unemployed|volunteer)/i, 25],
  [/(founder|co-?founder|ceo|cto|coo|cmo|cpo|chief|owner|president|managing partner|general partner|\bgp\b)/i, 92],
  [/(\bai\b|artificial intelligence|machine learning|\bml\b|data scientist)/i, 85],
  [/(vp|vice president|head of|director|principal|founding|partner|\blead\b)/i, 80],
  [/(engineer|developer|software|product manager|\bpm\b|designer|growth|devrel|developer relations|indie|maker|hacker|technical)/i, 76],
  [/(marketing|sales|business development|bizdev|consultant|advisor|investor|operator)/i, 60],
  [/(manager|analyst|specialist|coordinator|associate)/i, 50],
];

export function fitFromTitle(title) {
  const t = String(title || '').toLowerCase().trim();
  if (!t) return 45;
  for (const [re, score] of RULES) if (re.test(t)) return score;
  return 50;
}
