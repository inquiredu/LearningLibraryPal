# Learning Library Engine

A Google Apps Script web application that manages the full content lifecycle for collaborative learning sessions — from intake through synthesis, AI-powered Gems, a shareable learning library, and pre-session email.

## Setup Instructions

1. Clone repo and `cd LearningLibrary`
2. **Important:** Copy the `.clasp.json` configuration or run `clasp create` if you are deploying a fresh instance.
3. `clasp login` then `clasp push`
4. In the GAS editor → Project Settings → Script Properties, add:
   - `GEMINI_API_KEY` — from [Google AI Studio](https://aistudio.google.com/)
   - `ROOT_FOLDER_ID` — (optional) a Drive folder ID; auto-created in My Drive if missing
5. Deploy as Web App: **Execute as** `User accessing the web app` · **Who has access** `Anyone`
6. Authorize scopes by running any function in the editor the first time.

## Key Features
- **Wizard:** New Session form creates Drive folders, Master Sheet row, Gemini session brief
- **Synthesis:** Gemini analysis of each resource
- **Gems:** AI persona prompt structures
- **Library:** Shareable learning library page per session
- **Email:** Gemini-drafted pre-session email

## Tech Stack
- Google Apps Script (V8)
- Gemini 1.5 Flash via Google AI Studio REST API
- Google Drive & Google Sheets
- `clasp` for local development
