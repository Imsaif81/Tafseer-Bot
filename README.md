# Tafseer Bot

Production-ready Telegram bot (Node.js, polling mode) for:
- daily dua reminders
- nightly hadith reminders
- salah reminders from Aladhan API
- weekend class reminders
- fuzzy dua search
- Google Drive folder monitoring updates

Developer: **Md Saif**

## Tech Stack
- `node-telegram-bot-api` (long polling, no webhook)
- `googleapis` (Sheets + Drive APIs)
- `node-cron`
- `axios`
- `dotenv`

## Project Structure
```txt
tafseer-bot/
├── bot.js
├── scheduler.js
├── sheets.js
├── search.js
├── salah.js
├── driveMonitor.js
├── utils.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Google Sheets Setup
Spreadsheet must contain these sheets exactly:

### 1) `Duas_50`
- A: ID
- B: Category (`Morning`, `Evening`, `Sleep`)
- C: Arabic
- D: English
- E: Urdu
- F: Source
- G: Authenticity
- H: Used (`TRUE`/`FALSE`)
- I: LastSent

### 2) `Hadith_300`
- A: ID
- B: Theme
- C: Arabic
- D: English
- E: Urdu
- F: Source
- G: Authenticity (`Sahih` only used)
- H: Used
- I: LastSent

## Environment Variables
Environment Variables required in Railway:

```env
BOT_TOKEN=your_telegram_bot_token
SPREADSHEET_ID=your_google_sheet_id
GOOGLE_CREDENTIALS_JSON=full JSON content of service account key
```

## Google Credentials
1. Create a Google Cloud service account.
2. Enable:
   - Google Sheets API
   - Google Drive API
3. Copy the full service account key JSON content.
4. Share:
   - your spreadsheet with the service account email (Editor)
   - drive folder `16O4S87mKVkg4PbC4GE4CpCFjQrV6ggd3` with the service account email (Viewer)

## Local Run
```bash
npm install
npm run check
npm start
```

## Railway Deployment
1. Push this project to GitHub.
2. Create a new Railway project from the repo.
3. Set variables in Railway:
   - `BOT_TOKEN`
   - `SPREADSHEET_ID`
   - `GOOGLE_CREDENTIALS_JSON` (full JSON content)
4. Start command:
   - `npm start`
5. Deploy.

## Cron Schedules (Asia/Kolkata)
- Morning Dua: `07:00`
- Evening Dua: `18:30`
- Sleep Dua: `22:30`
- Hadith: `22:00`
- Class Reminder: Saturday and Sunday `21:30`
- Salah timings fetch: daily `00:05`
- Salah reminder check: every minute
- Drive monitor check: every minute
