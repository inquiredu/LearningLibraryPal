# Learning Library Engine

A Google Apps Script web application that manages the full content lifecycle for collaborative learning sessions — from intake through synthesis, AI-powered Gems, a shareable learning library, and pre-session email.

This project is open-source and ready for you to deploy and customize for your own organization or community.

## How to Deploy Your Own Instance

Since this is a Google Apps Script project, you don't need a traditional server to run it. Google hosts it entirely for free within your Google Workspace or Gmail account.

The easiest way to build and manage this project is by using `clasp` (Command Line Apps Script Projects), a tool provided by Google.

### Prerequisites
1. A Google Account (Workspace/GSuite is recommended, but a standard Gmail works).
2. [Node.js](https://nodejs.org/) installed on your computer.
3. Your own Gemini API Key. You can get a free one from [Google AI Studio](https://aistudio.google.com/).

---

### Step 1: Clone the Repository
Open your terminal (or GitHub Codespace / VS Code) and clone this repository to your local machine:
```bash
git clone https://github.com/inquiredu/LearningLibrary.git
cd LearningLibrary
```

### Step 2: Install Google Clasp
Install the `clasp` utility globally so you can use it from your command line:
```bash
npm install -g @google/clasp
```

### Step 3: Authenticate with Google
Log in to your Google account via the command line. This allows `clasp` to push code directly to your Google Drive.
```bash
clasp login
```
*A browser window will open. Sign in and grant the necessary permissions.*

### Step 4: Create a New Apps Script Project
You need to create a new, empty Apps Script project in your Google account to hold this code.
```bash
clasp create --type sheets --title "Learning Library Engine"
```
*This command creates a new Google Sheet in your Google Drive and binds a new Apps Script project to it. A `.clasp.json` file will automatically be created in your directory linking your local code to that specific project on Google's servers.*

### Step 5: Push the Code
Now, push the code from your computer up to Google Apps Script.
```bash
clasp push
```

### Step 6: Configure the App
Before you start using the app, you need to configure your domain and branding.
1. Open `Config.js` in your editor.
2. Update the `ALLOWED_DOMAIN` to your organization's Google Workspace domain (e.g., `'yourdomain.org'`). If you are using a standard Gmail account or want it open to any signed-in Google user, set it to `''`.
3. Update `APP_NAME` and `DISPLAY_TIMEZONE` to match your needs.
4. If you made changes, save the file and run `clasp push` again.

### Step 7: Initial Setup & Authorization
1. Open the newly created Google Sheet. You can open it directly from the terminal with:
   ```bash
   clasp open
   ```
   *(Select the "Spreadsheet" option if prompted).*
2. In the Google Sheet, wait a few seconds. A new custom menu called **"Learning Library Engine"** will appear next to "Help".
3. Click **Learning Library Engine → ⚙️ Initial Setup**.
4. A prompt will appear asking for Authorization. Follow the steps to grant the script permission to run. *(Note: You may see a "Google hasn't verified this app" warning. This is normal for scripts you build yourself. Click "Advanced" and "Go to Learning Library Engine (unsafe)" to continue).*
5. The Setup Wizard will open. Paste your **Gemini API Key**. You can optionally provide a Google Drive Folder ID where you want all session folders to be stored. Click **Save Configuration**.

### Step 8: Deploy the Web App
To make the dashboard, wizard, and public library pages accessible, you must deploy the script as a Web App.
1. From the Apps Script editor (which you can open with `clasp open`), look at the top right corner and click **Deploy → New deployment**.
2. Click the gear icon ⚙️ next to "Select type" and choose **Web app**.
3. **Configuration:**
   - **Description:** "v1 - Initial Release" (or whatever you like)
   - **Execute as:** `Me (your email)`
   - **Who has access:** `Anyone` *(Note: `Config.js` controls who can actually view the dashboard; setting this to "Anyone" ensures that the public Library links work for external guests).*
4. Click **Deploy**.
5. Copy the **Web app URL** (it ends in `/exec`). This is the link you and your team will use to access the dashboard!

---

## Modifying and Building Upon This Project

This project is built using standard HTML, CSS, and Vanilla JavaScript. 

**Development Workflow:**
1. Make changes to the `.js` or `.html` files in your local editor (VS Code, Cursor, etc.).
2. Run `clasp push` to send the changes to Google Apps Script.
3. Refresh your Web App (or run `clasp open` to test specific functions).

*Note: When you make changes to HTML files or routing (`WebApp.js`), you must create a new deployment version for those changes to appear on the live `/exec` URL. You can use the `/dev` URL during development (available in the Apps Script editor under Deploy → Test deployments) to bypass creating new versions for every little change.*

## Key Features

- **Wizard:** New Session form creates Drive folders, Master Sheet row, Gemini session brief
- **Synthesis:** Gemini analysis of each resource
- **Gems:** AI persona prompt structures
- **Library:** Shareable learning library page per session
- **Email:** Gemini-drafted pre-session email
