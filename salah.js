const cron = require("node-cron");
const axios = require("axios");
const {
  DEFAULT_TIMEZONE,
  getLocalDateParts,
  cleanApiTime,
  toMinutes,
  formatSalahMessage,
  logError,
  logInfo
} = require("./utils");

const ALADHAN_URL =
  "https://api.aladhan.com/v1/timingsByCity?city=Delhi&country=India&method=1&school=1";
const PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

class SalahService {
  constructor({ bot, getTargetChatIds, timezone = DEFAULT_TIMEZONE }) {
    this.bot = bot;
    this.getTargetChatIds = getTargetChatIds;
    this.timezone = timezone;
    this.jobs = [];
    this.prayerTimesByDate = new Map();
    this.sentByDate = new Map();
    this.isFetching = false;
  }

  start() {
    const fetchJob = cron.schedule(
      "5 0 * * *",
      async () => {
        await this.safeFetchPrayerTimes();
      },
      { timezone: this.timezone }
    );

    const checkJob = cron.schedule(
      "* * * * *",
      async () => {
        await this.safeCheckAndSend();
      },
      { timezone: this.timezone }
    );

    this.jobs.push(fetchJob, checkJob);
    this.safeFetchPrayerTimes();
    this.safeCheckAndSend();
    logInfo("Salah service started.");
  }

  stop() {
    for (const job of this.jobs) {
      try {
        job.stop();
      } catch (error) {
        logError("Failed to stop salah cron job", error);
      }
    }
    this.jobs = [];
  }

  async safeFetchPrayerTimes() {
    try {
      await this.fetchPrayerTimesForToday();
    } catch (error) {
      logError("Salah prayer time fetch failed", error);
    }
  }

  async fetchPrayerTimesForToday() {
    if (this.isFetching) {
      return;
    }
    this.isFetching = true;

    try {
      const response = await axios.get(ALADHAN_URL, { timeout: 15000 });
      const timings = response?.data?.data?.timings;
      if (!timings) {
        throw new Error("Invalid Aladhan response.");
      }

      const currentDateKey = getLocalDateParts(new Date(), this.timezone).dateKey;
      const normalized = {};
      for (const prayer of PRAYERS) {
        normalized[prayer] = cleanApiTime(timings[prayer]);
      }

      this.prayerTimesByDate.set(currentDateKey, normalized);
      if (!this.sentByDate.has(currentDateKey)) {
        this.sentByDate.set(currentDateKey, new Set());
      }
      this.cleanupStaleState(currentDateKey);
      logInfo(`Prayer times fetched for ${currentDateKey}`, normalized);
    } finally {
      this.isFetching = false;
    }
  }

  cleanupStaleState(activeDateKey) {
    for (const dateKey of this.prayerTimesByDate.keys()) {
      if (dateKey !== activeDateKey) {
        this.prayerTimesByDate.delete(dateKey);
      }
    }
    for (const dateKey of this.sentByDate.keys()) {
      if (dateKey !== activeDateKey) {
        this.sentByDate.delete(dateKey);
      }
    }
  }

  async safeCheckAndSend() {
    try {
      await this.checkAndSendPrayerReminders();
    } catch (error) {
      logError("Salah reminder check failed", error);
    }
  }

  async checkAndSendPrayerReminders() {
    const now = getLocalDateParts(new Date(), this.timezone);
    const dateKey = now.dateKey;
    const nowMinutes = toMinutes(now.timeKey);

    if (nowMinutes === null) {
      return;
    }

    if (!this.prayerTimesByDate.has(dateKey)) {
      await this.fetchPrayerTimesForToday();
    }

    const prayerTimes = this.prayerTimesByDate.get(dateKey);
    if (!prayerTimes) {
      return;
    }

    const sentSet = this.sentByDate.get(dateKey) || new Set();
    const targetIds = this.getTargetChatIds?.();
    const targetChats = Array.isArray(targetIds) ? targetIds : [];

    if (targetChats.length === 0) {
      return;
    }

    for (const prayer of PRAYERS) {
      const prayerMinutes = toMinutes(prayerTimes[prayer]);
      if (prayerMinutes === null) {
        continue;
      }

      if (Math.abs(nowMinutes - prayerMinutes) <= 1 && !sentSet.has(prayer)) {
        await this.broadcast(targetChats, formatSalahMessage(prayer));
        sentSet.add(prayer);
      }
    }

    this.sentByDate.set(dateKey, sentSet);
  }

  async broadcast(chatIds, message) {
    await Promise.allSettled(
      chatIds.map((chatId) =>
        this.bot.sendMessage(chatId, message, {
          parse_mode: "HTML",
          disable_web_page_preview: true
        })
      )
    );
  }
}

function createSalahService(config) {
  return new SalahService(config);
}

module.exports = {
  createSalahService
};
