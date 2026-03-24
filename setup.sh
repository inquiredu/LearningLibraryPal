#!/bin/bash

# Make sure we stop on errors
set -e

echo "=================================================="
echo "🚀 Learning Library Engine Setup"
echo "=================================================="
echo ""
echo "This script will help you deploy your own copy of the Learning Library to your Google account."
echo ""

# 1. Check if clasp is installed
if ! command -v clasp &> /dev/null; then
    echo "⚙️  Installing Google Clasp..."
    npm install -g @google/clasp
fi

# 2. Login to Clasp
echo "🔑 Step 1: Authenticate with Google"
echo "Before continuing, you MUST enable the Google Apps Script API in your account."
echo "Please visit: https://script.google.com/home/usersettings"
echo "Turn the toggle to ON."
echo ""
echo "Press Enter when you have enabled the API..."
read -r

echo "A link will be generated below. Click it, log in to your Google account."
echo ""
echo "⚠️ IMPORTANT FOR CODESPACES USERS: If you see a 'This site can't be reached (localhost refused to connect)' error after logging in, DO NOT PANIC! This is normal."
echo "Look at the URL of the error page. Copy the long string of text immediately after '&code=' and before the next '&'."
echo "Paste that code back into this terminal and press Enter."
echo ""
clasp login --no-localhost
echo ""

# 3. Create the Apps Script Project
echo "📂 Step 2: Create a new Apps Script Project"
if [ -f .clasp.json ]; then
    echo "⚠️  A .clasp.json file already exists in this directory."
    echo "This means a project has already been created or cloned here."
    echo "We will skip project creation and proceed to push."
    echo ""
else
    echo "What would you like to name your new project? (Press Enter to use 'Learning Library Engine')"
    read -r PROJECT_NAME
    if [ -z "$PROJECT_NAME" ]; then
        PROJECT_NAME="Learning Library Engine"
    fi
    echo "Creating new Google Sheet and attaching Apps Script for: $PROJECT_NAME..."
    clasp create --type sheets --title "$PROJECT_NAME"
    echo ""
fi

# 4. Push the Code
echo "⬆️ Step 3: Push the code to Google"
clasp push
echo ""

# 5. Open the Project
echo "✅ Setup Complete!"
echo "Your code is now securely deployed to your Google account."
echo ""
echo "Next steps:"
echo "1. Run 'npm run open' to open your new Google Sheet."
echo "2. Look for the 'Learning Library Engine' menu next to 'Help'."
echo "3. Click '⚙️ Initial Setup' and paste your Gemini API Key."
echo ""
