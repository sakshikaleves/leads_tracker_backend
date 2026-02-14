const mysql = require('mysql2/promise');
const config = require('./env');

let pool = null;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 30000,
      connectTimeout: 10000,
      maxIdle: 5,
      idleTimeout: 60000,
    });
    console.log('Connected to MySQL');
  }
  return pool;
}

async function query(sql, params = []) {
  const pool = await getPool();
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    console.error('DB Query Error:', err.message, err.code, err.errno, '\nSQL:', sql, '\nParams:', params);
    throw err;
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('MySQL connection closed');
  }
}

module.exports = {
  getPool,
  query,
  closePool,
};
