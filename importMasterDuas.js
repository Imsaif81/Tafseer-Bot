require("dotenv").config();

const axios = require("axios");
const { google } = require("googleapis");
const { getGoogleAuth } = require("./googleAuth");
const { normalizeText, logError, logInfo } = require("./utils");
const { inferCategory, generateKeywordBundle } = require("./keywordGenerator");

const CHAPTERS_URL = "http://www.hisnmuslim.com/api/en/husn_en.json";
const DUA_MASTER_SHEET = "DUA_MASTER";
const HEADERS = [
  "dua_id",
  "chapter_id",
  "chapter_title_en",
  "category",
  "arabic",
  "transliteration",
  "english",
  "urdu",
  "source_ref",
  "keywords_en",
  "keywords_ur",
  "keywords_roman",
  "keywords_ar",
  "tags",
  "search_blob"
];

function getSpreadsheetId() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error("Missing required environment variable: SPREADSHEET_ID");
  }
  return spreadsheetId;
}

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function compactText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getArrayFromPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

async function fetchJson(url) {
  const response = await axios.get(url, {
    timeout: 20000,
    responseType: "text"
  });
  const text = stripBom(response.data);
  return JSON.parse(text);
}

async function getSheetsService() {
  const auth = getGoogleAuth();
  const authClient = await auth.getClient();
  return google.sheets({
    version: "v4",
    auth: authClient
  });
}

async function ensureSheetExistsAndHeaders(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))"
  });

  const existing = meta.data.sheets || [];
  const hasSheet = existing.some((sheet) => sheet.properties?.title === DUA_MASTER_SHEET);

  if (!hasSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: DUA_MASTER_SHEET } } }]
      }
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${DUA_MASTER_SHEET}!A1:O1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [HEADERS]
    }
  });
}

function createDuaRow(chapter, duaItem) {
  const chapterId = String(chapter.ID || "");
  const chapterTitleEn = compactText(chapter.TITLE || "Untitled Chapter");
  const localDuaId = String(duaItem.ID || "");
  const duaId = `${chapterId}_${localDuaId}`;

  const arabic = compactText(duaItem.ARABIC_TEXT || "");
  const transliteration = compactText(duaItem.LANGUAGE_ARABIC_TRANSLATED_TEXT || "");
  const english = compactText(duaItem.TRANSLATED_TEXT || "");
  const category = inferCategory(chapterTitleEn);

  const keywordBundle = generateKeywordBundle({
    chapterTitleEn,
    category,
    englishText: english,
    arabicText: arabic.slice(0, 300)
  });

  const sourceRef = compactText(
    `${chapterTitleEn} | chapter_id:${chapterId} | hisnul_number:${localDuaId}`
  );

  return [
    duaId,
    chapterId,
    chapterTitleEn,
    category,
    arabic,
    transliteration,
    english,
    "",
    sourceRef,
    keywordBundle.keywords_en,
    keywordBundle.keywords_ur,
    keywordBundle.keywords_roman,
    keywordBundle.keywords_ar,
    keywordBundle.tags,
    normalizeText(keywordBundle.search_blob)
  ];
}

async function fetchChapters() {
  const chaptersPayload = await fetchJson(CHAPTERS_URL);
  const chapters = getArrayFromPayload(chaptersPayload);
  return chapters.filter((chapter) => chapter && chapter.ID && chapter.TITLE);
}

async function fetchChapterDuas(chapter) {
  const chapterUrl = chapter.TEXT || `http://www.hisnmuslim.com/api/en/${chapter.ID}.json`;
  const payload = await fetchJson(chapterUrl);
  const duas = getArrayFromPayload(payload);
  return duas.filter((item) => item && item.ID);
}

async function buildMasterRows() {
  const chapters = await fetchChapters();
  const rowMap = new Map();

  for (const chapter of chapters) {
    let duas = [];
    try {
      duas = await fetchChapterDuas(chapter);
    } catch (error) {
      logError(`Failed to fetch chapter ${chapter.ID}`, error);
      continue;
    }

    for (const dua of duas) {
      const row = createDuaRow(chapter, dua);
      rowMap.set(row[0], row);
    }
  }

  return [...rowMap.values()];
}

async function getExistingRowIndexByDuaId(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${DUA_MASTER_SHEET}!A2:O`
  });

  const values = response.data.values || [];
  const index = new Map();

  values.forEach((row, idx) => {
    const duaId = compactText(row[0]);
    if (!duaId) {
      return;
    }
    index.set(duaId, idx + 2);
  });

  return index;
}

async function applyUpdates(sheets, spreadsheetId, updates) {
  if (updates.length === 0) {
    return;
  }

  const chunkSize = 250;
  for (let start = 0; start < updates.length; start += chunkSize) {
    const chunk = updates.slice(start, start + chunkSize);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: chunk
      }
    });
  }
}

async function appendRows(sheets, spreadsheetId, rows) {
  if (rows.length === 0) {
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${DUA_MASTER_SHEET}!A2:O`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows
    }
  });
}

async function upsertDuaMasterRows(rows) {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsService();

  await ensureSheetExistsAndHeaders(sheets, spreadsheetId);
  const existingIndex = await getExistingRowIndexByDuaId(sheets, spreadsheetId);

  const updates = [];
  const appends = [];

  for (const row of rows) {
    const duaId = row[0];
    const existingRowNumber = existingIndex.get(duaId);
    if (existingRowNumber) {
      updates.push({
        range: `${DUA_MASTER_SHEET}!A${existingRowNumber}:O${existingRowNumber}`,
        values: [row]
      });
    } else {
      appends.push(row);
    }
  }

  await applyUpdates(sheets, spreadsheetId, updates);
  await appendRows(sheets, spreadsheetId, appends);

  return {
    total: rows.length,
    updated: updates.length,
    inserted: appends.length
  };
}

async function run() {
  try {
    logInfo("Fetching HisnMuslim chapters and duas...");
    const rows = await buildMasterRows();
    logInfo(`Prepared ${rows.length} dua records for DUA_MASTER.`);

    const result = await upsertDuaMasterRows(rows);
    logInfo("DUA_MASTER import completed.", result);
  } catch (error) {
    logError("DUA_MASTER import failed", error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  run,
  buildMasterRows,
  upsertDuaMasterRows
};
