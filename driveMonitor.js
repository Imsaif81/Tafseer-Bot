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
    const { snapshot: currentSnapshot, trashedIds } = await this.buildSnapshot(this.folderId);
    if (!this.initialized) {
      this.snapshot = currentSnapshot;
      this.initialized = true;
      logInfo(`Drive snapshot initialized with ${currentSnapshot.size} files.`);
      return;
    }

    const events = this.diffSnapshots(this.snapshot, currentSnapshot, trashedIds);
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
    const trashedIds = new Set();
    const queue = [rootFolderId];
    const visited = new Set();

    while (queue.length > 0) {
      const folderId = queue.shift();
      if (!folderId || visited.has(folderId)) {
        continue;
      }
      visited.add(folderId);

      const activeFiles = await this.listFilesByTrashState(drive, folderId, false);
      for (const file of activeFiles) {
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

      const trashedFiles = await this.listFilesByTrashState(drive, folderId, true);
      for (const file of trashedFiles) {
        if (file?.id) {
          trashedIds.add(file.id);
        }
      }
    }

    return { snapshot, trashedIds };
  }

  async listFilesByTrashState(drive, folderId, trashed) {
    const files = [];
    let pageToken = null;

    do {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed=${trashed ? "true" : "false"}`,
        fields:
          "nextPageToken, files(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners(displayName),lastModifyingUser(displayName))",
        pageSize: 1000,
        pageToken: pageToken || undefined,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      });

      files.push(...(response.data.files || []));
      pageToken = response.data.nextPageToken || null;
    } while (pageToken);

    return files;
  }

  diffSnapshots(previousSnapshot, currentSnapshot, trashedIds = new Set()) {
    const events = [];

    for (const [id, currentFile] of currentSnapshot.entries()) {
      if (trashedIds.has(id)) {
        continue;
      }

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
      const missingFromCurrent = !currentSnapshot.has(id);
      const movedToTrash = trashedIds.has(id);
      if (missingFromCurrent || movedToTrash) {
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
    const separator = "━━━━━━━━━━━━━━━━━━";
    const fileName = escapeHtml(String(file.name || "Unnamed File").slice(0, 220));
    const editor = escapeHtml(String(file.lastEditorName || "Unknown").slice(0, 120));
    const link = escapeHtml(String(file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`));
    const formattedDateTime = escapeHtml(`${date} ${time}`);

    const message = [
      "📁 <b>Drive Activity</b>",
      separator,
      "✏️ <b>Document Updated</b>",
      `📄 <b>${fileName}</b>`,
      `👤 Updated by: ${editor}`,
      `🕒 ${formattedDateTime}`,
      `🔗 <a href="${link}">View Document</a>`
    ].join("\n");

    return message.length <= 4096 ? message : `${message.slice(0, 4093)}...`;
  }

  formatNewFileMessage(file) {
    const { date, time } = formatDateTimeInTimeZone(file.createdTime || new Date(), this.timezone);
    const separator = "━━━━━━━━━━━━━━━━━━";
    const fileName = escapeHtml(String(file.name || "Unnamed File").slice(0, 220));
    const owner = escapeHtml(String(file.ownerName || "Unknown").slice(0, 120));
    const link = escapeHtml(String(file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`));
    const formattedDateTime = escapeHtml(`${date} ${time}`);

    const message = [
      "📁 <b>Drive Activity</b>",
      separator,
      "🆕 <b>New File Created</b>",
      `📄 <b>${fileName}</b>`,
      `👤 Owner: ${owner}`,
      `🕒 ${formattedDateTime}`,
      `🔗 <a href="${link}">Open Document</a>`
    ].join("\n");

    return message.length <= 4096 ? message : `${message.slice(0, 4093)}...`;
  }

  formatDeletedFileMessage(file) {
    const { date, time } = formatDateTimeInTimeZone(new Date(), this.timezone);
    const separator = "━━━━━━━━━━━━━━━━━━";
    const fileName = escapeHtml(String(file.name || "Unnamed File").slice(0, 220));
    const editor = escapeHtml(String(file.lastEditorName || "Unknown").slice(0, 120));
    const formattedDateTime = escapeHtml(`${date} ${time}`);

    const message = [
      "📁 <b>Drive Activity</b>",
      separator,
      "❌ <b>File Deleted</b>",
      `📄 <b>${fileName}</b>`,
      `👤 Last edited by: ${editor}`,
      `🕒 ${formattedDateTime}`,
      "⚠️ This file was removed from the monitored folder."
    ].join("\n");

    return message.length <= 4096 ? message : `${message.slice(0, 4093)}...`;
  }
}

function createDriveMonitor(config) {
  return new DriveMonitor(config);
}

module.exports = {
  createDriveMonitor
};
