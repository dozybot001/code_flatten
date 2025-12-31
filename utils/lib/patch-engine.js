/**
 * 解析 AI 响应并应用补丁（支持宽松的模糊匹配）
 * Returns a map: { 'path/to/file': 'modified_content' }
 */
export function applyPatchesMultiFile(fileContexts, aiResponse) {
    const fileMap = {};
    // 创建原始文件内容的映射
    fileContexts.forEach(f => fileMap[f.path] = f.content);

    // 解析出所有的修改块
    const blocks = parseBlocks(aiResponse);

    blocks.forEach(block => {
        const { file, search, replace } = block;
        
        // 如果文件不存在于上下文中，跳过
        if (!fileMap[file]) {
            console.warn(`[Patcher] Skipping patch for unknown file: ${file}`);
            return;
        }

        const content = fileMap[file];
        
        // 策略 1: 精确匹配 (Exact Match)
        if (content.includes(search)) {
            fileMap[file] = content.replace(search, replace);
            console.log(`[Patcher] Exact match applied for ${file}`);
        } 
        // 策略 2: 宽松匹配 (Fuzzy Regex Match) - 忽略缩进和空行的差异
        else {
            const regex = generateFuzzyRegex(search);
            if (regex.test(content)) {
                fileMap[file] = content.replace(regex, replace);
                console.log(`[Patcher] Fuzzy (regex) match applied for ${file}`);
            } else {
                console.warn(`[Patcher] Match failed for ${file}. AI search block not found.`);
                // 可选：在这里记录失败的 search 块以便调试
            }
        }
    });

    return fileMap;
}

// === 辅助函数 ===

/**
 * 将 AI 的 Search 块转换为允许空白差异的正则表达式
 */
function generateFuzzyRegex(searchStr) {
    // 1. 转义正则特殊字符 (如 ., *, +, ?, etc.)
    const escaped = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // 2. 将字符串按行分割
    // 3. 去除每一行首尾的空格
    // 4. 过滤掉空行
    // 5. 用 "\s*\n\s*" (任意空白+换行+任意空白) 连接各行
    const pattern = escaped
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\\s*\\n\\s*'); 
    
    // 'm' flag 不一定是必须的，因为我们要匹配整个多行块，而不是单行锚点
    // 但我们需要确保它能跨行匹配。上面的 join 已经构建了跨行结构。
    return new RegExp(pattern); 
}

/**
 * 解析器：将 AI 的文本响应拆解为结构化的 Search/Replace 块对象
 */
function parseBlocks(aiResponse) {
    const lines = aiResponse.split('\n');
    const blocks = [];
    let currentFile = null;
    let i = 0;

    const SEARCH_MARKER = '<<<<<<< SEARCH';
    const MID_MARKER = '=======';
    const END_MARKER = '>>>>>>>';

    while (i < lines.length) {
        const line = lines[i]; // 保留缩进用于内容，但在判断标记时 trim
        const trimmedLine = line.trim();

        // 识别文件名 "File: src/main.js"
        if (trimmedLine.startsWith('File: ')) {
            currentFile = trimmedLine.replace('File: ', '').trim();
            i++; 
            continue;
        }

        // 识别块开始
        if (trimmedLine === SEARCH_MARKER) {
            i++; // 跳过 SEARCH 标记行
            
            // 提取 SEARCH 内容
            let searchArr = [];
            while(i < lines.length && lines[i].trim() !== MID_MARKER) {
                searchArr.push(lines[i]); 
                i++;
            }
            i++; // 跳过 =======
            
            // 提取 REPLACE 内容
            let replaceArr = [];
            while(i < lines.length && lines[i].trim() !== END_MARKER) {
                replaceArr.push(lines[i]); 
                i++;
            }
            // 跳过 >>>>>>> (循环末尾会自动 i++，或者这里显式跳过)
            
            if (currentFile) {
                blocks.push({
                    file: currentFile,
                    search: searchArr.join('\n'),
                    replace: replaceArr.join('\n')
                });
            }
        }
        i++;
    }
    return blocks;
}