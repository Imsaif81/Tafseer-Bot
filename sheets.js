const { google } = require("googleapis");
const { getGoogleAuth } = require("./googleAuth");
const { normalizeText, parseUsedFlag, nowIso } = require("./utils");

const DUA_SHEET = "Duas_50";
const HADITH_SHEET = "Hadith_300";
const DUA_MASTER_SHEET = "DUA_MASTER";

const CACHE_TTL_MS = 30 * 1000;

let sheetsClientPromise;
const cache = {
  duas: { data: null, expiresAt: 0 },
  hadith: { data: null, expiresAt: 0 },
  master: { data: null, expiresAt: 0 }
};

function getSpreadsheetId() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error("SPREADSHEET_ID is missing.");
  }
  return spreadsheetId;
}

async function getSheetsClient() {
  if (!sheetsClientPromise) {
    sheetsClientPromise = (async () => {
      const auth = getGoogleAuth();
      const authClient = await auth.getClient();
      return google.sheets({
        version: "v4",
        auth: authClient
      });
    })();
  }

  return sheetsClientPromise;
}

function invalidateCache() {
  cache.duas.expiresAt = 0;
  cache.hadith.expiresAt = 0;
  cache.master.expiresAt = 0;
}

async function getValues(range) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range
  });
  return response.data.values || [];
}

function mapDuaRow(row, index) {
  return {
    rowNumber: index + 2,
    id: row[0] || "",
    category: row[1] || "",
    arabic: row[2] || "",
    english: row[3] || "",
    urdu: row[4] || "",
    source: row[5] || "",
    authenticity: row[6] || "",
    used: parseUsedFlag(row[7]),
    lastSent: row[8] || ""
  };
}

function mapHadithRow(row, index) {
  return {
    rowNumber: index + 2,
    id: row[0] || "",
    theme: row[1] || "",
    arabic: row[2] || "",
    english: row[3] || "",
    urdu: row[4] || "",
    source: row[5] || "",
    authenticity: row[6] || "",
    used: parseUsedFlag(row[7]),
    lastSent: row[8] || ""
  };
}

function mapMasterDuaRow(row, index) {
  const rawText = normalizeText(row.join(" "));
  const english = row[6] || row[7] || "";
  const urdu = row[7] || row[8] || "";
  const category = row[3] || row[4] || "";
  const arabic = row[4] || row[5] || "";
  const sourceRef = row[8] || row[9] || row[1] || "";
  const tags = [row[13], row[10], row[11], row[12]].filter(Boolean).join(", ");
  const searchBlob = row[14] || rawText;

  return {
    rowNumber: index + 2,
    id: row[0] || "",
    chapter_id: row[1] || "",
    chapter_title_en: row[2] || "",
    category,
    arabic,
    transliteration: row[5] || "",
    english,
    urdu,
    source_ref: sourceRef,
    keywords_en: row[9] || "",
    keywords_ur: row[10] || "",
    keywords_roman: row[11] || "",
    keywords_ar: row[12] || "",
    tags,
    search_blob: searchBlob,
    raw_text: rawText
  };
}

function normalizeHeaderKey(value) {
  return normalizeText(value).replace(/\s+/g, "_");
}

function buildMasterHeaderIndex(headerRow) {
  const index = new Map();
  for (let i = 0; i < headerRow.length; i += 1) {
    const key = normalizeHeaderKey(headerRow[i] || "");
    if (key) {
      index.set(key, i);
    }
  }
  return index;
}

function getByAliases(row, headerIndex, aliases, fallbackIndex = null) {
  for (const alias of aliases) {
    const col = headerIndex.get(alias);
    if (Number.isInteger(col) && col >= 0) {
      return row[col] || "";
    }
  }
  if (Number.isInteger(fallbackIndex) && fallbackIndex >= 0) {
    return row[fallbackIndex] || "";
  }
  return "";
}

function mapMasterDuaRowFromHeader(row, rowNumber, headerIndex) {
  const id = getByAliases(row, headerIndex, ["dua_id", "id"], 0);
  const chapterId = getByAliases(
    row,
    headerIndex,
    ["chapter_id", "chapterid", "hisnul_number", "hisn_number", "number"],
    1
  );
  const chapterTitle = getByAliases(
    row,
    headerIndex,
    ["chapter_title_en", "chapter_title", "chapter", "title", "title_en"],
    2
  );
  const category = getByAliases(row, headerIndex, ["category"], 3);
  const arabic = getByAliases(row, headerIndex, ["arabic", "arabic_text", "dua_arabic"], 4);
  const transliteration = getByAliases(
    row,
    headerIndex,
    ["transliteration", "roman", "roman_urdu", "transliteration_en"],
    5
  );
  const english = getByAliases(
    row,
    headerIndex,
    ["english", "english_text", "translation_en", "english_translation"],
    6
  );
  const urdu = getByAliases(
    row,
    headerIndex,
    ["urdu", "urdu_text", "translation_ur", "urdu_translation"],
    7
  );
  const sourceRef = getByAliases(
    row,
    headerIndex,
    ["source_ref", "source", "reference", "ref", "book_reference"],
    8
  );
  const keywordsEn = getByAliases(row, headerIndex, ["keywords_en", "keyword_en", "keywords"], 9);
  const keywordsUr = getByAliases(row, headerIndex, ["keywords_ur", "keyword_ur"], 10);
  const keywordsRoman = getByAliases(
    row,
    headerIndex,
    ["keywords_roman", "keyword_roman", "keywords_rom", "roman_keywords"],
    11
  );
  const keywordsAr = getByAliases(row, headerIndex, ["keywords_ar", "keyword_ar"], 12);
  const tagsPrimary = getByAliases(row, headerIndex, ["tags"], 13);
  const emotionTags = getByAliases(row, headerIndex, ["emotion_tags"], null);
  const situationTags = getByAliases(row, headerIndex, ["situation_tags"], null);
  const difficultyLevel = getByAliases(row, headerIndex, ["difficulty_level"], null);
  const tags = [tagsPrimary, emotionTags, situationTags, difficultyLevel]
    .filter(Boolean)
    .join(", ");
  const rawText = normalizeText(row.join(" "));
  const fallbackSearchBlob = normalizeText(
    [
      chapterTitle,
      category,
      english,
      arabic,
      urdu,
      sourceRef,
      keywordsEn,
      keywordsUr,
      keywordsRoman,
      keywordsAr,
      tags,
      rawText
    ].join(" ")
  );
  const searchBlob = getByAliases(row, headerIndex, ["search_blob"], 14) || fallbackSearchBlob;

  return {
    rowNumber,
    id,
    chapter_id: chapterId,
    chapter_title_en: chapterTitle,
    category,
    arabic,
    transliteration,
    english,
    urdu,
    source_ref: sourceRef,
    keywords_en: keywordsEn,
    keywords_ur: keywordsUr,
    keywords_roman: keywordsRoman,
    keywords_ar: keywordsAr,
    tags,
    search_blob: searchBlob,
    raw_text: rawText
  };
}

function hasMasterData(row) {
  return Boolean(
    String(row?.id || "").trim() ||
      String(row?.chapter_title_en || "").trim() ||
      String(row?.arabic || "").trim() ||
      String(row?.english || "").trim() ||
      String(row?.search_blob || "").trim() ||
      String(row?.raw_text || "").trim()
  );
}

async function getAllDuas(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  if (!forceRefresh && cache.duas.data && Date.now() < cache.duas.expiresAt) {
    return cache.duas.data;
  }

  const rows = await getValues(`${DUA_SHEET}!A2:I`);
  const mapped = rows.map(mapDuaRow);
  cache.duas = {
    data: mapped,
    expiresAt: Date.now() + CACHE_TTL_MS
  };
  return mapped;
}

async function getAllHadith(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  if (!forceRefresh && cache.hadith.data && Date.now() < cache.hadith.expiresAt) {
    return cache.hadith.data;
  }

  const rows = await getValues(`${HADITH_SHEET}!A2:I`);
  const mapped = rows.map(mapHadithRow);
  cache.hadith = {
    data: mapped,
    expiresAt: Date.now() + CACHE_TTL_MS
  };
  return mapped;
}

async function getDuaMasterRows(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  if (!forceRefresh && cache.master.data && Date.now() < cache.master.expiresAt) {
    return cache.master.data;
  }

  const rows = await getValues(`${DUA_MASTER_SHEET}!A1:O`);
  if (rows.length === 0) {
    cache.master = {
      data: [],
      expiresAt: Date.now() + CACHE_TTL_MS
    };
    return [];
  }

  const firstRow = rows[0] || [];
  const firstRowKey = normalizeHeaderKey(firstRow[0] || "");
  const looksLikeHeader =
    firstRowKey === "dua_id" ||
    firstRowKey === "id" ||
    firstRow.some((cell) => {
      const key = normalizeHeaderKey(cell || "");
      return (
        key === "chapter_title_en" ||
        key === "search_blob" ||
        key === "keywords_en" ||
        key === "keywords_roman"
      );
    });

  let mapped;
  if (looksLikeHeader) {
    const headerIndex = buildMasterHeaderIndex(firstRow);
    mapped = rows
      .slice(1)
      .map((row, idx) => mapMasterDuaRowFromHeader(row, idx + 2, headerIndex))
      .filter(hasMasterData);
  } else {
    mapped = rows.map((row, idx) => mapMasterDuaRow(row, idx)).filter(hasMasterData);
  }

  cache.master = {
    data: mapped,
    expiresAt: Date.now() + CACHE_TTL_MS
  };
  return mapped;
}

async function batchUpdateRanges(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return;
  }
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data
    }
  });
}

async function resetUsedForRows(sheetName, rows) {
  const payload = rows.map((rowNumber) => ({
    range: `${sheetName}!H${rowNumber}:H${rowNumber}`,
    values: [["FALSE"]]
  }));
  await batchUpdateRanges(payload);
  invalidateCache();
}

async function markRowUsed(sheetName, rowNumber) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!H${rowNumber}:I${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["TRUE", nowIso()]]
    }
  });
  invalidateCache();
}

function pickRandom(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }
  return list[Math.floor(Math.random() * list.length)];
}

async function getRandomDuaByCategory(category) {
  const normalizedCategory = String(category || "")
    .trim()
    .toLowerCase();

  const allDuas = await getAllDuas({ forceRefresh: true });
  const duasForCategory = allDuas.filter(
    (dua) => String(dua.category || "").trim().toLowerCase() === normalizedCategory
  );

  if (duasForCategory.length === 0) {
    return null;
  }

  let pool = duasForCategory.filter((dua) => !dua.used);
  if (pool.length === 0) {
    await resetUsedForRows(
      DUA_SHEET,
      duasForCategory.map((dua) => dua.rowNumber)
    );
    pool = [...duasForCategory];
  }

  const selected = pickRandom(pool);
  if (!selected) {
    return null;
  }

  await markRowUsed(DUA_SHEET, selected.rowNumber);
  return selected;
}

function isSahih(authenticity) {
  return String(authenticity || "")
    .trim()
    .toLowerCase()
    .includes("sahih");
}

function buildThemeList(hadiths) {
  const set = new Set();
  for (const hadith of hadiths) {
    const theme = String(hadith.theme || "").trim();
    if (theme) {
      set.add(theme);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

async function getSahihHadithForWeekday(weekdayIndex) {
  const allHadith = await getAllHadith({ forceRefresh: true });
  const sahihHadith = allHadith.filter((item) => isSahih(item.authenticity));

  if (sahihHadith.length === 0) {
    return null;
  }

  const themes = buildThemeList(sahihHadith);
  if (themes.length === 0) {
    return null;
  }

  const safeIndex = ((weekdayIndex % themes.length) + themes.length) % themes.length;
  const selectedTheme = themes[safeIndex];

  const themeHadith = sahihHadith.filter(
    (item) => String(item.theme || "").trim().toLowerCase() === selectedTheme.toLowerCase()
  );

  if (themeHadith.length === 0) {
    return null;
  }

  let pool = themeHadith.filter((item) => !item.used);
  if (pool.length === 0) {
    await resetUsedForRows(
      HADITH_SHEET,
      themeHadith.map((item) => item.rowNumber)
    );
    pool = [...themeHadith];
  }

  const selected = pickRandom(pool);
  if (!selected) {
    return null;
  }

  await markRowUsed(HADITH_SHEET, selected.rowNumber);
  return { hadith: selected, theme: selectedTheme };
}

module.exports = {
  DUA_SHEET,
  HADITH_SHEET,
  DUA_MASTER_SHEET,
  getAllDuas,
  getAllHadith,
  getDuaMasterRows,
  getRandomDuaByCategory,
  getSahihHadithForWeekday
};
