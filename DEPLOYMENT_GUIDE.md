# Deployment Guide

Complete guide to deploy your Project Tracker to Railway with MongoDB.

## 📋 Prerequisites

- [ ] GitHub account ([github.com](https://github.com))
- [ ] Railway account ([railway.app](https://railway.app))
- [ ] MongoDB connection string from Railway

## 🚀 Step-by-Step Deployment

### Step 1: Set Up GitHub Repository (5 minutes)

#### Option A: Using GitHub Web Interface (Recommended)

1. **Create new repository:**
   - Go to [github.com/new](https://github.com/new)
   - Repository name: `project-tracker`
   - Make it Public or Private
   - **DO NOT** initialize with README
   - Click "Create repository"

2. **Upload files:**
   - Click "uploading an existing file"
   - Drag and drop your entire project folder
   - Ensure you include:
     - `client/` folder (with index.html, css/, js/)
     - `server/` folder (with server.js, package.json)
     - `.gitignore`
     - `.env.example`
     - `README.md`
     - `DEPLOYMENT_GUIDE.md`
   - Click "Commit changes"

#### Option B: Using Git Command Line

```bash
# Navigate to project directory
cd path/to/project-tracker

# Initialize git (if not already)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: Project Tracker"

# Add GitHub remote (replace YOUR_USERNAME/YOUR_REPO)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Push to GitHub
git branch -M main
git push -u origin main
```

### Step 2: Get MongoDB Connection String (2 minutes)

1. **Log into Railway:** [railway.app](https://railway.app)

2. **Find MongoDB service:**
   - Go to your Railway dashboard
   - Click on your MongoDB project/service

3. **Get connection string:**
   - Click "Variables" or "Connect" tab
   - Look for `MONGO_URL`, `MONGODB_URL`, or similar
   - Copy the full connection string

   **Format:** `mongodb://user:password@host:port/database`
   
   **Example:** `mongodb://mongo:abc123@monorail.proxy.rlwy.net:12345/railway`

### Step 3: Deploy to Railway (5 minutes)

1. **Create new Railway project:**
   - Click "+ New Project"
   - Select "Deploy from GitHub repo"
   - Choose your `project-tracker` repository
   - Click "Deploy Now"

2. **Configure build settings:**
   Railway should auto-detect the Node.js project. If not:
   - Click on the service
   - Go to "Settings"
   - **Root Directory:** Leave empty (uses project root)
   - **Build Command:** (auto-detected)
   - **Start Command:** `cd server && npm start`

3. **Add environment variable:**
   - Click "Variables" tab
   - Click "+ New Variable"
   - **Name:** `MONGODB_URI`
   - **Value:** Your MongoDB connection string from Step 2
   - Click "Add"

4. **Wait for deployment:**
   - Railway will:
     - Install dependencies
     - Build the project
     - Start the server
   - Watch the logs for: `✅ Connected to MongoDB`

5. **Generate domain:**
   - Go to "Settings" tab
   - Under "Domains" section
   - Click "Generate Domain"
   - Copy your URL (e.g., `project-tracker-production.up.railway.app`)

### Step 4: Configure Your Password (3 minutes)

**Important:** Change the default password!

1. **In your GitHub repository:**
   - Navigate to `client/js/modules/config.js`
   - Click the pencil icon (Edit)
   - Find line 4: `export const ADMIN_PASSWORD = "admin123";`
   - Change `"admin123"` to your secure password
   - Scroll down and click "Commit changes"

2. **Railway auto-redeploys:**
   - Railway detects the GitHub change
   - Automatically redeploys with new password
   - Wait ~1-2 minutes for deployment

### Step 5: Test Your Deployment (2 minutes)

1. **Access your app:**
   - Open your Railway domain in browser
   - You should see the password prompt

2. **Log in:**
   - Enter your password
   - Should see "ADMIN MODE" indicator

3. **Test functionality:**
   - Create a new project
   - Add some tasks
   - Refresh the page
   - Projects should still be there (saved to MongoDB!)

4. **Check health endpoint:**
   - Visit: `https://your-app.railway.app/api/health`
   - Should show:
     ```json
     {
       "status": "ok",
       "mongodb": "connected",
       "timestamp": "2025-..."
     }
     ```

## ✅ Deployment Checklist

Use this to verify everything is working:

- [ ] Code pushed to GitHub
- [ ] All files and folders present in repository
- [ ] Railway project created from GitHub repo
- [ ] `MONGODB_URI` environment variable added
- [ ] Deployment completed successfully (check logs)
- [ ] Domain generated
- [ ] Password changed from default
- [ ] Can access app in browser
- [ ] Password login works
- [ ] Can create and manage projects
- [ ] Data persists after refresh
- [ ] `/api/health` shows MongoDB connected

## 🐛 Common Issues & Solutions

### Issue: "Cannot connect to MongoDB"

**Symptoms:** Server crashes, error in logs

**Solutions:**
1. Verify `MONGODB_URI` is set correctly
2. Check connection string format
3. Ensure MongoDB service is running
4. Test connection locally: `node test-connection.js`

### Issue: "Module not found" errors

**Symptoms:** Build fails, import errors

**Solutions:**
1. Ensure `server/package.json` exists
2. Check all imports use correct paths
3. Verify file structure matches documentation
4. Check Railway build logs for specific errors

### Issue: "404 Not Found" for frontend

**Symptoms:** Can't access app, only see error page

**Solutions:**
1. Verify server is serving from `../client` directory
2. Check `client/index.html` exists
3. Review server.js file paths
4. Check Railway logs for server errors

### Issue: "Password doesn't work"

**Symptoms:** Can't log in after changing password

**Solutions:**
1. Verify `client/js/modules/config.js` has correct password
2. Check GitHub commit was successful
3. Wait for Railway redeployment to complete
4. Clear browser cache
5. Check Railway deployment logs

### Issue: "Data not saving"

**Symptoms:** Changes disappear after refresh

**Solutions:**
1. Check browser console (F12) for API errors
2. Verify MongoDB connection in `/api/health`
3. Check Railway logs for database errors
4. Ensure `MONGODB_URI` is correct

## 🔄 Making Updates

After your initial deployment, to update your app:

```bash
# Make your changes to the code

# Commit and push
git add .
git commit -m "Description of changes"
git push

# Railway automatically redeploys!
# Check deployment logs in Railway dashboard
```

## 📊 Monitoring Your App

### Check Deployment Logs
1. Go to Railway dashboard
2. Click on your service
3. Click "Deployments"
4. View logs for latest deployment

### Monitor Usage
1. Railway dashboard → Your project
2. View metrics:
   - CPU usage
   - Memory usage
   - Network traffic
   - Build times

### Check Database
1. Go to MongoDB service in Railway
2. View connection metrics
3. Monitor storage usage

## 🔐 Security Best Practices

✅ **Change default password immediately**  
✅ **Use strong, unique password**  
✅ **Never commit `.env` to GitHub**  
✅ **Keep MongoDB connection string secret**  
✅ **Regularly update dependencies**  
✅ **Monitor Railway logs for suspicious activity**  
✅ **Use environment variables for all secrets**  

## 💡 Pro Tips

1. **Custom Domain:**
   - Buy a domain (Namecheap, Google Domains, etc.)
   - Add to Railway in Settings → Domains
   - Follow Railway's DNS instructions

2. **Environment-specific configs:**
   - Create different branches for development/production
   - Use Railway preview deployments for testing

3. **Database Backups:**
   - Set up MongoDB backups in Railway
   - Export data regularly for safety

4. **Performance:**
   - Monitor Railway metrics
   - Optimize slow API endpoints
   - Use Railway's auto-scaling if needed

5. **Debugging:**
   - Use `console.log` strategically
   - Check both browser and server logs
   - Use Railway's log filtering

## 📞 Getting Help

If you're stuck:

1. **Check documentation:**
   - Railway docs: [docs.railway.app](https://docs.railway.app)
   - MongoDB docs: [mongodb.com/docs](https://www.mongodb.com/docs)

2. **Verify basics:**
   - All files in GitHub repository
   - Environment variables set correctly
   - No errors in Railway logs
   - MongoDB service is running

3. **Test locally:**
   - Clone your repo
   - Set up `.env` file
   - Run `node test-connection.js`
   - Run `cd server && npm start`

4. **Check Railway status:**
   - [status.railway.app](https://status.railway.app)
   - Verify no ongoing incidents

## 🎉 Success!

If you've made it here and everything is working:

✅ Your app is deployed and accessible  
✅ MongoDB is connected and saving data  
✅ Password is changed and secure  
✅ You can manage projects and tasks  
✅ Data persists across sessions  

**Congratulations! Your project tracker is live! 🚀**

---

**Need to go back?** See [README.md](README.md) for project overview and local development.
