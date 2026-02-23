const cron = require("node-cron");
const { google } = require("googleapis");
const { getGoogleAuth } = require("./googleAuth");
const {
  DEFAULT_TIMEZONE,
  formatDateTimeInTimeZone,
  logError,
  logInfo
} = require("./utils");

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DEFAULT_FOLDER_ID = "16O4S87mKVkg4PbC4GE4CpCFjQrV6ggd3";
const COOLDOWN_MS = 3 * 60 * 1000;
const DRIVE_EVENT_TYPES = Object.freeze({
  FILE_CREATED: 1,
  FILE_UPDATED: 2,
  FILE_DELETED: 3,
  FOLDER_CREATED: 4,
  FOLDER_DELETED: 5
});

let driveClientPromise;

function escapeMarkdown(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/([_*`\[])/g, "\\$1");
}

function normalizeDriveText(value, { fallback = "Unknown", max = 220 } = {}) {
  const compact = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const safe = compact ? compact.slice(0, max) : fallback;
  return escapeMarkdown(safe);
}

function normalizeDriveLink(value) {
  return String(value ?? "").trim();
}

function generateDriveEventMessage(eventType, data = {}) {
  const fileName = normalizeDriveText(data.fileName, { fallback: "Unnamed File", max: 220 });
  const folderName = normalizeDriveText(data.folderName, { fallback: "Unnamed Folder", max: 220 });
  const date = normalizeDriveText(data.date, { fallback: "N/A", max: 50 });
  const time = normalizeDriveText(data.time, { fallback: "N/A", max: 50 });
  const editorName = normalizeDriveText(data.editorName, { fallback: "Unknown", max: 120 });
  const fileLink = normalizeDriveLink(data.fileLink);

  if (eventType === DRIVE_EVENT_TYPES.FILE_CREATED) {
    return [
      "*🌿 Qur’an Tafseer Course – New File Added*",
      "",
      `📄 ${fileName} has been created.`,
      "",
      `🗓 *Created on:* ${date}`,
      `⏰ *Time:* ${time}`,
      `👤 *Created by:* ${editorName}`,
      "",
      "🔗 *Access here:*",
      fileLink,
      "",
      "Please review the newly added file."
    ].join("\n");
  }

  if (eventType === DRIVE_EVENT_TYPES.FILE_UPDATED) {
    return [
      "*🌿 Qur’an Tafseer Course – Official Update*",
      "",
      `📖 ${fileName} has been updated.`,
      "",
      `🗓 *Updated on:* ${date}`,
      `⏰ *Time:* ${time}`,
      `👤 *Updated by:* ${editorName}`,
      "",
      "🔗 *Access here:*",
      fileLink,
      "",
      "Please review the updated content."
    ].join("\n");
  }

  if (eventType === DRIVE_EVENT_TYPES.FILE_DELETED) {
    return [
      "*🌿 Qur’an Tafseer Course – File Removed*",
      "",
      `❌ ${fileName} has been deleted.`,
      "",
      `🗓 *Deleted on:* ${date}`,
      `⏰ *Time:* ${time}`,
      `👤 *Deleted by:* ${editorName}`,
      "",
      "This file is no longer available in the course folder."
    ].join("\n");
  }

  if (eventType === DRIVE_EVENT_TYPES.FOLDER_CREATED) {
    return [
      "*🌿 Qur’an Tafseer Course – New Folder Created*",
      "",
      `📁 ${folderName} folder has been created.`,
      "",
      `🗓 *Created on:* ${date}`,
      `⏰ *Time:* ${time}`,
      `👤 *Created by:* ${editorName}`,
      "",
      "This folder is now available in the course directory."
    ].join("\n");
  }

  if (eventType === DRIVE_EVENT_TYPES.FOLDER_DELETED) {
    return [
      "*🌿 Qur’an Tafseer Course – Folder Removed*",
      "",
      `❌ ${folderName} folder has been deleted.`,
      "",
      `🗓 *Deleted on:* ${date}`,
      `⏰ *Time:* ${time}`,
      `👤 *Deleted by:* ${editorName}`,
      "",
      "This folder is no longer available in the course directory."
    ].join("\n");
  }

  throw new Error(`Unsupported drive event type: ${eventType}`);
}

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
            parse_mode: "Markdown",
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
    const message = generateDriveEventMessage(DRIVE_EVENT_TYPES.FILE_UPDATED, {
      fileName: file.name,
      date,
      time,
      editorName: file.lastEditorName || "Unknown",
      fileLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
    });
    return message.length <= 4096 ? message : `${message.slice(0, 4093)}...`;
  }

  formatNewFileMessage(file) {
    const { date, time } = formatDateTimeInTimeZone(file.createdTime || new Date(), this.timezone);
    const message = generateDriveEventMessage(DRIVE_EVENT_TYPES.FILE_CREATED, {
      fileName: file.name,
      date,
      time,
      editorName: file.ownerName || "Unknown",
      fileLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
    });
    return message.length <= 4096 ? message : `${message.slice(0, 4093)}...`;
  }

  formatDeletedFileMessage(file) {
    const { date, time } = formatDateTimeInTimeZone(new Date(), this.timezone);
    const message = generateDriveEventMessage(DRIVE_EVENT_TYPES.FILE_DELETED, {
      fileName: file.name,
      date,
      time,
      editorName: file.lastEditorName || "Unknown"
    });
    return message.length <= 4096 ? message : `${message.slice(0, 4093)}...`;
  }
}

function createDriveMonitor(config) {
  return new DriveMonitor(config);
}

module.exports = {
  DRIVE_EVENT_TYPES,
  createDriveMonitor,
  generateDriveEventMessage
};
