# Contributing to the Learning Library Engine

First off, thank you for considering contributing to the Learning Library Engine! It's people like you that make open-source such a great community.

## Development Workflow

Since this project runs on Google Apps Script, the development workflow is slightly different than a traditional web app.

### Setting Up Your Environment
1. **Fork** this repository to your own GitHub account.
2. **Clone** your fork locally or open it in a GitHub Codespace.
3. Run `npm run setup` to authenticate with Google and create a bound Apps Script project in your own Google Drive.
4. Run `npm run open` to open your local instance in the Google Apps Script editor.

### Making Changes
1. Create a new branch for your feature or bug fix: `git checkout -b feature/my-awesome-feature`.
2. Make your changes in the `.js` or `.html` files locally.
3. Push your changes to your Google Apps Script project to test them:
   ```bash
   npm run deploy
   ```
4. Test your changes thoroughly in your own Google Workspace environment.

### Submitting a Pull Request
1. Commit your changes locally: `git commit -m "feat: added an awesome new feature"`.
2. Push your branch to your fork on GitHub: `git push origin feature/my-awesome-feature`.
3. Open a Pull Request against the `main` branch of this repository.
4. Provide a clear description of the problem you are solving and the solution you have implemented. If your change affects the UI, please include screenshots!

## Architecture Overview
- **Backend:** `Code.js` and `*Service.js` files handle the business logic, API calls to Gemini, and Google Drive/Sheets scaffolding.
- **Frontend:** `*Page.html`, `Index.html`, and `Wizard.html` are served via the `doGet` function in `WebApp.js`. 
- **AI Integration:** `GeminiService.js` handles all prompt construction and API communication with Google AI Studio.

## Code Style
- We use vanilla JavaScript (ES6+ features supported by V8).
- We do not use TypeScript or build tools (Webpack/Babel) to keep the barrier to entry as low as possible for educators and community builders.
- Please comment your code clearly, especially when dealing with complex Google Workspace APIs or AI prompts.

Thank you for contributing!
