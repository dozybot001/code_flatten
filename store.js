const subscribers = new Set();

// 初始状态定义
const initialState = {
    isSidebarExpanded: localStorage.getItem('should_expand_sidebar') === 'true', // 初始化时读取
    theme: localStorage.getItem('theme') || 'dark',
    projectName: 'Project',
    contextContent: null,
    tree: [] 
};

// 创建响应式 Proxy
const reactiveState = new Proxy(initialState, {
    set(target, key, value) {
        const oldValue = target[key];
        const result = Reflect.set(target, key, value);
        
        // 仅当值发生变化时触发通知
        if (oldValue !== value) {
            subscribers.forEach(callback => callback(key, value, oldValue));
        }
        return result;
    },
    get(target, key) {
        return Reflect.get(target, key);
    }
});

export const Store = {
    state: reactiveState,

    /**
     * 订阅状态变更
     * @param {Function} callback (key, newValue, oldValue) => void
     */
    subscribe(callback) {
        subscribers.add(callback);
        // 可选：立即执行一次以同步当前状态
    },

    setProject(name, treeData) {
        // 批量更新建议单独处理，或者直接赋值触发 Proxy
        this.state.projectName = name;
        this.state.tree = treeData;
    },

    toggleNodeSelection(index) {
        const tree = this.state.tree;
        const node = tree[index];

        if (node) {
            // 1. 切换当前节点状态
            node.selected = !node.selected;

            // 2. 如果是文件夹，同步更新所有子节点
            if (node.type === 'dir') {
                const parentPath = node.id + '/';
                tree.forEach(child => {
                    if (child.id.startsWith(parentPath)) {
                        child.selected = node.selected;
                    }
                });
            }

            // 3. 触发响应式更新 (一次性通知 UI)
            this.state.tree = [...tree]; 
            
            return node;
        }
        return null;
    }
};