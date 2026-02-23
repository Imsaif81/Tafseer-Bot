const { google } = require("googleapis");
const { getGoogleAuth } = require("./googleAuth");
const { parseUsedFlag, nowIso } = require("./utils");

const DUA_SHEET = "Duas_50";
const HADITH_SHEET = "Hadith_300";

const CACHE_TTL_MS = 30 * 1000;

let sheetsClientPromise;
const cache = {
  duas: { data: null, expiresAt: 0 },
  hadith: { data: null, expiresAt: 0 }
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
  getAllDuas,
  getAllHadith,
  getRandomDuaByCategory,
  getSahihHadithForWeekday
};
