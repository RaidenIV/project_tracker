# Code Project Tracker

A professional full-stack project management application with MongoDB database integration via Railway.

## 📋 Features

- ✅ Password-protected admin mode
- ✅ Project and task management with progress tracking
- ✅ Switch between active and completed projects
- ✅ Bulk task import (paste multiple tasks)
- ✅ Keyboard shortcuts for efficient navigation
- ✅ MongoDB cloud database storage
- ✅ Modular, maintainable codebase
- ✅ Fully responsive design

## 🏗️ Project Structure

```
project-tracker/
├── README.md                    # This file
├── DEPLOYMENT_GUIDE.md          # Detailed deployment instructions
├── .env.example                 # Environment variables template
├── .gitignore                   # Git ignore rules
├── test-connection.js           # MongoDB connection tester
│
├── client/                      # Frontend application
│   ├── index.html              # Main HTML file
│   ├── css/
│   │   └── styles.css          # Application styles
│   └── js/
│       ├── main.js             # Main application logic
│       └── modules/
│           ├── config.js       # Configuration (PASSWORD HERE!)
│           ├── state.js        # State management
│           ├── api.js          # Server API calls
│           └── auth.js         # Authentication
│
└── server/                      # Backend API
    ├── server.js               # Express + MongoDB server
    └── package.json            # Server dependencies
```

## 🔑 Password Configuration

**Default password:** `admin123`

**To change:**
1. Open `client/js/modules/config.js`
2. Find line 4: `export const ADMIN_PASSWORD = "admin123";`
3. Change to your secure password
4. Save and deploy

## 🚀 Quick Start

### Prerequisites

- Node.js (v18+)
- MongoDB connection string from Railway
- GitHub account
- Railway account

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/project-tracker.git
cd project-tracker

# 2. Create .env file
cp .env.example .env
# Edit .env and add your MONGODB_URI

# 3. Install dependencies
cd server
npm install

# 4. Test MongoDB connection (from project root)
cd ..
node test-connection.js

# 5. Start the server
cd server
npm start

# 6. Open browser
# http://localhost:3000
```

### Deployment to Railway

See **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** for detailed instructions.

**Quick steps:**
1. Push code to GitHub
2. Create new Railway project from GitHub repo
3. Add `MONGODB_URI` environment variable
4. Railway automatically deploys
5. Generate domain and access your app

## 🎮 Keyboard Shortcuts

- **N** - New Project
- **C** - Toggle Control Panel
- **M** - Toggle Menu
- **A** - View Active Projects
- **D** - View Completed Projects
- **?** - Show Help

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serve frontend app |
| `/api/data` | GET | Get all projects and stats |
| `/api/data` | POST | Save all data |
| `/api/projects` | PUT | Update projects |
| `/api/stats` | PUT | Update stats |
| `/api/health` | GET | Health check |

## 🛠️ Development

### Frontend Structure

- **index.html** - Clean HTML structure, no inline scripts
- **css/styles.css** - All styling in separate file
- **js/main.js** - Main application logic
- **js/modules/** - Modular JavaScript:
  - `config.js` - Configuration and constants
  - `state.js` - Application state management
  - `api.js` - Server communication
  - `auth.js` - Authentication logic

### Backend Structure

- **server.js** - Express server with MongoDB integration
- **package.json** - Dependencies management

### Adding New Features

1. Update state in `client/js/modules/state.js`
2. Add API calls in `client/js/modules/api.js`
3. Implement logic in `client/js/main.js`
4. Update UI in HTML/CSS as needed
5. Add backend endpoints in `server/server.js` if needed

## 📦 MongoDB Schema

```javascript
{
  userId: "default",
  projects: [{
    id: Number,
    title: String,
    tasks: [{
      id: Number,
      text: String,
      completed: Boolean,
      completedDate: String
    }],
    dateCreated: String,
    priority: Number,
    completed: Boolean,
    completedDate: String
  }],
  stats: {
    completedTasks: Number,
    completedProjects: Number
  },
  lastModified: Date
}
```

## 🐛 Troubleshooting

### Can't connect to MongoDB
- Verify `MONGODB_URI` in `.env`
- Run `node test-connection.js`
- Check Railway MongoDB service status

### Frontend not loading
- Check server is serving from `../client` directory
- Verify all files are in correct locations
- Check browser console for errors

### Changes not saving
- Verify admin password is correct
- Check browser console for API errors
- Check Railway logs for backend errors

## 🔄 Deployment Updates

After making changes:

```bash
git add .
git commit -m "Description of changes"
git push
```

Railway automatically redeploys!

## 📝 Best Practices

✅ Keep password configuration in `config.js`  
✅ Use environment variables for sensitive data  
✅ Separate client and server code  
✅ Use modules for better organization  
✅ Never commit `.env` file  
✅ Test locally before deploying  

## 🌟 Future Enhancements

- Multi-user authentication
- Real-time collaboration
- File attachments
- Due dates and reminders
- Email notifications
- Project templates
- Time tracking
- Analytics dashboard

## 📞 Support

If you encounter issues:
1. Check [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
2. Review Railway deployment logs
3. Test with `node test-connection.js`
4. Check browser console (F12)
5. Verify environment variables

## 📄 License

MIT License - Feel free to use and modify!

---

**Built with:**
- Frontend: HTML, CSS, JavaScript (ES6 Modules)
- Backend: Node.js, Express
- Database: MongoDB (Railway)
- Deployment: Railway

**Last Updated:** February 2025
