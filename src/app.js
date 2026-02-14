const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const { getPool } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth.routes');
const trackerRoutes = require('./routes/tracker.routes');
const leadRoutes = require('./routes/lead.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const teamRoutes = require('./routes/team.routes');
const callerInteractionRoutes = require('./routes/callerInteraction.routes');
const customStatusRoutes = require('./routes/customStatus.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/trackers', trackerRoutes);
app.use('/api/trackers', leadRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/trackers', teamRoutes);
app.use('/api/trackers', callerInteractionRoutes);
app.use('/api/trackers', customStatusRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// Start server
async function startServer() {
  try {
    // Initialize database connection
    await getPool();

    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Only start server when running directly (not on Vercel)
if (require.main === module) {
  startServer();
}

module.exports = app;
