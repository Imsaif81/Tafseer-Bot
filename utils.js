const DEFAULT_TIMEZONE = "Asia/Kolkata";

function logInfo(message, meta) {
  if (meta !== undefined) {
    console.log(`[INFO] ${message}`, meta);
    return;
  }
  console.log(`[INFO] ${message}`);
}

function logError(message, error) {
  if (!error) {
    console.error(`[ERROR] ${message}`);
    return;
  }

  if (error instanceof Error) {
    console.error(`[ERROR] ${message}: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    return;
  }

  console.error(`[ERROR] ${message}`, error);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeWords(text) {
  return normalizeText(text)
    .split(" ")
    .filter(Boolean);
}

function parseUsedFlag(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function getLocalDateParts(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    weekday: map.weekday,
    weekdayIndex: weekdayMap[map.weekday] ?? 0,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
    dateKey: `${map.year}-${map.month}-${map.day}`,
    timeKey: `${map.hour}:${map.minute}`
  };
}

function getWeekdayIndexInTimeZone(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return getLocalDateParts(date, timeZone).weekdayIndex;
}

function formatDateTimeInTimeZone(dateInput, timeZone = DEFAULT_TIMEZONE) {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) {
    return { date: "N/A", time: "N/A" };
  }

  const formattedDate = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);

  const formattedTime = new Intl.DateTimeFormat("en-IN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(date);

  return { date: formattedDate, time: formattedTime };
}

function cleanApiTime(rawValue) {
  return String(rawValue ?? "")
    .split(" ")[0]
    .trim()
    .slice(0, 5);
}

function toMinutes(hhmm) {
  const parts = String(hhmm ?? "").split(":");
  if (parts.length !== 2) {
    return null;
  }
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function nowIso() {
  return new Date().toISOString();
}

function formatDuaMessage(dua) {
  return [
    "🌿 <b>Qur'an Tafseer Course - Daily Reminder</b>",
    "",
    `🌙 ${escapeHtml(dua.category || "General")} Dua`,
    "",
    escapeHtml(dua.arabic || "N/A"),
    "",
    "English:",
    escapeHtml(dua.english || "N/A"),
    "",
    "Urdu:",
    escapeHtml(dua.urdu || "N/A"),
    "",
    `📚 Source: ${escapeHtml(dua.source || "N/A")}`,
    `Authenticity: ${escapeHtml(dua.authenticity || "N/A")}`
  ].join("\n");
}

function formatHadithMessage(hadith) {
  return [
    "🌿 <b>Qur'an Tafseer Course - Night Reminder</b>",
    "",
    "📖 Hadith of the Day",
    "",
    escapeHtml(hadith.arabic || "N/A"),
    "",
    "English:",
    escapeHtml(hadith.english || "N/A"),
    "",
    "Urdu:",
    escapeHtml(hadith.urdu || "N/A"),
    "",
    `📚 Source: ${escapeHtml(hadith.source || "N/A")}`,
    "Authenticity: Sahih"
  ].join("\n");
}

function formatSalahMessage(prayerName) {
  return [
    "🌿 <b>Qur'an Tafseer Course - Salah Reminder</b>",
    `🕌 It is time for <b>${escapeHtml(prayerName)}</b> (Delhi)`
  ].join("\n");
}

function formatClassReminderMessage() {
  return [
    "🌿 <b>Qur'an Tafseer Course - Class Reminder</b>",
    "",
    "📚 Reminder: Weekend class starts at 10:00 PM (Asia/Kolkata).",
    "Please join on time."
  ].join("\n");
}

module.exports = {
  DEFAULT_TIMEZONE,
  logInfo,
  logError,
  escapeHtml,
  normalizeText,
  tokenizeWords,
  parseUsedFlag,
  getLocalDateParts,
  getWeekdayIndexInTimeZone,
  formatDateTimeInTimeZone,
  cleanApiTime,
  toMinutes,
  nowIso,
  formatDuaMessage,
  formatHadithMessage,
  formatSalahMessage,
  formatClassReminderMessage
};
