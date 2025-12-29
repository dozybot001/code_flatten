export const FileSystem = {
    DEFAULT_IGNORE_RULES: [
        '.git', 'node_modules', '.DS_Store', 'dist', 'build', 
        '.vscode', '.idea', 'coverage', '*.log', 'npm-debug.log',
        'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
    ],

    globToRegex(pattern) {
        const cleanPattern = pattern.replace(/\/$/, '');
        let re = cleanPattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '.*')
            .replace(/(^|[^\\])\*/g, '$1[^/]*')
            .replace(/\?/g, '[^/]');
        return new RegExp(`(^|/)${re}(/|$)`);
    },

    shouldIgnore(path, rules) {
        return rules.some(regex => regex.test(path));
    },

    parseIgnoreRules(content) {
        if (!content) return [];
        return content.split(/\r?\n/).filter(line => line.trim() !== '');
    },

    _sortChildren(childrenMap) {
        return Array.from(childrenMap.values()).sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    },

    async buildFileTree(files) {
        if (!files.length) return null;
        const fileArray = Array.from(files);

        let firstPath = fileArray[0].webkitRelativePath || fileArray[0].name;
        let projectName = firstPath.split('/')[0];
        if (projectName === firstPath) projectName = 'Project';

        let systemRulesRegex = [];
        const defaultRegex = this.DEFAULT_IGNORE_RULES.map(r => this.globToRegex(r));
        systemRulesRegex = [...defaultRegex];

        try {
            const response = await fetch('../assets/ignore.txt');
            if (response.ok) {
                const text = await response.text();
                const rules = this.parseIgnoreRules(text);
                const fileRulesRegex = rules
                    .filter(r => r && !r.trim().startsWith('#'))
                    .map(r => this.globToRegex(r.trim()));
                systemRulesRegex = [...systemRulesRegex, ...fileRulesRegex];
            }
        } catch (e) {
            console.warn("Failed to load system ignore.txt, using defaults only", e);
        }

        const root = { 
            id: projectName, 
            name: projectName, 
            type: 'dir', 
            children: new Map(),
            selected: true 
        };

        fileArray.forEach(file => {
            const relativePath = file.webkitRelativePath || `${projectName}/${file.name}`;
            const parts = relativePath.split('/');
            const pathParts = parts.length > 1 ? parts.slice(1) : [parts[0]];
            
            let currentNode = root;
            let currentPath = projectName;

            pathParts.forEach((part, index) => {
                const isFile = index === pathParts.length - 1;
                currentPath = `${currentPath}/${part}`;
                
                if (!currentNode.children.has(part)) {
                    currentNode.children.set(part, {
                        id: currentPath,
                        name: part,
                        type: isFile ? 'file' : 'dir',
                        file: isFile ? file : null,
                        children: new Map(), 
                        selected: true
                    });
                }
                currentNode = currentNode.children.get(part);
            });
        });

        await this._recursivePrune(root, projectName, systemRulesRegex);

        return { root, projectName };
    },

    async _recursivePrune(node, currentPath, parentRules) {
        let localRulesRegex = [];
        if (node.children.has('.gitignore')) {
            const gitIgnoreNode = node.children.get('.gitignore');
            if (gitIgnoreNode.type === 'file' && gitIgnoreNode.file) {
                try {
                    const content = await this.readFileContent(gitIgnoreNode.file);
                    const rawRules = this.parseIgnoreRules(content);
                    
                    localRulesRegex = rawRules
                        .filter(r => r && !r.trim().startsWith('#'))
                        .map(rule => {
                            const trimmed = rule.trim();
                            if (trimmed.startsWith('/')) {
                                const cleanRule = trimmed.slice(1);
                                const fullPath = currentPath ? `${currentPath}/${cleanRule}` : cleanRule;
                                return this.globToRegex(fullPath);
                            } else {
                                return this.globToRegex(trimmed);
                            }
                        });
                } catch (e) {
                    console.warn(`Error reading .gitignore at ${currentPath}`, e);
                }
            }
        }
        const activeRules = [...parentRules, ...localRulesRegex];

        for (const key of Array.from(node.children.keys())) {
            const child = node.children.get(key);
            if (this.shouldIgnore(child.id, activeRules)) {
                node.children.delete(key);
                continue; 
            }
            if (child.type === 'dir') {
                await this._recursivePrune(child, child.id, activeRules);
            }
        }
    },

    flattenTree(root) {
        const flatList = [];
        flatList.push({
            ...root,
            prefix: '',
            connector: '', 
            children: undefined 
        });

        const traverse = (node, prefix = '') => {
            const children = this._sortChildren(node.children);
            children.forEach((child, index) => {
                const isLast = index === children.length - 1;
                const connector = isLast ? '└── ' : '├── ';
                flatList.push({
                    ...child,
                    prefix: prefix,       
                    connector: connector, 
                    children: undefined 
                });
                if (child.type === 'dir') {
                    const childPrefix = prefix + (isLast ? '    ' : '│   ');
                    traverse(child, childPrefix);
                }
            });
        };
        traverse(root);
        return flatList;
    },

    readFileContent(file) {
        return new Promise((resolve) => {
            const isBinaryExt = /\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|zip|rar|pdf|exe|dll|bin)$/i.test(file.name);
            if (isBinaryExt) return resolve(`[Binary File: ${file.name} Omitted]`);

            const MAX_SIZE = 1024 * 1024; 
            if (file.size > MAX_SIZE) {
                return resolve(`[File too large: ${file.name} (${(file.size / 1024).toFixed(2)} KB) Omitted for performance]`);
            }

            const HEADER_SIZE = 512;
            const headerBlob = file.slice(0, HEADER_SIZE);
            const headerReader = new FileReader();

            headerReader.onload = (e) => {
                const buffer = new Uint8Array(e.target.result);
                const isBinary = buffer.some(byte => byte === 0);

                if (isBinary) {
                    resolve(`[Binary Content Detected: ${file.name} Omitted]`);
                } else {
                    const fullReader = new FileReader();
                    fullReader.onload = (ev) => resolve(ev.target.result);
                    fullReader.onerror = () => resolve(`[Error reading ${file.name}]`);
                    fullReader.readAsText(file);
                }
            };
            headerReader.onerror = () => resolve(`[Error reading header of ${file.name}]`);
            headerReader.readAsArrayBuffer(headerBlob);
        });
    },

    generateTreeString(flatStructure, projectName) {
        const selectedNodes = flatStructure.filter(n => n.selected);
        if (selectedNodes.length === 0) return 'Project Tree:\n(No files selected)\n';
        const tempRoot = { name: projectName, children: new Map() };
        
        selectedNodes.forEach(node => {
            if (node.id === projectName) return;
            const parts = node.id.split('/');
            const relativeParts = parts.slice(1);
            let current = tempRoot;
            
            relativeParts.forEach((part, index) => {
                if (!current.children.has(part)) {
                    current.children.set(part, { name: part, type: 'dir', children: new Map() });
                }
                current = current.children.get(part);
                if (index === relativeParts.length - 1) current.type = node.type;
            });
        });

        const lines = ["Project Tree:", `${tempRoot.name}/`];
        const buildLines = (node, prefix = '') => {
            const children = this._sortChildren(node.children);
            children.forEach((child, index) => {
                const isLast = index === children.length - 1;
                const connector = isLast ? '└── ' : '├── ';
                lines.push(`${prefix}${connector}${child.name}${child.type === 'dir' ? '/' : ''}`);
                if (child.children.size > 0) {
                    buildLines(child, prefix + (isLast ? '    ' : '│   '));
                }
            });
        };
        buildLines(tempRoot);
        return lines.join('\n') + '\n';
    },

    async generateFullContext(selectedFiles, flatStructure, projectName) {
        const treePart = this.generateTreeString(flatStructure, projectName);
        const separator = "=".repeat(48);
        const BATCH_SIZE = 50; 
        const fileContents = [];

        for (let i = 0; i < selectedFiles.length; i += BATCH_SIZE) {
            const batch = selectedFiles.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async (node) => {
                try {
                    const content = await this.readFileContent(node.file);
                    const ext = node.name.split('.').pop() || '';
                    return `=== File: ${node.id} ===\n\`\`\`${ext}\n${content}\n\`\`\``;
                } catch (e) {
                    console.error(`Failed to read ${node.name}`, e);
                    return `=== File: ${node.id} ===\n[Error reading file]`;
                }
            }));
            fileContents.push(...batchResults);
        }
        return `# Project Context\n\n${treePart}\n${separator}\n\n${fileContents.join('\n\n')}`;
    }
};