import { AIService } from './utils/ai-service.js';
import { EditorManager } from './utils/editor-manager.js';
import { UIManager } from './utils/ui-manager.js';
import { FileManager } from './utils/file-manager.js';
import { AppController } from './utils/app-controller.js';

// === Global State ===
const aiService = new AIService();

// === Initialization ===
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Instantiate Managers
    const uiManager = new UIManager(aiService);
    const fileManager = new FileManager('file-tree-content');
    
    const editorManager = new EditorManager(
        document.getElementById('monaco-container'),
        document.getElementById('tabs-bar')
    );

    // 2. Async Init Services
    await Promise.all([
        editorManager.init(),
        fileManager.init()
    ]);

    // 3. Initialize Controller (The Brain)
    const app = new AppController(uiManager, fileManager, editorManager, aiService);
    await app.init();

    // 4. Layout Observer
    new ResizeObserver(() => editorManager.layout()).observe(document.getElementById('monaco-container'));
});