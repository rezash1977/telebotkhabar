const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();
const puppeteer = require('puppeteer');

const token = process.env.TELEGRAM_BOT_TOKEN || '7435493856:AAEOlA9wzXRw3x9KFwJaiFVuvoQRMchwu0I';
const dataFilePath = 'data.json';

// --- Configuration ---
const SCRAPE_INTERVAL_MINUTES = 10; // Check every 10 minutes
const SCRAPE_TIMEOUT_MS = 120000; // Timeout for page load (120 seconds)

// --- Data Management ---
let data = { users: {}, keywords: [], loggedInUsers: {}, adminUsernames: [], scrapeChannel: null, lastScrapedMessageId: {} };
let isScraping = false; // Flag to prevent concurrent scrapes

function loadData() {
    try {
        if (fs.existsSync(dataFilePath)) {
            const fileData = fs.readFileSync(dataFilePath, 'utf8');
            data = JSON.parse(fileData);
            data.users = data.users || {};
            data.keywords = data.keywords || [];
            data.loggedInUsers = data.loggedInUsers || {};
            data.adminUsernames = data.adminUsernames || [];
            data.scrapeChannel = data.scrapeChannel || null;
            data.lastScrapedMessageId = data.lastScrapedMessageId || {};

            // Compatibility: Ensure isAdmin exists, default to false
            // Also populate adminUsernames list for easier checking
            data.adminUsernames = [];
            for (const username in data.users) {
                if (data.users[username].isAdmin === undefined) {
                    data.users[username].isAdmin = false;
                }
                if (data.users[username].isAdmin === true) {
                    data.adminUsernames.push(username);
                }
            }
            console.log('Data loaded successfully.');
        } else {
            // Initialize with default structure if file doesn't exist
            data = { users: {}, keywords: ['ایران'], loggedInUsers: {}, adminUsernames: [], scrapeChannel: null, lastScrapedMessageId: {} };
            saveData();
            console.log('data.json not found, created with default structure.');
        }
    } catch (err) {
        console.error('Error loading data.json:', err);
        data = { users: {}, keywords: ['ایران'], loggedInUsers: {}, adminUsernames: [], scrapeChannel: null, lastScrapedMessageId: {} };
    }
}

function saveData() {
    try {
        // Re-populate adminUsernames before saving, just in case
        data.adminUsernames = Object.keys(data.users).filter(u => data.users[u].isAdmin);
        fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('Error saving data.json:', err);
    }
}

// --- Password Hashing ---
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// --- Bot State Management ---
// Tracks what the bot is expecting from each user
// Example: { chatId: { state: 'awaiting_username', action: 'register' } }
const userStates = {};

// --- Bot Initialization ---
loadData();
const bot = new TelegramBot(token, { polling: true });
console.log('Bot is running...');
console.log('Keywords loaded:', data.keywords);

// --- Keyboard Definitions ---
const mainMenuLoggedOut = {
    inline_keyboard: [
        [{ text: '✍️ ثبت نام', callback_data: 'register_prompt' }],
        [{ text: '🔑 ورود', callback_data: 'login_prompt' }],
        [{ text: '❓ راهنما', callback_data: 'help' }]
    ]
};

const mainMenuLoggedIn = {
    inline_keyboard: [
        [{ text: '➕ افزودن کلمه کلیدی', callback_data: 'add_keyword_prompt' }],
        [{ text: '➖ حذف کلمه کلیدی', callback_data: 'remove_keyword_prompt' }],
        [{ text: '📜 لیست کلمات کلیدی', callback_data: 'list_keywords' }],
        [{ text: '🚪 خروج', callback_data: 'logout' }]
    ]
};

// --- Helper Functions ---
function isUserAdmin(chatId) {
    const username = data.loggedInUsers[chatId];
    return username && data.users[username] && data.users[username].isAdmin;
}

function sendMainMenu(chatId, messageText = 'انتخاب کنید:') {
    const username = data.loggedInUsers[chatId];
    let keyboard;
    let welcomeMsg = messageText;
    const isAdmin = isUserAdmin(chatId);

    if (username) {
        welcomeMsg = `✅ شما با نام کاربری *${username}*${isAdmin ? ' (ادمین) ' : ''} وارد شده‌اید.\n${messageText}`;
        // Add admin-specific buttons if desired
        let buttons = [
            [{ text: '➕ افزودن کلمه کلیدی', callback_data: 'add_keyword_prompt' }],
            [{ text: '➖ حذف کلمه کلیدی', callback_data: 'remove_keyword_prompt' }],
            [{ text: '📜 لیست کلمات کلیدی', callback_data: 'list_keywords' }]
        ];
        if (isAdmin) {
             buttons.push([{ text: '👑 مدیریت ادمین‌ها', callback_data: 'admin_manage' }]);
        }
         buttons.push([{ text: '🚪 خروج', callback_data: 'logout' }]);
        keyboard = { inline_keyboard: buttons };

    } else {
        keyboard = mainMenuLoggedOut; // Assumes mainMenuLoggedOut is defined
    }
    bot.sendMessage(chatId, welcomeMsg, { reply_markup: keyboard, parse_mode: 'Markdown' });
}

function clearUserState(chatId) {
    delete userStates[chatId];
}

// --- /start Command Handler ---
bot.onText(/^\/start$/, (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type !== 'private') {
        bot.sendMessage(chatId, 'لطفاً از این ربات در چت خصوصی استفاده کنید.');
        return;
    }

    clearUserState(chatId); // Clear any previous state
    const welcomeMessage = `👋 خوش آمدید!

این ربات پیام‌های گروه‌هایی که در آن عضو است را برای کلمات کلیدی مشخص شده بررسی می‌کند و در صورت تطابق، آن پیام را برای شما فوروارد می‌کند.

لطفا ثبت نام کنید یا وارد شوید:`;
    sendMainMenu(chatId, welcomeMessage);
});

// --- Callback Query Handler (Button Clicks) ---
bot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const dataCallback = callbackQuery.data;

    // --- Answer Callback Query Immediately ---
    bot.answerCallbackQuery(callbackQuery.id).catch(err => {
        // Log error if answering fails, but don't stop processing
        console.error('Error answering callback query:', err.message);
    });
    // ----------------------------------------

    const usernameLoggedIn = data.loggedInUsers[chatId];
    const isAdmin = isUserAdmin(chatId);

    // Clear previous state before starting a new action
    clearUserState(chatId);

    // Only handle callbacks if user is logged in for most actions
    if (!usernameLoggedIn && ![ 'register_prompt', 'login_prompt', 'help' ].includes(dataCallback)) {
        sendMainMenu(chatId, '❌ برای دسترسی به این بخش، ابتدا وارد شوید.');
        return;
    }

    switch (dataCallback) {
        case 'register_prompt':
            userStates[chatId] = { state: 'awaiting_username', action: 'register' };
            bot.sendMessage(chatId, 'لطفا نام کاربری مورد نظر خود را وارد کنید:');
            break;
        case 'login_prompt':
            userStates[chatId] = { state: 'awaiting_username', action: 'login' };
            bot.sendMessage(chatId, 'لطفا نام کاربری خود را وارد کنید:');
            break;
        case 'help':
            bot.sendMessage(chatId, `راهنما:
- برای شروع، ثبت نام کنید یا وارد شوید.
- پس از ورود، می‌توانید کلمات کلیدی را مدیریت کنید.
- ربات را به گروه‌های مورد نظر اضافه کنید (مطمئن شوید ربات دسترسی خواندن پیام و Privacy Mode آن غیرفعال باشد).
- پیام‌های حاوی کلمات کلیدی به صورت خودکار برای شما فوروارد می‌شوند.
برای بازگشت به منو /start را بزنید.`);
            break;
        case 'add_keyword_prompt':
            if (!usernameLoggedIn) { sendMainMenu(chatId, '❌ ابتدا وارد شوید.'); break; }
            userStates[chatId] = { state: 'awaiting_keyword', action: 'add' };
            bot.sendMessage(chatId, 'لطفا کلمه کلیدی مورد نظر برای افزودن را وارد کنید:');
            break;
        case 'remove_keyword_prompt':
            if (!usernameLoggedIn) { sendMainMenu(chatId, '❌ ابتدا وارد شوید.'); break; }
            if (data.keywords.length === 0) {
                 bot.sendMessage(chatId, '⚠️ هیچ کلمه کلیدی برای حذف وجود ندارد.').then(() => sendMainMenu(chatId));
                 break;
            }
            userStates[chatId] = { state: 'awaiting_keyword', action: 'remove' };
            bot.sendMessage(chatId, `کدام کلمه کلیدی را می‌خواهید حذف کنید؟ (از لیست زیر)
- ${data.keywords.join('\n- ')}`);
            break;
        case 'list_keywords':
            if (!usernameLoggedIn) { sendMainMenu(chatId, '❌ ابتدا وارد شوید.'); break; }
            if (data.keywords.length > 0) {
                bot.sendMessage(chatId, `📜 لیست کلمات کلیدی فعال:
- ${data.keywords.join('\n- ')}`).then(() => sendMainMenu(chatId));
            } else {
                bot.sendMessage(chatId, '⚠️ هیچ کلمه کلیدی فعالی تنظیم نشده است.').then(() => sendMainMenu(chatId));
            }
            break;
        case 'logout':
            if (usernameLoggedIn) {
                delete data.loggedInUsers[chatId];
                saveData();
                bot.sendMessage(chatId, '✅ با موفقیت خارج شدید.').then(() => sendMainMenu(chatId));
                console.log(`User logged out: ${usernameLoggedIn} (Chat ID: ${chatId})`);
            } else {
                sendMainMenu(chatId, 'شما وارد سیستم نشده بودید.');
            }
            break;
        case 'admin_manage':
             if (!isAdmin) { sendMainMenu(chatId, '❌ شما دسترسی ادمین ندارید.'); break; }
             const adminKeyboard = {
                inline_keyboard: [
                    [{ text: 'افزودن ادمین جدید', callback_data: 'add_admin_prompt' }],
                    [{ text: 'حذف ادمین', callback_data: 'remove_admin_prompt' }],
                    [{ text: 'لیست ادمین‌ها', callback_data: 'list_admins' }],
                    [{ text: 'تنظیم کانال اسکرپ', callback_data: 'set_scrape_channel_prompt' }],
                    [{ text: 'بررسی کانال اسکرپ', callback_data: 'check_scrape_channel' }],
                    [{ text: 'بازگشت', callback_data: 'back_to_main' }]
                ]
            };
             bot.sendMessage(chatId, 'مدیریت ادمین‌ها و اسکرپ:', { reply_markup: adminKeyboard });
             break;
        case 'add_admin_prompt':
            if (!isAdmin) { sendMainMenu(chatId, '❌ شما دسترسی ادمین ندارید.'); break; }
            userStates[chatId] = { state: 'awaiting_username', action: 'make_admin' };
            bot.sendMessage(chatId, 'لطفا نام کاربری فردی که می‌خواهید به ادمین تبدیل کنید را وارد نمایید:');
            break;
        case 'remove_admin_prompt':
            if (!isAdmin) { sendMainMenu(chatId, '❌ شما دسترسی ادمین ندارید.'); break; }
             if (data.adminUsernames.length <= 1) {
                 bot.sendMessage(chatId, '⚠️ حداقل یک ادمین باید وجود داشته باشد. نمی‌توانید آخرین ادمین را حذف کنید.');
                 break;
             }
            userStates[chatId] = { state: 'awaiting_username', action: 'remove_admin' };
            bot.sendMessage(chatId, `نام کاربری ادمینی که می‌خواهید حذف کنید وارد نمایید (از لیست زیر، به جز خودتان):
- ${data.adminUsernames.filter(u => u !== usernameLoggedIn).join('\n- ')}`);
            break;
        case 'list_admins':
            if (!isAdmin) { sendMainMenu(chatId, '❌ شما دسترسی ادمین ندارید.'); break; }
            bot.sendMessage(chatId, `لیست ادمین‌های فعلی:
- ${data.adminUsernames.join('\n- ')}`).then(() => sendMainMenu(chatId));
            break;
        case 'back_to_main':
            sendMainMenu(chatId);
            break;
        case 'set_scrape_channel_prompt':
            if (!isAdmin) { sendMainMenu(chatId, '❌ شما دسترسی ادمین ندارید.'); break; }
            userStates[chatId] = { state: 'awaiting_channel_username', action: 'set_scrape_channel' };
            bot.sendMessage(chatId, 'لطفا نام کاربری کانال عمومی مورد نظر را بدون @ وارد کنید (مثال: varzesh3). برای لغو، /cancel را بزنید.');
            break;
        case 'check_scrape_channel':
             if (!isAdmin) { sendMainMenu(chatId, '❌ شما دسترسی ادمین ندارید.'); break; }
             if (!data.scrapeChannel) {
                 bot.sendMessage(chatId, '⚠️ ابتدا باید یک کانال برای اسکرپ با استفاده از منوی مدیریت تنظیم کنید.').then(() => sendMainMenu(chatId));
                 break;
             }
            bot.sendMessage(chatId, `⏳ در حال بررسی کانال @${data.scrapeChannel} برای پیام‌های جدید... لطفاً صبر کنید.`);
            scrapePublicChannel(data.scrapeChannel).then(foundMessages => {
                if (foundMessages.length > 0) {
                    bot.sendMessage(chatId, `✅ ${foundMessages.length} پیام جدید حاوی کلمات کلیدی یافت شد:`)
                    foundMessages.forEach(msg => {
                         // Send message content instead of forwarding
                         bot.sendMessage(chatId, `کانال: @${data.scrapeChannel}\nکلمه کلیدی: ${msg.keyword}\n\n${msg.text.substring(0, 3500)}...`); // Limit message length
                    });
                } else {
                    bot.sendMessage(chatId, `ℹ️ پیام جدیدی حاوی کلمات کلیدی در کانال @${data.scrapeChannel} یافت نشد.`);
                }
                 sendMainMenu(chatId); // Show menu again after check
            }).catch(err => {
                console.error("Error during manual scrape check:", err);
                // Send the specific error message from scrape function if available
                bot.sendMessage(chatId, `❌ خطایی هنگام بررسی کانال رخ داد: ${err.message || 'Unknown error'}`).then(() => sendMainMenu(chatId));
            });
            break;
        default:
            sendMainMenu(chatId, 'دستور نامشخص.'); // Should not happen
            break;
    }
});

// --- Text Message Handler (Handles user input based on state) ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // --- Group Message Forwarding Logic (Modified) ---
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        const groupChatId = msg.chat.id;
        const messageId = msg.message_id;
        const messageText = msg.text || msg.caption;

        if (!messageText) return;
        const foundKeyword = data.keywords.find(keyword => messageText.includes(keyword));

        if (foundKeyword) {
            console.log(`Keyword "${foundKeyword}" found in group ${groupChatId}.`);
            // Find logged-in users who ARE admins
            const loggedInAdminChatIds = Object.keys(data.loggedInUsers).filter(cid => {
                const uname = data.loggedInUsers[cid];
                return uname && data.users[uname] && data.users[uname].isAdmin;
            });

            if (loggedInAdminChatIds.length > 0) {
                console.log(`Forwarding to ${loggedInAdminChatIds.length} admin user(s).`);
                for (const targetChatId of loggedInAdminChatIds) {
                    try {
                        await bot.forwardMessage(targetChatId, groupChatId, messageId);
                    } catch (error) {
                        console.error(`Error forwarding to admin ${targetChatId}:`, error.response ? error.response.body : error.message);
                        if (error.response && (error.response.statusCode === 403 || error.response.statusCode === 400)) {
                            console.log(`Admin User ${data.loggedInUsers[targetChatId]} (Chat ID: ${targetChatId}) might have blocked the bot. Logging them out.`);
                            delete data.loggedInUsers[targetChatId];
                            saveData();
                        }
                    }
                }
            } else {
                console.log('Keyword found, but no logged-in admin users to forward to.');
            }
        }
        return; // Don't process group messages further
    }

    // --- Private Chat State Management Logic (Modified for admin actions) ---
    if (msg.chat.type === 'private' && userStates[chatId] && text && !text.startsWith('/')) {
        const stateInfo = userStates[chatId];
        const currentState = stateInfo.state;
        const currentAction = stateInfo.action;

        switch (currentState) {
            case 'awaiting_username':
                stateInfo.username = text.toLowerCase();
                stateInfo.state = 'awaiting_password';
                bot.sendMessage(chatId, 'لطفا رمز عبور را وارد کنید:');
                break;

            case 'awaiting_password':
                const username = stateInfo.username;
                const password = text;
                if (currentAction === 'register') {
                    if (data.users[username]) {
                        bot.sendMessage(chatId, '❌ نام کاربری قبلاً ثبت شده است.').then(() => sendMainMenu(chatId));
                    } else {
                        // Make the very first user an admin automatically
                        const isFirstUser = Object.keys(data.users).length === 0;
                        data.users[username] = {
                            passwordHash: hashPassword(password),
                            isAdmin: isFirstUser // First user becomes admin
                        };
                        if (isFirstUser) {
                            data.adminUsernames.push(username);
                            console.log(`User registered: ${username} (Auto-Admin)`);
                            bot.sendMessage(chatId, '✅ ثبت نام با موفقیت انجام شد. شما به عنوان اولین کاربر، ادمین شدید.').then(() => sendMainMenu(chatId));
                        } else {
                             console.log(`User registered: ${username}`);
                             bot.sendMessage(chatId, '✅ ثبت نام با موفقیت انجام شد.').then(() => sendMainMenu(chatId));
                        }
                        saveData();
                    }
                } else if (currentAction === 'login') {
                    const user = data.users[username];
                    if (user && user.passwordHash === hashPassword(password)) {
                        data.loggedInUsers[chatId] = username;
                        saveData(); // Persist login
                        console.log(`User logged in: ${username} (Chat ID: ${chatId})`);
                        sendMainMenu(chatId, `✅ خوش آمدید ${username}!`);
                    } else {
                        bot.sendMessage(chatId, '❌ نام کاربری یا رمز عبور نامعتبر است.').then(() => sendMainMenu(chatId));
                    }
                }
                clearUserState(chatId);
                break;

            case 'awaiting_keyword':
                const keyword = text.trim();
                if (currentAction === 'add') {
                    if (keyword && !data.keywords.includes(keyword)) {
                        data.keywords.push(keyword);
                        saveData();
                        bot.sendMessage(chatId, `✅ کلمه کلیدی "${keyword}" اضافه شد.`).then(() => sendMainMenu(chatId));
                        console.log(`Keyword added: "${keyword}" by user ${data.loggedInUsers[chatId]}`);
                    } else if (data.keywords.includes(keyword)) {
                        bot.sendMessage(chatId, `⚠️ کلمه کلیدی "${keyword}" از قبل وجود دارد.`).then(() => sendMainMenu(chatId));
                    } else {
                        bot.sendMessage(chatId, '❌ لطفاً یک کلمه کلیدی معتبر وارد کنید.').then(() => sendMainMenu(chatId));
                    }
                } else if (currentAction === 'remove') {
                    const initialLength = data.keywords.length;
                    data.keywords = data.keywords.filter(k => k !== keyword);
                    if (data.keywords.length < initialLength) {
                        saveData();
                        bot.sendMessage(chatId, `✅ کلمه کلیدی "${keyword}" حذف شد.`).then(() => sendMainMenu(chatId));
                        console.log(`Keyword removed: "${keyword}" by user ${data.loggedInUsers[chatId]}`);
                    } else {
                        bot.sendMessage(chatId, `❌ کلمه کلیدی "${keyword}" یافت نشد.`).then(() => sendMainMenu(chatId));
                    }
                }
                clearUserState(chatId);
                break;

            case 'awaiting_username': // Re-checking state for admin actions
                 const targetUsername = text.toLowerCase();
                 if (!data.users[targetUsername]) {
                     bot.sendMessage(chatId, `❌ کاربری با نام ${targetUsername} یافت نشد.`).then(() => sendMainMenu(chatId));
                     clearUserState(chatId);
                     break;
                 }
                if (currentAction === 'make_admin') {
                    if (data.users[targetUsername].isAdmin) {
                        bot.sendMessage(chatId, `⚠️ کاربر ${targetUsername} در حال حاضر ادمین است.`).then(() => sendMainMenu(chatId));
                    } else {
                        data.users[targetUsername].isAdmin = true;
                        saveData();
                        bot.sendMessage(chatId, `✅ کاربر ${targetUsername} با موفقیت به ادمین تبدیل شد.`).then(() => sendMainMenu(chatId));
                        console.log(`Admin status granted to ${targetUsername} by ${data.loggedInUsers[chatId]}`);
                    }
                 } else if (currentAction === 'remove_admin') {
                     const issuerUsername = data.loggedInUsers[chatId];
                     if (targetUsername === issuerUsername) {
                         bot.sendMessage(chatId, '❌ شما نمی‌توانید خودتان را از لیست ادمین‌ها حذف کنید.').then(() => sendMainMenu(chatId));
                     } else if (!data.users[targetUsername].isAdmin) {
                         bot.sendMessage(chatId, `⚠️ کاربر ${targetUsername} ادمین نیست.`).then(() => sendMainMenu(chatId));
                     } else if (data.adminUsernames.length <= 1) {
                          bot.sendMessage(chatId, '⚠️ حداقل یک ادمین باید وجود داشته باشد. نمی‌توانید آخرین ادمین را حذف کنید.').then(() => sendMainMenu(chatId));
                     } else {
                         data.users[targetUsername].isAdmin = false;
                         saveData();
                         bot.sendMessage(chatId, `✅ کاربر ${targetUsername} از لیست ادمین‌ها حذف شد.`).then(() => sendMainMenu(chatId));
                         console.log(`Admin status revoked from ${targetUsername} by ${issuerUsername}`);
                     }
                 }
                 clearUserState(chatId);
                 break;

            case 'awaiting_channel_username':
                const channelUsernameInput = text.trim().replace(/^@/, '');
                if (currentAction === 'set_scrape_channel') {
                    if (/^[a-zA-Z0-9_]{5,}$/.test(channelUsernameInput)) {
                        data.scrapeChannel = channelUsernameInput;
                        data.lastScrapedMessageId[channelUsernameInput.toLowerCase()] = 0;
                        saveData();
                        bot.sendMessage(chatId, `✅ کانال @${data.scrapeChannel} برای اسکرپ تنظیم شد.`).then(() => sendMainMenu(chatId));
                        console.log(`Scrape channel set to: ${data.scrapeChannel} by ${data.loggedInUsers[chatId]}`);
                    } else {
                        bot.sendMessage(chatId, '❌ نام کاربری کانال نامعتبر است. لطفاً دوباره وارد کنید یا /cancel را بزنید.');
                        break;
                    }
                }
                clearUserState(chatId);
                break;
        }
    } else if (msg.chat.type === 'private' && text === '/start') {
        // Allow /start to reset state even if waiting for input
        // Handled by bot.onText('/start', ...)
    } else if (msg.chat.type === 'private' && !text.startsWith('/') && !userStates[chatId]) {
        // Handle random text when no state is set
        sendMainMenu(chatId, 'لطفا از منوی زیر استفاده کنید یا /start را بزنید.');
    } else if (msg.chat.type === 'private' && text === '/cancel' && userStates[chatId]) {
        clearUserState(chatId);
        sendMainMenu(chatId, 'عملیات لغو شد.');
    }
});

// --- Channel Post Handler ---
async function handleChannelPost(post) {
    const channelChatId = post.chat.id;
    const messageId = post.message_id;
    const messageText = post.text || post.caption;

    // Ensure it's a channel and there's text/caption
    if (post.chat.type !== 'channel' || !messageText) {
        // console.log('Ignoring non-channel post or post without text.');
        return;
    }

    const foundKeyword = data.keywords.find(keyword => messageText.includes(keyword));

    if (foundKeyword) {
        console.log(`Keyword "${foundKeyword}" found in channel ${channelChatId} (${post.chat.title || 'Untitled Channel'}). Post ID: ${messageId}`);

        // Find logged-in users who ARE admins
        const loggedInAdminChatIds = Object.keys(data.loggedInUsers).filter(cid => {
            const uname = data.loggedInUsers[cid];
            return uname && data.users[uname] && data.users[uname].isAdmin;
        });

        if (loggedInAdminChatIds.length > 0) {
            console.log(`Forwarding channel post to ${loggedInAdminChatIds.length} admin user(s).`);
            for (const targetChatId of loggedInAdminChatIds) {
                try {
                    await bot.forwardMessage(targetChatId, channelChatId, messageId);
                     console.log(`Successfully forwarded channel post ${messageId} from ${channelChatId} to admin ${targetChatId}`);
                } catch (error) {
                    console.error(`Error forwarding channel post ${messageId} to admin ${targetChatId}:`, error.response ? error.response.body : error.message);
                    // Optional: Handle specific errors like user blocking the bot
                    if (error.response && (error.response.statusCode === 403 || error.response.statusCode === 400)) {
                        console.log(`Admin User ${data.loggedInUsers[targetChatId]} (Chat ID: ${targetChatId}) might have blocked the bot. Logging them out.`);
                        delete data.loggedInUsers[targetChatId];
                        saveData();
                    }
                }
            }
        } else {
            console.log('Keyword found in channel post, but no logged-in admin users to forward to.');
        }
    }
}

bot.on('channel_post', handleChannelPost);
bot.on('edited_channel_post', handleChannelPost); // Also check edited posts

// --- Error Handling ---
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.code, '-', error.message);
});

bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error.code, '-', error.message);
});

console.log('Event listeners attached.');

// --- Web Scraping Function (Updated Selectors & ID logic) ---
async function scrapePublicChannel(channelUsername) {
    if (!channelUsername) return [];
    const url = `https://t.me/s/${channelUsername}`;
    console.log(`[${new Date().toISOString()}] Starting scrape for: ${url}`);
    let browser = null;
    const foundMessages = [];

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36');
        console.log(`Navigating to ${url} with ${SCRAPE_TIMEOUT_MS / 1000}s timeout...`);
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: SCRAPE_TIMEOUT_MS
        });
        console.log(`Page loaded: ${url}`);

        // --- Updated Selectors based on new screenshot ---
        const messageSelector = '.tgme_widget_message_wrap.js-widget_message_wrap'; // Main message container
        const textSelector = '.tgme_widget_message_text.js-message_text';    // Element containing the message text
        const messageIdAttr = 'data-post'; // Attribute holding the ID (e.g., "channel/12345")
        // --------------------------------------------------

        const messages = await page.$$(messageSelector);
        console.log(`Found ${messages.length} potential message containers on the page.`);

        let latestMessageIdThisScrape = 0;
        const channelKey = channelUsername.toLowerCase();
        const lastProcessedId = data.lastScrapedMessageId[channelKey] || 0;
        // console.log(`Last processed ID for ${channelKey}: ${lastProcessedId}`);

        // Process messages (consider processing in reverse if needed, but usually chronological)
        for (const messageHandle of messages.slice(-30)) { // Process last 30 for efficiency
             let postIdAttr = null; 
             try {
                // Find the child element with the data-post attribute
                // Using '.js-widget_message' as it seems present on the div with data-post
                const postElementHandle = await messageHandle.$('.js-widget_message[data-post]'); // More specific selector

                if (!postElementHandle) {
                    console.log(`[Scrape Debug] Skipping message: Could not find child element with [data-post].`);
                    continue;
                }

                postIdAttr = await postElementHandle.evaluate(el => el.getAttribute('data-post'));
                await postElementHandle.dispose(); // Dispose the handle

                let messageId = 0;
                if (postIdAttr && postIdAttr.includes('/')) {
                    messageId = parseInt(postIdAttr.split('/')[1], 10);
                }
                console.log(`[Scrape Debug] Processing element with data-post="${postIdAttr}", Extracted ID: ${messageId}`); 

                if (!messageId || isNaN(messageId)) {
                    console.log(`[Scrape Debug] Skipping message: Invalid or non-numeric ID from data-post="${postIdAttr}".`); 
                    continue;
                }
                if (messageId <= lastProcessedId) {
                     console.log(`[Scrape Debug] Skipping message ID ${messageId}: Already processed (Last processed: ${lastProcessedId})`);
                     continue; 
                }

                if (messageId > latestMessageIdThisScrape) latestMessageIdThisScrape = messageId;

                // Get text content
                const textElement = await messageHandle.$(textSelector);
                const messageText = textElement ? await textElement.evaluate(el => el.innerText) : null;
                console.log(`[Scrape Debug] Message ID ${messageId} - Extracted Text: ${(messageText || 'NULL/EMPTY').substring(0, 70)}...`); // <-- DEBUG LOG

                if (messageText) {
                    const foundKeyword = data.keywords.find(keyword => messageText.includes(keyword));
                    if (foundKeyword) {
                        console.log(`[Scrape Debug] Keyword "${foundKeyword}" FOUND in message ID ${messageId}`); // <-- DEBUG LOG
                        foundMessages.push({ id: messageId, text: messageText, keyword: foundKeyword });
                    } else {
                         console.log(`[Scrape Debug] No keywords found in message ID ${messageId}`); // <-- DEBUG LOG
                    }
                } else {
                    console.log(`[Scrape Debug] Text extraction failed for message ID ${messageId}`); // <-- DEBUG LOG
                }
             } catch(err) {
                  console.error(`Error processing a message (Attribute approx ${postIdAttr || 'unknown'}?) from @${channelUsername}:`, err);
             }
        }

        if (latestMessageIdThisScrape > lastProcessedId) {
            data.lastScrapedMessageId[channelKey] = latestMessageIdThisScrape;
            saveData();
            console.log(`Updated last processed ID for ${channelKey} via auto-scrape to ${latestMessageIdThisScrape}`);
        }

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error during auto-scrape for ${channelUsername}:`, error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
    return foundMessages.sort((a, b) => a.id - b.id); // Return sorted by ID
}

// --- Automatic Scrape Interval ---
setInterval(async () => {
    if (!data.scrapeChannel || isScraping) {
        // Don't run if no channel is set or if already scraping
        return;
    }

    isScraping = true;
    console.log(`[${new Date().toISOString()}] Auto-scrape interval triggered for @${data.scrapeChannel}`);

    try {
        const foundMessages = await scrapePublicChannel(data.scrapeChannel);

        if (foundMessages.length > 0) {
            const loggedInAdminChatIds = Object.keys(data.loggedInUsers).filter(cid => isUserAdmin(cid));

            if (loggedInAdminChatIds.length > 0) {
                console.log(`Auto-scrape found ${foundMessages.length} new messages. Sending to ${loggedInAdminChatIds.length} admins.`);
                for (const targetChatId of loggedInAdminChatIds) {
                    for (const msg of foundMessages) {
                         try {
                            // Send message content instead of forwarding
                            await bot.sendMessage(targetChatId, `کانال: @${data.scrapeChannel}\nکلمه کلیدی: ${msg.keyword}\n\n${msg.text.substring(0, 3500)}...`); // Limit message length
                             await new Promise(resolve => setTimeout(resolve, 300)); // Small delay between messages to avoid rate limits
                         } catch (sendError) {
                            console.error(`[${new Date().toISOString()}] Error sending auto-scraped message ${msg.id} to admin ${targetChatId}:`, sendError.message);
                             // Handle user blocking bot during send
                             if (sendError.response && (sendError.response.statusCode === 403 || sendError.response.statusCode === 400)) {
                                 console.log(`Admin User ${data.loggedInUsers[targetChatId]} (Chat ID: ${targetChatId}) blocked bot during auto-send. Logging out.`);
                                 delete data.loggedInUsers[targetChatId];
                                 saveData();
                                 break; // Stop sending to this user for this batch
                             }
                         }
                    }
                }
            } else {
                 console.log(`Auto-scrape found ${foundMessages.length} messages, but no admins are logged in.`);
            }
        }
    } catch (err) {
        // Errors are logged within scrapePublicChannel for the interval
        console.error(`[${new Date().toISOString()}] Uncaught error during scrape interval execution: ${err.message}`);
    } finally {
        isScraping = false;
        console.log(`[${new Date().toISOString()}] Auto-scrape cycle finished for @${data.scrapeChannel}`);
    }
}, SCRAPE_INTERVAL_MINUTES * 60 * 1000); // Convert minutes to milliseconds

console.log(`Auto-scraping configured to run every ${SCRAPE_INTERVAL_MINUTES} minutes.`);

// --- Callback Query Handler (Manual check still exists but is less necessary) ---
// ... (Callback handler remains largely the same, manual check button can stay or go)

// --- Text Message Handler ---
// ... (Text handler remains the same)

// --- Channel Post Handler ---
// ... (Channel post handler remains the same)

// --- Error Handling ---
// ... (Error handlers remain the same) 