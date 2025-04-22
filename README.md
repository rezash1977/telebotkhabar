# ربات تلگرام کلمه‌یاب

این ربات تلگرام پیام‌های حاوی کلمات کلیدی را از گروه‌ها و کانال‌های عمومی پیدا کرده و برای ادمین‌ها ارسال می‌کند.

## امکانات

- ثبت نام و ورود کاربران
- مدیریت کلمات کلیدی (افزودن/حذف)
- مدیریت ادمین‌ها
- پیدا کردن پیام‌های حاوی کلمات کلیدی در گروه‌ها
- اسکرپ کانال‌های عمومی برای یافتن پیام‌های حاوی کلمات کلیدی

## نصب و راه‌اندازی

1. نصب Node.js
2. نصب وابستگی‌ها:
```bash
npm install
```

3. ایجاد فایل `.env` و تنظیم توکن ربات:
```
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

4. اجرای ربات:
```bash
node index.js
```

## نکات مهم

- برای کار با گروه‌ها، باید Privacy Mode ربات غیرفعال باشد
- برای اسکرپ کانال‌های عمومی نیاز به نصب Puppeteer است
- داده‌های ربات در فایل `data.json` ذخیره می‌شود

## Usage (Private Chat with Bot)

All interactions happen in a **private chat** with the bot.

1.  **Start the Bot:** Send `/start`.
2.  **Welcome Message & Main Menu:**
    *   If not logged in: Register, Login, Help buttons.
    *   If logged in (non-admin): Add/Remove/List Keywords, Logout buttons.
    *   If logged in (admin): Add/Remove/List Keywords, **Manage Admins**, Logout buttons.
3.  **Registration/Login:** Follow the prompts after clicking the buttons (enter username, then password).
4.  **Managing Keywords (Logged-in users):** Use the menu buttons to add, remove, or list keywords. Keywords are global and shared.
5.  **Managing Admins (Admin users only):**
    *   Click the "👑 مدیریت ادمین‌ها" button.
    *   **Add Admin:** Promote an existing user to admin.
    *   **Remove Admin:** Demote an admin (cannot remove the last admin or yourself).
    *   **List Admins:** View current administrators.

## Group Functionality

1.  Add the bot to your target Telegram group(s).
2.  Ensure the bot has permission to read messages.
3.  Ensure the bot's **Privacy Mode is disabled** (Check via @BotFather -> /mybots -> Your Bot -> Bot Settings -> Group Privacy -> Disable. You might need to remove/re-add the bot to the group after changing this).
4.  When a message containing any active keyword is sent in the group, the bot will forward it **only to administrators who are currently logged in**.

## Channel Monitoring (Via Web Scraping - Unreliable & Automated)

This method **automatically attempts** to read a configured public channel by scraping its `t.me/s/` web preview **every 10 minutes** (configurable in `index.js`). It remains **highly unstable** and **not recommended** for critical monitoring.

1.  **Set Target Channel (Admin Only):**
    *   Log in as an admin.
    *   Go to "👑 مدیریت ادمین‌ها و اسکرپ".
    *   Click "تنظیم کانال اسکرپ".
    *   Enter the channel username (without `@`). Once set, the bot will start checking automatically every 10 minutes.
2.  **Automatic Checking:**
    *   The bot runs the scrape function in the background periodically.
    *   If new messages (since the last successful check) containing keywords are found, their **text content** is sent to **all currently logged-in admins**.
3.  **Manual Check (Optional):**
    *   The "بررسی کانال اسکرپ" button still exists for manually triggering a check if needed, but the primary method is now automatic.

**VERY Important Limitations & Warnings:**
    *   **Interval:** Default check is every 10 minutes. Shorter intervals drastically increase the risk of IP blocking and server load.
    *   **CSS Selectors Break Easily:** Selectors in `index.js` (`.bubble-content-wrapper`, `.translatable-message`) **will likely break** with Telegram updates. Requires manual inspection and code updates.
    *   **IP Blocking Risk:** Automated scraping increases the risk of your server IP being blocked.
    *   **Not Real-time:** Checks happen periodically, not instantly.
    *   **Resource Intensive:** Running Puppeteer periodically uses server resources.
    *   **Inaccurate Text:** Text extraction might be flawed.
    *   **Requires `npm install`:** Puppeteer must be installed.
    *   **Server Setup:** May need extra dependencies on Linux.

## Data Storage

-   Usernames, hashed passwords, keywords, and admin status are stored in `data.json`.
-   **Security Note:** Protect your `data.json` file.

## Features

-   Interactive menu-based interface using inline keyboards.
-   User registration and login system.
-   **Admin Role:** Forwards messages only to logged-in admins.
-   **Admin Management:** Admins can promote/demote other users.
-   Keyword management via menus (global list).
-   Persistent storage of users and keywords in `data.json`.
-   Password hashing (SHA256 - consider bcrypt for better security).
-   Welcome message and help section.
-   Works in groups and supergroups.
-   Automated periodic web scraping of a configured public channel (experimental, unreliable). 