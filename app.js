import { TreeManager } from './ui/tree.js';
import { SettingsManager } from './ui/settings.js';
import { ChatManager } from './ui/chat.js';
import { ToolbarManager } from './ui/toolbar.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize UI Modules
    TreeManager.init();
    SettingsManager.init();
    ChatManager.init();
    ToolbarManager.init();

    // 2. Global Init (Theme check is handled by SettingsManager/Store now)
    console.log("AIchemy App Initialized.");
});