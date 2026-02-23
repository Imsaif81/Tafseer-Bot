const cron = require("node-cron");
const { getRandomDuaByCategory, getSahihHadithForWeekday } = require("./sheets");
const { createSalahService } = require("./salah");
const { createDriveMonitor } = require("./driveMonitor");
const {
  DEFAULT_TIMEZONE,
  getWeekdayIndexInTimeZone,
  formatDuaMessage,
  formatHadithMessage,
  formatClassReminderMessage,
  logError,
  logInfo
} = require("./utils");

const DEFAULT_REMINDER_SETTINGS = {
  duas: true,
  hadith: true,
  salah: true
};

function createScheduler(bot, options = {}) {
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const knownChats = new Set();
  const reminderSettings = new Map();
  const cronJobs = [];
  let started = false;
  let salahService = null;
  let driveMonitor = null;

  function ensureChat(chatId) {
    const normalizedChatId = Number(chatId);
    if (!Number.isFinite(normalizedChatId)) {
      return null;
    }
    knownChats.add(normalizedChatId);
    if (!reminderSettings.has(normalizedChatId)) {
      reminderSettings.set(normalizedChatId, { ...DEFAULT_REMINDER_SETTINGS });
    }
    return normalizedChatId;
  }

  function registerChat(chatId) {
    ensureChat(chatId);
  }

  function getReminderStatus(chatId) {
    const normalizedChatId = ensureChat(chatId);
    if (normalizedChatId === null) {
      return { ...DEFAULT_REMINDER_SETTINGS };
    }
    return { ...reminderSettings.get(normalizedChatId) };
  }

  function setReminderSetting(chatId, key, enabled) {
    const normalizedChatId = ensureChat(chatId);
    if (normalizedChatId === null) {
      return { ...DEFAULT_REMINDER_SETTINGS };
    }
    const next = { ...reminderSettings.get(normalizedChatId) };
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      next[key] = Boolean(enabled);
      reminderSettings.set(normalizedChatId, next);
    }
    return { ...next };
  }

  function removeChat(chatId) {
    knownChats.delete(chatId);
    reminderSettings.delete(chatId);
  }

  function getChatsForSetting(key) {
    const selected = [];
    for (const chatId of knownChats) {
      const settings = reminderSettings.get(chatId) || DEFAULT_REMINDER_SETTINGS;
      if (settings[key]) {
        selected.push(chatId);
      }
    }
    return selected;
  }

  async function sendToChats(chatIds, message, options = {}) {
    const settled = await Promise.allSettled(
      chatIds.map((chatId) => bot.sendMessage(chatId, message, options))
    );

    settled.forEach((result, idx) => {
      if (result.status !== "rejected") {
        return;
      }
      const chatId = chatIds[idx];
      const statusCode = result.reason?.response?.statusCode;
      if (statusCode === 403 || statusCode === 400) {
        removeChat(chatId);
      }
      logError(`Failed to send message to chat ${chatId}`, result.reason);
    });
  }

  async function runScheduledDua(category) {
    const targets = getChatsForSetting("duas");
    if (targets.length === 0) {
      return;
    }

    const dua = await getRandomDuaByCategory(category);
    if (!dua) {
      logInfo(`No dua found for category: ${category}`);
      return;
    }

    await sendToChats(targets, formatDuaMessage(dua), {
      parse_mode: "HTML",
      disable_web_page_preview: true
    });
  }

  async function runScheduledHadith() {
    const targets = getChatsForSetting("hadith");
    if (targets.length === 0) {
      return;
    }

    const weekdayIndex = getWeekdayIndexInTimeZone(new Date(), timezone);
    const payload = await getSahihHadithForWeekday(weekdayIndex);
    if (!payload) {
      logInfo("No Sahih hadith available for scheduled reminder.");
      return;
    }

    await sendToChats(targets, formatHadithMessage(payload.hadith), {
      parse_mode: "HTML",
      disable_web_page_preview: true
    });
  }

  async function runClassReminder() {
    const targets = [...knownChats];
    if (targets.length === 0) {
      return;
    }

    await sendToChats(targets, formatClassReminderMessage(), {
      parse_mode: "HTML",
      disable_web_page_preview: true
    });
  }

  function withSafeExecution(jobName, handler) {
    return async () => {
      try {
        await handler();
      } catch (error) {
        logError(`Cron job failed: ${jobName}`, error);
      }
    };
  }

  function start() {
    if (started) {
      return;
    }
    started = true;

    cronJobs.push(
      cron.schedule("0 7 * * *", withSafeExecution("morning-dua", () => runScheduledDua("Morning")), {
        timezone
      })
    );
    cronJobs.push(
      cron.schedule(
        "30 18 * * *",
        withSafeExecution("evening-dua", () => runScheduledDua("Evening")),
        { timezone }
      )
    );
    cronJobs.push(
      cron.schedule("30 22 * * *", withSafeExecution("sleep-dua", () => runScheduledDua("Sleep")), {
        timezone
      })
    );
    cronJobs.push(
      cron.schedule("0 22 * * *", withSafeExecution("night-hadith", runScheduledHadith), {
        timezone
      })
    );
    cronJobs.push(
      cron.schedule("30 21 * * 6,0", withSafeExecution("class-reminder", runClassReminder), {
        timezone
      })
    );

    salahService = createSalahService({
      bot,
      timezone,
      getTargetChatIds: () => getChatsForSetting("salah")
    });
    salahService.start();

    driveMonitor = createDriveMonitor({
      bot,
      timezone,
      getTargetChatIds: () => [...knownChats]
    });
    driveMonitor.start();

    logInfo("Scheduler started.", { timezone });
  }

  function stop() {
    for (const job of cronJobs) {
      try {
        job.stop();
      } catch (error) {
        logError("Failed to stop cron job", error);
      }
    }
    cronJobs.length = 0;

    if (salahService) {
      salahService.stop();
      salahService = null;
    }
    if (driveMonitor) {
      driveMonitor.stop();
      driveMonitor = null;
    }
    started = false;
  }

  return {
    start,
    stop,
    registerChat,
    getReminderStatus,
    setReminderSetting,
    getKnownChatCount: () => knownChats.size
  };
}

module.exports = {
  createScheduler
};
