require('dotenv').config(); // Load environment variables

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { createAudioPlayer, createAudioResource, joinVoiceChannel, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: ['CHANNEL', 'MESSAGE']
});

const token = process.env.DISCORD_TOKEN;
const apiKey = process.env.HUGGING_FACE_API_KEY;
const apiURL = 'https://api-inference.huggingface.co/models/YOUR_MODEL';
const youtubeApiKey = process.env.YOUTUBE_API_KEY;
const nekoBaseURL = 'https://nekobot.xyz/api';

if (!token || !apiKey) {
    console.error('Missing environment variables! Check .env');
    process.exit(1);
}

// Store game states
const games = new Map();

// Store user message activity (for spam protection)
const userMessages = new Map();

// Spam message threshold (e.g., 5 messages in 10 seconds)
const SPAM_THRESHOLD = 5;
const SPAM_TIME_WINDOW = 10000; // 10 seconds

client.once('ready', () => {
    console.log(`Logged in as ${client.user.username}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Ignore bot messages

    const content = message.content.toLowerCase().trim();
    console.log('Received message:', content); // Debugging log

    // Check for spam (same message being sent too many times in a short period)
    await handleSpamProtection(message, content);

    // Simple replies
    await handleSimpleReplies(message, content);

    // Polling system
    if (content.startsWith('!投票')) {
        await handlePoll(message, content);
    }

    // Delete messages - only for admins
    if (content.startsWith('!刪除')) {
        if (!message.member.permissions.has('ADMINISTRATOR')) {
            return await message.reply('你沒有權限執行此命令。只有管理員才能使用此命令。');
        }
        await handleDeleteMessages(message, content);
    }

    // Image generation
    if (content.startsWith('!畫畫')) {
        await generateImage(message, content);
    }

    // Rock Paper Scissors
    if (content.startsWith('!猜拳')) {
        await handleRockPaperScissors(message, content);
    }

    // NSFW image
    if (content.startsWith('!nsfw')) {
        await handleNSFWImage(message);
    }

    // Number guessing game
    if (content.startsWith('!猜數字')) {
        await handleNumberGuessingGame(message, content);
    }

    // Play music
    if (content.startsWith('!play')) {
        await handleMusicPlay(message, content);
    }
});

// Simple replies based on content
async function handleSimpleReplies(message, content) {
    const replies = {
        '測試': '測試成功！',
        '!help': '1 !投票 2 !刪除 3 !畫畫 4 !猜拳 5!nsfw 6 !猜數字 7 !play',
    };

    for (const [key, reply] of Object.entries(replies)) {
        if (content.includes(key)) {
            await message.reply(reply);
            return;
        }
    }
}

// Spam protection for any repetitive message
async function handleSpamProtection(message, content) {
    const userId = message.author.id;
    const currentTime = Date.now();

    // Initialize userMessages map if not set
    if (!userMessages.has(userId)) {
        userMessages.set(userId, []);
    }

    const userMessageTimes = userMessages.get(userId);

    // Remove messages older than the spam time window (SPAM_TIME_WINDOW)
    userMessages.set(userId, userMessageTimes.filter(time => currentTime - time < SPAM_TIME_WINDOW));

    // Add current message timestamp to the array
    userMessages.get(userId).push(currentTime);

    // Check if the user has sent the same message too many times in the window
    const messageHistory = userMessages.get(userId).filter(timestamp => message.content === content);
    if (messageHistory.length >= SPAM_THRESHOLD) {
        await message.delete();  // Delete the spam message
        await message.reply('請不要頻繁發送相同的消息。');
        console.log(`User ${userId} was warned for spamming: "${content}".`);
    }
}

// Poll system
async function handlePoll(message, content) {
    const args = content.split(' ').slice(1);
    if (args.length < 2) {
        return await message.reply('用法: !投票 [問題] [選項1] [選項2] ... [選項N]');
    }

    const question = args[0];
    const options = args.slice(1);

    if (options.length > 25) {
        return await message.reply('選項數量不能超過 25 個。');
    }

    const pollEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('投票系統')
        .setDescription(question)
        .setFooter({ text: 'React with the corresponding emoji to vote!' });

    options.forEach((option, index) => {
        pollEmbed.addFields({ name: `${index + 1}. ${option}`, value: '\u200B' });
    });

    try {
        const pollMessage = await message.channel.send({ embeds: [pollEmbed] });
        for (let i = 0; i < options.length; i++) {
            await pollMessage.react(['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][i]);
        }
    } catch (error) {
        console.error('Poll error:', error);
        await message.reply('發送投票消息時發生錯誤。');
    }
}

// Delete messages and respond
async function handleDeleteMessages(message, content) {
    const args = content.split(' ').slice(1);
    const numToDelete = parseInt(args[0]);

    if (isNaN(numToDelete) || numToDelete <= 0) {
        return await message.reply('請指定有效的刪除數量，例如：!刪除 10');
    }

    const deleteLimit = Math.min(numToDelete, 50);  // Limit deletion to 50 messages

    try {
        // Fetch messages from the current channel
        const fetchedMessages = await message.channel.messages.fetch({ limit: deleteLimit + 1 });

        // Filter out pinned messages and messages older than 14 days
        const messagesToDelete = fetchedMessages.filter(msg => 
            !msg.pinned && (Date.now() - msg.createdTimestamp < 1209600000)
        );

        // If there are no valid messages to delete
        if (messagesToDelete.size === 0) {
            return await message.reply('沒有可刪除的有效消息。');
        }

        // Attempt to delete the valid messages
        await message.channel.bulkDelete(messagesToDelete, true);

        // Deleting is successful, reply with a simple acknowledgment
        await message.channel.send('成功刪除消息！');

    } catch (error) {
        console.error('Message delete error:', error);

        // Provide more detailed error message
        if (error.code === 50035) {
            await message.reply('刪除訊息時發生錯誤：無效的消息引用。');
        } else {
            await message.reply('刪除訊息時發生錯誤。請再試一次。');
        }
    }
}


// Image generation with HuggingFace API
async function generateImage(message, content) {
    const prompt = content.replace('!畫畫', '').trim();
    if (!prompt) {
        return await message.reply('請提供一個畫圖的描述，例如：!畫畫 一隻可愛的小貓');
    }

    try {
        const response = await axios.post(apiURL, { inputs: prompt }, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        const imageUrl = response.data[0]?.url;

        if (!imageUrl) {
            throw new Error('No image URL returned');
        }

        const imageEmbed = new EmbedBuilder()
            .setTitle('AI 生成圖像')
            .setImage(imageUrl)
            .setFooter({ text: 'AI Bot • Stable Diffusion' });

        await message.channel.send({ embeds: [imageEmbed] });
    } catch (error) {
        console.error('Image generation error:', error);
        await message.reply('生成圖像時發生錯誤。');
    }
}

// Rock Paper Scissors game
async function handleRockPaperScissors(message, content) {
    const userChoice = content.split(' ')[1];
    const choices = ['石頭', '剪刀', '布'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];

    if (!choices.includes(userChoice)) {
        return await message.reply('請輸入有效選項：石頭、剪刀或布！');
    }

    await message.reply(`你選擇了 ${userChoice}，我選擇了 ${botChoice}。`);

    if (userChoice === botChoice) {
        await message.reply('平手！');
    } else if (
        (userChoice === '石頭' && botChoice === '剪刀') ||
        (userChoice === '剪刀' && botChoice === '布') ||
        (userChoice === '布' && botChoice === '石頭')
    ) {
        await message.reply('你贏了！');
    } else {
        await message.reply('我贏了！');
    }
}

// Command handler for fetching random image
async function handleNSFWImage(message) {
    if (message.channel.nsfw) {  // Check if the channel is NSFW
        try {
            // Request image of type 'neko' from NekoBot API
            const response = await axios.get(`${nekoBaseURL}/image`, { 
                params: { type: 'neko' }  // You can change 'neko' to other types as needed
            });
            const imageUrl = response.data.message;

            // Embed the image
            const nsfwEmbed = new EmbedBuilder()
                .setTitle('NSFW Image')
                .setImage(imageUrl)
                .setFooter({ text: 'NSFW Bot • nekobot.xyz' });

            await message.channel.send({ embeds: [nsfwEmbed] });
        } catch (error) {
            console.error('NSFW image error:', error);
            await message.reply('生成 NSFW 圖像時發生錯誤。');
        }
    } else {
        await message.reply('此命令只能在 NSFW 頻道中使用。');
    }
}

// Number guessing game
async function handleNumberGuessingGame(message, content) {
    const args = content.split(' ').slice(1);

    if (args[0] === '開始') {
        // Start game
        const secretNumber = Math.floor(Math.random() * 100) + 1;
        games.set(message.author.id, { secretNumber, attempts: 0 });

        await message.reply('遊戲開始了！猜一個 1 到 100 之間的數字。');
        console.log(`Game started! User ${message.author.id}'s secret number is ${secretNumber}`);
    } else {
        // Guess number
        const userGame = games.get(message.author.id);
        if (!userGame) {
            return await message.reply('你還沒有開始一個遊戲。使用 !猜數字 開始 來開始遊戲。');
        }

        const guess = parseInt(content.replace('!猜數字', '').trim());
        if (isNaN(guess) || guess < 1 || guess > 100) {
            return await message.reply('請輸入一個有效的數字（1 到 100）。');
        }

        userGame.attempts += 1;
        console.log(`User ${message.author.id} guessed ${guess}.`);

        if (guess === userGame.secretNumber) {
            await message.reply(`恭喜你！猜對了！你總共猜了 ${userGame.attempts} 次。`);
            games.delete(message.author.id);
        } else if (guess < userGame.secretNumber) {
            await message.reply('猜的數字太小了。再試一次！');
        } else {
            await message.reply('猜的數字太大了。再試一次！');
        }
    }
}

// Spotify API 配置
const SPOTIFY_API_URL = 'https://api.spotify.com/v1';
const SPOTIFY_ACCESS_TOKEN = '你的Spotify訪問令牌'; // 替換為你的OAuth訪問令牌

// 查找 Spotify 音樂
async function searchTrack(query) {
    const url = `${SPOTIFY_API_URL}/search`;
    const params = {
        q: query,
        type: 'track',  // 查找音樂
        limit: 1         // 限制結果數量
    };

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${SPOTIFY_ACCESS_TOKEN}`,
            },
            params
        });

        const track = response.data.tracks.items[0]; // 取第一個匹配的音樂

        if (!track) {
            return null;
        }

        // 返回音樂信息，包括音樂名稱和播放URL
        return {
            name: track.name,
            url: track.external_urls.spotify, // 返回 Spotify 的音樂 URL
            previewUrl: track.preview_url // 返回音樂預覽的 URL
        };
    } catch (error) {
        console.error('Error searching for track:', error);
        return null;
    }
}

// 播放 Spotify 音樂
async function handleMusicPlay(message, content) {
    const args = content.split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await message.reply('請提供要播放的音樂名稱或 URL。');
    }

    try {
        const track = await searchTrack(query); // 查找 Spotify 音樂
        if (!track) {
            return await message.reply('找不到指定的音樂。');
        }

        // 建立語音連接
        const connection = joinVoiceChannel({
            channelId: message.member.voice.channel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator
        });

        const player = createAudioPlayer();
        const resource = createAudioResource(track.previewUrl || track.url); // 使用預覽音樂URL或Spotify URL
        player.play(resource);

        connection.on(VoiceConnectionStatus.Ready, () => {
            connection.subscribe(player);
            message.reply(`正在播放：${track.name}`);
        });

        player.on(AudioPlayerStatus.Idle, () => {
            connection.destroy();
        });
    } catch (error) {
        console.error('Music play error:', error);
        await message.reply('播放音樂時發生錯誤。');
    }
}

// Login to Discord
client.login(token);
