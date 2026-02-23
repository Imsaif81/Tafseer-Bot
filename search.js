const { normalizeText, tokenizeWords } = require("./utils");

const SEARCH_STATE_TTL_MS = 15 * 60 * 1000;
const stateMap = new Map();

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

function overlapScore(queryWords, textWordSet) {
  if (queryWords.length === 0) {
    return 0;
  }

  let overlapCount = 0;
  for (const word of queryWords) {
    if (textWordSet.has(word)) {
      overlapCount += 1;
    }
  }
  return overlapCount / queryWords.length;
}

function rankDuaMatches(duas, query) {
  const normalizedQuery = normalizeText(query);
  const queryWords = tokenizeWords(normalizedQuery);

  if (!normalizedQuery || queryWords.length === 0) {
    return [];
  }

  const scored = [];

  for (const dua of duas) {
    const searchableText = normalizeText([
      dua.category,
      dua.arabic,
      dua.english,
      dua.urdu,
      dua.source,
      dua.authenticity
    ].join(" "));

    const textWordSet = new Set(tokenizeWords(searchableText));
    const exact = searchableText.includes(normalizedQuery);
    const overlap = overlapScore(queryWords, textWordSet);

    if (!exact && overlap < 0.5) {
      continue;
    }

    const score = (exact ? 10 : 0) + overlap;
    scored.push({ dua, exact, overlap, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.exact !== a.exact) return b.exact - a.exact;
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return String(a.dua.id || "").localeCompare(String(b.dua.id || ""));
  });

  return scored.map((item) => item.dua);
}

module.exports = {
  beginDuaSearch,
  setDuaSelectionState,
  getDuaSearchState,
  clearDuaSearchState,
  rankDuaMatches
};
