let config = null;
let lucideData = [];
let installedApps = [];
let activeAppPickerTarget = null;
let activeAppPickerCallback = null;

const itemsList = document.getElementById('items-list');
const itemCount = document.getElementById('item-count');
const statusEl = document.getElementById('status');
const iconListEl = document.getElementById('icon-list');

const orbSizeSlider = document.getElementById('orb-size-slider');
const orbSizeVal = document.getElementById('orb-size-val');
const blurSlider = document.getElementById('blur-slider');
const blurVal = document.getElementById('blur-val');

const appPickerModal = document.getElementById('app-picker-modal');
const appSearchInput = document.getElementById('app-search-input');
const appListContainer = document.getElementById('app-list');
const closeAppPickerBtn = document.getElementById('close-app-picker');

const MAX_ITEMS = 12;

function iconChar(name) {
  const icon = lucideData.find(i => i.n === name);
  return icon ? String.fromCharCode(icon.c) : '?';
}

function extractAppName(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return '';
  let str = targetPath.trim().replace(/^"|"$/g, '');
  if (!str) return '';

  const parts = str.split(/[/\\]/);
  let base = parts[parts.length - 1];

  if (base.toLowerCase().endsWith('.lnk')) {
    base = base.slice(0, -4);
  } else if (base.toLowerCase().endsWith('.exe')) {
    base = base.slice(0, -4);
  }

  const lower = base.toLowerCase();
  if (lower === 'cmd') return 'Command Prompt';
  if (lower === 'powershell') return 'PowerShell';
  if (lower === 'explorer') return 'File Explorer';
  if (lower === 'calc') return 'Calculator';
  if (lower === 'notepad') return 'Notepad';
  if (lower === 'code') return 'VS Code';
  if (lower === 'chrome') return 'Google Chrome';
  if (lower === 'brave') return 'Brave Browser';
  if (lower === 'msedge') return 'Microsoft Edge';
  if (lower === 'firefox') return 'Firefox';
  if (lower === 'taskmgr') return 'Task Manager';
  if (lower === 'control') return 'Control Panel';

  if (/^[a-z0-9_-]+$/i.test(base)) {
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  return base;
}

function autoDetectIcon(name, targetPath = '') {
  const combined = ((name || '') + ' ' + (targetPath || '')).toLowerCase();

  if (combined.includes('whatsapp')) return 'whatsapp';
  if (combined.includes('brave')) return 'brave';
  if (combined.includes('chrome')) return 'chrome';
  if (combined.includes('edge')) return 'edge';
  if (combined.includes('firefox')) return 'firefox';

  if (combined.includes('youtube')) return 'youtube';
  if (combined.includes('spotify')) return 'spotify';
  if (combined.includes('discord')) return 'discord';
  if (combined.includes('steam')) return 'steam';
  if (combined.includes('telegram')) return 'telegram';
  if (combined.includes('netflix')) return 'netflix';
  if (combined.includes('reddit')) return 'reddit';
  if (combined.includes('twitter') || combined.includes('x.com')) return 'twitter';
  if (combined.includes('instagram')) return 'instagram';
  if (combined.includes('slack')) return 'slack';
  if (combined.includes('github')) return 'github';
  if (combined.includes('figma')) return 'figma';
  if (combined.includes('notion')) return 'notion';
  if (combined.includes('zoom')) return 'zoom';

  if (combined.includes('vscode') || combined.includes('code') || combined.includes('visual studio')) return 'code';
  if (combined.includes('python')) return 'python';
  if (combined.includes('node') || combined.includes('npm')) return 'node';
  if (combined.includes('git')) return 'git';
  if (combined.includes('docker')) return 'docker';
  if (combined.includes('react')) return 'react';

  if (combined.includes('terminal') || combined.includes('cmd') || combined.includes('powershell')) return 'terminal';
  if (combined.includes('calc')) return 'calculator';
  if (combined.includes('note') || combined.includes('text') || combined.includes('word')) return 'notebook';
  if (combined.includes('excel')) return 'excel';
  if (combined.includes('powerpoint')) return 'powerpoint';
  if (combined.includes('outlook')) return 'outlook';
  if (combined.includes('teams')) return 'teams';

  if (combined.includes('paint') || combined.includes('photo') || combined.includes('photoshop')) return 'photoshop';
  if (combined.includes('illustrator')) return 'illustrator';
  if (combined.includes('premiere')) return 'premiere';
  if (combined.includes('blender')) return 'blender';
  if (combined.includes('vlc')) return 'vlc';
  if (combined.includes('obs')) return 'obs';

  if (combined.includes('folder') || combined.includes('explorer')) return 'folder';
  if (combined.includes('setting') || combined.includes('control')) return 'settings';
  if (combined.includes('trash') || combined.includes('bin')) return 'trash-2';
  if (combined.includes('lock')) return 'lock';

  return 'grid';
}

function guessAppIcon(name) {
  return autoDetectIcon(name);
}

// Builds one item card. Supports multi-level nesting up to depth = 3.
function buildItemCard(item, arr, index, depth, onListChanged) {
  const card = document.createElement('div');
  card.className = `item-card level-${depth}`;

  const row1 = document.createElement('div');
  row1.className = 'row2';

  const iconPreview = document.createElement('div');
  iconPreview.className = 'item-icon-preview lucide-icon';
  iconPreview.title = 'Click to open Visual Icon Picker';
  if (window.renderIconInto) {
    window.renderIconInto(item.icon, iconPreview);
  }
  iconPreview.addEventListener('click', () => {
    openIconPicker(item, () => {
      iconInput.value = item.icon;
      if (window.renderIconInto) window.renderIconInto(item.icon, iconPreview);
    });
  });

  const nameInput = document.createElement('input');
  nameInput.placeholder = 'Name';
  nameInput.value = item.name || '';
  nameInput.style.flex = '2';
  nameInput.addEventListener('input', () => {
    item.name = nameInput.value;
    if (item.type === 'app' && !item.userIcon && (!iconInput.value || iconInput.value === 'circle' || iconInput.value === 'grid')) {
      const derivedIcon = autoDetectIcon(nameInput.value, item.target);
      if (derivedIcon) {
        item.icon = derivedIcon;
        iconInput.value = derivedIcon;
        if (window.renderIconInto) window.renderIconInto(derivedIcon, iconPreview);
      }
    }
  });

  const iconInput = document.createElement('input');
  iconInput.placeholder = 'icon';
  iconInput.setAttribute('list', 'icon-list');
  iconInput.value = item.icon || '';
  iconInput.style.flex = '1';
  iconInput.addEventListener('input', () => {
    item.icon = iconInput.value;
    item.userIcon = true;
    if (window.renderIconInto) {
      window.renderIconInto(item.icon, iconPreview);
    }
  });

  const quickKeyInput = document.createElement('input');
  quickKeyInput.placeholder = 'Key';
  quickKeyInput.title = 'Quick Key shortcut (single character)';
  quickKeyInput.className = 'quickkey-input';
  quickKeyInput.maxLength = 1;
  quickKeyInput.value = item.quickKey || '';
  quickKeyInput.addEventListener('input', () => {
    item.quickKey = quickKeyInput.value.toLowerCase().trim();
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'item-remove';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    arr.splice(index, 1);
    onListChanged();
  });

  row1.append(iconPreview, nameInput, iconInput, quickKeyInput, removeBtn);

  const row2 = document.createElement('div');
  row2.className = 'row2';

  const typeSelect = document.createElement('select');
  const types = ['app', 'cmd', 'url', 'system', 'widget'];
  if (depth < 3) types.push('folder');

  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (item.type === t) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeSelect.style.flex = '1';

  const SYSTEM_ACTION_GROUPS = [
    {
      group: '⚙️ Orbs & Launcher',
      items: [
        { value: 'open-settings', name: 'Orbs Settings', icon: 'settings', desc: 'Configure Orbs Launcher & Appearance' },
        { value: 'toggle-dark-mode', name: 'Toggle Dark Mode', icon: 'moon', desc: 'Toggle dark / light appearance' },
        { value: 'quit-app', name: 'Exit Orbs Launcher', icon: 'power', desc: 'Close Orbs process' }
      ]
    },
    {
      group: '⚡ Power & Session',
      items: [
        { value: 'lock-screen', name: 'Lock Screen', icon: 'lock', desc: 'Lock active Windows session' },
        { value: 'sleep-pc', name: 'Sleep PC', icon: 'moon', desc: 'Put computer into Sleep mode' },
        { value: 'restart-pc', name: 'Restart PC', icon: 'rotate-cw', desc: 'Reboot Windows system' },
        { value: 'shutdown-pc', name: 'Shut Down PC', icon: 'power', desc: 'Turn off Windows computer' },
        { value: 'log-off', name: 'Log Off User', icon: 'log-out', desc: 'Log off current Windows user' }
      ]
    },
    {
      group: '🔊 Volume & Media',
      items: [
        { value: 'volume-mute', name: 'Mute / Unmute Volume', icon: 'volume-x', desc: 'Toggle master audio mute' },
        { value: 'volume-up', name: 'Volume Up (+)', icon: 'volume-2', desc: 'Increase master audio volume' },
        { value: 'volume-down', name: 'Volume Down (-)', icon: 'volume-1', desc: 'Decrease master audio volume' },
        { value: 'media-play-pause', name: 'Play / Pause Media', icon: 'play', desc: 'Toggle media playback' },
        { value: 'media-next', name: 'Next Media Track', icon: 'skip-forward', desc: 'Skip to next track' },
        { value: 'media-prev', name: 'Previous Media Track', icon: 'skip-back', desc: 'Rewind to previous track' }
      ]
    },
    {
      group: '🛠️ Windows System Tools',
      items: [
        { value: 'task-manager', name: 'Task Manager', icon: 'activity', desc: 'Open Windows Task Manager' },
        { value: 'win-settings', name: 'Windows Settings', icon: 'settings', desc: 'Open Windows System Settings' },
        { value: 'control-panel', name: 'Control Panel', icon: 'sliders', desc: 'Open legacy Control Panel' },
        { value: 'empty-trash', name: 'Empty Recycle Bin', icon: 'trash-2', desc: 'Clear all items in Recycle Bin' },
        { value: 'screen-clip', name: 'Snipping Tool (Screenshot)', icon: 'camera', desc: 'Take a region screenshot' },
        { value: 'device-manager', name: 'Device Manager', icon: 'cpu', desc: 'Manage hardware & device drivers' },
        { value: 'disk-cleanup', name: 'Disk Cleanup', icon: 'hard-drive', desc: 'Free up disk space' }
      ]
    },
    {
      group: '📁 Quick Folders',
      items: [
        { value: 'open-downloads', name: 'Downloads Folder', icon: 'download', desc: 'Open User Downloads directory' },
        { value: 'open-documents', name: 'Documents Folder', icon: 'file-text', desc: 'Open User Documents directory' },
        { value: 'open-pictures', name: 'Pictures Folder', icon: 'image', desc: 'Open User Pictures directory' },
        { value: 'open-desktop-folder', name: 'Desktop Folder', icon: 'folder', desc: 'Open User Desktop directory' },
        { value: 'open-temp', name: 'Temp Folder', icon: 'folder', desc: 'Open System Temp directory' }
      ]
    }
  ];

  const targetInput = document.createElement('input');
  targetInput.placeholder = 'Target (path / command / url)';
  targetInput.value = item.target || '';
  targetInput.style.flex = '3';
  targetInput.style.display = item.type === 'system' ? 'none' : 'block';
  targetInput.addEventListener('input', () => {
    item.target = targetInput.value;
    if (!nameInput.value || nameInput.value === 'New Item') {
      const derivedName = extractAppName(targetInput.value);
      if (derivedName) {
        item.name = derivedName;
        nameInput.value = derivedName;
      }
    }
    if (!item.userIcon && (!iconInput.value || iconInput.value === 'circle' || iconInput.value === 'grid')) {
      const derivedIcon = autoDetectIcon(nameInput.value, targetInput.value);
      if (derivedIcon) {
        item.icon = derivedIcon;
        iconInput.value = derivedIcon;
        if (window.renderIconInto) window.renderIconInto(derivedIcon, iconPreview);
      }
    }
  });

  const systemSelect = document.createElement('select');
  systemSelect.style.flex = '3';
  systemSelect.style.display = item.type === 'system' ? 'block' : 'none';
  
  const defaultSysOpt = document.createElement('option');
  defaultSysOpt.value = '';
  defaultSysOpt.textContent = '-- Select System Action --';
  systemSelect.appendChild(defaultSysOpt);

  const ALL_SYSTEM_ACTIONS = [];
  SYSTEM_ACTION_GROUPS.forEach(g => {
    const groupEl = document.createElement('optgroup');
    groupEl.label = g.group;
    g.items.forEach(act => {
      ALL_SYSTEM_ACTIONS.push(act);
      const opt = document.createElement('option');
      opt.value = act.value;
      opt.textContent = `${act.name} (${act.value})`;
      if (item.target === act.value) opt.selected = true;
      groupEl.appendChild(opt);
    });
    systemSelect.appendChild(groupEl);
  });

  systemSelect.addEventListener('change', () => {
    const selectedAct = ALL_SYSTEM_ACTIONS.find(a => a.value === systemSelect.value);
    if (selectedAct) {
      item.target = selectedAct.value;
      if (!nameInput.value || nameInput.value === 'New Item') {
        item.name = selectedAct.name;
        nameInput.value = selectedAct.name;
      }
      if (!iconInput.value || iconInput.value === 'circle') {
        item.icon = selectedAct.icon;
        iconInput.value = selectedAct.icon;
        if (window.renderIconInto) window.renderIconInto(selectedAct.icon, iconPreview);
      }
      if (!descInput.value) {
        item.description = selectedAct.desc;
        descInput.value = selectedAct.desc;
      }
    }
  });

  const browseBtn = document.createElement('button');
  browseBtn.className = 'browse-btn';
  browseBtn.textContent = 'Browse...';
  browseBtn.style.display = item.type === 'app' ? 'block' : 'none';
  browseBtn.addEventListener('click', async () => {
    const picked = await window.orbsAPI.pickAppTarget();
    if (picked) {
      item.target = picked;
      targetInput.value = picked;

      const derivedName = extractAppName(picked);
      if (derivedName && (!nameInput.value || nameInput.value === 'New Item')) {
        item.name = derivedName;
        nameInput.value = derivedName;
      }

      if (!item.userIcon) {
        const derivedIcon = autoDetectIcon(nameInput.value, picked);
        if (derivedIcon) {
          item.icon = derivedIcon;
          iconInput.value = derivedIcon;
          if (window.renderIconInto) window.renderIconInto(derivedIcon, iconPreview);
        }
      }
    }
  });

  const appPickerBtn = document.createElement('button');
  appPickerBtn.className = 'browse-btn';
  appPickerBtn.textContent = 'Apps...';
  appPickerBtn.title = 'Scan installed Start Menu apps';
  appPickerBtn.style.display = item.type === 'app' ? 'block' : 'none';
  appPickerBtn.addEventListener('click', () => {
    openAppPicker(item, () => onListChanged());
  });

  const iconPickerBtn = document.createElement('button');
  iconPickerBtn.className = 'browse-btn';
  iconPickerBtn.textContent = 'Icon...';
  iconPickerBtn.title = 'Open Visual Icon Picker (600+ icons)';
  iconPickerBtn.addEventListener('click', () => {
    openIconPicker(item, () => {
      iconInput.value = item.icon;
      if (window.renderIconInto) window.renderIconInto(item.icon, iconPreview);
      onListChanged();
    });
  });

  typeSelect.addEventListener('change', () => {
    item.type = typeSelect.value;
    browseBtn.style.display = item.type === 'app' ? 'block' : 'none';
    appPickerBtn.style.display = item.type === 'app' ? 'block' : 'none';
    targetInput.style.display = item.type === 'system' ? 'none' : 'block';
    systemSelect.style.display = item.type === 'system' ? 'block' : 'none';
    targetInput.disabled = item.type === 'widget' || item.type === 'folder';
    if (item.type === 'folder' && !Array.isArray(item.children)) {
      item.children = [];
    }
    onListChanged();
  });
  targetInput.disabled = item.type === 'widget' || item.type === 'folder';

  row2.append(typeSelect, targetInput, systemSelect, browseBtn, appPickerBtn, iconPickerBtn);

  const row3 = document.createElement('div');
  row3.className = 'row3';
  const descInput = document.createElement('input');
  descInput.placeholder = 'Description (shown in wheel center)';
  descInput.value = item.description || '';
  descInput.style.flex = '1';
  descInput.addEventListener('input', () => { item.description = descInput.value; });
  row3.appendChild(descInput);

  card.append(row1, row2, row3);

  // Folder sub-items editor (for depth < 3)
  if (depth < 3 && item.type === 'folder') {
    if (!Array.isArray(item.children)) item.children = [];

    const childrenWrap = document.createElement('div');
    childrenWrap.style.marginTop = '4px';
    childrenWrap.style.paddingLeft = '12px';
    childrenWrap.style.borderLeft = '2px solid rgba(255,255,255,0.1)';

    const childHeader = document.createElement('div');
    childHeader.style.display = 'flex';
    childHeader.style.alignItems = 'center';
    childHeader.style.justifyContent = 'space-between';
    childHeader.style.marginBottom = '6px';

    const childLabel = document.createElement('span');
    childLabel.textContent = `Submenu Level ${depth + 1} items (${item.children.length})`;
    childLabel.style.fontSize = '10px';
    childLabel.style.color = 'rgba(255,255,255,0.5)';
    childLabel.style.textTransform = 'uppercase';
    childLabel.style.letterSpacing = '0.5px';

    const addChildBtn = document.createElement('button');
    addChildBtn.className = 'btn-secondary';
    addChildBtn.textContent = `+ Add Level ${depth + 1} item`;
    addChildBtn.addEventListener('click', () => {
      if (item.children.length >= MAX_ITEMS) {
        setStatus(`Max ${MAX_ITEMS} submenu items supported.`, 'error');
        return;
      }
      item.children.push({ name: 'New Item', icon: 'circle', type: 'app', target: '', description: '' });
      onListChanged();
    });

    childHeader.append(childLabel, addChildBtn);
    childrenWrap.appendChild(childHeader);

    const childList = document.createElement('div');
    childList.style.display = 'flex';
    childList.style.flexDirection = 'column';
    childList.style.gap = '8px';

    item.children.forEach((child, childIndex) => {
      const childCard = buildItemCard(child, item.children, childIndex, depth + 1, onListChanged);
      childList.appendChild(childCard);
    });

    childrenWrap.appendChild(childList);
    card.appendChild(childrenWrap);
  }

  return card;
}

function renderItems() {
  itemsList.innerHTML = '';
  itemCount.textContent = `(${config.items.length}/${MAX_ITEMS})`;

  config.items.forEach((item, index) => {
    const card = buildItemCard(item, config.items, index, 1, renderItems);
    itemsList.appendChild(card);
  });
}

// ---------- App Picker Modal Logic ----------
async function openAppPicker(itemTarget, onSelected) {
  activeAppPickerTarget = itemTarget;
  activeAppPickerCallback = onSelected;
  appSearchInput.value = '';
  appPickerModal.classList.remove('hidden');
  appSearchInput.focus();

  if (installedApps.length === 0) {
    appListContainer.innerHTML = '<div style="padding:12px; color:rgba(255,255,255,0.4); text-align:center;">Scanning Windows installed apps...</div>';
  }
  installedApps = await window.orbsAPI.getInstalledApps();
  renderAppPickerList('');
}

function renderAppPickerList(filterText) {
  appListContainer.innerHTML = '';
  const query = filterText.toLowerCase().trim();
  const filtered = installedApps.filter(a => a.name.toLowerCase().includes(query));

  if (filtered.length === 0) {
    appListContainer.innerHTML = '<div style="padding:12px; color:rgba(255,255,255,0.4); text-align:center;">No matching apps found</div>';
    return;
  }

  filtered.forEach(app => {
    const row = document.createElement('div');
    row.className = 'app-list-item';
    row.innerHTML = `
      <span class="app-item-name">${app.name}</span>
      <span class="app-item-path" title="${app.path}">${app.path}</span>
    `;
    row.addEventListener('click', () => {
      if (activeAppPickerTarget) {
        activeAppPickerTarget.target = app.path;
        activeAppPickerTarget.name = app.name;
        activeAppPickerTarget.icon = autoDetectIcon(app.name, app.path);
      }
      appPickerModal.classList.add('hidden');
      if (activeAppPickerCallback) activeAppPickerCallback();
    });
    appListContainer.appendChild(row);
  });
}

appSearchInput.addEventListener('input', () => {
  renderAppPickerList(appSearchInput.value);
});

closeAppPickerBtn.addEventListener('click', () => {
  appPickerModal.classList.add('hidden');
});

appPickerModal.addEventListener('click', (e) => {
  if (e.target === appPickerModal) {
    appPickerModal.classList.add('hidden');
  }
});

// ---------- Icon Picker Modal Logic ----------
let activeIconPickerTarget = null;
let activeIconPickerCallback = null;
let currentIconCategory = 'all';

const iconPickerModal = document.getElementById('icon-picker-modal');
const iconSearchInput = document.getElementById('icon-search-input');
const iconGridContainer = document.getElementById('icon-grid');
const closeIconPickerBtn = document.getElementById('close-icon-picker');

function openIconPicker(itemTarget, onSelected) {
  activeIconPickerTarget = itemTarget;
  activeIconPickerCallback = onSelected;
  if (iconSearchInput) iconSearchInput.value = '';
  currentIconCategory = 'all';
  
  document.querySelectorAll('.cat-pill').forEach(p => {
    p.classList.toggle('active', p.getAttribute('data-cat') === 'all');
  });

  if (iconPickerModal) iconPickerModal.classList.remove('hidden');
  if (iconSearchInput) iconSearchInput.focus();
  renderIconGrid('', 'all');
}

function renderIconGrid(filterText = '', category = 'all') {
  if (!iconGridContainer) return;
  iconGridContainer.innerHTML = '';
  const query = filterText.toLowerCase().trim();

  let iconsToDisplay = [];

  // Gather Brand Icons
  const added = new Set();
  if (window.BRAND_ICONS) {
    Object.keys(window.BRAND_ICONS).forEach(key => {
      if (category === 'all' || category === 'brand') {
        if (!query || key.toLowerCase().includes(query)) {
          added.add(key);
          iconsToDisplay.push({ name: key, type: 'brand' });
        }
      }
    });
  }

  // Gather Simple Icons
  if (Array.isArray(window.SIMPLE_ICONS)) {
    window.SIMPLE_ICONS.forEach(key => {
      if (category === 'all' || category === 'brand') {
        if (!query || key.toLowerCase().includes(query)) {
          if (!added.has(key)) {
            added.add(key);
            iconsToDisplay.push({ name: key, type: 'simple' });
          }
        }
      }
    });
  }

  // Gather Lucide Icons
  if (Array.isArray(lucideData)) {
    lucideData.forEach(icon => {
      const name = icon.n;
      let matchedCategory = false;
      if (category === 'all') matchedCategory = true;
      else if (category === 'system' && (name.includes('file') || name.includes('folder') || name.includes('setting') || name.includes('hard') || name.includes('cpu') || name.includes('trash') || name.includes('lock') || name.includes('terminal') || name.includes('activity'))) matchedCategory = true;
      else if (category === 'media' && (name.includes('volume') || name.includes('play') || name.includes('skip') || name.includes('camera') || name.includes('image') || name.includes('music') || name.includes('video') || name.includes('radio'))) matchedCategory = true;
      else if (category === 'dev' && (name.includes('code') || name.includes('git') || name.includes('terminal') || name.includes('command') || name.includes('database') || name.includes('server') || name.includes('cpu') || name.includes('sliders'))) matchedCategory = true;
      else if (category === 'brand') matchedCategory = false;

      if (matchedCategory) {
        if (!query || name.toLowerCase().includes(query)) {
          iconsToDisplay.push({ name, type: 'lucide' });
        }
      }
    });
  }

  if (iconsToDisplay.length === 0) {
    iconGridContainer.innerHTML = '<div style="grid-column:1/-1; padding:20px; color:rgba(255,255,255,0.4); text-align:center;">No matching icons found</div>';
    return;
  }

  iconsToDisplay.slice(0, 300).forEach(iconObj => {
    const itemEl = document.createElement('div');
    itemEl.className = 'icon-grid-item';
    itemEl.title = iconObj.name;

    const prevEl = document.createElement('div');
    prevEl.className = 'icon-grid-preview lucide-icon';
    if (window.renderIconInto) {
      window.renderIconInto(iconObj.name, prevEl);
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'icon-grid-name';
    nameEl.textContent = iconObj.name;

    itemEl.append(prevEl, nameEl);

    itemEl.addEventListener('click', () => {
      if (activeIconPickerTarget) {
        activeIconPickerTarget.icon = iconObj.name;
        activeIconPickerTarget.userIcon = true;
      }
      if (iconPickerModal) iconPickerModal.classList.add('hidden');
      if (activeIconPickerCallback) activeIconPickerCallback();
    });

    iconGridContainer.appendChild(itemEl);
  });
}

if (iconSearchInput) {
  iconSearchInput.addEventListener('input', () => {
    renderIconGrid(iconSearchInput.value, currentIconCategory);
  });
}

document.querySelectorAll('.cat-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentIconCategory = pill.getAttribute('data-cat') || 'all';
    renderIconGrid(iconSearchInput ? iconSearchInput.value : '', currentIconCategory);
  });
});

if (closeIconPickerBtn) {
  closeIconPickerBtn.addEventListener('click', () => {
    if (iconPickerModal) iconPickerModal.classList.add('hidden');
  });
}

if (iconPickerModal) {
  iconPickerModal.addEventListener('click', (e) => {
    if (e.target === iconPickerModal) {
      iconPickerModal.classList.add('hidden');
    }
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (appPickerModal && !appPickerModal.classList.contains('hidden')) {
      appPickerModal.classList.add('hidden');
    }
    if (iconPickerModal && !iconPickerModal.classList.contains('hidden')) {
      iconPickerModal.classList.add('hidden');
    }
  }
});

// ---------- Tab Switching Logic ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    const targetPane = document.getElementById(tabId);
    if (targetPane) targetPane.classList.add('active');
  });
});

// ---------- Hotkey Preview Pill ----------
function updateHotkeyPill() {
  const mod = document.getElementById('hotkey-modifier').value;
  const key = document.getElementById('hotkey-key').value.trim() || 'space';
  const pillMod = document.getElementById('pill-modifier');
  const pillKey = document.getElementById('pill-key');
  if (pillMod) pillMod.textContent = mod.toUpperCase();
  if (pillKey) pillKey.textContent = key.toUpperCase();
}
document.getElementById('hotkey-modifier').addEventListener('change', updateHotkeyPill);
document.getElementById('hotkey-key').addEventListener('input', updateHotkeyPill);

// ---------- Appearance Sliders & Live Preview ----------
function updateLivePreview() {
  const size = parseInt(orbSizeSlider.value, 10);
  const blur = parseInt(blurSlider.value, 10);
  orbSizeVal.textContent = `${size}px`;
  blurVal.textContent = `${blur}px`;

  const miniPreview = document.getElementById('mini-orb-preview');
  if (miniPreview) {
    const scale = (size / 470).toFixed(2);
    miniPreview.style.transform = `scale(${Math.max(0.7, Math.min(scale, 1.3))})`;
    miniPreview.style.boxShadow = `0 0 ${blur * 1.5}px rgba(124, 77, 255, 0.4)`;
  }
}

orbSizeSlider.addEventListener('input', updateLivePreview);
blurSlider.addEventListener('input', updateLivePreview);

// ---------- Main Event Handlers ----------
document.getElementById('add-item').addEventListener('click', () => {
  if (config.items.length >= MAX_ITEMS) {
    setStatus(`Max ${MAX_ITEMS} items supported by the wheel layout.`, 'error');
    return;
  }
  config.items.push({ name: 'New Item', icon: 'circle', type: 'app', target: '', description: '' });
  renderItems();
});

document.getElementById('cancel-btn').addEventListener('click', () => {
  window.orbsAPI.closeSettings();
});

document.getElementById('save-btn').addEventListener('click', async () => {
  config.hotkey.modifier = document.getElementById('hotkey-modifier').value;
  config.hotkey.key = document.getElementById('hotkey-key').value.trim() || 'space';

  const selectedThemeEl = document.querySelector('input[name="theme-select"]:checked');
  const selectedTheme = selectedThemeEl ? selectedThemeEl.value : 'cyberpunk';

  config.appearance = {
    orbSize: parseInt(orbSizeSlider.value, 10),
    blurIntensity: parseInt(blurSlider.value, 10),
    theme: selectedTheme
  };

  const result = await window.orbsAPI.saveConfig(config);
  if (result.ok) {
    setStatus('Saved successfully!', 'success');
    setTimeout(() => window.orbsAPI.closeSettings(), 600);
  } else {
    setStatus(`Error: ${result.error}`, 'error');
  }
});

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

(async () => {
  config = await window.orbsAPI.getConfig();
  window.lucideData = await window.orbsAPI.getLucideIcons();
  lucideData = window.lucideData;

  document.getElementById('hotkey-modifier').value = config.hotkey.modifier || 'ctrl';
  document.getElementById('hotkey-key').value = config.hotkey.key || 'space';

  const orbSize = config.appearance?.orbSize || 470;
  const blurIntensity = config.appearance?.blurIntensity || 16;
  const theme = config.appearance?.theme || 'cyberpunk';

  orbSizeSlider.value = orbSize;
  blurSlider.value = blurIntensity;

  const themeRadio = document.querySelector(`input[name="theme-select"][value="${theme}"]`);
  if (themeRadio) themeRadio.checked = true;
  document.documentElement.setAttribute('data-theme', theme);

  document.querySelectorAll('input[name="theme-select"]').forEach(r => {
    r.addEventListener('change', () => {
      document.documentElement.setAttribute('data-theme', r.value);
    });
  });

  updateLivePreview();
  updateHotkeyPill();

  if (window.BRAND_ICONS) {
    Object.keys(window.BRAND_ICONS).forEach(brand => {
      const opt = document.createElement('option');
      opt.value = brand;
      iconListEl.appendChild(opt);
    });
  }

  lucideData.forEach(icon => {
    const opt = document.createElement('option');
    opt.value = icon.n;
    iconListEl.appendChild(opt);
  });

  const autostartToggle = document.getElementById('autostart-toggle');
  if (autostartToggle && window.orbsAPI.getAutoStart) {
    try {
      const isAutoStart = await window.orbsAPI.getAutoStart();
      autostartToggle.checked = Boolean(isAutoStart);
      autostartToggle.addEventListener('change', async () => {
        await window.orbsAPI.setAutoStart(autostartToggle.checked);
      });
    } catch (err) {
      console.error('Failed to query autostart status:', err);
    }
  }

  renderItems();
})();
