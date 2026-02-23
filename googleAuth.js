const { google } = require("googleapis");

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly"
];

let googleAuthInstance;

function getCredentialsFromEnv() {
  const rawCredentials = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!rawCredentials) {
    throw new Error(
      "Missing required environment variable: GOOGLE_CREDENTIALS_JSON. Set it to the full JSON content of your Google service account key."
    );
  }

  try {
    const parsed = JSON.parse(rawCredentials);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Credentials JSON must be an object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Invalid GOOGLE_CREDENTIALS_JSON. Expected valid JSON service account key content. ${error.message}`
    );
  }
}

function getGoogleAuth() {
  if (!googleAuthInstance) {
    googleAuthInstance = new google.auth.GoogleAuth({
      credentials: getCredentialsFromEnv(),
      scopes: GOOGLE_SCOPES
    });
  }
  return googleAuthInstance;
}

module.exports = {
  GOOGLE_SCOPES,
  getGoogleAuth
};
