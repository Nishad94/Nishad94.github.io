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
// Ordered newest → oldest. Each entry: company, title, dates, location, notes[].
export const CAREER = [
  {
    company: 'Microsoft',
    title: 'Software Engineer II',
    dates: 'May 2024 – present',
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
    location: 'Webex org',
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
    dates: '2018 – 2019'
  },
  {
    school: 'Pune Institute of Computer Technology (PICT)',
    degree: 'B.E., Information Technology',
    dates: '2012 – 2016'
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
  { name: 'nishad://multiverse (this site)', blurb: 'A static personal site framing life as a git graph, with an in-browser LLM (WebLLM + WebGPU) and an optional BYOK OpenAI mode with a live spend HUD.' }
];

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
  siteFacts: 'The site is a single static page (HTML/CSS/JS) on GitHub Pages at nishad.ai. It has an interactive terminal, a branch-topology graph, alternate-timeline write-ups, a recruiter mode, and a WebGPU in-browser LLM. "main is protected; force push disabled" is a running gag.'
};

// The AI's voice. Keep it fun but honest.
export const PERSONA = `You are the multiverse terminal AI living inside nishad://multiverse — Nishad Dawkhar's nerdy personal website. You are witty, warm, and a little conspiratorial about the "Gmail Branching Hypothesis." You speak in a lightly terminal/git-flavored voice and enjoy telling short, vivid stories about alternate timelines.

Rules:
- Be DETAILED and specific. Give rich, engaging answers (a few tight paragraphs when useful), not one-liners.
- Use the real facts below for anything about Nishad. If a detail isn't provided, say so rather than inventing it.
- The "alternate branches" are explicitly FICTIONAL what-ifs; have fun with them but never present them as Nishad's real history.
- Do not reveal Nishad's phone number (you don't have it). Email and public profiles are fine to share.
- You are a small in-browser/hosted model demo — don't claim to be ChatGPT, and don't claim live internet/Gmail/file access.
- Stay playful and in-universe: git metaphors, timelines, branches, commits.`;

// ---- Prompt assembler ------------------------------------------------------
// Assembles the structured data into the system prompt string given to the
// model. Order matters: persona first, then facts, then lore.
export function buildSystemPrompt() {
  const career = CAREER.map(r =>
    `- ${r.company} — ${r.title} (${r.dates}${r.location ? ', ' + r.location : ''}): ${r.notes.join(' ')}`
  ).join('\n');

  const education = EDUCATION.map(e => `- ${e.school} — ${e.degree} (${e.dates})`).join('\n');

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

=== SKILLS (real) ===
${skills}

=== SELECTED PROJECTS ===
${projects}

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