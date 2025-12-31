export class UIManager {
    constructor() {
        this.fileTreeContainer = document.getElementById('file-tree'); // Changed ID to container specific
        this.fileTreePanel = document.getElementById('file-tree-panel');
        this.chatPanel = document.getElementById('chat-panel');
        this.chatMessages = document.getElementById('chat-messages');
        
        // Review Mode UI
        this.pendingContainer = document.getElementById('pending-changes-panel');
        this.pendingList = document.getElementById('pending-list');
        this.pendingCount = document.getElementById('pending-count');

        // Settings DOM
        this.settingsMenu = document.getElementById('settings-menu');
        this.apiConfigModal = document.getElementById('api-config-modal');
        this.modelMenu = document.getElementById('model-menu');
        
        // Callbacks (assigned by Controller)
        this.onFileClick = null; 
        this.onReviewFileClick = null;
        this.onConfigSave = null; // [NEW] Event for saving settings
        this.onFetchDirectory = null; // [NEW] Delegate data fetching to Controller

        this._initListeners();
    }

    _initListeners() {
        // Layout Toggles
        document.getElementById('btn-toggle-tree').addEventListener('click', () => {
            this.fileTreePanel.classList.toggle('collapsed');
        });

        document.getElementById('btn-toggle-chat').addEventListener('click', () => {
            this.chatPanel.classList.toggle('collapsed');
        });

        document.getElementById('btn-clear-chat').addEventListener('click', () => {
            this.chatMessages.innerHTML = '';
        });

        this._bindSettingsLogic();
    }

    _bindSettingsLogic() {
        // ... (保持原有的 Settings 逻辑不变) ...
        const btnSettings = document.getElementById('btn-settings');
        const menuItemApi = document.getElementById('menu-item-api');
        const inputs = [
            document.getElementById('input-base-url'),
            document.getElementById('input-api-key'),
            document.getElementById('input-model-name')
        ];

        btnSettings.addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeAllMenus();
            this.settingsMenu.classList.remove('hidden');
        });

        menuItemApi.addEventListener('click', (e) => {
            e.stopPropagation();
            // Inputs are already populated by updateSettingsView via Controller
            this.apiConfigModal.classList.remove('hidden');
        });

        inputs.forEach(input => {
            // Remove direct UI update call, let the event loop handle it via Controller
            if (input) input.addEventListener('input', () => this._saveConfigFromInputs(inputs));
        });

        document.addEventListener('click', () => this._closeAllMenus());
        this.apiConfigModal.addEventListener('click', e => e.stopPropagation());
    }

    /**
     * Public method to update settings UI state
     * @param {Object} config - { apiKey, baseUrl, model }
     */
    updateSettingsView(config) {
        const urlInput = document.getElementById('input-base-url');
        const keyInput = document.getElementById('input-api-key');
        const modelInput = document.getElementById('input-model-name');
        const modelDisplay = document.getElementById('model-name-text');

        if (urlInput) urlInput.value = config.baseUrl || '';
        if (keyInput) keyInput.value = config.apiKey || '';
        if (modelInput) modelInput.value = config.model || '';
        if (modelDisplay) modelDisplay.textContent = config.model || '';
    }

    _saveConfigFromInputs(inputs) {
        const [url, key, model] = inputs;
        if (this.onConfigSave) {
            this.onConfigSave(
                key.value.trim(), 
                url.value.trim(), 
                model.value.trim()
            );
        }
    }

    _closeAllMenus() {
        this.settingsMenu.classList.add('hidden');
        this.apiConfigModal.classList.add('hidden');
        this.modelMenu.classList.add('hidden');
    }

    // === Public API: Chat & Layout ===

    getChatInput() {
        const input = document.getElementById('chat-input');
        const val = input.value.trim();
        if (val) {
            input.value = '';
            input.style.height = '42px';
        }
        return val;
    }

    addMessage(role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;
        msgDiv.textContent = text;
        this.chatMessages.appendChild(msgDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        return msgDiv;
    }

    showLoading(text) {
        this.loadingEl = this.addMessage('ai', text);
    }

    updateLoading(text) {
        if (this.loadingEl) this.loadingEl.textContent = text;
    }

    clearLoading() {
        if (this.loadingEl) this.loadingEl.innerHTML = '';
    }

    bindGlobalActions({ onOpenFolder, onShowMap, onChatSubmit }) {
        document.getElementById('btn-open-folder').addEventListener('click', onOpenFolder);
        document.getElementById('btn-show-map').addEventListener('click', onShowMap);

        const btnSend = document.getElementById('btn-send-chat');
        const chatInput = document.getElementById('chat-input');
        
        btnSend.addEventListener('click', onChatSubmit);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onChatSubmit();
            }
        });
    }

    setFileTreeVisible(isVisible) {
        if (isVisible) this.fileTreePanel.classList.remove('collapsed');
        else this.fileTreePanel.classList.add('collapsed');
    }

    triggerDownload(fileName, content) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    }

    displayRelevantFiles(files, onGenerateClick) {
        const resultMsg = this.addMessage('ai', '');
        resultMsg.innerHTML = `I found <strong>${files.length}</strong> relevant files:<br>`;
        const list = document.createElement('ul');
        list.style.paddingLeft = '20px';
        files.forEach(f => {
            const li = document.createElement('li');
            li.textContent = f;
            li.style.color = '#4caf50';
            list.appendChild(li);
        });
        resultMsg.appendChild(list);

        const btn = document.createElement('button');
        btn.textContent = "Generate Code Edit ->";
        btn.className = "btn-primary";
        btn.style.marginTop = "8px";
        btn.onclick = (e) => onGenerateClick(e.target);
        resultMsg.appendChild(btn);
    }

    displayPendingChanges(count, onAcceptClick) {
        const successMsg = this.addMessage('ai', `✅ Generated edits for ${count} file(s). Review them in the sidebar.`);
        const btnAccept = document.createElement('button');
        btnAccept.className = 'btn-primary';
        btnAccept.innerHTML = '<i class="ph ph-check"></i> Accept All';
        btnAccept.onclick = () => onAcceptClick(btnAccept);
        successMsg.appendChild(btnAccept);
    }

    // === NEW: File Tree Rendering (Moved from FileManager) ===

    async renderFileTree(rootDirHandle, globalIgnoreRules) {
        this.fileTreeContainer.innerHTML = '';
        
        // Root Label
        const rootLabel = document.createElement('div');
        rootLabel.className = 'tree-node is-folder';
        rootLabel.textContent = `${rootDirHandle.name}/`;
        this.fileTreeContainer.appendChild(rootLabel);

        // Initial Scope
        const rootScope = { basePath: "", rules: globalIgnoreRules };
        await this._renderTreeLevel(rootDirHandle, this.fileTreeContainer, "", [rootScope]);
    }

    async _renderTreeLevel(dirHandle, parent, prefix, scopeStack = [], currentPath = "") {
        // Delegate logic: Request processed data from Controller/Model
        if (!this.onFetchDirectory) {
            console.error("UIManager: onFetchDirectory callback not set");
            return;
        }

        const { entries, scopeStack: nextStack } = await this.onFetchDirectory(dirHandle, currentPath, scopeStack);

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const isLast = i === entries.length - 1;
            const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
            
            const row = document.createElement('div');
            row.className = `tree-node ${entry.kind === 'directory' ? 'is-folder' : 'is-file'}`;
            row.textContent = `${prefix}${isLast ? '└ ' : '├ '}${entry.name}`;

            if (entry.kind === 'file') {
                row.addEventListener('click', () => {
                    if (this.onFileClick) this.onFileClick(entry, entryPath);
                });
                parent.appendChild(row);
            } else {
                const childContainer = document.createElement('div');
                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    childContainer.classList.toggle('hidden');
                });
                parent.appendChild(row);
                parent.appendChild(childContainer);
                // Fixed: currentStack -> nextStack
                await this._renderTreeLevel(entry, childContainer, prefix + (isLast ? '  ' : '│ '), nextStack, entryPath);
            }
        }
    }

    // === NEW: Review Mode Rendering (Moved from FileManager) ===

    renderPendingList(fileMap) {
        const files = Object.keys(fileMap);
        
        if (files.length === 0) {
            this.pendingContainer.classList.add('hidden');
            this.pendingList.innerHTML = '';
            this.pendingCount.textContent = '0';
            return;
        }

        this.pendingContainer.classList.remove('hidden');
        this.pendingCount.textContent = files.length;
        this.pendingList.innerHTML = '';

        files.forEach(path => {
            const fileName = path.split('/').pop();
            const el = document.createElement('div');
            el.className = 'pending-item';
            el.innerHTML = `<i class="ph ph-git-diff"></i> <span>${fileName}</span>`;
            
            el.addEventListener('click', () => {
                document.querySelectorAll('.pending-item').forEach(i => i.classList.remove('active'));
                el.classList.add('active');
                if (this.onReviewFileClick) this.onReviewFileClick(path, fileMap[path]);
            });
            this.pendingList.appendChild(el);
        });
    }
}