const DEFAULT_TIMEZONE = "Asia/Kolkata";
const LOG_LEVELS = {
  important: 1,
  debug: 2
};

const rawLogLevel = String(process.env.LOG_LEVEL || "important")
  .trim()
  .toLowerCase();
const CURRENT_LOG_LEVEL = LOG_LEVELS[rawLogLevel] ? rawLogLevel : "important";

function shouldLog(level) {
  const normalizedLevel = LOG_LEVELS[level] ? level : "important";
  return LOG_LEVELS[CURRENT_LOG_LEVEL] >= LOG_LEVELS[normalizedLevel];
}

function getLogLevel() {
  return CURRENT_LOG_LEVEL;
}

function logInfo(message, meta) {
  if (!shouldLog("important")) {
    return;
  }

  if (meta !== undefined) {
    if (shouldLog("debug")) {
      console.log(`[INFO] ${message}`, meta);
      return;
    }

    console.log(`[INFO] ${message}`);
    return;
  }

  console.log(`[INFO] ${message}`);
}

function logDebug(message, meta) {
  if (!shouldLog("debug")) {
    return;
  }

  if (meta !== undefined) {
    console.log(`[DEBUG] ${message}`, meta);
    return;
  }

  console.log(`[DEBUG] ${message}`);
}

function logError(message, error) {
  if (!shouldLog("important")) {
    return;
  }

  if (!error) {
    console.error(`[ERROR] ${message}`);
    return;
  }

  if (error instanceof Error) {
    console.error(`[ERROR] ${message}: ${error.message}`);
    if (error.stack && shouldLog("debug")) {
      console.error(error.stack);
    }
    return;
  }

  console.error(`[ERROR] ${message}`);
  if (shouldLog("debug")) {
    console.error(error);
  }
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
  const separator = "━━━━━━━━━━━━━━━━━━";
  const clip = (value, max) => {
    const text = escapeHtml(value || "N/A");
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
  };

  const message = [
    "🌿 <b>Tafseer Bot</b>",
    separator,
    "🕊 <b>Daily Dua Reminder</b>",
    separator,
    `🌙 <b>Category:</b> ${clip(dua.category || "General", 80)} Dua`,
    separator,
    "🕋 <b>Arabic</b>",
    clip(dua.arabic, 900),
    separator,
    "🇬🇧 <b>English</b>",
    clip(dua.english, 900),
    separator,
    "🇵🇰 <b>Urdu</b>",
    clip(dua.urdu, 900),
    separator,
    `📚 <b>Source:</b> ${clip(dua.source, 220)}`,
    `✅ <b>Authenticity:</b> ${clip(dua.authenticity, 120)}`
  ].join("\n");

  return message.length <= 4096 ? message : `${message.slice(0, 4093)}...`;
}

function formatHadithMessage(hadith) {
  const separator = "━━━━━━━━━━━━━━━━━━";
  const clip = (value, max) => {
    const text = escapeHtml(value || "N/A");
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
  };

  const message = [
    "🌿 <b>Tafseer Bot</b>",
    separator,
    "📜 <b>Nightly Sahih Hadith</b>",
    separator,
    "📖 <b>Hadith of the Day</b>",
    separator,
    "🕋 <b>Arabic</b>",
    clip(hadith.arabic, 900),
    separator,
    "🇬🇧 <b>English</b>",
    clip(hadith.english, 900),
    separator,
    "🇵🇰 <b>Urdu</b>",
    clip(hadith.urdu, 900),
    separator,
    `📚 <b>Source:</b> ${clip(hadith.source, 220)}`,
    "✅ <b>Authenticity:</b> Sahih"
  ].join("\n");

  return message.length <= 4096 ? message : `${message.slice(0, 4093)}...`;
}

function formatSalahMessage(prayerName) {
  const separator = "━━━━━━━━━━━━━━━━━━";
  const safePrayer = escapeHtml(prayerName || "Prayer");
  const message = [
    "🌿 <b>Tafseer Bot</b>",
    separator,
    "🕌 <b>Salah Reminder</b>",
    separator,
    `🕌 <b>Now:</b> ${safePrayer} (Delhi)`,
    "⏳ <b>Please prepare for salah.</b>"
  ].join("\n");

  return message.length <= 4096 ? message : `${message.slice(0, 4093)}...`;
}

function formatClassReminderMessage() {
  const separator = "━━━━━━━━━━━━━━━━━━";
  const message = [
    "🌿 <b>Tafseer Bot</b>",
    separator,
    "🎓 <b>Weekend Class Reminder</b>",
    separator,
    "🕘 <b>Time:</b> 10:00 PM (Asia/Kolkata)",
    "📚 <b>Note:</b> Please join a few minutes early."
  ].join("\n");

  return message.length <= 4096 ? message : `${message.slice(0, 4093)}...`;
}

module.exports = {
  DEFAULT_TIMEZONE,
  getLogLevel,
  logInfo,
  logDebug,
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
