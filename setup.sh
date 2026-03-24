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
echo "A link will be generated below. Click it, log in to your Google account, and copy the code it gives you."
echo "Paste that code back into this terminal and press Enter."
clasp login --no-localhost
echo ""

# 3. Create the Apps Script Project
echo "📂 Step 2: Create a new Apps Script Project"
echo "We will now create a new Google Sheet and attach the Apps Script to it."
clasp create --type sheets --title "Learning Library Engine"
echo ""

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
