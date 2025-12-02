const { Telegraf } = require('telegraf');
const { TwitterApi } = require('twitter-api-v2');
const schedule = require('node-schedule');
const config = require('./config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const { startServer } = require('./server');

// Initialize Telegram Bot
const bot = new Telegraf(config.telegram.botToken);

// Initialize Twitter Clients for all accounts
const twitterClients = config.twitter.map((creds, index) => {
  console.log(`Initializing Twitter client #${index + 1}`);
  return new TwitterApi(creds).readWrite;
});

if (twitterClients.length === 0) {
  console.error('No Twitter accounts configured. Please check your .env file.');
  process.exit(1);
}

// Keep track of the currently scheduled job
let scheduledJob = null;
const postQueue = [];
let isProcessingQueue = false;

// Function to calculate the next available posting time
async function calculateNextPostTime() {
  const lastPostTime = await db.getLastPostTime();
  let nextPostTime;

  const twoHoursInMillis = 2 * 60 * 60 * 1000;
  if (lastPostTime && lastPostTime > new Date()) {
    // If the last post is in the future, schedule 2 hours after it
    nextPostTime = new Date(lastPostTime.getTime() + twoHoursInMillis);
  } else {
    // Otherwise, schedule 2 hours from now
    nextPostTime = new Date(new Date().getTime() + twoHoursInMillis);
  }
  return nextPostTime;
}

async function handleNewPost(postObject) {
  const originalText = postObject.text || postObject.caption || '';
  const footerText = "\n\n📌 Acesse nosso site:\ncornosbrasil.com.br";
  const fullText = originalText + footerText;
  const videoId = postObject.video ? postObject.video.file_id : null;
  let videoPath = null;

  if (videoId) {
    try {
      console.log(`Downloading video immediately for new post with videoId: ${videoId}...`);
      const file = await bot.telegram.getFile(videoId);
      const filePath = file.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;

      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }
      videoPath = path.join(tempDir, `${videoId}.mp4`);
      const writer = fs.createWriteStream(videoPath);
      const response = await axios({
        url: fileUrl,
        method: 'GET',
        responseType: 'stream',
      });
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      console.log(`Video downloaded to ${videoPath}`);
    } catch (downloadError) {
      console.error(`Error downloading video immediately for post with videoId ${videoId}:`, downloadError.message || downloadError);
      // Se o download falhar, não adicionamos o vídeo ao post, e ele será tratado como um post de texto.
      videoId = null; // Reset videoId para que o post seja tratado como texto
      videoPath = null;
    }
  }

  // Verificar se o post já existe no banco de dados
  const postExists = await db.checkIfPostExists(fullText, videoId);

  if (postExists) {
    console.log('Post duplicado detectado e ignorado:', fullText);
    // Opcional: enviar uma mensagem de volta ao proprietário informando sobre o duplicado
    // ctx.reply('Post duplicado detectado e ignorado.');
    // Se o vídeo foi baixado, excluí-lo agora, pois o post será ignorado.
    if (videoPath && fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
      console.log(`Temporary video file deleted for duplicate post: ${videoPath}`);
    }
    return;
  }

  postQueue.push({ text: fullText, videoId: videoId, videoPath: videoPath }); // Adicionar videoPath
  if (!isProcessingQueue) {
    processPostQueue();
  }
}

async function processPostQueue() {
  if (postQueue.length === 0) {
    isProcessingQueue = false;
    return;
  }

  isProcessingQueue = true;
  const postData = postQueue.shift(); // postData agora pode conter videoPath

  const postAt = await calculateNextPostTime();
  await db.addPostToQueue(postData, postAt); // db.addPostToQueue precisará ser atualizado para aceitar videoPath
  console.log(`Post adicionado à fila do banco de dados, agendado para ${postAt.toLocaleString()}`);

  // Se nenhum trabalho estiver agendado, ou o novo post for mais cedo que o agendado, reagendar.
  if (!scheduledJob || (scheduledJob && postAt < scheduledJob.nextInvocation())) {
    scheduleNextPost();
  }

  // Processar o próximo item na fila
  processPostQueue();
}

// Listen for new channel posts
bot.on('channel_post', (ctx) => {
  const post = ctx.channelPost;
  if (post.chat.id.toString() === config.telegram.channelId) {
    console.log('New post in channel:', post);
    handleNewPost(post);
  }
});

// Listen for forwarded messages from the owner
bot.on('message', (ctx) => {
  const message = ctx.message;

  // Check if the message is from the owner and is forwarded from the correct channel
  if (
    message.from.id.toString() === config.telegram.ownerId &&
    message.forward_from_chat &&
    message.forward_from_chat.id.toString() === config.telegram.channelId
  ) {
    console.log('Received forwarded post from owner:', message);
    handleNewPost(message);
    // Send a confirmation message back to the owner
    ctx.reply('Post adicionado à fila de agendamento!');
  }
});

async function postToTwitter(post) {
  console.log(`Posting scheduled post #${post.id} to ${twitterClients.length} Twitter account(s)...`);

  const videoPath = post.videoPath; // O videoPath já deve estar no objeto post

  try {
    const postPromises = twitterClients.map((client, index) => {
      return (async () => {
        let success = false;
        let message = '';
        try {
          const alreadyPosted = await db.checkIfPostWasSuccessfullyPostedToAccount(post.text, post.videoId, index + 1);
          if (alreadyPosted) {
            console.log(`[Account #${index + 1}] Post com o mesmo conteúdo já foi postado com sucesso. Ignorando.`);
            success = true; // Considerar como sucesso para não tentar novamente
            message = 'Post duplicado para esta conta, ignorado.';
          } else {
            if (post.videoId) {
              await uploadVideoAndPost(post, client, index + 1, videoPath); // Passar videoPath
            } else {
              console.log(`[Account #${index + 1}] Posting text tweet...`);
              await client.v2.tweet(post.text);
              console.log(`[Account #${index + 1}] Post successful!`);
            }
            success = true;
            message = 'Postado com sucesso.';
          }
        } catch (error) {
          console.error(`[Account #${index + 1}] Error posting tweet:`, error.message || error);
          success = false;
          message = error.message || 'Erro desconhecido ao postar.';
        } finally {
          await db.recordPostStatus(post.id, index + 1, success, message);
        }
      })();
    });

    await Promise.all(postPromises);

  } catch (error) {
    console.error(`Error during post processing for post #${post.id}:`, error.message || error);
    // Se houver um erro geral (que não deveria acontecer aqui se o download já foi feito),
    // marcar todas as contas como falha.
    const failedPromises = twitterClients.map((client, index) =>
      db.recordPostStatus(post.id, index + 1, false, `Erro durante o processamento do post: ${error.message}`)
    );
    await Promise.all(failedPromises);
  } finally {
    // 5. Delete temporary file if it exists, AFTER all accounts have attempted to post
    // O videoPath agora vem do objeto post, que foi baixado em handleNewPost
    if (videoPath && fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
      console.log(`Temporary video file deleted: ${videoPath}`);
    }
  }

  // Once all attempts are made (success or fail), mark the post as posted.
  await db.markPostAsPosted(post.id);
  
  // Schedule the next post.
  scheduleNextPost();
}

const uploadVideoAndPost = async (post, client, accountIndex, videoPath) => { // Aceitar videoPath
  try {
    console.log(`[Account #${accountIndex}] Starting video upload process...`);
    
    if (!videoPath || !fs.existsSync(videoPath)) {
      throw new Error('Video file not found for upload.');
    }

    // 3. Upload video to Twitter for the specific client
    console.log(`[Account #${accountIndex}] Uploading video to Twitter from ${videoPath}...`);
    const mediaId = await client.v1.uploadMedia(videoPath, {
      mimeType: 'video/mp4',
    });

    // 4. Post tweet with media ID for the specific client
    console.log(`[Account #${accountIndex}] Posting tweet with video...`);
    await client.v2.tweet(post.text, {
      media: { media_ids: [mediaId] },
    });

    console.log(`[Account #${accountIndex}] Post with video successful!`);

  } catch (error) {
    console.error(`[Account #${accountIndex}] Error in uploadVideoAndPost:`, error.message || error);
    throw error; // Re-throw to be caught by the postToTwitter's promise handler
  }
};

async function scheduleNextPost() {
  // Cancel any existing job
  if (scheduledJob) {
    scheduledJob.cancel();
    scheduledJob = null;
  }

  const nextPost = await db.getNextPostFromQueue();

  if (nextPost) {
    const postDate = new Date(nextPost.postAt);
    if (postDate > new Date()) {
      console.log(`Scheduling next post #${nextPost.id} for ${postDate.toLocaleString()}`);
      scheduledJob = schedule.scheduleJob(postDate, () => postToTwitter(nextPost));
    } else {
      // If the post is overdue, post it immediately.
      console.log(`Overdue post #${nextPost.id} found. Posting immediately.`);
      postToTwitter(nextPost);
    }
  } else {
    console.log('No posts in the queue to schedule.');
  }
}

async function main() {
  await db.setupDb();
  console.log('Database setup complete.');

  global.scheduleNextPost = scheduleNextPost;
  startServer(bot); // Passar o objeto bot para o servidor

  // Schedule the first post on startup
  scheduleNextPost();

  bot.launch();
  console.log('Bot is running...');
}

main().catch((err) => {
  console.error('Error during startup:', err);
  process.exit(1);
});
