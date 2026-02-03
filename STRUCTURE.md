# Project Tracker – File Structure

```
project-tracker/
│
├── README.md                    # Getting-started & feature overview
├── DEPLOYMENT_GUIDE.md          # Railway + MongoDB step-by-step
├── STRUCTURE.md                 # This file
├── .env.example                 # Environment-variable template
├── .gitignore                   # Git ignore rules
│
├── package.json                 # Root package.json (Railway entry-point)
├── railway.json                 # Railway build configuration
├── nixpacks.toml                # Railway build details
├── Procfile                     # Railway start command
├── test-connection.js           # One-off MongoDB connectivity tester
│
├── client/                      # Static frontend – served by Express
│   ├── index.html               # Single-page shell; no bundler needed
│   ├── css/
│   │   └── styles.css           # All styles (neomorphic theme, responsive,
│   │                            #   drag-reorder, scrollbar, mobile)
│   └── js/
│       ├── main.js              # App logic: render, drag-and-drop, CRUD,
│       │                        #   modal, undo, keyboard shortcuts
│       └── modules/
│           ├── config.js        # ADMIN_PASSWORD, VIEWS enum, SHORTCUTS map
│           ├── state.js         # In-memory state (projects, stats, view,
│           │                    #   task-selection, undo stack)
│           ├── api.js           # fetch() wrappers → Express /api routes
│           ├── auth.js          # Password prompt + admin-flag helpers
│           └── projects.js      # Thin project-operation helpers
│
└── server/                      # Express back-end
    ├── server.js                # Static-file serving + /api CRUD routes
    │                            #   backed by MongoDB via Mongoose
    └── package.json             # Server dependencies
```

---

## How the layers talk

```
Browser  ──fetch()──►  Express /api  ──Mongoose──►  MongoDB (Atlas)
   │                       │
   │  GET /               static files
   ◄───────────────────────┘
```

* **client/js/main.js** is the single entry-point.  It imports the four
  helper modules and exports only `loadData()` (called by `index.html`).
* All persistent state lives in MongoDB; the browser keeps an in-memory
  copy in `state.js` and pushes every mutation through `api.js`.
* The server has no view layer – it just mirrors the DB over REST.

---

## Key design decisions

| Area | Decision | Why |
|---|---|---|
| Bundler | None – native ES modules | Zero build step; Railway deploys the repo as-is |
| CSS | Single file, CSS custom-properties | No preprocessor; variables keep the neomorphic theme consistent |
| Auth | Client-side password check | Lightweight; the password is hashed at build time in `config.js` |
| Drag-and-drop | Pointer-event slide engine | Works on touch *and* mouse without a library; iOS-style long-press enters edit mode |
| Undo | Single-entry stack in `state.js` | Covers the only destructive action (delete) without extra complexity |
