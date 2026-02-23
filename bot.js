require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { createScheduler } = require("./scheduler");
const { getAllDuas } = require("./sheets");
const {
  beginDuaSearch,
  setDuaSelectionState,
  getDuaSearchState,
  clearDuaSearchState,
  rankDuaMatches
} = require("./search");
const { escapeHtml, formatDuaMessage, logError, logInfo } = require("./utils");

const REQUIRED_ENV_KEYS = ["BOT_TOKEN", "SPREADSHEET_ID", "GOOGLE_CREDENTIALS_JSON"];
for (const key of REQUIRED_ENV_KEYS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: {
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

const scheduler = createScheduler(bot);
scheduler.start();

function getSenderId(msg) {
  return msg?.from?.id || msg?.chat?.id;
}

function registerChatFromMessage(msg) {
  if (!msg?.chat?.id) {
    return;
  }
  scheduler.registerChat(msg.chat.id);
}

async function sendHtml(chatId, html, options = {}) {
  try {
    await bot.sendMessage(chatId, html, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...options
    });
  } catch (error) {
    logError(`Failed to send message to chat ${chatId}`, error);
  }
}

function formatReminderStatus(status) {
  return [
    `• Duas: <b>${status.duas ? "ON" : "OFF"}</b>`,
    `• Hadith: <b>${status.hadith ? "ON" : "OFF"}</b>`,
    `• Salah: <b>${status.salah ? "ON" : "OFF"}</b>`
  ].join("\n");
}

function buildHelpText() {
  return [
    "📚 <b>Tafseer Bot Commands</b>",
    "",
    "/start - Welcome message",
    "/help - Show command list",
    "/info - Features and reminder status",
    "/dua - Search duas by keyword",
    "/duas on | /duas off - Toggle scheduled dua reminders",
    "/hadith on | /hadith off - Toggle scheduled hadith reminders",
    "/salah on | /salah off - Toggle salah reminders"
  ].join("\n");
}

function buildInfoText(chatId) {
  const status = scheduler.getReminderStatus(chatId);

  return [
    "🌿 <b>Tafseer Bot</b>",
    "",
    "Features:",
    "• Daily Morning, Evening, and Sleep dua reminders",
    "• Nightly Sahih hadith reminders with theme rotation",
    "• Daily salah timing reminders (Delhi, Aladhan API)",
    "• Weekend class reminder (Sat/Sun 9:30 PM for 10:00 PM class)",
    "• Dua fuzzy search (50% overlap rule)",
    "• Google Drive folder change monitoring (new/update/delete)",
    "",
    "Reminder Status:",
    formatReminderStatus(status),
    "",
    "Developer: <b>Md Saif</b>"
  ].join("\n");
}

async function setBotCommands() {
  try {
    await bot.setMyCommands([
      { command: "start", description: "Welcome message" },
      { command: "help", description: "List all commands" },
      { command: "info", description: "Bot features and reminder status" },
      { command: "dua", description: "Search dua by keywords" },
      { command: "duas", description: "Toggle dua reminders (on/off)" },
      { command: "hadith", description: "Toggle hadith reminders (on/off)" },
      { command: "salah", description: "Toggle salah reminders (on/off)" }
    ]);
  } catch (error) {
    logError("Failed to set bot commands", error);
  }
}

bot.onText(/^\/start(?:@\w+)?$/i, async (msg) => {
  registerChatFromMessage(msg);
  const chatId = msg.chat.id;

  await sendHtml(
    chatId,
    [
      "🌿 <b>Assalamu Alaikum!</b>",
      "",
      "Welcome to <b>Tafseer Bot</b>.",
      "Use /help to see all commands."
    ].join("\n")
  );
});

bot.onText(/^\/help(?:@\w+)?$/i, async (msg) => {
  registerChatFromMessage(msg);
  await sendHtml(msg.chat.id, buildHelpText());
});

bot.onText(/^\/info(?:@\w+)?$/i, async (msg) => {
  registerChatFromMessage(msg);
  await sendHtml(msg.chat.id, buildInfoText(msg.chat.id));
});

bot.onText(/^\/dua(?:@\w+)?$/i, async (msg) => {
  registerChatFromMessage(msg);
  beginDuaSearch(msg.chat.id, getSenderId(msg));

  await sendHtml(
    msg.chat.id,
    "🔎 Dua search mode enabled.\nSend keywords (English/Urdu/Arabic) to find matching duas."
  );
});

bot.onText(/^\/duas(?:@\w+)?$/i, async (msg) => {
  registerChatFromMessage(msg);
  await sendHtml(msg.chat.id, "Usage: /duas on or /duas off");
});

bot.onText(/^\/hadith(?:@\w+)?$/i, async (msg) => {
  registerChatFromMessage(msg);
  await sendHtml(msg.chat.id, "Usage: /hadith on or /hadith off");
});

bot.onText(/^\/salah(?:@\w+)?$/i, async (msg) => {
  registerChatFromMessage(msg);
  await sendHtml(msg.chat.id, "Usage: /salah on or /salah off");
});

bot.onText(/^\/duas(?:@\w+)?\s+(on|off)$/i, async (msg, match) => {
  registerChatFromMessage(msg);
  const enabled = String(match[1]).toLowerCase() === "on";
  const status = scheduler.setReminderSetting(msg.chat.id, "duas", enabled);

  await sendHtml(
    msg.chat.id,
    `✅ Dua reminders are now <b>${status.duas ? "ON" : "OFF"}</b>.`
  );
});

bot.onText(/^\/hadith(?:@\w+)?\s+(on|off)$/i, async (msg, match) => {
  registerChatFromMessage(msg);
  const enabled = String(match[1]).toLowerCase() === "on";
  const status = scheduler.setReminderSetting(msg.chat.id, "hadith", enabled);

  await sendHtml(
    msg.chat.id,
    `✅ Hadith reminders are now <b>${status.hadith ? "ON" : "OFF"}</b>.`
  );
});

bot.onText(/^\/salah(?:@\w+)?\s+(on|off)$/i, async (msg, match) => {
  registerChatFromMessage(msg);
  const enabled = String(match[1]).toLowerCase() === "on";
  const status = scheduler.setReminderSetting(msg.chat.id, "salah", enabled);

  await sendHtml(
    msg.chat.id,
    `✅ Salah reminders are now <b>${status.salah ? "ON" : "OFF"}</b>.`
  );
});

bot.on("message", async (msg) => {
  registerChatFromMessage(msg);
  if (!msg?.text) {
    return;
  }

  const text = msg.text.trim();
  if (!text || text.startsWith("/")) {
    return;
  }

  const chatId = msg.chat.id;
  const senderId = getSenderId(msg);
  const state = getDuaSearchState(chatId, senderId);
  if (!state) {
    return;
  }

  if (state.stage === "awaiting_query") {
    try {
      const duas = await getAllDuas();
      const matches = rankDuaMatches(duas, text);

      if (matches.length === 0) {
        await sendHtml(chatId, "No matching dua found. Try different keywords.");
        return;
      }

      if (matches.length === 1) {
        clearDuaSearchState(chatId, senderId);
        await sendHtml(chatId, formatDuaMessage(matches[0]));
        return;
      }

      const topOptions = matches.slice(0, 3);
      setDuaSelectionState(chatId, senderId, topOptions);
      const items = topOptions.map((dua, index) => {
        const previewText = String(dua.english || dua.arabic || "No text")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);
        return `${index + 1}. [${escapeHtml(dua.category || "General")}] ${escapeHtml(previewText)}`;
      });

      const notice = matches.length > 3 ? "\n\nShowing top 3 matches." : "";
      await sendHtml(
        chatId,
        [
          "Multiple matches found. Reply with a number:",
          ...items,
          notice,
          "",
          "Send 1, 2, or 3."
        ]
          .filter(Boolean)
          .join("\n")
      );
      return;
    } catch (error) {
      logError("Dua search query handling failed", error);
      await sendHtml(chatId, "Search failed due to a temporary error. Please try again.");
      return;
    }
  }

  if (state.stage === "awaiting_selection") {
    const selectedNumber = Number.parseInt(text, 10);
    if (!Number.isInteger(selectedNumber) || selectedNumber < 1 || selectedNumber > 3) {
      await sendHtml(chatId, "Please send a valid number (1, 2, or 3), or use /dua to restart.");
      return;
    }

    const selected = state.options[selectedNumber - 1];
    if (!selected) {
      await sendHtml(chatId, "Invalid selection. Use /dua to start a new search.");
      return;
    }

    clearDuaSearchState(chatId, senderId);
    await sendHtml(chatId, formatDuaMessage(selected));
  }
});

bot.on("polling_error", (error) => {
  logError("Polling error", error);
});

bot.on("webhook_error", (error) => {
  logError("Webhook error (should be unused in polling mode)", error);
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled rejection", reason);
});

process.on("uncaughtException", (error) => {
  logError("Uncaught exception", error);
});

function handleShutdown(signal) {
  logInfo(`Received ${signal}. Shutting down bot...`);
  scheduler.stop();
  bot
    .stopPolling()
    .catch((error) => {
      logError("Failed to stop polling cleanly", error);
    })
    .finally(() => {
      process.exit(0);
    });
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

setBotCommands();
logInfo("Tafseer Bot started in polling mode.");
