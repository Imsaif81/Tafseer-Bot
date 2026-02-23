const { getDuaMasterRows } = require("./sheets");
const { escapeHtml, normalizeText, tokenizeWords, logDebug } = require("./utils");

const SEARCH_STATE_TTL_MS = 15 * 60 * 1000;
const stateMap = new Map();
const QUERY_STOP_WORDS = new Set(["ki", "ka", "ke", "dua", "duaon", "for", "the", "a", "an"]);
const QUERY_ALIASES = {
  safar: ["travel", "journey", "trip"],
  travel: ["safar", "journey"],
  sone: ["sleep", "night"],
  neend: ["sleep", "night"],
  subah: ["morning"],
  shaam: ["evening"],
  evening: ["shaam"],
  morning: ["subah"],
  rizq: ["rozi", "provision", "money", "wealth"],
  rozi: ["rizq", "provision", "money"],
  riza: ["rizq", "rozi", "provision"],
  astagfar: ["astaghfar", "istighfar", "forgiveness"],
  astaghfar: ["istighfar", "forgiveness"],
  istigfar: ["istighfar", "forgiveness"],
  anxiety: ["stress", "worry", "distress"],
  pareshani: ["anxiety", "stress", "worry"],
  udasi: ["sadness", "grief"],
  khauf: ["fear", "afraid"],
  gussa: ["anger"],
  hifazat: ["protection", "safety"],
  shifa: ["health", "healing"]
};

function makeSessionKey(chatId, userId) {
  return `${chatId}:${userId || chatId}`;
}

function beginDuaSearch(chatId, userId) {
  stateMap.set(makeSessionKey(chatId, userId), {
    stage: "awaiting_query",
    options: [],
    updatedAt: Date.now()
  });
}

function setDuaSelectionState(chatId, userId, options) {
  stateMap.set(makeSessionKey(chatId, userId), {
    stage: "awaiting_selection",
    options: Array.isArray(options) ? options : [],
    updatedAt: Date.now()
  });
}

function getDuaSearchState(chatId, userId) {
  const key = makeSessionKey(chatId, userId);
  const current = stateMap.get(key);
  if (!current) {
    return null;
  }

  if (Date.now() - current.updatedAt > SEARCH_STATE_TTL_MS) {
    stateMap.delete(key);
    return null;
  }

  return current;
}

function clearDuaSearchState(chatId, userId) {
  stateMap.delete(makeSessionKey(chatId, userId));
}

function makeTokenSet(text) {
  return new Set(tokenizeWords(text));
}

function buildQueryTokens(queryText) {
  const normalized = normalizeText(queryText);
  const rawTokens = tokenizeWords(normalized);
  const baseTokens = rawTokens.filter((token) => !QUERY_STOP_WORDS.has(token));
  const rootTokens = baseTokens.length > 0 ? baseTokens : rawTokens;
  const expanded = new Set(rootTokens);

  for (const token of rootTokens) {
    const aliases = QUERY_ALIASES[token];
    if (!aliases) {
      continue;
    }
    for (const alias of aliases) {
      const aliasNormalized = normalizeText(alias);
      if (aliasNormalized) {
        expanded.add(aliasNormalized);
      }
    }
  }

  return [...expanded];
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function isNearTokenMatch(queryToken, candidateToken) {
  if (!queryToken || !candidateToken) {
    return false;
  }

  if (queryToken === candidateToken) {
    return true;
  }

  if (candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken)) {
    return true;
  }

  const maxDistance = queryToken.length >= 7 ? 2 : 1;
  if (Math.abs(queryToken.length - candidateToken.length) > maxDistance) {
    return false;
  }

  return levenshteinDistance(queryToken, candidateToken) <= maxDistance;
}

function scoreDua(queryNormalized, queryTokens, dua) {
  const chapter = normalizeText(dua.chapter_title_en || "");
  const category = normalizeText(dua.category || "");
  const arabic = normalizeText(dua.arabic || "");
  const english = normalizeText(dua.english || "");
  const rawText = normalizeText(dua.raw_text || "");
  const keywords = normalizeText(
    [
      dua.keywords_en,
      dua.keywords_ur,
      dua.keywords_roman,
      dua.keywords_ar,
      dua.tags
    ].join(" ")
  );
  const searchBlob = normalizeText(
    dua.search_blob ||
      [
        dua.chapter_title_en,
        dua.category,
        dua.english,
        dua.arabic,
        dua.keywords_en,
        dua.keywords_ur,
        dua.keywords_roman,
        dua.keywords_ar,
        dua.tags
      ].join(" ")
  );

  const chapterTokens = makeTokenSet(chapter);
  const categoryTokens = makeTokenSet(category);
  const arabicTokens = makeTokenSet(arabic);
  const englishTokens = makeTokenSet(english);
  const keywordTokens = makeTokenSet(keywords);
  const blobTokens = makeTokenSet(searchBlob);
  const rawTokens = makeTokenSet(rawText);

  let score = 0;

  if (searchBlob.includes(queryNormalized)) score += 36;
  if (keywords.includes(queryNormalized)) score += 28;
  if (chapter.includes(queryNormalized) || category.includes(queryNormalized)) score += 20;
  if (rawText.includes(queryNormalized)) score += 16;

  let matchedTokens = 0;
  for (const token of queryTokens) {
    let tokenMatched = false;

    if (keywordTokens.has(token)) {
      score += 11;
      tokenMatched = true;
    }
    if (categoryTokens.has(token) || chapterTokens.has(token)) {
      score += 9;
      tokenMatched = true;
    }
    if (arabicTokens.has(token) || englishTokens.has(token)) {
      score += 7;
      tokenMatched = true;
    }
    if (blobTokens.has(token)) {
      score += 4;
      tokenMatched = true;
    }
    if (rawTokens.has(token)) {
      score += 3;
      tokenMatched = true;
    }

    if (tokenMatched) {
      matchedTokens += 1;
    }
  }

  if (queryTokens.length > 0) {
    score += (matchedTokens / queryTokens.length) * 18;
  }

  return score;
}

async function searchDuaMaster(queryText, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 3;
  const queryNormalized = normalizeText(queryText);
  const queryTokens = buildQueryTokens(queryNormalized);

  if (!queryNormalized || queryTokens.length === 0) {
    return [];
  }

  const masterRows = await getDuaMasterRows();
  if (!Array.isArray(masterRows) || masterRows.length === 0) {
    return [];
  }

  logDebug("QUERY", queryText);

  const scored = [];
  for (const dua of masterRows) {
    const score = scoreDua(queryNormalized, queryTokens, dua);
    if (score <= 0) {
      continue;
    }
    scored.push({ dua, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.dua.id).localeCompare(String(b.dua.id));
  });

  logDebug("RESULT COUNT", scored.length);

  if (scored.length > 0) {
    return scored.slice(0, limit).map((item) => item.dua);
  }

  const relaxed = [];
  for (const dua of masterRows) {
    const haystack = normalizeText(
      [
        dua.chapter_title_en,
        dua.category,
        dua.arabic,
        dua.english,
        dua.urdu,
        dua.keywords_en,
        dua.keywords_ur,
        dua.keywords_roman,
        dua.keywords_ar,
        dua.tags,
        dua.search_blob,
        dua.raw_text
      ].join(" ")
    );
    if (!haystack) {
      continue;
    }

    const hayTokens = tokenizeWords(haystack);
    let score = 0;

    for (const token of queryTokens) {
      if (haystack.includes(token)) {
        score += 5;
        continue;
      }

      if (hayTokens.some((candidate) => isNearTokenMatch(token, candidate))) {
        score += 2.5;
      }
    }

    if (score > 0) {
      relaxed.push({ dua, score });
    }
  }

  relaxed.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.dua.id).localeCompare(String(b.dua.id));
  });

  logDebug("RELAXED RESULT COUNT", relaxed.length);
  return relaxed.slice(0, limit).map((item) => item.dua);
}

function buildDuaResultsMessage(matches) {
  const topOptions = matches.slice(0, 3);
  const numberEmojis = ["1️⃣", "2️⃣", "3️⃣"];

  const rows = topOptions.map((dua, idx) => {
    const snippetSource = String(dua.arabic || dua.chapter_title_en || dua.english || "No text")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const snippet = snippetSource.length > 45 ? `${snippetSource.slice(0, 45)}…` : snippetSource;
    return `${numberEmojis[idx]} <b>[${escapeHtml(dua.category || "General")}]</b>\n${escapeHtml(snippet || "No text")}`;
  });

  const message = [
    "🌿 <b>Dua Results</b>",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "🔎 <b>Multiple matches found</b>",
    "",
    ...rows,
    "",
    "━━━━━━━━━━━━━━━━━━",
    "✍️ Reply with <b>1, 2, or 3</b> to view full dua",
    "",
    "❌ Send /cancel to exit"
  ].join("\n");

  return message.length <= 4096 ? message : `${message.slice(0, 4093)}...`;
}

module.exports = {
  beginDuaSearch,
  setDuaSelectionState,
  getDuaSearchState,
  clearDuaSearchState,
  searchDuaMaster,
  buildDuaResultsMessage
};
