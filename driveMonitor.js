const cron = require("node-cron");
const { google } = require("googleapis");
const { getGoogleAuth } = require("./googleAuth");
const {
  DEFAULT_TIMEZONE,
  formatDateTimeInTimeZone,
  escapeHtml,
  logError,
  logInfo
} = require("./utils");

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DEFAULT_FOLDER_ID = "16O4S87mKVkg4PbC4GE4CpCFjQrV6ggd3";
const COOLDOWN_MS = 3 * 60 * 1000;

let driveClientPromise;

async function getDriveClient() {
  if (!driveClientPromise) {
    driveClientPromise = (async () => {
      const auth = getGoogleAuth();
      const authClient = await auth.getClient();
      return google.drive({
        version: "v3",
        auth: authClient
      });
    })();
  }
  return driveClientPromise;
}

class DriveMonitor {
  constructor({ bot, getTargetChatIds, timezone = DEFAULT_TIMEZONE, folderId = DEFAULT_FOLDER_ID }) {
    this.bot = bot;
    this.getTargetChatIds = getTargetChatIds;
    this.timezone = timezone;
    this.folderId = folderId;
    this.job = null;
    this.snapshot = new Map();
    this.cooldownMap = new Map();
    this.initialized = false;
  }

  start() {
    this.job = cron.schedule(
      "* * * * *",
      async () => {
        await this.safeCheckForChanges();
      },
      { timezone: this.timezone }
    );
    this.safeCheckForChanges();
    logInfo("Drive monitor started.");
  }

  stop() {
    if (!this.job) {
      return;
    }
    try {
      this.job.stop();
    } catch (error) {
      logError("Failed to stop Drive monitor job", error);
    }
    this.job = null;
  }

  async safeCheckForChanges() {
    try {
      await this.checkForChanges();
    } catch (error) {
      logError("Drive monitor iteration failed", error);
    }
  }

  async checkForChanges() {
    const currentSnapshot = await this.buildSnapshot(this.folderId);
    if (!this.initialized) {
      this.snapshot = currentSnapshot;
      this.initialized = true;
      logInfo(`Drive snapshot initialized with ${currentSnapshot.size} files.`);
      return;
    }

    const events = this.diffSnapshots(this.snapshot, currentSnapshot);
    this.snapshot = currentSnapshot;
    if (events.length === 0) {
      return;
    }

    const targetIds = this.getTargetChatIds?.();
    const chatIds = Array.isArray(targetIds) ? targetIds : [];
    if (chatIds.length === 0) {
      return;
    }

    for (const event of events) {
      if (!this.isAllowedByCooldown(event)) {
        continue;
      }

      const message = this.formatEventMessage(event);
      await Promise.allSettled(
        chatIds.map((chatId) =>
          this.bot.sendMessage(chatId, message, {
            parse_mode: "HTML",
            disable_web_page_preview: false
          })
        )
      );
    }
  }

  async buildSnapshot(rootFolderId) {
    const drive = await getDriveClient();
    const snapshot = new Map();
    const queue = [rootFolderId];
    const visited = new Set();

    while (queue.length > 0) {
      const folderId = queue.shift();
      if (!folderId || visited.has(folderId)) {
        continue;
      }
      visited.add(folderId);

      let pageToken = null;
      do {
        const response = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields:
            "nextPageToken, files(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners(displayName),lastModifyingUser(displayName))",
          pageSize: 1000,
          pageToken: pageToken || undefined,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true
        });

        const files = response.data.files || [];
        for (const file of files) {
          if (file.mimeType === FOLDER_MIME_TYPE) {
            queue.push(file.id);
            continue;
          }

          snapshot.set(file.id, {
            id: file.id,
            name: file.name || "Unnamed File",
            modifiedTime: file.modifiedTime || "",
            createdTime: file.createdTime || "",
            webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
            ownerName: file.owners?.[0]?.displayName || "Unknown",
            lastEditorName:
              file.lastModifyingUser?.displayName ||
              file.owners?.[0]?.displayName ||
              "Unknown"
          });
        }

        pageToken = response.data.nextPageToken || null;
      } while (pageToken);
    }

    return snapshot;
  }

  diffSnapshots(previousSnapshot, currentSnapshot) {
    const events = [];

    for (const [id, currentFile] of currentSnapshot.entries()) {
      const previousFile = previousSnapshot.get(id);
      if (!previousFile) {
        events.push({ type: "new", file: currentFile });
        continue;
      }

      if ((previousFile.modifiedTime || "") !== (currentFile.modifiedTime || "")) {
        events.push({ type: "updated", file: currentFile, previous: previousFile });
      }
    }

    for (const [id, previousFile] of previousSnapshot.entries()) {
      if (!currentSnapshot.has(id)) {
        events.push({ type: "deleted", file: previousFile });
      }
    }

    return events;
  }

  isAllowedByCooldown(event) {
    const fileId = event.file?.id || event.file?.name || "unknown";
    const key = `${event.type}:${fileId}`;
    const now = Date.now();
    const lastSent = this.cooldownMap.get(key) || 0;

    if (now - lastSent < COOLDOWN_MS) {
      return false;
    }

    this.cooldownMap.set(key, now);
    this.pruneCooldown(now);
    return true;
  }

  pruneCooldown(now) {
    for (const [key, timestamp] of this.cooldownMap.entries()) {
      if (now - timestamp > COOLDOWN_MS * 12) {
        this.cooldownMap.delete(key);
      }
    }
  }

  formatEventMessage(event) {
    if (event.type === "new") {
      return this.formatNewFileMessage(event.file);
    }
    if (event.type === "deleted") {
      return this.formatDeletedFileMessage(event.file);
    }
    return this.formatUpdatedFileMessage(event.file);
  }

  formatUpdatedFileMessage(file) {
    const { date, time } = formatDateTimeInTimeZone(file.modifiedTime || new Date(), this.timezone);

    return [
      "🌿 <b>Qur'an Tafseer Course - Official Update</b>",
      "",
      `📖 ${escapeHtml(file.name)} document has been updated.`,
      "",
      `🗓 Updated on: ${escapeHtml(date)}`,
      `⏰ Time: ${escapeHtml(time)}`,
      `👤 Updated by: ${escapeHtml(file.lastEditorName || "Unknown")}`,
      "",
      "🔗 Access here:",
      escapeHtml(file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`),
      "",
      "Please review the updated content."
    ].join("\n");
  }

  formatNewFileMessage(file) {
    const { date, time } = formatDateTimeInTimeZone(file.createdTime || new Date(), this.timezone);

    return [
      "🌿 <b>Qur'an Tafseer Course - Official Update</b>",
      "",
      "🆕 New document created.",
      "",
      `📖 ${escapeHtml(file.name)}`,
      "",
      `🗓 Created on: ${escapeHtml(date)}`,
      `⏰ Time: ${escapeHtml(time)}`,
      `👤 Created by: ${escapeHtml(file.ownerName || "Unknown")}`,
      "",
      "🔗 Access here:",
      escapeHtml(file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`),
      "",
      "Please review the new document."
    ].join("\n");
  }

  formatDeletedFileMessage(file) {
    const { date, time } = formatDateTimeInTimeZone(new Date(), this.timezone);

    return [
      "🌿 <b>Qur'an Tafseer Course - Official Update</b>",
      "",
      "❌ Document deleted.",
      "",
      `📖 ${escapeHtml(file.name)}`,
      "",
      `🗓 Deleted on: ${escapeHtml(date)}`,
      `⏰ Time: ${escapeHtml(time)}`,
      "",
      "Please contact admin if this was unintentional."
    ].join("\n");
  }
}

function createDriveMonitor(config) {
  return new DriveMonitor(config);
}

module.exports = {
  createDriveMonitor
};
