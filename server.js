const express = require('express');
const path = require('path');
const db = require('./database');
const axios = require('axios'); // Adicionar axios para download de vídeo
const config = require('./config'); // Adicionar config para token do bot

const app = express();
const port = process.env.PORT || 3001;

// API endpoint to get all scheduled posts
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await db.getAllPostsFromQueue();
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.post('/api/posts/:id/now', async (req, res) => {
  try {
    const postId = req.params.id;
    const post = await db.getPostById(postId);
    if (!post) {
      return res.status(404).send('Post not found');
    }
    
    const newPostTime = new Date(new Date().getTime() + 60 * 1000); // 1 minute from now
    await db.updatePostTime(postId, newPostTime);
    
    // This is a placeholder for the rescheduling logic
    // The actual rescheduling will be handled in index.js
    if (global.scheduleNextPost) {
      global.scheduleNextPost();
    }
    
    res.status(200).send('Post rescheduled');
  } catch (error) {
    console.error('Error in /api/posts/:id/now:', error);
    res.status(500).json({ error: 'Failed to reschedule post' });
  }
});

// API endpoint to get all posted reports
app.get('/api/reports', async (req, res) => {
  try {
    const reports = await db.getPostedReports(); // Nova função no database.js
    res.json(reports);
  } catch (error) {
    console.error('Error in /api/reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Serve static files from the 'public' directory
// Endpoint para servir vídeos
app.get('/api/video/:videoId', async (req, res) => {
  const videoId = req.params.videoId;
  try {
    // O bot será passado para startServer, então precisamos de uma forma de acessá-lo aqui.
    // Por enquanto, vamos assumir que 'bot' está disponível globalmente ou será passado.
    // Para simplificar, vou usar o config.telegram.botToken diretamente aqui.
    // Em um cenário real, seria melhor passar o objeto 'bot' para evitar duplicação de lógica.

    // 1. Obter o caminho do arquivo do Telegram
    // Isso requer o objeto 'bot' para usar bot.telegram.getFile.
    // Como o 'bot' não está disponível diretamente aqui, vou simular a URL.
    // A URL real do vídeo do Telegram é construída em index.js:
    // `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`
    // Para este endpoint, o videoId é o file_id. Precisamos do filePath.
    // Isso significa que precisamos do objeto 'bot' aqui.

    // Refatoração necessária: passar o objeto 'bot' para startServer.
    // Por enquanto, vou deixar um placeholder e farei a refatoração em index.js.
    // Para o MVP, vou usar uma URL de exemplo ou assumir que o videoId é a URL completa.
    // Mas a instrução é para servir o vídeo do servidor que foi upado.
    // O vídeo não é "upado" para o servidor de forma persistente para ser servido.
    // Ele é baixado temporariamente para ser enviado ao Twitter.

    // A melhor abordagem é que o frontend peça o videoId, e o backend use o file_id
    // para obter a URL do Telegram e redirecionar ou fazer proxy.

    // Para evitar salvar o arquivo no disco, faremos um proxy.
    // O 'bot' precisa ser acessível aqui.

    // Placeholder para a lógica real:
    // const file = await bot.telegram.getFile(videoId);
    // const filePath = file.file_path;
    // const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;

    // Para que isso funcione, 'bot' precisa ser passado para 'startServer'.
    // Vou adicionar um placeholder para o bot e o config.
    // E depois refatorar index.js para passar o bot.

    // Temporariamente, vou usar o config.telegram.botToken para construir a URL.
    // Mas ainda preciso do filePath, que só vem de bot.telegram.getFile(videoId).
    // Então, a refatoração é essencial.

    // Vou adicionar um parâmetro 'botInstance' à função startServer.
    // E o endpoint usará esse botInstance.

    res.status(501).send('Video streaming not yet implemented. Server needs bot instance.');

  } catch (error) {
    console.error(`Error serving video ${videoId}:`, error);
    res.status(500).json({ error: 'Failed to stream video' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

function startServer(botInstance) { // Aceitar botInstance como parâmetro
  if (!botInstance) {
    console.error('Bot instance not provided to startServer.');
    process.exit(1);
  }

  // Agora o botInstance está disponível para o endpoint de vídeo
  app.get('/api/video/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    try {
      const file = await botInstance.telegram.getFile(videoId);
      const filePath = file.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;

      const response = await axios({
        url: fileUrl,
        method: 'GET',
        responseType: 'stream',
      });

      // Definir cabeçalhos para streaming de vídeo
      res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
      res.setHeader('Content-Length', response.headers['content-length']);
      res.setHeader('Accept-Ranges', 'bytes');

      response.data.pipe(res); // Stream o vídeo diretamente para o cliente

    } catch (error) {
      console.error(`Error serving video ${videoId}:`, error);
      res.status(500).json({ error: 'Failed to stream video' });
    }
  });

  app.listen(port, () => {
    console.log(`Web server running at http://localhost:${port}`);
  });
}

module.exports = { startServer };
