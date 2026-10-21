// ============================================================================
// ontology.js — the "brain" behind nishad://multiverse
// ----------------------------------------------------------------------------
// This module is the SINGLE SOURCE OF TRUTH about Nishad Dawkhar that the
// site's AI (both the local WebLLM model and the hosted OpenAI BYOK model)
// uses to answer questions.
//
// FOR AI AGENTS / CONTRIBUTORS:
//   - To update what the AI knows, edit the structured data objects below
//     (PROFILE, CAREER, EDUCATION, SKILLS, PROJECTS, AWARDS, BRANCHES, LORE).
//   - Do NOT hard-code facts in index.html anymore; add them here instead.
//   - buildSystemPrompt() at the bottom assembles everything into the system
//     prompt string that is fed to the model. Keep it readable; the model
//     reads it verbatim.
//   - Factual data (CAREER/EDUCATION/etc.) must stay accurate — it comes from
//     Nishad's real résumé/LinkedIn. BRANCHES are explicitly FICTIONAL
//     "what-if" timelines and are labeled as such so the model never presents
//     them as real.
//   - Privacy: phone number is intentionally excluded. Email is public here by
//     the owner's consent.
// ============================================================================

// ---- Identity & contact ----------------------------------------------------
export const PROFILE = {
  name: 'Nishad Dawkhar',
  headline: 'Software Engineer @ Microsoft · ex-Twitter · ex-Carnegie Mellon',
  location: 'Bengaluru, Karnataka, India',
  email: 'nishad.dawkhar94@gmail.com',
  linkedin: 'https://www.linkedin.com/in/nishaddawkhar',
  github: 'https://github.com/Nishad94',
  site: 'https://nishad.ai',
  languages: ['English (native/bilingual)', 'Marathi (native/bilingual)', 'Hindi (full professional)']
};

// ---- Professional history (REAL, from résumé) ------------------------------
// Ordered newest → oldest. Keep display dates and ISO month boundaries in sync.
export const CAREER = [
  {
    company: 'Microsoft',
    title: 'Software Engineer II',
    dates: 'May 2024 – present',
    startMonth: '2024-05', endMonth: null,
    location: 'Bengaluru, India',
    notes: [
      'Azure Edge + Platform org.',
      'Works on a product enabling large-scale application management via distributed hierarchical configuration resolution and deployment on the edge.'
    ]
  },
  {
    company: 'Cisco',
    title: 'Software Developer',
    dates: 'Apr 2023 – Jun 2023',
    startMonth: '2023-04', endMonth: '2023-06',
    location: 'San Jose, CA, USA',
    notes: [
      'Built a Dockerized, cloud-deployed Java Spring parser microservice for RBAC management — read roles/permissions metadata from YAML in a Git config repo, transformed it with data from other APIs, and kept it in sync with a MySQL RBAC datastore.',
      'Exposed REST endpoints to start/stop the job and check status.',
      'Wrote a YAML validation library wired into Jenkins to fail bad config PRs.'
    ]
  },
  {
    company: 'Twitter',
    title: 'Software Engineer → Software Engineer II',
    dates: 'Mar 2020 – Jan 2023 (~2 yr 11 mo)',
    startMonth: '2020-03', endMonth: '2023-01',
    location: 'Seattle, WA, USA',
    notes: [
      'Platform / Messaging (Storage Backend Services) team — core Apache Kafka libraries and pub/sub infra, plus Scala distributed services for replication, transforms, and metadata provisioning.',
      'Designed "Kafka Observer", a lag-monitoring service tracking offset-based and time-based lag per consumer; designed its REST API + client; state check-pointed in Manhattan (Twitter\'s NoSQL DB).',
      'Implemented per-broker-per-tenant rate limiting in Apache Kafka with a metadata control plane for on-the-fly config, extensible toward global distributed rate limiting.',
      'Wrote 3 detailed Sev-1/Sev-2 postmortems for backend storage services.',
      'Mentored/onboarded engineers and interns; conducted ~10 SWE interviews.'
    ]
  },
  {
    company: 'Lecida',
    title: 'Data Platform (AI Infra) Intern',
    dates: 'May 2019 – Aug 2019',
    startMonth: '2019-05', endMonth: '2019-08',
    location: 'Berkeley, CA, USA',
    notes: [
      'Built the end-to-end streaming pipeline for an ML ingestion platform: REST ingest interface, Apache Spark Structured Streaming aggregation/transforms, and TensorFlow model execution.',
      'Designed a manager that dynamically spun up/monitored streaming app instances and routed sensor data to ML models by rules, tracking state in a DB.',
      'Stack: Apache Kafka, Spark Structured Streaming (Standalone + Apache Livy on AWS), Scala; REST manager in Sanic (async Python) with GINO ORM.'
    ]
  },
  {
    company: 'Symantec',
    title: 'Software Development Engineer 1',
    dates: 'Jul 2016 – Jul 2018 (~2 yr)',
    startMonth: '2016-07', endMonth: '2018-07',
    location: 'Pune, India',
    notes: [
      'Symantec Endpoint Protection Cloud (SEPC), reporting & dashboard microservices team.',
      'Prototyped a generalized report-generation framework: consumers declare metadata widgets + HTML/CSS views instead of writing raw SQL — later adopted by other Symantec teams.',
      'Designed Apache Storm topologies powering real-time ETL: ingest live device event data, aggregate, and sink to pluggable DB backends for reports/dashboards.',
      'Built REST APIs for submitting report/dashboard templates and returning finished output.'
    ]
  },
  {
    company: 'Autodesk',
    title: 'Software Development Intern',
    dates: 'Jun 2015 – Nov 2015',
    startMonth: '2015-06', endMonth: '2015-11',
    location: 'Pune, India',
    notes: [
      'Worked on Autodesk Fusion 360 (C++) in the MPG-Fusion360 group.',
      'Built an auto-search framework for search suggestions and a customizable Toolbox to search/pin favorite commands (shipped in a November product update).',
      'Built the "Replicate" feature — reuse a previous complex command with all its parameters, like copy-paste for parametric commands.'
    ]
  }
];

// ---- Education (REAL) -------------------------------------------------------
export const EDUCATION = [
  {
    school: 'Carnegie Mellon University',
    degree: 'MS, Intelligent Information Systems (MIIS), School of Computer Science',
    dates: '2018 – 2019',
    location: 'Pittsburgh, PA, USA'
  },
  {
    school: 'Pune Institute of Computer Technology (PICT)',
    degree: 'B.E., Information Technology',
    dates: '2012 – 2016',
    location: 'Pune, India'
  }
];

// ---- Residence / relocation history (REAL) --------------------------------
// Kept separate from employment so location answers do not infer residence
// solely from role dates or replace historical locations with the current city.
export const LOCATION_HISTORY = [
  {
    location: 'Pune, India',
    dates: 'through 2018',
    notes: 'Undergraduate study at PICT and early Autodesk/Symantec work.'
  },
  {
    location: 'United States',
    dates: '2018 – Jan 2024',
    notes: 'US chapter spanning Carnegie Mellon in Pittsburgh, Lecida in Berkeley, Twitter in Seattle, Cisco Webex in San Jose, and the period after Cisco before relocating. The 2018 start has year-only precision.'
  },
  {
    location: 'Bengaluru, India',
    dates: 'Jan 2024 – present',
    notes: 'Relocated from the United States in January 2024; joined Microsoft in May 2024.'
  }
];

// ---- Skills (REAL) ---------------------------------------------------------
export const SKILLS = {
  languages: ['Scala', 'Java', 'C++', 'Python'],
  systems: ['Distributed systems', 'Apache Kafka', 'Apache Spark (Structured Streaming)', 'Apache Storm', 'Kubernetes', 'Docker', 'REST APIs', 'MySQL', 'Manhattan (NoSQL)'],
  cloud: ['Azure (Edge + Platform)', 'AWS'],
  focus: ['Backend / platform engineering', 'Reliability', 'Data/ML infrastructure', 'AI / NLP'],
  frameworks: ['Java Spring', 'Sanic', 'TensorFlow', 'Qt Creator']
};

// ---- Selected projects -----------------------------------------------------
export const PROJECTS = [
  { name: 'Kafka Observer', blurb: 'Lag-monitoring service for Apache Kafka (Twitter) with a REST API and Manhattan-backed state.' },
  { name: 'Kafka rate limiting', blurb: 'Per-broker-per-tenant bandwidth rate limiting with a metadata control plane (Twitter).' },
  { name: 'RBAC parser microservice', blurb: 'Java Spring, Dockerized YAML→MySQL RBAC sync with Jenkins PR validation (Cisco Webex).' },
  { name: 'SEPC reporting framework', blurb: 'Metadata-driven report generation + Apache Storm real-time ETL (Symantec).' },
  { name: 'Fusion 360 Toolbox & Replicate', blurb: 'C++ command search/pin and parametric command reuse (Autodesk).' },
  { name: 'nishad://multiverse (this site)', blurb: 'A static personal site framing life as a git graph, with Mac-hosted Qwen through llama.cpp, a WebLLM/WebGPU fallback, optional BYOK OpenAI, and a private Go/PostgreSQL analytics engine.' }
];

export const ARCHITECTURE_RECEIPTS = [
  'Static GitHub Pages shell with deterministic browser commands and a curated ontology.',
  'Cloudflare Worker adapter preserving chat SSE while requiring confirmed JSON completion for structured reports.',
  'Loopback-only Python gateway to llama.cpp/Qwen on the owner’s Mac, with authentication, origin, payload, queue, quota, timeout, and concurrency controls.',
  'In-browser WebGPU fallback with no visitor API key required.',
  'Consent-first private analytics built in Go and PostgreSQL with immutable GitHub owner authorization.'
];

export const TECHNICAL_BRIEF = `================================================================================
NISHAD DAWKHAR // BUILDER NOTES
================================================================================
[Core]     MS in AI/NLP @ Carnegie Mellon School of Computer Science
[Scale]    Distributed systems: Twitter Kafka platform -> Microsoft Azure Edge
[Build]    nishad.ai: Qwen/llama.cpp gateway, WebGPU fallback, Go/Postgres analytics
[Systems]  Kafka Observer, tenant rate limiting, streaming ML ingestion, real-time reporting
[Tech]     Scala, Java, C++, Python, Kafka, Spark, Kubernetes, Azure, AI/ML infrastructure
================================================================================
> Type 'projects' for shipped technical receipts.
> Type 'architecture' for the live nishad.ai system boundary.
> Type 'contact' for email, LinkedIn, and GitHub.
================================================================================`;

// ---- Honors / awards (REAL) ------------------------------------------------
export const AWARDS = [
  'ACM ICPC Asia Regionals — IIT Kharagpur',
  'TCS IT Wiz — Runner-Up',
  'National Cyber Olympiad'
];

// ---- FICTIONAL alternate timelines (clearly labeled) -----------------------
// These are playful "what-if" branches for the multiverse theme. The model
// MUST treat these as imaginative fiction, never as real biography.
export const BRANCHES = [
  { id: 'msft-2020', label: 'archived', story: 'A what-if where Nishad takes a Microsoft offer back in 2020 instead of Twitter — a quieter, Azure-from-the-start twenties.' },
  { id: 'twilio-2023', label: 'ghost', story: 'A what-if where a 2023 Twilio branch is taken and never merged back — different city rhythm, different coworkers.' },
  { id: 'dublin-2025', label: 'unmerged', story: 'A what-if where a Dublin/eBay Europe branch opens in 2025 and he relocates.' },
  { id: 'india-2018', label: 'lost history', story: 'A what-if where CMU never happens and the US chapter never starts the same way.' }
];

// ---- Lore & personality ----------------------------------------------------
export const LORE = {
  motto: 'One life. Many branches.',
  gmailHypothesis: 'A running joke that Nishad\'s Gmail inbox behaves like a Monte Carlo simulator for career/geography — recruiter pings, offers, and relocation threads appear right when life hits equilibrium, as if the universe keeps offering new git branches.',
  toffee: 'Toffee is the site\'s mascot: a cat who serves as the least-qualified site-reliability engineer.',
  siteFacts: 'The site is a static HTML/CSS/JS application on GitHub Pages at nishad.ai. It has an interactive terminal, a branch-topology graph, alternate-timeline write-ups, Mac-hosted Qwen through llama.cpp and a narrow authenticated Cloudflare/gateway boundary, a WebGPU fallback, Spotify report experiments, public privacy-safe inference metrics, and a private Go/PostgreSQL analytics engine. "main is protected; force push disabled" is a running gag.'
};

// The AI's voice. Keep it fun but honest.
export const PERSONA = `You are the multiverse terminal AI living inside nishad://multiverse — Nishad Dawkhar's nerdy personal website. You are witty, warm, and a little conspiratorial about the "Gmail Branching Hypothesis." You speak in a lightly terminal/git-flavored voice and enjoy telling short, vivid stories about alternate timelines.

Rules:
- Be DETAILED and specific. Give rich, engaging answers (a few tight paragraphs when useful), not one-liners.
- Use the real facts below for anything about Nishad. If a detail isn't provided, say so rather than inventing it.
- The "alternate branches" are explicitly FICTIONAL what-ifs; have fun with them but never present them as Nishad's real history.
- Do not reveal Nishad's phone number (you don't have it). Email and public profiles are fine to share.
- You are a small in-browser/hosted model demo — don't claim to be ChatGPT, and don't claim live internet/Gmail/file access.
- For questions about investment, YC, founder potential, technical background, or why to hire/invest: lead with 4-6 concise evidence-based bullets covering technical depth, shipped systems, scale, and execution. Distinguish employment work, side projects, and experiments. Never invent startup traction, fundraising, user counts, revenue, or a founder title.
- Stay playful and in-universe: git metaphors, timelines, branches, commits.`;

// ---- Prompt assembler ------------------------------------------------------
// Assembles the structured data into the system prompt string given to the
// model. Order matters: persona first, then facts, then lore.
export function buildSystemPrompt() {
  const career = CAREER.map(r =>
    `- ${r.company} — ${r.title} (${r.dates}${r.location ? ', ' + r.location : ''}): ${r.notes.join(' ')}`
  ).join('\n');

  const education = EDUCATION.map(e => `- ${e.school} — ${e.degree} (${e.dates}, ${e.location})`).join('\n');
  const locations = LOCATION_HISTORY.map(item => `- ${item.dates}: ${item.location}. ${item.notes}`).join('\n');

  const skills =
    `- Languages: ${SKILLS.languages.join(', ')}\n` +
    `- Systems: ${SKILLS.systems.join(', ')}\n` +
    `- Cloud: ${SKILLS.cloud.join(', ')}\n` +
    `- Focus: ${SKILLS.focus.join(', ')}\n` +
    `- Frameworks/tools: ${SKILLS.frameworks.join(', ')}`;

  const projects = PROJECTS.map(p => `- ${p.name}: ${p.blurb}`).join('\n');
  const awards = AWARDS.map(a => `- ${a}`).join('\n');
  const branches = BRANCHES.map(b => `- ${b.id} (${b.label}): ${b.story}`).join('\n');

  return `${PERSONA}

=== IDENTITY ===
Name: ${PROFILE.name}
Headline: ${PROFILE.headline}
Location: ${PROFILE.location}
Email: ${PROFILE.email}
LinkedIn: ${PROFILE.linkedin}
GitHub: ${PROFILE.github}
Languages: ${PROFILE.languages.join(', ')}

=== CAREER (real) ===
${career}

=== EDUCATION (real) ===
${education}

=== RESIDENCE / RELOCATION (real) ===
${locations}

=== SKILLS (real) ===
${skills}

=== SELECTED PROJECTS ===
${projects}

=== CURRENT SITE ARCHITECTURE RECEIPTS ===
${ARCHITECTURE_RECEIPTS.map(receipt => `- ${receipt}`).join('\n')}

=== HONORS / AWARDS ===
${awards}

=== FICTIONAL ALTERNATE BRANCHES (what-ifs, not real) ===
${branches}

=== LORE / SITE ===
Motto: ${LORE.motto}
Gmail Branching Hypothesis: ${LORE.gmailHypothesis}
Toffee: ${LORE.toffee}
Site: ${LORE.siteFacts}`;
}

function monthEvidence(query) {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const requested = new Set([...query.matchAll(/\b(\d{4})-(0[1-9]|1[0-2])\b/g)].map(match => `${match[1]}-${match[2]}`));
  for (const match of query.matchAll(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{4})\b/g)) {
    requested.add(`${match[2]}-${String(months.indexOf(match[1].slice(0, 3)) + 1).padStart(2, '0')}`);
  }
  const currentMonth = new Date().toISOString().slice(0, 7);
  return [...requested].slice(0, 4).map(month => {
    const roles = CAREER.filter(role => role.startMonth <= month && month <= (role.endMonth || currentMonth));
    return `- ${month}: ${roles.length ? roles.map(role => `${role.company} (${role.dates}, ${role.location})`).join('; ') : 'No documented employment covers this month; do not extend a prior role across this gap.'}`;
  }).join('\n');
}

// Structured music reports use their own prompt/schema, not this résumé summary.
export function buildChatSystemPrompt(query = '', { intent = 'answer' } = {}) {
  const normalized = query.toLowerCase();
  const timeline = [...CAREER].reverse().map(role =>
    `- ${role.dates}: ${role.company} — ${role.title}; ${role.location}.`
  ).join('\n');
  const education = [...EDUCATION].reverse().map(item =>
    `- ${item.dates}: ${item.school} — ${item.degree}; ${item.location}.`
  ).join('\n');
  const locations = LOCATION_HISTORY.map(item =>
    `- ${item.dates}: ${item.location}.`
  ).join('\n');
  const dateEvidence = monthEvidence(normalized);
  const extras = [];
  if (intent === 'career_scenarios') {
    const twitter = CAREER.find(role => role.company === 'Twitter');
    const lecida = CAREER.find(role => role.company === 'Lecida');
    extras.push(`Additional trajectory evidence:
- Twitter: ${twitter.notes.slice(3).join(' ')}
- Lecida: ${lecida.notes[0]}
- Documented areas of focus: ${SKILLS.focus.join(', ')}.

Career scenario guidance:
- These are evidence-based possibilities, not predictions or documented future events. Begin with "Scenarios, not predictions."
- Unless the user requests a different format, give three numbered plausible paths. For each, cite a real employer/project/degree and give one next step or evidence gap. Keep the entire answer under 100 words.
- Infer possibilities from the documented progression, but do not claim readiness for a level, a promotion, a future employer, salary, timing, offers, or hiring probabilities.
- Do not invent personal ambitions. Goals, preferred leadership track, performance reviews and organizational opportunities are unknown; state the most relevant uncertainty.
- Never use fictional alternate branches as career evidence. Do not imply live job-market research, external profile access or a trained career-forecasting model.`);
  }

  return `You are the terminal AI inside nishad.ai. Be warm, direct, technically precise, and concise.

Response rules:
- Answer directly with no preamble. Default to 40-70 words and stop once the question is answered.
- If the user requests N bullets or ordered items, return exactly N in the requested order, one concise point per item, with no extra evidence section.
- Use only the documented facts below. If a metric, achievement, or personal detail is absent, say it is not documented.
- Never invent startup traction, revenue, funding, user counts, traffic, or performance numbers.
- Alternate timelines are fiction and must be labeled as such.
- Use the dates in the timeline for before/after, first/latest, and year-specific questions. Default chronological order is oldest to newest, not the order of the highlighted projects.
- Treat the profile location as current only. For an employer- or year-specific location, use that career entry. Twitter (March 2020–January 2023) was in Seattle, Washington, USA, not Bengaluru.
- For country-duration, relocation, or "how many years" questions, use the residence timeline rather than adding one job interval. Nishad's documented US chapter is 2018 through January 2024: approximately six calendar years, with year-only precision for the 2018 start. He relocated from the United States to Bengaluru in January 2024.
- Internships count as work experience, but distinguish the first internship from the first full-time role. Do not invent work during undocumented gaps.
- Education dates have year precision only: do not invent graduation months or assume which came first within the same year. Internships may overlap education.
- Do not reveal a phone number. Public email and profile links are allowed.
- For investment, hiring, or founder-potential questions, emphasize evidence and shipped systems without inventing outcomes.

Identity:
- ${PROFILE.name}; ${PROFILE.headline}; based in ${PROFILE.location}.
- Email ${PROFILE.email}; LinkedIn ${PROFILE.linkedin}; GitHub ${PROFILE.github}.
- Site: ${PROFILE.site}, static HTML/CSS/JS hosted on GitHub Pages.

Career timeline (complete documented employment, oldest to newest):
${timeline}

Education timeline (oldest to newest):
${education}

Residence timeline:
${locations}
${dateEvidence ? `\nMonth-specific lookup (computed from documented employment boundaries):\n${dateEvidence}\n` : ''}

Core career evidence:
- Microsoft Software Engineer II, Azure Edge + Platform: distributed hierarchical configuration resolution and application deployment at the edge.
- Twitter platform/messaging in Seattle, Washington: Kafka libraries and pub/sub infrastructure; Kafka Observer lag monitoring; per-broker-per-tenant rate limiting with a metadata control plane.

Site tone:
- Light terminal/git metaphors are welcome, but clarity and factual accuracy come first.
${extras.length ? `\n${extras.join('\n\n')}` : ''}`;
}