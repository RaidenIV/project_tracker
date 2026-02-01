// Test MongoDB Connection
// Run this with: node test-connection.js

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ ERROR: MONGODB_URI not found in .env file');
    console.log('📝 Please create a .env file with your MongoDB connection string');
    console.log('💡 Example: MONGODB_URI=mongodb://user:pass@host:port/database');
    process.exit(1);
}

console.log('🔄 Testing MongoDB connection...');
console.log('📍 Connection string:', MONGODB_URI.replace(/:[^:@]+@/, ':****@')); // Hide password

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => {
    console.log('✅ SUCCESS! Connected to MongoDB');
    console.log('📊 Database:', mongoose.connection.name);
    console.log('🌐 Host:', mongoose.connection.host);
    console.log('');
    console.log('🎉 Your MongoDB connection is working!');
    console.log('👉 You can now run: npm start');
    mongoose.connection.close();
    process.exit(0);
})
.catch((err) => {
    console.error('❌ FAILED to connect to MongoDB');
    console.error('📋 Error details:', err.message);
    console.log('');
    console.log('🔍 Troubleshooting:');
    console.log('1. Check your MONGODB_URI in .env file');
    console.log('2. Verify your MongoDB service is running in Railway');
    console.log('3. Make sure the connection string includes username and password');
    console.log('4. Check if your IP is whitelisted (Railway should handle this)');
    process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
    console.log('⏱️  Connection timeout - taking too long');
    process.exit(1);
}, 10000);
