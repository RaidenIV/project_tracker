# Project Tracker

A lightweight, self-hosted project-and-task manager with a neomorphic UI.
Runs on [Railway](https://railway.app) with a [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
back-end — no other infrastructure needed.

---

## Features

* **Projects** – create, reorder (drag-to-reorder on desktop *and* touch), mark
  complete, and restore with one-tap undo.
* **Tasks** – add, complete, reorder inside each project, bulk-paste from a
  text box, and copy all pending tasks to clipboard in one click.
* **Progress** – per-project and global completion percentages update in
  real time.
* **Notes** – a free-text notes tab inside every project modal.
* **Admin / read-only mode** – enter a password to unlock write access;
  without it the board is fully browsable but nothing can be changed.
* **Keyboard shortcuts** – full keyboard navigation (press `?` to see the
  shortcut map).
* **Responsive** – single-column layout, larger touch targets, and
  hidden keyboard hints on phones (≤ 480 px).

---

## Quick Start

### 1. Prerequisites

| Tool | Minimum version |
|---|---|
| Node.js | 18 LTS |
| npm | 9 |
| MongoDB Atlas | Free tier is fine |

### 2. Clone & configure

```bash
git clone <your-repo-url>
cd project-tracker
cp .env.example .env          # fill in MONGODB_URI
```

Open `.env` and paste your Atlas connection string into `MONGODB_URI`.

### 3. Install & run locally

```bash
npm install                   # installs server deps
node server/server.js         # starts on PORT 3000 by default
```

Open **http://localhost:3000** in a browser.

### 4. Deploy to Railway

See **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** for the full Railway
walk-through.  The short version:

1. Push the repo to GitHub.
2. Create a Railway project → *Deploy from GitHub repo*.
3. Add a **MongoDB Atlas** service (or point `MONGODB_URI` at an existing
   cluster).
4. Railway auto-detects `Procfile` and deploys.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `N` | New project |
| `C` | Toggle control panel |
| `M` | Toggle menu |
| `A` | Switch to Active view |
| `D` | Switch to Completed view |
| `Z` | Undo last deletion |
| `?` | Show shortcut help overlay |

*Shortcuts are disabled while an input or textarea is focused.*

---

## Project Layout

See **[STRUCTURE.md](STRUCTURE.md)** for a full file-tree walkthrough.

```
client/   – HTML + CSS + JS (served as static files)
server/   – Express + Mongoose API
```

---

## License

This project is provided as-is for personal use.
