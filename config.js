require('dotenv').config();

module.exports = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    channelId: process.env.TELEGRAM_CHANNEL_ID,
    ownerId: process.env.TELEGRAM_OWNER_ID,
  },
  twitter: [],
  database: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  },
};

// Dynamically load all Twitter accounts from .env
const twitterAccounts = [];
let i = 1;
while (process.env[`TWITTER_API_KEY_${i}`]) {
  twitterAccounts.push({
    appKey: process.env[`TWITTER_API_KEY_${i}`],
    appSecret: process.env[`TWITTER_API_KEY_SECRET_${i}`],
    accessToken: process.env[`TWITTER_ACCESS_TOKEN_${i}`],
    accessSecret: process.env[`TWITTER_ACCESS_TOKEN_SECRET_${i}`],
  });
  i++;
}

module.exports.twitter = twitterAccounts;
