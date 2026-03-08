# Mngaia Content Engine Architecture

## Overview
The Mngaia Content Engine is a frictionless, multi-modal content pipeline designed to transform raw brainstorms into structured "Resource Kits" and "Gems" for professional communities.

## Core Principles
1.  **Human-in-the-Loop (HITL):** AI generates drafts; Humans make decisions. No auto-publishing.
2.  **Data Sovereignty:** All data resides within the Google Workspace tenant.
3.  **Frictionless UX:** Automation handles the heavy lifting of organization and synthesis.

## Tech Stack
*   **Orchestration:** Google Apps Script (GAS) managed via CLASP.
*   **Intelligence:** Gemini 1.5 Pro via Google AI Studio API.
*   **Storage:** Google Drive (Docs, PDFs, Shortcuts).
*   **Frontend:** Google Sites.

## Workflow Phases

### Phase 1: Intake (The Wizard)
*   **Input:** Raw "Inbound Brainstorm" Google Doc.
*   **Input:** Google Doc or NotebookLM Markdown export.
*   **Process:**
    *   **In-Place Scaffolding:** Ensure folder structure exists in the source file's parent folder.
    *   Analyze content using Gemini.
    *   Generate a **Decision Document** (Strategic choices).
    *   Scaffold Folder Map (`/Research`, `/Drafts`, `/Gems`, `/Final_Assets`).
*   **Output:** A structured project folder in Drive.
*   **Output:** A structured project environment around the source file.

### Phase 2: Synthesis (The Library)
*   **Input:** Links, PDFs, Videos in `/Research`.
*   **Process:**
    *   Extract text/transcript.
    *   Generate Metadata (Relevance, Engagement Level, "So What").
*   **Output:** JSON metadata and summary Docs in `/Drafts`.

### Phase 3: Engagement (The Gems)
*   **Input:** Synthesized themes.
*   **Process:** Draft System Instructions for AI Agents.
*   **Output:** "Gem" definitions ready for testing.

## Data Structure

### Folder Map
```text
/[Project Name]
├── 00_Admin
│   └── Decision_Doc.gdoc
├── 01_Research (Raw inputs)
├── 02_Drafts (AI outputs pending review)
├── 03_Gems (AI Persona definitions)
└── 04_Final_Assets (Approved content for Sites)
```

### Metadata Schema (JSON)
Used for Google Sites integration.
```json
{
  "title": "String",
  "url": "String",
  "type": "Article|Video|PDF",
  "engagementLevel": "Skim|Deep Dive",
  "relevance": "String (Why this matters)",
  "valueProp": "String (The So What)"
}
```