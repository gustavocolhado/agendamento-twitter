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
        text TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
        videoId VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
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
  const [rows] = await pool.query('SELECT * FROM posts WHERE postedAt IS NULL ORDER BY postAt ASC LIMIT 1');
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
  const [rows] = await pool.query('SELECT * FROM posts WHERE postedAt IS NULL ORDER BY postAt ASC');
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

async function checkIfPostExists(text, videoId) {
  const pool = await getPool();
  let query = 'SELECT id FROM posts WHERE text = ?';
  let params = [text];

  if (videoId) {
    query += ' AND videoId = ?';
    params.push(videoId);
  } else {
    query += ' AND videoId IS NULL';
  }

  console.log('Checking for duplicate post (any account) with text:', text.substring(0, 50) + '...', 'and videoId:', videoId);
  const [rows] = await pool.query(query, params);
  console.log('Duplicate check (any account) result:', rows.length > 0 ? 'Found' : 'Not found');
  return rows.length > 0;
}

async function checkIfPostWasSuccessfullyPostedToAccount(text, videoId, accountIndex) {
  const pool = await getPool();
  let query = `
    SELECT ps.id
    FROM post_statuses ps
    JOIN posts p ON ps.postId = p.id
    WHERE p.text = ?
      AND ps.accountIndex = ?
      AND ps.success = TRUE
  `;
  let params = [text, accountIndex];

  if (videoId) {
    query += ' AND p.videoId = ?';
    params.push(videoId);
  } else {
    query += ' AND p.videoId IS NULL';
  }

  console.log(`Checking if post was successfully posted to account ${accountIndex} with text:`, text.substring(0, 50) + '...', 'and videoId:', videoId);
  const [rows] = await pool.query(query, params);
  console.log(`Post to account ${accountIndex} check result:`, rows.length > 0 ? 'Found' : 'Not found');
  return rows.length > 0;
}

module.exports = {
  setupDb,
  addPostToQueue,
  getNextPostFromQueue,
  markPostAsPosted,
  getAllPostsFromQueue,
  getLastPostTime,
  getPostById,
  updatePostTime,
  recordPostStatus,
  getPostedReports,
  checkIfPostExists,
  checkIfPostWasSuccessfullyPostedToAccount, // Nova função
};
