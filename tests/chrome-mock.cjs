const fs = require('node:fs');
const vm = require('node:vm');
function event() {
  const listeners = [];
  return { listeners, addListener(fn) { listeners.push(fn); }, fire(...args) { for (const fn of listeners) fn(...args); } };
}
function createHarness(options = {}) {
  const windows = structuredClone(options.windows || [{ id: 1, type: 'normal', focused: true, incognito: false }]);
  let tabs = (options.tabs || [{ id: 1, active: true }]).map((tab, index) => ({ index, windowId: 1, groupId: -1, pinned: false, highlighted: !!tab.active, incognito: false, status: 'complete', url: 'https://example.test/', mutedInfo: { muted: false }, ...structuredClone(tab) }));
  let groups = structuredClone(options.groups || []);
  const session = structuredClone(options.session || {});
  const calls = [];
  const local = {};
  let nextId = Math.max(0, ...tabs.map(tab => tab.id)) + 1;
  let nextGroupId = 100;
  let lastFocused = options.lastFocused || windows.find(window => window.focused && window.type === 'normal')?.id || 1;
  let offscreen = false;
  const clone = data => structuredClone(data);
  const getTab = id => { const tab = tabs.find(tab => tab.id === id); if (!tab) throw Error('No tab'); return tab; };
  const reindex = () => { for (const window of windows) tabs.filter(tab => tab.windowId === window.id).forEach((tab, index) => tab.index = index); };
  const storage = data => ({
    async get(key) { return typeof key === 'string' ? { [key]: clone(data[key]) } : clone(data); },
    async set(value) { Object.assign(data, clone(value)); },
    async remove(key) { for (const name of Array.isArray(key) ? key : [key]) delete data[name]; }
  });
  const chrome = {
    commands: { onCommand: event() },
    action: { async setBadgeText(value) { calls.push(['badge', value]); }, async setBadgeBackgroundColor() {} },
    storage: { session: storage(session), local: storage(local) },
    windows: {
      WINDOW_ID_NONE: -1, onFocusChanged: event(),
      async getAll(query = {}) { return clone(windows.filter(window => !query.windowTypes || query.windowTypes.includes(window.type))); },
      async getLastFocused(query = {}) { return clone(windows.find(window => window.id === lastFocused && (!query.windowTypes || query.windowTypes.includes(window.type))) || windows.find(window => !query.windowTypes || query.windowTypes.includes(window.type))); },
      async get(id) { const window = windows.find(window => window.id === id); if (!window) throw Error('No window'); return clone(window); },
      async update(id, properties) {
        const window = windows.find(window => window.id === id); if (!window) throw Error('No window');
        if (properties.focused && !window.focused) {
          windows.forEach(window => { window.focused = false; }); window.focused = true; lastFocused = id;
          chrome.windows.onFocusChanged.fire(id);
        }
        Object.assign(window, properties); calls.push(['focus', id]); return clone(window);
      },
      async create(properties) { calls.push(['window-create', clone(properties)]); return { id: 99 }; }
    },
    tabs: {
      onActivated: event(), onRemoved: event(), onReplaced: event(),
      async query(query = {}) { return clone(tabs.filter(tab => Object.entries(query).every(([key, value]) => key === 'currentWindow' ? tab.windowId === lastFocused : tab[key] === value))); },
      async get(id) { return clone(getTab(id)); },
      async discard(id) {
        const tab = getTab(id); calls.push(['discard', id]);
        if (tab.active) throw Error('Cannot discard an active tab');
        if (options.failDiscardIds?.includes(id)) throw Error('Discard blocked');
        tab.discarded = true;
        if (options.discardReplacesTab) {
          tab.id = nextId++;
          chrome.tabs.onReplaced.fire(tab.id, id);
        }
        return clone(tab);
      },
      async captureVisibleTab(windowId, properties) {
        calls.push(['capture', windowId, clone(properties)]);
        if (options.captureError) throw Error(options.captureError);
        if (options.afterCapture) await options.afterCapture(chrome);
        return options.captureData || 'data:image/png;base64,test';
      },
      async create(properties) {
        calls.push(['create', clone(properties)]);
        if (options.failCreate) throw Error('Create failed');
        const windowId = properties.windowId || lastFocused;
        if (!windows.some(window => window.id === windowId)) throw Error('No window');
        const tab = { id: nextId++, index: 0, windowId, groupId: -1, pinned: false, active: false, highlighted: false, status: 'complete', url: 'chrome://newtab/', mutedInfo: { muted: false }, incognito: windows.find(window => window.id === windowId).incognito, ...properties };
        const local = tabs.filter(tab => tab.windowId === windowId);
        const anchor = local[properties.index ?? local.length];
        tabs.splice(anchor ? tabs.indexOf(anchor) : tabs.length, 0, tab); reindex();
        if (properties.active !== false) await chrome.tabs.update(tab.id, { active: true });
        return clone(tab);
      },
      async remove(ids) {
        for (const id of Array.isArray(ids) ? ids : [ids]) {
          const tab = getTab(id); calls.push(['remove', id]); tabs = tabs.filter(tab => tab.id !== id);
          chrome.tabs.onRemoved.fire(id);
          if (!tabs.some(item => item.windowId === tab.windowId)) windows.splice(windows.findIndex(window => window.id === tab.windowId), 1);
          groups = groups.filter(group => tabs.some(tab => tab.groupId === group.id));
        }
        reindex();
      },
      async update(id, properties) {
        const tab = getTab(id); calls.push(['update', id, clone(properties)]);
        if (properties.active) {
          tabs.filter(item => item.windowId === tab.windowId).forEach(item => { item.active = false; item.highlighted = false; });
          tab.active = true; tab.highlighted = true;
          tab.discarded = false;
          chrome.tabs.onActivated.fire({ tabId: id, windowId: tab.windowId });
        }
        if (properties.pinned !== undefined && properties.pinned !== tab.pinned) {
          tab.groupId = -1; tab.pinned = properties.pinned;
          const pinned = tabs.filter(item => item.windowId === tab.windowId && item.pinned && item.id !== id).length;
          await chrome.tabs.move(id, { index: pinned });
        }
        if (properties.muted !== undefined) tab.mutedInfo = {muted: properties.muted};
        Object.assign(tab, properties); return clone(tab);
      },
      async move(ids, properties) {
        if (Array.isArray(ids)) throw Error('Mock rejects bulk move: use individual moves');
        const tab = getTab(ids); calls.push(['move', ids, clone(properties)]);
        tabs = tabs.filter(item => item.id !== tab.id);
        const windowId = properties.windowId ?? tab.windowId;
        if (windowId !== tab.windowId) tab.groupId = -1;
        tab.windowId = windowId;
        const local = tabs.filter(tab => tab.windowId === windowId);
        const index = properties.index === -1 ? local.length : properties.index;
        const anchor = local[Math.min(index, local.length)];
        tabs.splice(anchor ? tabs.indexOf(anchor) : tabs.length, 0, tab); reindex(); return clone(tab);
      },
      async duplicate(id) {
        const source = clone(getTab(id)); calls.push(['duplicate', id]);
        return chrome.tabs.create({ ...source, id: nextId++, index: source.index + 1, active: true, historyMarker: source.historyMarker });
      },
      async group(properties) {
        calls.push(['group', clone(properties)]);
        if (options.failGroup) throw Error('Group failed');
        const id = properties.groupId ?? nextGroupId++;
        if (properties.groupId !== undefined && !groups.some(group => group.id === id)) throw Error('Group disappeared');
        if (!groups.some(group => group.id === id)) groups.push({ id, windowId: properties.createProperties?.windowId || getTab([properties.tabIds].flat()[0]).windowId, collapsed: false, color: 'blue', title: '' });
        for (const tabId of [properties.tabIds].flat()) getTab(tabId).groupId = id;
        return id;
      },
      async ungroup(ids) { calls.push(['ungroup', clone(ids)]); for (const id of [ids].flat()) getTab(id).groupId = -1; },
      async highlight(properties) {
        calls.push(['highlight', clone(properties)]);
        const local = tabs.filter(tab => tab.windowId === properties.windowId);
        for (const tab of local) { tab.active = false; tab.highlighted = properties.tabs.includes(tab.index); }
        const active = local[properties.tabs[0]];
        if (active) { active.active = true; active.discarded = false; chrome.tabs.onActivated.fire({ tabId: active.id, windowId: active.windowId }); }
      }
    },
    tabGroups: {
      TAB_GROUP_ID_NONE: -1,
      async query(query) { return clone(groups.filter(group => group.windowId === query.windowId)); },
      async get(id) { return clone(groups.find(group => group.id === id)); },
      async update(id, properties) { calls.push(['group-update', id, clone(properties)]); Object.assign(groups.find(group => group.id === id), properties); },
      async move(id, properties) {
        calls.push(['group-move', id, clone(properties)]);
        const members = tabs.filter(tab => tab.groupId === id);
        for (const tab of properties.index === -1 ? members : [...members].reverse()) await chrome.tabs.move(tab.id, { index: properties.index });
      }
    },
    runtime: {
      id: 'test-extension', onMessage: event(),
      getURL(path) { return `chrome-extension://test-extension/${path}`; },
      async getContexts() { return offscreen ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []; },
      async sendMessage(message) { calls.push(['message', clone(message)]); return { ok: !options.failClipboard }; }
    },
    offscreen: { async createDocument(properties) { calls.push(['offscreen', properties]); offscreen = true; } },
    permissions: { async request() { return options.permission !== false; }, async contains() { return options.permission !== false; } },
    scripting: { async executeScript(properties) { calls.push(['execute', properties.target]); if (options.failScript) throw Error('Script blocked'); return [{ result: 1 }]; } }
  };
  const context = vm.createContext({ chrome, console: { error() {} }, URL, setTimeout, clearTimeout,
    importScripts(file) { vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), context); }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), context);
  return { chrome, context, calls, session, get tabs() { return tabs; }, get groups() { return groups; }, windows,
    evaluate(code) { return vm.runInContext(code, context); },
    async run(command) { return vm.runInContext(`enqueueCommand(() => runCommand(${JSON.stringify(command)}, true))`, context); },
    async drain() { for (let i = 0; i < 3; i++) await vm.runInContext('historyQueue', context); },
    async activate(id) { await chrome.tabs.update(id, { active: true }); await this.drain(); }
  };
}
module.exports = { createHarness };
