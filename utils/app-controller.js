import { CodingAgent } from './coding-agent.js';
import { AppStore } from './store.js';

export class AppController {
    constructor(uiManager, fileManager, editorManager, aiService) {
        this.ui = uiManager;
        this.file = fileManager;
        this.editor = editorManager;
        this.ai = aiService;
        
        this.store = new AppStore(); // Central State
        this.agent = new CodingAgent(this.ai);
        
        this.pendingChangesMap = {};
    }

    async init() {
        // 1. Initialize State & Services
        const initialConfig = this.store.getConfig();
        this.ai.saveConfig(initialConfig.apiKey, initialConfig.baseUrl, initialConfig.model);
        this.ui.updateSettingsView(initialConfig);

        // 2. Bind Store Events
        this.store.addEventListener('config-updated', (e) => {
            const { apiKey, baseUrl, model } = e.detail;
            this.ai.saveConfig(apiKey, baseUrl, model);
            this.ui.updateSettingsView(e.detail); // Sync UI
        });

        this.store.addEventListener('context-updated', (e) => {
             // Future: Update UI to show what files are in context?
        });

        // 3. Bind UI Actions
        this.ui.bindGlobalActions({
            onOpenFolder: () => this.handleOpenFolder(),
            onShowMap: () => this.handleShowMap(),
            onChatSubmit: () => this.handleChatSubmit()
        });
        
        this.ui.onFileClick = (handle, path) => this.editor.openFile(handle, path);
        this.ui.onReviewFileClick = (path, content) => this.handleReviewClick(path, content);
        
        this.ui.onFetchDirectory = async (handle, path, stack) => {
            return await this.file.getDirectoryEntries(handle, path, stack);
        };

        // Decoupled Config Save
        this.ui.onConfigSave = (apiKey, baseUrl, model) => {
            this.store.updateConfig({ apiKey, baseUrl, model });
        };

        // 4. Bind Editor Actions (New: IO Delegation)
        this.editor.onSaveRequest = async (fileHandle, content) => {
            // Use FileManager or File API directly via handle (since handle implies permission)
            // Here we use the handle directly as it was opened via Window.showDirectoryPicker flow
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
        };
    }

    // === Event Handlers ===

    async handleOpenFolder() {
        // 1. Model: Open Handle
        const rootHandle = await this.file.openDirectoryHandle();
        if (rootHandle) {
            this.editor.reset();
            
            // 2. UI: Render Tree (Passing data from Model)
            const ignoreRules = this.file.getIgnoreRules();
            await this.ui.renderFileTree(rootHandle, ignoreRules);
            this.ui.setFileTreeVisible(true);
        }
    }

    async handleShowMap() {
        if (!this.file.hasRoot()) return alert("Please open a folder first.");
        try {
            const mapContent = await this.file.getRepoMap();
            this.ui.triggerDownload('repo-map.txt', mapContent);
        } catch (e) {
            console.error(e);
            alert("Failed to generate map.");
        }
    }

    async handleReviewClick(path, newContent) {
        try {
            const originalContent = await this.file.readFile(path);
            const fileName = path.split('/').pop();
            this.editor.openDiffTab(originalContent, newContent, fileName);
        } catch (e) {
            console.error("Review Error:", e);
        }
    }

    // === AI Workflow Orchestration ===

    async handleChatSubmit() {
        const query = this.ui.getChatInput();
        if (!query) return;

        this.ui.addMessage('user', query);
        
        try {
            if (!this.file.hasRoot()) throw new Error("Please open a folder first.");
            if (!this.ai.hasKey()) throw new Error("API Key is missing.");

            // Step 1: Context Analysis
            this.ui.showLoading('Analyzing project structure...');
            const repoMap = await this.file.getRepoMap();
            
            this.ui.updateLoading('Identifying relevant files...');
            // 使用 Agent 代理业务逻辑
            const relevantFiles = await this.agent.identifyRelevantFiles(query, repoMap);
            this.store.setActiveContextFiles(relevantFiles); // Update Store
            this.ui.clearLoading();

            this.ui.displayRelevantFiles(relevantFiles, (btn) => {
                this._handleCodeGeneration(query, btn); 
            });

        } catch (err) {
            this.ui.clearLoading();
            this.ui.addMessage('ai', `Error: ${err.message}`).style.color = '#ff6b6b';
        }
    }

    async _handleCodeGeneration(query, statusBtn) {
        statusBtn.disabled = true;
        try {
            statusBtn.textContent = "Reading files...";
            const fileContexts = [];
            const activeFiles = this.store.getActiveContextFiles(); // Read from Store

            for (const path of activeFiles) {
                try {
                    const content = await this.file.readFile(path);
                    fileContexts.push({ path, content });
                } catch(e) { console.error(`Skipped ${path}`, e); }
            }

            statusBtn.textContent = "Generating edits...";
            
            // 委托 Agent 处理生成、补丁应用和过滤
            const { pendingChangesMap, patchCount } = await this.agent.generateAndApplyEdits(query, fileContexts);
            this.pendingChangesMap = pendingChangesMap;

            statusBtn.textContent = "Processing diffs...";

            // Show Review UI
            if (patchCount > 0) {
                // UI: Update Review Panel
                this.ui.renderPendingList(this.pendingChangesMap);
                this.ui.setFileTreeVisible(true);
                this.ui.displayPendingChanges(patchCount, (btn) => this._handleAcceptAll(btn));
                statusBtn.textContent = "Review Pending";
            } else {
                this.ui.addMessage('ai', "⚠️ AI generated output, but no valid patches were applied.");
                statusBtn.textContent = "No Changes";
            }

        } catch (err) {
            console.error(err);
            this.ui.addMessage('ai', `Generation Error: ${err.message}`);
            statusBtn.textContent = "Failed";
            statusBtn.disabled = false;
        }
    }

    async _handleAcceptAll(btn) {
        if (!confirm("Apply all pending changes to disk?")) return;
        
        btn.disabled = true;
        btn.textContent = "Applying...";

        try {
            const changes = Object.entries(this.pendingChangesMap);
            for (const [path, content] of changes) {
                await this.file.writeFile(path, content);
            }

            // Cleanup
            this.ui.renderPendingList({}); // Clear list UI
            this.editor.closeDiffTabs();
            this.pendingChangesMap = {};
            
            btn.textContent = "Applied";
            btn.classList.remove('btn-primary');
            this.ui.addMessage('ai', `✅ Successfully applied changes to ${changes.length} files.`);

        } catch (err) {
            console.error(err);
            alert("Failed to apply changes.");
            btn.disabled = false;
            btn.textContent = "Retry";
        }
    }
}