const mysql = require('mysql2/promise');
const config = require('./config');

let pool;

async function getPool() {
  if (pool) return pool;
  pool = mysql.createPool(config.database);
  return pool;
}

async function setupDb() {
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        text TEXT,
        videoId VARCHAR(255),
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        postAt DATETIME,
        postedAt DATETIME NULL DEFAULT NULL
      );
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS post_statuses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        postId INT NOT NULL,
        accountIndex INT NOT NULL,
        success BOOLEAN NOT NULL,
        message TEXT,
        postedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
      );
    `);
  } finally {
    connection.release();
  }
}

async function addPostToQueue(post, postAt) {
  const pool = await getPool();
  await pool.query(
    'INSERT INTO posts (text, videoId, postAt) VALUES (?, ?, ?)',
    [post.text, post.videoId, postAt]
  );
}

async function getNextPostFromQueue() {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM posts ORDER BY postAt ASC LIMIT 1');
  return rows[0];
}

async function markPostAsPosted(id) {
  const pool = await getPool();
  await pool.query('UPDATE posts SET postedAt = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

async function getLastPostTime() {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT MAX(postAt) as lastPostAt FROM posts');
  return rows[0] && rows[0].lastPostAt ? new Date(rows[0].lastPostAt) : null;
}

async function getAllPostsFromQueue() {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM posts ORDER BY postAt ASC');
  return rows;
}

async function getPostById(id) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM posts WHERE id = ?', [id]);
  return rows[0];
}

async function updatePostTime(id, newTime) {
  const pool = await getPool();
  await pool.query('UPDATE posts SET postAt = ? WHERE id = ?', [newTime, id]);
}

async function recordPostStatus(postId, accountIndex, success, message) {
  const pool = await getPool();
  await pool.query(
    'INSERT INTO post_statuses (postId, accountIndex, success, message) VALUES (?, ?, ?, ?)',
    [postId, accountIndex, success, message]
  );
}

async function getPostedReports() {
  const pool = await getPool();
  const [posts] = await pool.query('SELECT id, text, videoId, postedAt FROM posts WHERE postedAt IS NOT NULL ORDER BY postedAt DESC');

  for (const post of posts) {
    const [statuses] = await pool.query('SELECT accountIndex, success, message FROM post_statuses WHERE postId = ? ORDER BY accountIndex ASC', [post.id]);
    post.statuses = statuses;
  }
  return posts;
}

module.exports = {
  setupDb,
  addPostToQueue,
  getNextPostFromQueue,
  markPostAsPosted, // Renomeado
  getAllPostsFromQueue,
  getLastPostTime,
  getPostById,
  updatePostTime,
  recordPostStatus, // Novo
  getPostedReports, // Novo
};
