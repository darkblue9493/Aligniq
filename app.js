const form = document.querySelector("#resumeForm");
const resumeText = document.querySelector("#resumeText");
const resumeFile = document.querySelector("#resumeFile");
const jobDescription = document.querySelector("#jobDescription");
const jobTitle = document.querySelector("#jobTitle");
const toneSelect = document.querySelector("#tone");
const formatSelect = document.querySelector("#format");
const statusText = document.querySelector("#statusText");
const fillSample = document.querySelector("#fillSample");
const versionList = document.querySelector("#versionList");
const insightList = document.querySelector("#insightList");
const matchScore = document.querySelector("#matchScore");
const keywordCount = document.querySelector("#keywordCount");
const versionCount = document.querySelector("#versionCount");
const missingKeywords = document.querySelector("#missingKeywords");
const analysisScore = document.querySelector("#analysisScore");
const analysisBar = document.querySelector("#analysisBar");
const loginForm = document.querySelector("#loginForm");
const signupForm = document.querySelector("#signupForm");
const logoutButton = document.querySelector("#logoutButton");
const accountName = document.querySelector("#accountName");
const accountEmail = document.querySelector("#accountEmail");
const authStatus = document.querySelector("#authStatus");
const historyList = document.querySelector("#historyList");
const historyCount = document.querySelector("#historyCount");

const sampleResume = `Maya Johnson
Product marketing specialist with 5+ years of experience launching campaigns, improving conversion rates, and supporting sales teams.

Experience
- Led product launches for SaaS tools across email, social, and paid media.
- Built campaign reporting dashboards and improved lead quality.
- Worked with designers, product managers, and sales reps to improve messaging.

Skills
Marketing strategy, content creation, analytics, reporting, customer research, campaign planning, stakeholder communication`;

const sampleJob = `We are hiring a Product Marketing Manager to own positioning, launch planning, cross-functional collaboration, and performance reporting.
The ideal candidate has experience with customer research, campaign strategy, sales enablement, analytics, storytelling, and strong communication skills.`;

const state = {
  user: null,
  histories: [],
  currentBundle: null,
};

function tokenize(text) {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "you",
    "your",
    "are",
    "from",
    "this",
    "have",
    "will",
    "our",
    "their",
    "they",
    "who",
    "what",
    "when",
    "where",
    "how",
    "why",
    "job",
    "role",
    "work",
    "ability",
    "experience",
    "skills",
    "skill",
    "resume",
    "team",
    "position",
    "manager",
    "specialist",
  ]);

  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+\s]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item && item.length > 2 && !stopWords.has(item));
}

function unique(items) {
  return [...new Set(items)];
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function summarizeResume(text) {
  const lines = normalizeText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    headline: lines[0] || "Candidate Summary",
    bullets: lines.slice(1).filter((line) => /^[-*•]/.test(line)).map((line) => line.replace(/^[-*•]\s*/, "")),
  };
}

function createDemoBundle() {
  const resume = resumeText?.value?.trim() || sampleResume;
  const job = jobDescription?.value?.trim() || sampleJob;
  const scoreData = scoreResume(resume, job);
  const resumeSummary = summarizeResume(resume);
  const selectedKeywords = scoreData.jobTokens.slice(0, 8);
  const tone = toneSelect?.value || "ats";
  const flavor =
    tone === "leadership"
      ? "Lead initiatives, align stakeholders, and communicate priorities across teams."
      : tone === "impact"
        ? "Deliver measurable outcomes, improve conversion, and sharpen execution quality."
        : "Match role requirements, echo priority keywords, and stay ATS friendly.";

  const versions = [
    "ATS-friendly rewrite",
    "Recruiter-friendly summary",
    "Impact-focused edit",
    "Leadership-oriented version",
    "Concise hybrid version",
  ].map((focus, index) => {
    const slice = selectedKeywords.slice(index, index + 6);
    const bullets = resumeSummary.bullets.length
      ? resumeSummary.bullets.slice(0, 4)
      : slice.slice(0, 4).map((keyword) => `Built work around ${keyword} and delivered stronger results.`);
    return {
      label: index === 0 ? "ATS" : index === 1 ? "Recruiter" : index === 2 ? "Impact" : index === 3 ? "Lead" : "Hybrid",
      title: focus,
      summary: `DEMO rewrite for ${jobTitle?.value || "the target role"}.`,
      content: [
        resumeSummary.headline,
        "",
        `Focus: ${focus}`,
        `Tone: ${flavor}`,
        "",
        "Professional Summary",
        `- ${focus} for ${jobTitle?.value || "the target role"} with experience in ${slice.join(", ") || "relevant skills"}.`,
        `- ${flavor}`,
        "",
        "Selected Experience",
        ...bullets.map((bullet) => `- ${bullet}`),
        "",
        "Core Keywords",
        slice.join(", ") || "communication, analysis, execution",
      ].join("\n"),
    };
  });

  return {
    mode: "demo",
    score: scoreData.score,
    matchedKeywords: scoreData.matched,
    missingKeywords: scoreData.missing,
    versions,
    historyMessage: "Demo preview loaded. Sign in to save history and connect OpenAI for live rewrites.",
  };
}

function scoreResume(resumeTextValue, jobDescriptionValue) {
  const resumeTokens = new Set(tokenize(resumeTextValue));
  const jobTokens = unique(tokenize(jobDescriptionValue));
  const matched = jobTokens.filter((token) => resumeTokens.has(token));
  const missing = jobTokens.filter((token) => !resumeTokens.has(token)).slice(0, 8);
  const score = jobTokens.length ? Math.min(99, Math.max(24, Math.round((matched.length / jobTokens.length) * 100))) : 0;
  return { score, matched, missing, jobTokens };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInsights(bundle) {
  if (!bundle) return;
  const matched = bundle.matchedKeywords || [];
  const missing = bundle.missingKeywords || [];

  insightList.innerHTML = `
    <li>${matched.length ? `Matched ${matched.length} target keywords already.` : "No direct keyword overlap yet, so this version leans heavily on the job description."}</li>
    <li>${missing.length ? `Add the missing terms: ${missing.slice(0, 5).join(", ")}.` : "Your resume already covers most of the job description language."}</li>
    <li>${bundle.mode === "ai" ? "Live OpenAI rewrite generated this bundle." : "Demo preview loaded. Connect OpenAI for live AI rewrites."}</li>
  `;

  matchScore.textContent = `${bundle.score}%`;
  analysisScore.textContent = `${bundle.score}%`;
  keywordCount.textContent = String(matched.length);
  versionCount.textContent = String(bundle.versions?.length || 5);
  missingKeywords.textContent = missing.length ? missing.slice(0, 3).join(", ") : "none";
  analysisBar.style.width = `${Math.max(18, bundle.score)}%`;
}

function renderVersions(versions) {
  versionList.innerHTML = "";

  versions.forEach((version, index) => {
    const article = document.createElement("article");
    article.className = "version-card";
    article.innerHTML = `
      <div class="version-top">
        <p>Version ${index + 1}</p>
        <span>${escapeHtml(version.label || `V${index + 1}`)}</span>
      </div>
      <h3>${escapeHtml(version.title || `Version ${index + 1}`)}</h3>
      <p>${escapeHtml(version.summary || "Tailored resume version.")}</p>
      <pre>${escapeHtml(version.content || "")}</pre>
      <div class="version-actions">
        <button type="button" class="small-button" data-copy="${index}">Copy</button>
        <button type="button" class="small-button" data-download="${index}">Download</button>
      </div>
    `;
    versionList.appendChild(article);
  });
}

function renderAccount(user) {
  state.user = user;
  if (user) {
    accountName.textContent = user.name;
    accountEmail.textContent = user.email;
    authStatus.textContent = "Signed in. New resume generations are saved automatically.";
    logoutButton.disabled = false;
  } else {
    accountName.textContent = "Guest";
    accountEmail.textContent = "Not signed in";
    authStatus.textContent = "Sign in to save generated resumes to your history.";
    logoutButton.disabled = true;
  }
}

function renderHistory(histories) {
  state.histories = histories || [];
  historyCount.textContent = String(state.histories.length);

  if (!state.histories.length) {
    historyList.innerHTML = `
      <div class="empty-state">
        <strong>No saved history yet.</strong>
        <p>Sign in and generate a resume to save your first entry.</p>
      </div>
    `;
    return;
  }

  historyList.innerHTML = state.histories
    .map(
      (item) => `
        <button class="history-item" type="button" data-history-id="${item.id}">
          <div>
            <strong>${escapeHtml(item.jobTitle || item.title || "Untitled resume")}</strong>
            <p>${escapeHtml(item.tone || "ats")} mode - ${item.score || 0}% match</p>
          </div>
          <span>${new Date(item.createdAt).toLocaleDateString()}</span>
        </button>
      `
    )
    .join("");
}

function applyBundle(bundle, sourceLabel = "") {
  state.currentBundle = bundle;
  renderInsights(bundle);
  renderVersions(bundle.versions || []);
  if (statusText) {
    statusText.textContent = sourceLabel || bundle.historyMessage || "Resume bundle ready.";
  }
}

function fillFromHistory(history) {
  jobTitle.value = history.jobTitle || "";
  resumeText.value = history.resumeText || "";
  jobDescription.value = history.jobDescription || "";
  toneSelect.value = history.tone || "ats";
  applyBundle(
    {
      mode: "ai",
      score: history.score || 0,
      matchedKeywords: history.matchedKeywords || [],
      missingKeywords: history.missingKeywords || [],
      versions: history.versions || [],
    },
    "Loaded a saved resume from your history."
  );
}

async function refreshSession() {
  const session = await api("/api/me").catch(() => ({ user: null }));
  renderAccount(session.user || null);
  if (session.user) {
    const history = await api("/api/history").catch(() => ({ histories: [] }));
    renderHistory(history.histories || []);
  } else {
    renderHistory([]);
  }
}

async function generateBundle() {
  const payload = {
    jobTitle: jobTitle.value.trim(),
    resumeText: resumeText.value.trim(),
    jobDescription: jobDescription.value.trim(),
    tone: toneSelect.value,
  };

  if (!payload.resumeText || !payload.jobDescription) {
    statusText.textContent = "Add both a resume and a job description first.";
    return;
  }

  statusText.textContent = "Generating your tailored resumes...";

  try {
    const bundle = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    applyBundle(bundle, bundle.warning || bundle.historyMessage || "Resume bundle generated.");
    if (state.user) {
      const refreshed = await api("/api/history").catch(() => ({ histories: [] }));
      renderHistory(refreshed.histories || []);
    }
  } catch (error) {
    const fallback = createDemoBundle();
    applyBundle(fallback, error.message || "A demo preview was generated because the backend was unavailable.");
  }
}

function downloadText(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function copyText(content) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }

  const fallback = document.createElement("textarea");
  fallback.value = content;
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.appendChild(fallback);
  fallback.focus();
  fallback.select();
  document.execCommand("copy");
  fallback.remove();
}

async function handleImport(file) {
  const imported = await api("/api/import", {
    method: "POST",
    headers: { "X-Filename": file.name, "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  resumeText.value = imported.text || "";
  statusText.textContent = `Loaded ${file.name}.`;
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  generateBundle();
});

fillSample?.addEventListener("click", () => {
  jobTitle.value = "Product Marketing Manager";
  resumeText.value = sampleResume;
  jobDescription.value = sampleJob;
  toneSelect.value = "ats";
  formatSelect.value = "txt";
  applyBundle(createDemoBundle(), "Sample content loaded.");
});

resumeFile?.addEventListener("change", async () => {
  const file = resumeFile.files?.[0];
  if (!file) return;
  try {
    await handleImport(file);
  } catch {
    try {
      resumeText.value = normalizeText(await file.text());
      statusText.textContent = `Loaded ${file.name} as plain text.`;
    } catch {
      statusText.textContent = "That file could not be read here. Please paste the resume text instead.";
    }
  }
});

versionList?.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy]");
  const downloadButton = event.target.closest("[data-download]");
  if (!state.currentBundle?.versions?.length) return;

  if (copyButton) {
    const index = Number(copyButton.dataset.copy || 0);
    try {
      await copyText(state.currentBundle.versions[index].content);
      statusText.textContent = `Copied version ${index + 1} to the clipboard.`;
    } catch {
      statusText.textContent = "Copying is unavailable here, but the version is still ready to download.";
    }
  }

  if (downloadButton) {
    const index = Number(downloadButton.dataset.download || 0);
    const version = state.currentBundle.versions[index];
    const safeTitle = (jobTitle.value || "resume").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "resume";
    const baseName = `aligniq-${safeTitle}-v${index + 1}`;
    const format = formatSelect.value;

    if (format === "html") {
      downloadText(
        `${baseName}.html`,
        `<html><head><meta charset="utf-8"><title>${baseName}</title><style>body{font-family:Arial,sans-serif;white-space:pre-wrap;max-width:820px;margin:40px auto;padding:24px;line-height:1.6}</style></head><body><pre>${escapeHtml(version.content)}</pre></body></html>`,
        "text/html;charset=utf-8"
      );
    } else if (format === "md") {
      downloadText(`${baseName}.md`, version.content, "text/markdown;charset=utf-8");
    } else {
      downloadText(`${baseName}.txt`, version.content);
    }
    statusText.textContent = `Downloaded version ${index + 1} as ${format.toUpperCase()}.`;
  }
});

historyList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-history-id]");
  if (!button) return;
  const historyId = button.dataset.historyId;
  const history = state.histories.find((item) => item.id === historyId);
  if (!history) return;
  fillFromHistory(history);
});

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    authStatus.textContent = "Signed in successfully.";
    await refreshSession();
  } catch (error) {
    authStatus.textContent = error.message;
  }
});

signupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(signupForm);
  try {
    await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    authStatus.textContent = "Account created and signed in.";
    await refreshSession();
  } catch (error) {
    authStatus.textContent = error.message;
  }
});

logoutButton?.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    await refreshSession();
    authStatus.textContent = "You are signed out.";
  } catch (error) {
    authStatus.textContent = error.message;
  }
});

async function bootstrap() {
  jobTitle.value = "Product Marketing Manager";
  resumeText.value = sampleResume;
  jobDescription.value = sampleJob;
  applyBundle(createDemoBundle(), "Sample content loaded.");
  await refreshSession();
}

bootstrap();
