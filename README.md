# LearningLibrary
A project to create a human first process to create learning libraries for any event.
# Mngaia Content Engine

## Vision
The Mngaia Content Engine is a **digital utility belt** for community architects. It is not just a script; it is a multi-modal infrastructure layer that wraps around your existing workflow. Whether you start with a messy Google Doc or a structured NotebookLM export, the Engine builds the necessary scaffolding around your content to transform it into a polished learning experience.

## What It Is
A "Human-in-the-Loop" orchestration system built on Google Workspace and Gemini 1.5 Pro. Unlike rigid project management tools, it meets you where you are:
*   **Context Aware:** Connects to an existing Session Doc or NotebookLM export and builds the project structure *around* it.
*   **Multi-Modal:** Generates code, analyzes video transcripts, and synthesizes PDFs.
*   **Frictionless:** No need to migrate files to "new folders." The system adapts to your Drive organization.

## Core Capabilities

### 1. The Launch Wizard (Intake)
*   **Input:** A Google Doc *or* a NotebookLM Markdown export.
*   **Action:** "Snaps" a project structure onto the file's current location.
*   **Output:**
    *   **Infrastructure:** Automatically generates `/Research`, `/Drafts`, and `/Gems` folders alongside your source file.
    *   **Strategy:** Reads your notes and generates a **Decision Matrix** (Strategic angles, Pros/Cons) to guide the month's theme.

### 2. The Synthesis Library (Processing)
*   **Action:** Watches the `/Research` folder for inputs (PDFs, YouTube links, MP3s).
*   **Output:** Generates a "Resource Kit" with standardized JSON metadata:
    *   **Relevance:** Why this specific item matters to the monthly theme.
    *   **The "So What":** Explicit value proposition.
    *   **Engagement Level:** "5-minute skim" vs. "Deep Dive".

### 3. Engagement Gems (Pre-work)
*   **Action:** Takes the synthesized themes and codes custom AI experiences.
*   **Output:** System Instructions for "Gems" (e.g., a "Devil's Advocate" bot) that attendees can interact with to prime their thinking before the session.

## Innovative AI Approaches
*   **NotebookLM Integration:** Ingests deep research exports (Markdown) to jumpstart the wizard with high-fidelity context.
*   **In-Place Construction:** The code uses Drive APIs to detect the context of the input file and deploy resources locally, preserving the user's organizational logic.
*   **Strategic Reasoning:** We use Gemini not just for copy, but for *consultancy*—analyzing the "white space" in a topic to suggest novel angles.

## Final Outcome
A utility belt that turns a single document into a full-fledged **Learning Engine**. It reduces planning time from days to hours, ensuring that every monthly meeting is backed by deep research, curated assets, and interactive AI pre-work—all without leaving your Google Drive.
