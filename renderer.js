// ---------- Layout constants & Radii ----------
const CENTER = 450;

// Level 1 (Main Ring)
const MAIN_INNER_R = 75;
const MAIN_OUTER_R = 200;
const MAIN_ICON_R = 137;
const MAIN_BAND_MIN = 70;
const MAIN_BAND_MAX = 200;

// Level 2 (Sub-arc Ring)
const SUB2_INNER_R = 204;
const SUB2_OUTER_R = 315;
const SUB2_ICON_R = 260;
const SUB2_BAND_MIN = 204;
const SUB2_BAND_MAX = 315;

// Level 3 (Outer Sub-arc Ring)
const SUB3_INNER_R = 319;
const SUB3_OUTER_R = 430;
const SUB3_ICON_R = 375;
const SUB3_BAND_MIN = 319;
const SUB3_BAND_MAX = 430;

// ---------- State ----------
let config = null;
let lucideData = [];
let N = 0;
let anglePerSector = 0;

let activeIdx = -1;           // hovered L1 index (-1 if none)
let activeSubIdx = -1;        // hovered L2 index (-1 if none)
let activeSub3Idx = -1;       // hovered L3 index (-1 if none)

let expandedFolderIdx = -1;   // expanded L1 folder index (-1 if none)
let expandedL2FolderIdx = -1; // expanded L2 folder index (-1 if none)

let activeLeafItem = null;    // the resolved leaf item (or folder) that release-trigger would fire
let quickKeyMap = {};         // key -> { item, l1Idx, l2Idx, l3Idx }

let calcExpression = '';

// ---------- Geometry helpers ----------
function polarToCartesian(cx, cy, radius, angleInDegrees) {
  const angleInRadians = angleInDegrees * Math.PI / 180.0;
  return {
    x: cx + (radius * Math.cos(angleInRadians)),
    y: cy + (radius * Math.sin(angleInRadians))
  };
}

function describeSector(x, y, innerRadius, outerRadius, startAngle, endAngle) {
  const outerStart = polarToCartesian(x, y, outerRadius, startAngle);
  const outerEnd = polarToCartesian(x, y, outerRadius, endAngle);
  const innerStart = polarToCartesian(x, y, innerRadius, startAngle);
  const innerEnd = polarToCartesian(x, y, innerRadius, endAngle);

  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M", outerStart.x, outerStart.y,
    "A", outerRadius, outerRadius, 0, largeArcFlag, 1, outerEnd.x, outerEnd.y,
    "L", innerEnd.x, innerEnd.y,
    "A", innerRadius, innerRadius, 0, largeArcFlag, 0, innerStart.x, innerStart.y,
    "Z"
  ].join(" ");
}

function normDeg(d) {
  d = d % 360;
  if (d < 0) d += 360;
  return d;
}

function angleInSector(deg, start, end) {
  const nd = normDeg(deg), ns = normDeg(start), ne = normDeg(end);
  if (ns <= ne) return nd >= ns && nd < ne;
  return nd >= ns || nd < ne;
}

function iconCharFor(iconName) {
  const icon = lucideData.find(li => li.n === iconName);
  return icon ? String.fromCharCode(icon.c) : '?';
}

function applyAppearance() {
  if (!config || !config.appearance) return;
  const orbSize = config.appearance.orbSize || 470;
  const blurIntensity = config.appearance.blurIntensity || 16;
  const theme = config.appearance.theme || 'cyberpunk';
  document.documentElement.style.setProperty('--orb-size', orbSize + 'px');
  document.documentElement.style.setProperty('--blur-intensity', blurIntensity + 'px');
  document.documentElement.setAttribute('data-theme', theme);
}

// ---------- Quick Key Indexer ----------
function buildQuickKeyMap() {
  quickKeyMap = {};
  if (!config || !Array.isArray(config.items)) return;

  function indexItems(items, l1Idx = -1, l2Idx = -1) {
    items.forEach((item, idx) => {
      const curL1 = l1Idx === -1 ? idx : l1Idx;
      const curL2 = l1Idx !== -1 && l2Idx === -1 ? idx : l2Idx;
      const curL3 = l2Idx !== -1 ? idx : -1;

      if (item.quickKey && typeof item.quickKey === 'string') {
        const k = item.quickKey.toLowerCase().trim();
        if (k.length === 1) {
          quickKeyMap[k] = { item, l1Idx: curL1, l2Idx: curL2, l3Idx: curL3 };
        }
      }

      if (item.type === 'folder' && Array.isArray(item.children)) {
        indexItems(item.children, curL1, curL2);
      }
    });
  }

  indexItems(config.items);
}

// ---------- Floating Item Builder ----------
function buildFloatingItem(item, displayIndex, x, y) {
  const el = document.createElement('div');
  el.className = 'floating-item';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  const badgeText = item.quickKey ? item.quickKey.toUpperCase() : String(displayIndex + 1);
  const badgeClass = item.quickKey ? 'item-badge quickkey-badge' : 'item-badge';

  el.innerHTML = `
    <span class="${badgeClass}">${badgeText}</span>
    <span class="floating-icon lucide-icon"></span>
    <span class="floating-name"></span>
    ${item.type === 'folder' ? '<span class="folder-indicator">\u2022\u2022\u2022</span>' : ''}
  `;
  el.querySelector('.floating-name').textContent = item.name;
  const iconContainer = el.querySelector('.floating-icon');

  if (item.icon && item.icon !== 'auto') {
    if (window.renderIconInto) {
      window.renderIconInto(item.icon, iconContainer);
    }
  } else if (item.type === 'app' && item.target && window.orbsAPI.getAppIcon) {
    window.orbsAPI.getAppIcon(item.target).then(iconUrl => {
      if (iconUrl) {
        iconContainer.innerHTML = `<img src="${iconUrl}" class="native-app-icon" alt="" />`;
      } else if (window.renderIconInto) {
        window.renderIconInto(item.icon || 'grid', iconContainer);
      }
    }).catch(() => {
      if (window.renderIconInto) {
        window.renderIconInto(item.icon || 'grid', iconContainer);
      }
    });
  } else if (window.renderIconInto) {
    window.renderIconInto(item.icon || 'grid', iconContainer);
  }

  return el;
}

// ---------- Level 1 Main Wheel ----------
function buildWheel() {
  N = config.items.length;
  anglePerSector = N > 0 ? 360 / N : 0;

  const sectorsGroup = document.getElementById('sectors-group');
  const iconsContainer = document.getElementById('icons-container');
  sectorsGroup.innerHTML = '';
  iconsContainer.innerHTML = '';

  config.items.forEach((item, index) => {
    const startAngle = index * anglePerSector - 90 - (anglePerSector / 2);
    const endAngle = (index + 1) * anglePerSector - 90 - (anglePerSector / 2);
    const pathData = describeSector(CENTER, CENTER, MAIN_INNER_R, MAIN_OUTER_R, startAngle, endAngle);

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', pathData);
    pathEl.setAttribute('class', 'sector-slice');
    pathEl.setAttribute('id', `sector-${index}`);
    sectorsGroup.appendChild(pathEl);
  });

  config.items.forEach((item, index) => {
    const angle = (index * anglePerSector - 90) * Math.PI / 180;
    const x = CENTER + MAIN_ICON_R * Math.cos(angle);
    const y = CENTER + MAIN_ICON_R * Math.sin(angle);

    const el = buildFloatingItem(item, index, x, y);
    el.id = `floating-${index}`;
    iconsContainer.appendChild(el);
  });

  buildQuickKeyMap();
  applyAppearance();
}

// ---------- Level 2 Folder Sub-arc ----------
function buildSubWheel(parentIndex) {
  const subSectorsGroup = document.getElementById('sub-sectors-group');
  const subIconsContainer = document.getElementById('sub-icons-container');
  subSectorsGroup.innerHTML = '';
  subIconsContainer.innerHTML = '';

  const parent = config.items[parentIndex];
  if (!parent || parent.type !== 'folder' || !Array.isArray(parent.children)) return;

  const children = parent.children;
  const M = children.length;
  if (M === 0) return;

  const childAngleWidth = anglePerSector;
  const parentCenterAngle = parentIndex * anglePerSector - 90;
  const totalSpan = M * childAngleWidth;
  const startAngle = parentCenterAngle - totalSpan / 2;

  children.forEach((child, i) => {
    const sStart = startAngle + i * childAngleWidth;
    const sEnd = startAngle + (i + 1) * childAngleWidth;
    const pathData = describeSector(CENTER, CENTER, SUB2_INNER_R, SUB2_OUTER_R, sStart, sEnd);

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', pathData);
    pathEl.setAttribute('class', 'sector-slice');
    pathEl.setAttribute('id', `sub-sector-${i}`);
    subSectorsGroup.appendChild(pathEl);

    const childCenterAngle = sStart + childAngleWidth / 2;
    const angleRad = childCenterAngle * Math.PI / 180;
    const x = CENTER + SUB2_ICON_R * Math.cos(angleRad);
    const y = CENTER + SUB2_ICON_R * Math.sin(angleRad);

    const el = buildFloatingItem(child, i, x, y);
    el.id = `sub-floating-${i}`;
    subIconsContainer.appendChild(el);
  });
}

function clearSubWheel() {
  document.getElementById('sub-sectors-group').innerHTML = '';
  document.getElementById('sub-icons-container').innerHTML = '';
  expandedFolderIdx = -1;
  clearSub3Wheel();
}

// ---------- Level 3 Folder Sub-arc ----------
function buildSub3Wheel(l1Index, l2Index) {
  const sub3SectorsGroup = document.getElementById('sub3-sectors-group');
  const sub3IconsContainer = document.getElementById('sub3-icons-container');
  sub3SectorsGroup.innerHTML = '';
  sub3IconsContainer.innerHTML = '';

  const l1Parent = config.items[l1Index];
  if (!l1Parent || l1Parent.type !== 'folder' || !Array.isArray(l1Parent.children)) return;

  const l2Parent = l1Parent.children[l2Index];
  if (!l2Parent || l2Parent.type !== 'folder' || !Array.isArray(l2Parent.children)) return;

  const children = l2Parent.children;
  const K = children.length;
  if (K === 0) return;

  const childAngleWidth = anglePerSector;

  // Center angle of the L2 sector
  const l1ParentCenterAngle = l1Index * anglePerSector - 90;
  const l2TotalSpan = l1Parent.children.length * childAngleWidth;
  const l2StartAngle = l1ParentCenterAngle - l2TotalSpan / 2;
  const l2SectorCenterAngle = l2StartAngle + (l2Index + 0.5) * childAngleWidth;

  const l3TotalSpan = K * childAngleWidth;
  const startAngle = l2SectorCenterAngle - l3TotalSpan / 2;

  children.forEach((child, i) => {
    const sStart = startAngle + i * childAngleWidth;
    const sEnd = startAngle + (i + 1) * childAngleWidth;
    const pathData = describeSector(CENTER, CENTER, SUB3_INNER_R, SUB3_OUTER_R, sStart, sEnd);

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', pathData);
    pathEl.setAttribute('class', 'sector-slice');
    pathEl.setAttribute('id', `sub3-sector-${i}`);
    sub3SectorsGroup.appendChild(pathEl);

    const childCenterAngle = sStart + childAngleWidth / 2;
    const angleRad = childCenterAngle * Math.PI / 180;
    const x = CENTER + SUB3_ICON_R * Math.cos(angleRad);
    const y = CENTER + SUB3_ICON_R * Math.sin(angleRad);

    const el = buildFloatingItem(child, i, x, y);
    el.id = `sub3-floating-${i}`;
    sub3IconsContainer.appendChild(el);
  });
}

function clearSub3Wheel() {
  document.getElementById('sub3-sectors-group').innerHTML = '';
  document.getElementById('sub3-icons-container').innerHTML = '';
  expandedL2FolderIdx = -1;
}

// ---------- Hover Detection ----------
window.addEventListener('mousemove', (e) => {
  if (N === 0) return;
  if (e.target.closest('#center-panel')) return;

  const rect = document.getElementById('app-container').getBoundingClientRect();
  const x = e.clientX - rect.left - CENTER;
  const y = e.clientY - rect.top - CENTER;
  const distance = Math.sqrt(x * x + y * y);

  let hoveredIdx = -1;
  let hoveredSubIdx = -1;
  let hoveredSub3Idx = -1;

  if (distance >= MAIN_BAND_MIN && distance <= MAIN_BAND_MAX) {
    // Main ring (L1)
    let angle = Math.atan2(y, x) * 180 / Math.PI;
    let deg = angle + 90;
    if (deg < 0) deg += 360;
    let shifted = deg + (anglePerSector / 2);
    if (shifted >= 360) shifted -= 360;
    hoveredIdx = Math.floor(shifted / anglePerSector) % N;
  } else if (distance > MAIN_BAND_MAX && expandedFolderIdx !== -1) {
    // Outer band (>MAIN_BAND_MAX): maintain expanded L1 folder active so sub-wheel never collapses unexpectedly
    hoveredIdx = expandedFolderIdx;

    if (distance > SUB3_BAND_MIN && expandedL2FolderIdx !== -1) {
      // Level 3 sub-arc band
      const l1Parent = config.items[expandedFolderIdx];
      const l2Parent = l1Parent && l1Parent.children ? l1Parent.children[expandedL2FolderIdx] : null;
      const children = (l2Parent && l2Parent.children) || [];
      if (children.length > 0) {
        const childAngleWidth = anglePerSector;
        const l1ParentCenterAngle = expandedFolderIdx * anglePerSector - 90;
        const l2TotalSpan = l1Parent.children.length * childAngleWidth;
        const l2StartAngle = l1ParentCenterAngle - l2TotalSpan / 2;
        const l2SectorCenterAngle = l2StartAngle + (expandedL2FolderIdx + 0.5) * childAngleWidth;

        const l3TotalSpan = children.length * childAngleWidth;
        const startAngle = l2SectorCenterAngle - l3TotalSpan / 2;
        const rawAngle = Math.atan2(y, x) * 180 / Math.PI;

        for (let i = 0; i < children.length; i++) {
          const s = startAngle + i * childAngleWidth;
          const eEnd = startAngle + (i + 1) * childAngleWidth;
          if (angleInSector(rawAngle, s, eEnd)) {
            hoveredSub3Idx = i;
            break;
          }
        }
        hoveredSubIdx = expandedL2FolderIdx;
      }
    } else {
      // Level 2 sub-arc band
      const parent = config.items[expandedFolderIdx];
      const children = (parent && parent.children) || [];
      if (children.length > 0) {
        const childAngleWidth = anglePerSector;
        const parentCenterAngle = expandedFolderIdx * anglePerSector - 90;
        const totalSpan = children.length * childAngleWidth;
        const startAngle = parentCenterAngle - totalSpan / 2;
        const rawAngle = Math.atan2(y, x) * 180 / Math.PI;

        for (let i = 0; i < children.length; i++) {
          const s = startAngle + i * childAngleWidth;
          const eEnd = startAngle + (i + 1) * childAngleWidth;
          if (angleInSector(rawAngle, s, eEnd)) {
            hoveredSubIdx = i;
            break;
          }
        }
      }
    }
  }

  updateActiveIndex(hoveredIdx, hoveredSubIdx, hoveredSub3Idx);
});

document.addEventListener('mouseleave', () => {
  updateActiveIndex(-1, -1, -1);
});

// ---------- Central State Update ----------
function updateActiveIndex(index, subIndex = -1, sub3Index = -1) {
  if (isSearchMode) return; // Keep Orbs search mode locked
  if (activeIdx === index && activeSubIdx === subIndex && activeSub3Idx === sub3Index) return;

  activeIdx = index;
  activeSubIdx = subIndex;
  activeSub3Idx = sub3Index;

  // L1 folder expansion
  const l1Item = index !== -1 ? config.items[index] : null;
  if (l1Item && l1Item.type === 'folder') {
    if (expandedFolderIdx !== index) {
      expandedFolderIdx = index;
      buildSubWheel(index);
    }
  } else if (expandedFolderIdx !== -1) {
    clearSubWheel();
  }

  // L2 folder expansion
  if (expandedFolderIdx !== -1 && subIndex !== -1) {
    const l1Parent = config.items[expandedFolderIdx];
    const l2Item = (l1Parent && l1Parent.children) ? l1Parent.children[subIndex] : null;
    if (l2Item && l2Item.type === 'folder') {
      if (expandedL2FolderIdx !== subIndex) {
        expandedL2FolderIdx = subIndex;
        buildSub3Wheel(expandedFolderIdx, subIndex);
      }
    } else if (expandedL2FolderIdx !== -1) {
      clearSub3Wheel();
    }
  } else if (expandedL2FolderIdx !== -1) {
    clearSub3Wheel();
  }

  // Highlight L1
  for (let i = 0; i < N; i++) {
    const slice = document.getElementById(`sector-${i}`);
    const label = document.getElementById(`floating-${i}`);
    if (slice && label) {
      const isActive = i === index;
      slice.classList.toggle('active', isActive);
      label.classList.toggle('active', isActive);
    }
  }

  // Highlight L2
  if (expandedFolderIdx !== -1) {
    const children = config.items[expandedFolderIdx].children || [];
    children.forEach((_, i) => {
      const slice = document.getElementById(`sub-sector-${i}`);
      const label = document.getElementById(`sub-floating-${i}`);
      if (!slice || !label) return;
      const isActive = i === subIndex;
      slice.classList.toggle('active', isActive);
      label.classList.toggle('active', isActive);
    });
  }

  // Highlight L3
  if (expandedFolderIdx !== -1 && expandedL2FolderIdx !== -1) {
    const l1Parent = config.items[expandedFolderIdx];
    const l2Parent = l1Parent.children ? l1Parent.children[expandedL2FolderIdx] : null;
    const children = (l2Parent && l2Parent.children) || [];
    children.forEach((_, i) => {
      const slice = document.getElementById(`sub3-sector-${i}`);
      const label = document.getElementById(`sub3-floating-${i}`);
      if (!slice || !label) return;
      const isActive = i === sub3Index;
      slice.classList.toggle('active', isActive);
      label.classList.toggle('active', isActive);
    });
  }

  // Resolve leaf item & center panel mode
  let leaf = null;
  let centerMode = 'default';
  let folderInfo = null;

  if (index !== -1 && l1Item) {
    if (l1Item.type === 'folder') {
      if (subIndex !== -1 && l1Item.children[subIndex]) {
        const l2Child = l1Item.children[subIndex];
        if (l2Child.type === 'folder') {
          if (sub3Index !== -1 && l2Child.children[sub3Index]) {
            leaf = l2Child.children[sub3Index];
          } else {
            folderInfo = l2Child;
          }
        } else {
          leaf = l2Child;
        }
      } else {
        folderInfo = l1Item;
      }
    } else {
      leaf = l1Item;
    }
  }

  if (leaf) {
    centerMode = (leaf.type === 'widget' && leaf.target === 'calculator') ? 'calc' : 'details';
  } else if (folderInfo) {
    centerMode = 'folder';
  }

  applyCenterPanel(centerMode, leaf, folderInfo);

  activeLeafItem = leaf;
  window.orbsAPI.sendActiveItem(leaf);
}

function applyCenterPanel(mode, leaf, folderInfo) {
  if (isSearchMode) return; // Search mode is active and locked; ignore hover mode changes!

  const defaultPanel = document.getElementById('center-default');
  const detailsPanel = document.getElementById('center-details');
  const calcPanel = document.getElementById('widget-calc');
  const searchPanel = document.getElementById('center-search');
  const centerPanel = document.getElementById('center-panel');

  defaultPanel.classList.add('hidden');
  detailsPanel.classList.add('hidden');
  calcPanel.classList.add('hidden');
  if (searchPanel) searchPanel.classList.add('hidden');
  centerPanel.classList.remove('widget-mode');
  centerPanel.classList.remove('search-mode');

  if (mode === 'default') {
    defaultPanel.classList.remove('hidden');
  } else if (mode === 'calc') {
    calcPanel.classList.remove('hidden');
    centerPanel.classList.add('widget-mode');
    resetCalculator();
  } else if (mode === 'folder') {
    detailsPanel.classList.remove('hidden');
    if (window.renderIconInto) window.renderIconInto(folderInfo.icon, document.getElementById('center-icon'));
    document.getElementById('center-title').innerText = folderInfo.name;
    const count = (folderInfo.children || []).length;
    document.getElementById('center-desc').innerText = `${count} items - hover to choose`;
  } else if (mode === 'details') {
    detailsPanel.classList.remove('hidden');
    if (window.renderIconInto) window.renderIconInto(leaf.icon, document.getElementById('center-icon'));
    document.getElementById('center-title').innerText = leaf.name;
    document.getElementById('center-desc').innerText = leaf.description || '';
  }
}

// ---------- Live Center Search ----------
let isSearchMode = false;
let searchResults = [];
let selectedSearchIdx = 0;
let scannedApps = [];

async function loadScannedApps() {
  if (scannedApps.length === 0 && window.orbsAPI.getInstalledApps) {
    try {
      scannedApps = await window.orbsAPI.getInstalledApps();
    } catch (e) {}
  }
}

function openCenterSearch(initialQuery = '') {
  isSearchMode = true;
  activeLeafItem = { type: 'widget', name: 'search' };
  activeIdx = -1;
  activeSubIdx = -1;
  activeSub3Idx = -1;

  for (let i = 0; i < N; i++) {
    const slice = document.getElementById(`sector-${i}`);
    const label = document.getElementById(`floating-${i}`);
    if (slice) slice.classList.remove('active');
    if (label) label.classList.remove('active');
  }

  if (window.orbsAPI && window.orbsAPI.sendActiveItem) {
    window.orbsAPI.sendActiveItem(activeLeafItem);
  }
  loadScannedApps();

  const defaultPanel = document.getElementById('center-default');
  const detailsPanel = document.getElementById('center-details');
  const calcPanel = document.getElementById('widget-calc');
  const searchPanel = document.getElementById('center-search');
  const centerPanel = document.getElementById('center-panel');
  const searchInput = document.getElementById('center-search-input');

  defaultPanel.classList.add('hidden');
  detailsPanel.classList.add('hidden');
  calcPanel.classList.add('hidden');
  centerPanel.classList.remove('widget-mode');

  searchPanel.classList.remove('hidden');
  centerPanel.classList.add('search-mode');

  if (searchInput) {
    searchInput.value = initialQuery;
    setTimeout(() => searchInput.focus(), 10);
  }
  performSearch(initialQuery);
}

function closeCenterSearch() {
  isSearchMode = false;
  const searchPanel = document.getElementById('center-search');
  const centerPanel = document.getElementById('center-panel');
  if (searchPanel) searchPanel.classList.add('hidden');
  if (centerPanel) centerPanel.classList.remove('search-mode');
  const defaultPanel = document.getElementById('center-default');
  if (defaultPanel) defaultPanel.classList.remove('hidden');
}

function performSearch(query) {
  const q = (query || '').toLowerCase().trim();
  searchResults = [];
  selectedSearchIdx = 0;

  function collectConfigItems(items) {
    items.forEach(item => {
      if (item.type === 'folder' && Array.isArray(item.children)) {
        collectConfigItems(item.children);
      } else if (item.name && (item.name.toLowerCase().includes(q) || (item.target && item.target.toLowerCase().includes(q)))) {
        searchResults.push({
          name: item.name,
          icon: item.icon || 'grid',
          type: item.type || 'app',
          target: item.target || '',
          description: item.description || 'Configured Action'
        });
      }
    });
  }

  if (config && Array.isArray(config.items)) {
    collectConfigItems(config.items);
  }

  scannedApps.forEach(app => {
    if (app.name.toLowerCase().includes(q) && !searchResults.some(r => r.name.toLowerCase() === app.name.toLowerCase())) {
      searchResults.push({
        name: app.name,
        icon: 'grid',
        type: 'app',
        target: app.path,
        description: app.path
      });
    }
  });

  renderSearchResults();
}

function renderSearchResults() {
  const container = document.getElementById('search-results-list');
  if (!container) return;
  container.innerHTML = '';

  if (searchResults.length === 0) {
    container.innerHTML = '<div style="font-size:10px; color:rgba(255,255,255,0.4); text-align:center; padding:12px;">No matching apps</div>';
    return;
  }

  searchResults.slice(0, 15).forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = `search-result-item ${idx === selectedSearchIdx ? 'selected' : ''}`;

    const iconEl = document.createElement('div');
    iconEl.className = 'search-result-icon lucide-icon';

    if (item.icon && item.icon !== 'auto') {
      if (window.renderIconInto) {
        window.renderIconInto(item.icon, iconEl);
      }
    } else if (item.type === 'app' && item.target && window.orbsAPI.getAppIcon) {
      window.orbsAPI.getAppIcon(item.target).then(iconUrl => {
        if (iconUrl) {
          iconEl.innerHTML = `<img src="${iconUrl}" class="native-app-icon" style="width:14px;height:14px;" alt="" />`;
        } else if (window.renderIconInto) {
          window.renderIconInto(item.icon || 'grid', iconEl);
        }
      }).catch(() => {
        if (window.renderIconInto) {
          window.renderIconInto(item.icon || 'grid', iconEl);
        }
      });
    } else if (window.renderIconInto) {
      window.renderIconInto(item.icon || 'grid', iconEl);
    }

    const info = document.createElement('div');
    info.className = 'search-result-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'search-result-name';
    nameEl.textContent = item.name;

    const subEl = document.createElement('div');
    subEl.className = 'search-result-sub';
    subEl.textContent = item.description || item.target;

    info.append(nameEl, subEl);
    row.append(iconEl, info);

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      window.orbsAPI.sendActiveItem(item);
      window.orbsAPI.sendReleaseTrigger();
    });

    container.appendChild(row);
  });
}

// ---------- Calculator ----------
function resetCalculator() {
  calcExpression = '';
  document.getElementById('calc-display').innerText = '0';
}

function evaluateMathExpression(str) {
  str = str.replace(/\s+/g, '');
  const tokens = [];
  let numberBuffer = '';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (/[0-9.]/.test(char)) {
      numberBuffer += char;
    } else {
      if (numberBuffer) {
        tokens.push(parseFloat(numberBuffer));
        numberBuffer = '';
      }
      if ('+-*/()'.includes(char)) {
        tokens.push(char);
      }
    }
  }
  if (numberBuffer) {
    tokens.push(parseFloat(numberBuffer));
  }

  while (tokens.includes('(')) {
    const openIdx = tokens.lastIndexOf('(');
    const closeIdx = tokens.indexOf(')', openIdx);
    if (closeIdx === -1) throw new Error('Mismatched parentheses');
    const subExpr = tokens.slice(openIdx + 1, closeIdx);
    const subResult = evaluateTokens(subExpr);
    tokens.splice(openIdx, closeIdx - openIdx + 1, subResult);
  }

  return evaluateTokens(tokens);
}

function evaluateTokens(tokens) {
  if (tokens.length === 0) return 0;

  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i];
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      if (typeof prev !== 'number' || typeof next !== 'number') {
        throw new Error('Invalid syntax');
      }
      const res = op === '*' ? prev * next : prev / next;
      tokens.splice(i - 1, 3, res);
      i--;
    } else {
      i++;
    }
  }

  let result = tokens[0];
  if (typeof result !== 'number') throw new Error('Invalid syntax');

  i = 1;
  while (i < tokens.length) {
    const op = tokens[i];
    const next = tokens[i + 1];
    if (typeof next !== 'number') throw new Error('Invalid syntax');
    if (op === '+') {
      result += next;
    } else if (op === '-') {
      result -= next;
    } else {
      throw new Error('Unknown operator');
    }
    i += 2;
  }

  return result;
}

function handleCalcInput(key) {
  const display = document.getElementById('calc-display');

  if (key === 'C' || key === 'Escape') {
    calcExpression = '';
    display.innerText = '0';
  } else if (key === 'Backspace') {
    calcExpression = calcExpression.slice(0, -1);
    display.innerText = calcExpression || '0';
  } else if (key === '=' || key === 'Enter') {
    try {
      const sanitized = calcExpression.replace(/[^0-9+\-*/().]/g, '');
      const result = evaluateMathExpression(sanitized);
      calcExpression = String(result);
      display.innerText = calcExpression;
      try {
        window.orbsAPI.copyToClipboard(calcExpression);
      } catch (clipErr) {
        console.warn('Clipboard copy failed:', clipErr);
      }
    } catch (err) {
      console.error('Calculator error:', err);
      display.innerText = 'Error';
      calcExpression = '';
    }
  } else {
    const operators = ['+', '-', '*', '/'];
    if (operators.includes(key) && operators.includes(calcExpression.slice(-1))) {
      calcExpression = calcExpression.slice(0, -1);
    }
    calcExpression += key;
    display.innerText = calcExpression;
  }
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#center-panel')) {
    if (e.target.closest('.calc-row')) {
      e.stopPropagation();
      handleCalcInput(e.target.innerText);
    } else if (!isSearchMode) {
      openCenterSearch();
    }
    return;
  }

  if (isSearchMode) {
    return;
  }

  if (activeLeafItem) {
    if (activeLeafItem.type === 'widget' || activeLeafItem.type === 'search') {
      return; // Keep widget / search active
    }
    window.orbsAPI.sendActiveItem(activeLeafItem);
    window.orbsAPI.sendReleaseTrigger();
  }
});

// ---------- Keyboard & Quick Keys Listener ----------
window.addEventListener('keydown', (e) => {
  const isCalcActive = activeLeafItem && activeLeafItem.type === 'widget' && activeLeafItem.target === 'calculator';

  if (isSearchMode) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedSearchIdx = Math.min(searchResults.length - 1, selectedSearchIdx + 1);
      renderSearchResults();
      return;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedSearchIdx = Math.max(0, selectedSearchIdx - 1);
      renderSearchResults();
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetItem = searchResults[selectedSearchIdx];
      if (targetItem) {
        window.orbsAPI.sendActiveItem(targetItem);
        window.orbsAPI.sendReleaseTrigger();
      }
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeCenterSearch();
      return;
    }
  }

  if (isCalcActive) {
    if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', '*', '/', '.', 'Enter', 'Backspace', 'Escape'].includes(e.key)) {
      e.preventDefault();
      handleCalcInput(e.key);
      return;
    }
  }

  if (!isSearchMode && !isCalcActive && e.key === '/') {
    e.preventDefault();
    openCenterSearch();
    return;
  }

  // Quick Key handling
  if (!isSearchMode && e.key && e.key.length === 1) {
    const k = e.key.toLowerCase();
    const entry = quickKeyMap[k];
    if (entry) {
      e.preventDefault();
      const item = entry.item;
      if (item.type === 'folder') {
        // Expand folder
        if (entry.l2Idx === -1) {
          updateActiveIndex(entry.l1Idx, -1, -1);
        } else {
          updateActiveIndex(entry.l1Idx, entry.l2Idx, -1);
        }
      } else if (item.type === 'widget') {
        // Activate widget
        activeLeafItem = item;
        updateActiveIndex(entry.l1Idx, entry.l2Idx, entry.l3Idx);
      } else {
        // Fire leaf item action & trigger release
        window.orbsAPI.sendActiveItem(item);
        window.orbsAPI.sendReleaseTrigger();
      }
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (isSearchMode) return; // Keep Orbs locked open while searching

  const modifier = (config.hotkey?.modifier || 'ctrl').toLowerCase();

  const isControlRelease = modifier === 'ctrl' && e.key === 'Control';
  const isAltRelease = modifier === 'alt' && e.key === 'Alt';
  const isShiftRelease = modifier === 'shift' && e.key === 'Shift';

  if (isControlRelease || isAltRelease || isShiftRelease) {
    window.orbsAPI.sendReleaseTrigger();
  }
});

window.orbsAPI.onShowWheel(() => {
  closeCenterSearch();
  activeLeafItem = null;
  updateActiveIndex(-1, -1, -1);
});

window.orbsAPI.onConfigReloaded((newConfig) => {
  config = newConfig;
  closeCenterSearch();
  clearSubWheel();
  buildWheel();
  updateActiveIndex(-1, -1, -1);
});

// ---------- Init ----------
(async () => {
  config = await window.orbsAPI.getConfig();
  window.lucideData = await window.orbsAPI.getLucideIcons();
  lucideData = window.lucideData;
  buildWheel();

  document.getElementById('center-search-input')?.addEventListener('input', (e) => {
    performSearch(e.target.value);
  });
})();
