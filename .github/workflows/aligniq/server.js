const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const port = Number(process.env.PORT || 4173);
const rootDir = __dirname;
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, "data");
const dbPath = path.join(dataDir, "aligniq-db.json");
const sessionCookieName = "aligniq_session";
const sessionMaxAge = 60 * 60 * 24 * 30;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function createEmptyDb() {
  return {
    users: [],
    sessions: [],
    histories: [],
  };
}

function ensureDbFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(createEmptyDb(), null, 2));
  }
}

function loadDb() {
  ensureDbFile();
  const raw = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const db = raw && typeof raw === "object" ? raw : createEmptyDb();
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.sessions)) db.sessions = [];
  if (!Array.isArray(db.histories)) db.histories = [];

  const now = Date.now();
  db.sessions = db.sessions.filter((session) => {
    const expiresAt = new Date(session.expiresAt || 0).getTime();
    return session.token && expiresAt > now;
  });
  return db;
}

function saveDb(db) {
  ensureDbFile();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function readJsonBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req, limit = 12_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Upload is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function parseCookies(header = "") {
  return header.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("=") || "");
    return acc;
  }, {});
}

function makeCookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex");
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    salt,
    hash: hashPassword(password, salt),
  };
}

function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  const candidate = hashPassword(password, record.salt);
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(record.hash));
}

function createSession(db, userId) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + sessionMaxAge * 1000).toISOString();
  db.sessions.unshift({ token, userId, expiresAt });
  db.sessions = db.sessions.slice(0, 20);
  return { token, expiresAt };
}

function getAuthedUser(req, db) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[sessionCookieName];
  if (!token) return null;
  const session = db.sessions.find((item) => item.token === token);
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId);
  if (!user) return null;
  return user;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

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

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractDocxText(buffer) {
  const signature = 0x06054b50;
  const endSearchStart = Math.max(0, buffer.length - 66_000);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= endSearchStart; i -= 1) {
    if (buffer.readUInt32LE(i) === signature) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Invalid DOCX file.");

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;
  const files = new Map();

  for (let entry = 0; entry < totalEntries; entry += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    offset += 46 + fileNameLength + extraLength + commentLength;

    const localSignature = buffer.readUInt32LE(localHeaderOffset);
    if (localSignature !== 0x04034b50) continue;
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    const fileBuffer = buffer.slice(dataStart, dataEnd);

    let content;
    if (compressionMethod === 0) {
      content = fileBuffer;
    } else if (compressionMethod === 8) {
      content = zlib.inflateRawSync(fileBuffer);
    } else {
      continue;
    }

    if (content.length !== uncompressedSize && uncompressedSize !== 0) {
      // Some DOCX writers leave the uncompressed size blank; keep going anyway.
    }
    files.set(fileName, content);
  }

  const documentXml = files.get("word/document.xml");
  if (!documentXml) throw new Error("DOCX file does not contain readable text.");

  return normalizeText(
    decodeXmlEntities(
      documentXml
        .toString("utf8")
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br\/>|<w:cr\/>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function decodePdfString(raw) {
  return String(raw || "")
    .replace(/\\([nrtbf()\\])/g, (_, ch) => {
      if (ch === "n") return "\n";
      if (ch === "r") return "\r";
      if (ch === "t") return "\t";
      if (ch === "b") return "\b";
      if (ch === "f") return "\f";
      return ch;
    })
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function extractPdfText(buffer) {
  const text = buffer.toString("latin1");
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  const chunks = [];

  while ((match = streamPattern.exec(text))) {
    const rawStream = Buffer.from(match[1], "latin1");
    let decoded = null;

    try {
      decoded = zlib.inflateSync(rawStream).toString("latin1");
    } catch {
      try {
        decoded = zlib.inflateRawSync(rawStream).toString("latin1");
      } catch {
        decoded = rawStream.toString("latin1");
      }
    }

    const textMatches = [];
    const literalPattern = /\(((?:\\.|[^()])*)\)\s*T[Jj]/g;
    let literalMatch;
    while ((literalMatch = literalPattern.exec(decoded))) {
      textMatches.push(decodePdfString(literalMatch[1]));
    }

    const arrayPattern = /\[((?:\\.|[^\]])*)\]\s*TJ/g;
    let arrayMatch;
    while ((arrayMatch = arrayPattern.exec(decoded))) {
      const parts = arrayMatch[1].match(/\(((?:\\.|[^()])*)\)|<([0-9A-Fa-f]+)>/g) || [];
      parts.forEach((part) => {
        if (part.startsWith("(")) {
          textMatches.push(decodePdfString(part.slice(1, -1)));
        } else if (part.startsWith("<")) {
          const hex = part.slice(1, -1).replace(/\s+/g, "");
          if (hex.length % 2 === 0) {
            const hexText = Buffer.from(hex, "hex").toString("utf8");
            if (hexText.trim()) textMatches.push(hexText);
          }
        }
      });
    }

    if (textMatches.length) {
      chunks.push(textMatches.join(" "));
    }
  }

  return normalizeText(chunks.join("\n"));
}

function scoreResume(resumeText, jobDescription) {
  const resumeTokens = new Set(tokenize(resumeText));
  const jobTokens = unique(tokenize(jobDescription));
  const matched = jobTokens.filter((token) => resumeTokens.has(token));
  const missing = jobTokens.filter((token) => !resumeTokens.has(token)).slice(0, 8);
  const score = jobTokens.length ? Math.min(99, Math.max(24, Math.round((matched.length / jobTokens.length) * 100))) : 0;
  return { score, matched, missing, jobTokens };
}

function summarizeResume(text) {
  const lines = normalizeText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    headline: lines[0] || "Candidate Summary",
    bullets: lines.slice(1).filter((line) => /^[-*•]/.test(line)).map((line) => line.replace(/^[-*•]\s*/, "")),
    body: lines.slice(1).filter((line) => !/^[-*•]/.test(line)),
  };
}

function createFallbackBundle({ jobTitle, resumeText, jobDescription, tone }) {
  const scoreData = scoreResume(resumeText, jobDescription);
  const resumeSummary = summarizeResume(resumeText);
  const selectedKeywords = scoreData.jobTokens.slice(0, 8);
  const baseFocus = [
    "ATS-friendly rewrite",
    "Recruiter-friendly summary",
    "Impact-focused edit",
    "Leadership-oriented version",
    "Concise hybrid version",
  ];
  const toneLine =
    tone === "leadership"
      ? "Lead initiatives, align stakeholders, and communicate priorities across teams."
      : tone === "impact"
        ? "Deliver measurable outcomes, improve conversion, and sharpen execution quality."
        : "Match role requirements, echo priority keywords, and stay ATS friendly.";
  const title = jobTitle ? `${jobTitle} resume` : "Tailored resume";

  const versions = baseFocus.map((focus, index) => {
    const slice = selectedKeywords.slice(index, index + 6);
    const bullets = resumeSummary.bullets.length
      ? resumeSummary.bullets.slice(0, 4)
      : slice.slice(0, 4).map((keyword) => `Built work around ${keyword} and delivered stronger results.`);
    return {
      label: index === 0 ? "ATS" : index === 1 ? "Recruiter" : index === 2 ? "Impact" : index === 3 ? "Lead" : "Hybrid",
      title: focus,
      summary: `${tone.toUpperCase()} rewrite for ${jobTitle || "the target role"}.`,
      content: [
        resumeSummary.headline,
        "",
        `Focus: ${focus}`,
        `Tone: ${toneLine}`,
        "",
        "Professional Summary",
        `- ${focus} for ${jobTitle || "the target role"} with experience in ${slice.join(", ") || "relevant skills"}.`,
        `- ${toneLine}`,
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
    title,
    score: scoreData.score,
    matchedKeywords: scoreData.matched,
    missingKeywords: scoreData.missing,
    versions,
  };
}

function extractJsonBlock(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

function normalizeModelBundle(payload, fallbackMeta) {
  const score = Number.isFinite(Number(payload?.score)) ? Number(payload.score) : fallbackMeta.score;
  const matchedKeywords = Array.isArray(payload?.matchedKeywords) ? payload.matchedKeywords.filter(Boolean).slice(0, 20) : fallbackMeta.matchedKeywords;
  const missingKeywords = Array.isArray(payload?.missingKeywords) ? payload.missingKeywords.filter(Boolean).slice(0, 20) : fallbackMeta.missingKeywords;
  const versions = Array.isArray(payload?.versions) ? payload.versions.slice(0, 5) : [];
  const safeVersions = versions.length
    ? versions.map((item, index) => ({
        label: String(item?.label || ["ATS", "Recruiter", "Impact", "Lead", "Hybrid"][index] || `V${index + 1}`),
        title: String(item?.title || `Version ${index + 1}`),
        summary: String(item?.summary || "Tailored resume version."),
        content: normalizeText(item?.content || ""),
      }))
    : fallbackMeta.versions;

  return {
    mode: "ai",
    score,
    matchedKeywords,
    missingKeywords,
    versions: safeVersions.length ? safeVersions : fallbackMeta.versions,
  };
}

async function createAiBundle(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return createFallbackBundle(payload);
  }

  const prompt = [
    "You are AlignIQ, an expert resume tailoring assistant.",
    "",
    "Return ONLY valid JSON with this structure:",
    '{ "score": number, "matchedKeywords": string[], "missingKeywords": string[], "versions": [ { "label": string, "title": string, "summary": string, "content": string } ] }',
    "",
    "Rules:",
    "- Produce exactly 5 versions.",
    "- Tailor the resume to the job description using only the candidate's existing background.",
    "- Do not invent employers, degrees, certifications, or hard numbers.",
    "- If information is missing, keep the language honest and use placeholders like [add evidence] when useful.",
    "- Make each version meaningfully different: ATS-focused, recruiter-friendly, impact-focused, leadership-focused, and concise hybrid.",
    "- Keep the content plain text with line breaks.",
    "",
    `Target role: ${payload.jobTitle || "Unknown"}`,
    `Tone: ${payload.tone || "ats"}`,
    "",
    "Resume:",
    payload.resumeText,
    "",
    "Job description:",
    payload.jobDescription,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      input: prompt,
      max_output_tokens: 3000,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}.`);
  }

  const result = await response.json();
  const text = Array.isArray(result.output)
    ? result.output
        .flatMap((item) => Array.isArray(item.content) ? item.content : [])
        .filter((part) => part.type === "output_text" && part.text)
        .map((part) => part.text)
        .join("\n")
    : "";
  const jsonText = extractJsonBlock(text);
  if (!jsonText) {
    throw new Error("The AI response did not include valid JSON.");
  }

  const parsed = JSON.parse(jsonText);
  const fallbackMeta = createFallbackBundle(payload);
  return normalizeModelBundle(parsed, fallbackMeta);
}

async function importResumeText(filename, buffer) {
  const ext = path.extname(filename || "").toLowerCase();

  if (ext === ".txt" || ext === ".md" || ext === ".csv") {
    return normalizeText(buffer.toString("utf8"));
  }

  if (ext === ".rtf") {
    return normalizeText(buffer.toString("utf8").replace(/\\'[0-9a-fA-F]{2}/g, " ").replace(/\\par[d]?/g, "\n").replace(/[{}]/g, ""));
  }

  if (ext === ".docx") {
    return extractDocxText(buffer);
  }

  if (ext === ".pdf") {
    const extracted = extractPdfText(buffer);
    if (extracted) return extracted;
    throw new Error("PDF text could not be extracted.");
  }

  return normalizeText(buffer.toString("utf8"));
}

function renderHistoryEntry(entry) {
  return {
    id: entry.id,
    title: entry.title,
    jobTitle: entry.jobTitle,
    tone: entry.tone,
    score: entry.score,
    matchedKeywords: entry.matchedKeywords || [],
    missingKeywords: entry.missingKeywords || [],
    createdAt: entry.createdAt,
    versions: entry.versions || [],
  };
}

function saveHistory(db, userId, payload, bundle) {
  const entry = {
    id: `history-${crypto.randomUUID()}`,
    userId,
    title: bundle.title,
    jobTitle: payload.jobTitle || "",
    tone: payload.tone || "ats",
    score: bundle.score,
    matchedKeywords: bundle.matchedKeywords || [],
    missingKeywords: bundle.missingKeywords || [],
    resumeText: payload.resumeText || "",
    jobDescription: payload.jobDescription || "",
    versions: bundle.versions || [],
    createdAt: new Date().toISOString(),
  };
  db.histories.unshift(entry);
  db.histories = db.histories.filter((item) => item.userId === userId || item.userId);
  db.histories = db.histories.slice(0, 100);
  return entry;
}

function getUserHistory(db, userId) {
  return db.histories.filter((entry) => entry.userId === userId).map(renderHistoryEntry);
}

function setAuthCookie(res, token, expiresAt) {
  const ttl = Math.max(60, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  res.setHeader("Set-Cookie", makeCookie(sessionCookieName, token, ttl));
}

function clearAuthCookie(res) {
  res.setHeader("Set-Cookie", `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function getStaticFile(filePath) {
  const resolved = path.resolve(rootDir, filePath);
  if (!resolved.startsWith(rootDir)) return null;
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return null;
  return resolved;
}

async function handleApi(req, res, url) {
  const db = loadDb();

  if (req.method === "GET" && url.pathname === "/api/me") {
    return sendJson(res, 200, { user: publicUser(getAuthedUser(req, db)) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/signup") {
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!name || !validateEmail(email) || password.length < 8) {
      return sendJson(res, 400, { error: "Use a name, a valid email, and a password with at least 8 characters." });
    }
    if (db.users.some((user) => user.email.toLowerCase() === email)) {
      return sendJson(res, 409, { error: "That email is already registered." });
    }

    const { salt, hash } = createPasswordRecord(password);
    const user = {
      id: `user-${crypto.randomUUID()}`,
      name,
      email,
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    };

    db.users.unshift(user);
    const session = createSession(db, user.id);
    saveDb(db);
    setAuthCookie(res, session.token, session.expiresAt);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = db.users.find((item) => item.email.toLowerCase() === email);
    if (!user || !verifyPassword(password, { salt: user.passwordSalt, hash: user.passwordHash })) {
      return sendJson(res, 401, { error: "Invalid email or password." });
    }

    const session = createSession(db, user.id);
    saveDb(db);
    setAuthCookie(res, session.token, session.expiresAt);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[sessionCookieName];
    if (token) {
      db.sessions = db.sessions.filter((session) => session.token !== token);
      saveDb(db);
    }
    clearAuthCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    const user = getAuthedUser(req, db);
    if (!user) return sendJson(res, 200, { histories: [] });
    return sendJson(res, 200, { histories: getUserHistory(db, user.id) });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/history/")) {
    const user = getAuthedUser(req, db);
    if (!user) return sendJson(res, 401, { error: "Please sign in first." });
    const historyId = url.pathname.split("/").pop();
    const history = db.histories.find((entry) => entry.id === historyId && entry.userId === user.id);
    if (!history) return sendJson(res, 404, { error: "History item not found." });
    return sendJson(res, 200, { history: renderHistoryEntry(history) });
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const filename = String(req.headers["x-filename"] || "resume.txt");
    const buffer = await readRawBody(req);
    const text = await importResumeText(filename, buffer);
    return sendJson(res, 200, { text });
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    const body = await readJsonBody(req, 4_000_000);
    const payload = {
      jobTitle: String(body.jobTitle || "").trim(),
      resumeText: normalizeText(body.resumeText || ""),
      jobDescription: normalizeText(body.jobDescription || ""),
      tone: String(body.tone || "ats").trim(),
    };

    if (!payload.resumeText || !payload.jobDescription) {
      return sendJson(res, 400, { error: "Add both a resume and a job description first." });
    }

    let bundle;
    try {
      bundle = await createAiBundle(payload);
    } catch (error) {
      bundle = createFallbackBundle(payload);
      bundle.warning = process.env.OPENAI_API_KEY
        ? "The AI service could not be reached, so a local draft was created instead."
        : "Set OPENAI_API_KEY to enable the live OpenAI rewrite backend.";
    }

    const user = getAuthedUser(req, db);
    let savedHistory = null;
    if (user) {
      savedHistory = saveHistory(db, user.id, payload, bundle);
      saveDb(db);
    }

    return sendJson(res, 200, {
      ...bundle,
      savedHistory: savedHistory ? renderHistoryEntry(savedHistory) : null,
      historyMessage: user
        ? "Saved to your history."
        : "Sign in to save this to your history.",
    });
  }

  return sendJson(res, 404, { error: "API route not found." });
}

function serveStatic(req, res, url) {
  const filePath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const resolved = getStaticFile(filePath);
  if (!resolved) return false;
  const ext = path.extname(resolved).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const data = fs.readFileSync(resolved);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(data);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }
    if (serveStatic(req, res, url)) return;
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    return sendText(res, 404, "Not found");
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Server error." });
  }
});

server.listen(port, () => {
  console.log(`AlignIQ running at http://localhost:${port}`);
});
