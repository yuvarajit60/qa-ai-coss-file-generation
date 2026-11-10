// State Management
let currentConfig = {
  endpoint: "https://rmg-asc-etp-ssp-c-aifoundry02.services.ai.azure.com/api/projects/rmg-asc-ai-test-transformation-project01",
  agent1Name: "proshipper-csv-generation-RN",
  agent1Version: "5",
  agent2Name: "test-proshipperapi-call",
  agent2Version: "21",
  cossAgentName: "COSS-File-Generation-Agent",
  cossAgentVersion: "1"
};

let currentCSVData = null; // Store 2D array of CSV rows

const MODULES = {
  proshipping: {
    title: 'ProShipping Test Data & Label Generation System',
    subtitle: 'Dual-Agent Orchestration • Microsoft Foundry • Azure DevOps Pipeline 10516'
  },
  coss: {
    title: 'COSS File Generation System',
    subtitle: 'Single-Agent Generation • Microsoft Foundry • COSS-File-Generation-Agent'
  }
};

// Init on load
document.addEventListener('DOMContentLoaded', async () => {
  await fetchConfig();
  loadSavedToken();
  let savedModule = 'proshipping';
  try { savedModule = localStorage.getItem('rmg_module') || savedModule; } catch (e) {}
  switchModule(MODULES[savedModule] ? savedModule : 'proshipping');
});

// Module Selection: show only the stages belonging to the selected module
function switchModule(moduleKey) {
  document.getElementById('moduleSelect').value = moduleKey;
  document.querySelectorAll('[data-module]').forEach(el => {
    el.hidden = el.dataset.module !== moduleKey;
  });
  document.getElementById('headerTitle').innerText = MODULES[moduleKey].title;
  document.getElementById('headerSubtitle').innerText = MODULES[moduleKey].subtitle;
  try { localStorage.setItem('rmg_module', moduleKey); } catch (e) {}
}

function loadSavedToken() {
  const savedToken = localStorage.getItem('rmg_entra_token');
  if (savedToken) {
    document.getElementById('tokenInput').value = savedToken;
  }
  const savedGhToken = localStorage.getItem('rmg_github_token');
  if (savedGhToken) {
    document.getElementById('cfgGithubToken').value = savedGhToken;
  }
}

// Fetch backend default config
async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      currentConfig = await res.json();
    }
  } catch (e) {
    console.error('Failed to fetch config', e);
  }
  // Settings saved in this browser win over server defaults, which reset on every server restart
  try {
    const saved = JSON.parse(localStorage.getItem('rmg_agent_config') || 'null');
    if (saved) currentConfig = { ...currentConfig, ...saved };
  } catch (e) {}
  updateConfigUI();
}

function updateConfigUI() {
  document.getElementById('agent1Label').innerText = `${currentConfig.agent1Name} v${currentConfig.agent1Version}`;
  document.getElementById('agent2Label').innerText = `${currentConfig.agent2Name} v${currentConfig.agent2Version}`;
  document.getElementById('cfgEndpoint').value = currentConfig.endpoint;
  document.getElementById('cfgAgent1Name').value = currentConfig.agent1Name;
  document.getElementById('cfgAgent1Version').value = currentConfig.agent1Version;
  document.getElementById('cfgAgent2Name').value = currentConfig.agent2Name;
  document.getElementById('cfgAgent2Version').value = currentConfig.agent2Version;
  document.getElementById('cossAgentLabel').innerText = `${currentConfig.cossAgentName} v${currentConfig.cossAgentVersion}`;
  document.getElementById('cfgCossAgentName').value = currentConfig.cossAgentName;
  document.getElementById('cfgCossAgentVersion').value = currentConfig.cossAgentVersion;
  document.getElementById('cfgGithubRepo').value = currentConfig.githubRepo || '';
  document.getElementById('cfgGithubBranch').value = currentConfig.githubBranch || '';
  document.getElementById('cfgGithubFilePath').value = currentConfig.githubFilePath || '';
}

function getToken() {
  const token = document.getElementById('tokenInput').value.trim();
  if (!token) {
    alert('Please enter your Entra ID Access Token in "Configure Credentials" first.');
    openConfigModal();
    return null;
  }
  return token;
}

// Config Modal Controls
function openConfigModal() {
  document.getElementById('configModal').classList.add('open');
}

function closeConfigModal() {
  document.getElementById('configModal').classList.remove('open');
}

async function saveConfigModal() {
  const tokenVal = document.getElementById('tokenInput').value.trim();
  if (tokenVal) {
    localStorage.setItem('rmg_entra_token', tokenVal);
  }
  const ghTokenVal = document.getElementById('cfgGithubToken').value.trim();
  if (ghTokenVal) {
    localStorage.setItem('rmg_github_token', ghTokenVal);
  }

  const newConfig = {
    endpoint: document.getElementById('cfgEndpoint').value.trim(),
    agent1Name: document.getElementById('cfgAgent1Name').value.trim(),
    agent1Version: document.getElementById('cfgAgent1Version').value.trim(),
    agent2Name: document.getElementById('cfgAgent2Name').value.trim(),
    agent2Version: document.getElementById('cfgAgent2Version').value.trim(),
    cossAgentName: document.getElementById('cfgCossAgentName').value.trim(),
    cossAgentVersion: document.getElementById('cfgCossAgentVersion').value.trim(),
    githubRepo: document.getElementById('cfgGithubRepo').value.trim(),
    githubBranch: document.getElementById('cfgGithubBranch').value.trim(),
    githubFilePath: document.getElementById('cfgGithubFilePath').value.trim()
  };

  // Drop blank fields so they fall back to defaults instead of overriding them
  Object.keys(newConfig).forEach(k => { if (!newConfig[k]) delete newConfig[k]; });
  try { localStorage.setItem('rmg_agent_config', JSON.stringify(newConfig)); } catch (e) {}

  currentConfig = { ...currentConfig, ...newConfig };
  updateConfigUI();
  closeConfigModal();

  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    });
  } catch (e) {
    console.error('Failed to sync config to server', e);
  }
}

// STAGE 1: Agent 1 Conversational Test Data Generator
async function sendAgent1Message() {
  const token = getToken();
  if (!token) return;

  const inputEl = document.getElementById('agent1ChatInput');
  const prompt = inputEl.value.trim();
  if (!prompt) return;

  inputEl.value = '';
  appendUserChatMessage('agent1ChatTimeline', prompt);
  appendAgentThinkingMessage('agent1ChatTimeline', 'A1');

  try {
    const res = await fetch('/api/agent1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        token: token,
        endpoint: currentConfig.endpoint,
        agentName: currentConfig.agent1Name,
        agentVersion: currentConfig.agent1Version
      })
    });

    removeThinkingMessage('agent1ChatTimeline');
    const data = await res.json();

    if (!res.ok || !data.success) {
      appendAgentChatMessage('agent1ChatTimeline', 'A1', '⚠️ Error from Agent 1: ' + (data.error || JSON.stringify(data)));
      return;
    }

    // Extract text output from response
    const agentOutput = extractOutputText(data.result);
    appendAgentChatMessage('agent1ChatTimeline', 'A1', agentOutput);

    // If fetchedCsvText is available from Azure Files API or in output text, render Human Review Panel
    const csvToRender = data.fetchedCsvText || agentOutput;
    renderHumanReviewPanel(csvToRender);
  } catch (e) {
    removeThinkingMessage('agent1ChatTimeline');
    appendAgentChatMessage('agent1ChatTimeline', 'A1', '⚠️ Failed to communicate with Agent 1: ' + e.message);
  }
}

function extractOutputText(resultObj) {
  if (resultObj && resultObj.output) {
    for (const item of resultObj.output) {
      if (item.type === 'message' && item.content) {
        for (const block of item.content) {
          if (block.type === 'output_text' && block.text) {
            return block.text;
          }
        }
      }
    }
  }
  return JSON.stringify(resultObj, null, 2);
}

// Render Human Review Panel
function renderHumanReviewPanel(textOutput) {
  const panel = document.getElementById('humanReviewPanel');

  let csvText = "";
  const match = textOutput.match(/```csv\r?\n([\s\S]*?)\r?\n```/) || textOutput.match(/```\r?\n([\s\S]*?)\r?\n```/);
  if (match) {
    csvText = match[1];
  } else if (textOutput.includes('Label Filename')) {
    csvText = textOutput;
  }

  if (!csvText || !csvText.includes('Label Filename')) return;

  panel.style.display = 'block';

  // Parse CSV lines cleanly
  const lines = csvText.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 3) return;

  // Enforce 71-column canonical format in client memory
  currentCSVData = lines.map(line => {
    return line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(cell => cell.replace(/^"|"$/g, ''));
  });

  // Build HTML table
  let html = '<table>';
  currentCSVData.forEach((row, rIdx) => {
    html += '<tr>';
    row.forEach((cell, cIdx) => {
      if (rIdx < 2) {
        html += `<th contenteditable="true" onblur="updateCSVCell(${rIdx}, ${cIdx}, this.innerText)">${escapeHtml(cell)}</th>`;
      } else {
        html += `<td contenteditable="true" onblur="updateCSVCell(${rIdx}, ${cIdx}, this.innerText)">${escapeHtml(cell)}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</table>';
  document.getElementById('tableWrapper').innerHTML = html;
  panel.scrollIntoView({ behavior: 'smooth' });
}

function updateCSVCell(r, c, val) {
  if (currentCSVData && currentCSVData[r]) {
    currentCSVData[r][c] = val;
  }
}

function loadPrevalidatedDummyData() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  const tomorrowStr = `${year}-${month}-${day}`;

  const dummyRawCSV = `Label Filename,Carrier Specifics,Carrier Specifics,Carrier Specifics,Carrier Specifics,Carrier Specifics,Destination,Destination,Destination,Destination,Destination,Destination,Destination,Destination,Destination,Destination,Destination,Destination,Destination,Items,Items,Items,Items,Items,Items,Items,Items,Packages,Packages,Packages,Packages,Packages,Packages,Return To Sender,Return To Sender,Return To Sender,Return To Sender,Return To Sender,Return To Sender,Return To Sender,Return To Sender,Return To Sender,Return To Sender,Return To Sender,Shipment Information,Shipment Information,Shipment Information,Shipment Information,Shipment Information,Shipment Information,Shipment Information,Shipment Information,Shipment Information,Shipment Information,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper,Shipper
Label Filename,ebayVtn,SMS Notifications,Email Notifications,Signature Required,Service Level,Company Name,Contact Name,Contact Email,Contact Phone,Address Line 1,Address Line 2,Address Line 3,Town,County,Postcode,Country Code,EORI Number,VAT Number,Country of Origin,Description,Package Occurrence,Quantity,SKU Code,Value,Weight,HS Code,Declared Weight,Height,Width,Length,Package Occurrence,Package Type,Company Name,Contact Name,Contact Email,Contact Phone,Address Line 1,Address Line 2,Address Line 3,Town,County,Postcode,Country Code,Action,Container Id,Content Type,Currency Code,Description of Goods,Label Format,Service Code,Shipment Date,Dimensions Unit of Measure,Weight Unit of Measure,Company Name,Contact Name,Contact Email,Contact Phone,Address Line 1,Address Line 2,Address Line 3,Town,County,Postcode,Country Code,Department Number,EORI Number,VAT Number,Shipping Account Id,Shipping Location Id,Reference 1
1 - {TRACKINGNUMBERS},,Y,Y,Y,01,,PFW Test1,pfwtest1@test.com,01142000000,39 Merefield,,,Chorley,Lancashire,PR7 1UP,GB,GB213456789000,GB213456789,GB,Items,1,1,SKU123,10.99,2,123456,2,2,20,10,1,Parcel,Royal Mail,Chris Hemmings Test Parcel,chris.m.hemmings@royalmail.com,01142000000,185 Farringdon Road,,,London,,EC1A 1AA,GB,Process,,NDX,GBP,Clothes,PDF,FEA,${tomorrowStr},CM,KG,Royal Mail,Chris Hemmings Test Parcel,chris.m.hemmings@royalmail.com,01142000000,185 Farringdon Road,,,London,,EC1A 1AA,GB,,GB213456789000,GB213456789,129238e9-845e-43dc-89d0-26874b7276ed,66b857cb-5425-472d-b08a-edfbc89ac46f,Safeplace
2 - {TRACKINGNUMBERS},,Y,Y,Y,01,,PFW Test2,pfwtest2@test.com,01142000000,1 Medlar Close,Wesham,,Preston,Lancashire,PR4 3EJ,GB,GB213456789000,GB213456789,GB,Items,1,1,SKU123,10.99,2,123456,2,2,20,10,1,Parcel,Royal Mail,Chris Hemmings Test Parcel,chris.m.hemmings@royalmail.com,01142000000,185 Farringdon Road,,,London,,EC1A 1AA,GB,Process,,NDX,GBP,Clothes,PDF,FEA,${tomorrowStr},CM,KG,Royal Mail,Chris Hemmings Test Parcel,chris.m.hemmings@royalmail.com,01142000000,185 Farringdon Road,,,London,,EC1A 1AA,GB,,GB213456789000,GB213456789,129238e9-845e-43dc-89d0-26874b7276ed,66b857cb-5425-472d-b08a-edfbc89ac46f,KnockLouder
3 - {TRACKINGNUMBERS},,Y,Y,Y,01,,PFW Test5,pfwtest5@test.com,01142000000,3 Medlar Close,Wesham,,Preston,Lancashire,PR4 3EJ,GB,GB213456789000,GB213456789,GB,Items,1,1,SKU123,10.99,2,123456,2,2,20,10,1,Parcel,Royal Mail,Chris Hemmings Test Parcel,chris.m.hemmings@royalmail.com,01142000000,185 Farringdon Road,,,London,,EC1A 1AA,GB,Process,,NDX,GBP,Clothes,PDF,FEA,${tomorrowStr},CM,KG,Royal Mail,Chris Hemmings Test Parcel,chris.m.hemmings@royalmail.com,01142000000,185 Farringdon Road,,,London,,EC1A 1AA,GB,,GB213456789000,GB213456789,129238e9-845e-43dc-89d0-26874b7276ed,66b857cb-5425-472d-b08a-edfbc89ac46f,MoreTimeRequired
4 - {TRACKINGNUMBERS},,Y,Y,Y,01,,PFW Test4,pfwtest4@test.com,01142000000,18 Ryder Crescent,,,Southport,Lancashire,PR8 3AE,GB,GB213456789000,GB213456789,GB,Items,1,1,SKU123,10.99,2,123456,2,2,20,10,1,Parcel,Royal Mail,Chris Hemmings Test Parcel,chris.m.hemmings@royalmail.com,01142000000,185 Farringdon Road,,,London,,EC1A 1AA,GB,Process,,NDX,GBP,Clothes,PDF,FEA,${tomorrowStr},CM,KG,Royal Mail,Chris Hemmings Test Parcel,chris.m.hemmings@royalmail.com,01142000000,185 Farringdon Road,,,London,,EC1A 1AA,GB,,GB213456789000,GB213456789,129238e9-845e-43dc-89d0-26874b7276ed,66b857cb-5425-472d-b08a-edfbc89ac46f,KnockLouder
5 - {TRACKINGNUMBERS},,Y,Y,Y,01,,PFW Test1,pfwtest1@test.com,01142000000,39 Merefield,,,Chorley,Lancashire,PR7 1UP,GB,GB213456789000,GB213456789,GB,Items,1,1,SKU123,10.99,2,123456,2,2,20,10,1,Parcel,Royal Mail,Chris Hemmings Test Parcel,chris.m.hemmings@royalmail.com,01142000000,185 Farringdon Road,,,London,,EC1A 1AA,GB,Process,,NDX,GBP,Clothes,PDF,M07,${tomorrowStr},CM,KG,Royal Mail,Chris Hemmings Test Parcel,chris.m.hemmings@royalmail.com,01142000000,185 Farringdon Road,,,London,,EC1A 1AA,GB,,GB213456789000,GB213456789,129238e9-845e-43dc-89d0-26874b7276ed,66b857cb-5425-472d-b08a-edfbc89ac46f,Safeplace`;

  const lines = dummyRawCSV.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  currentCSVData = lines.map(line => line.split(','));

  const panel = document.getElementById('humanReviewPanel');
  panel.style.display = 'block';

  let html = '<table>';
  currentCSVData.forEach((row, rIdx) => {
    html += '<tr>';
    row.forEach((cell, cIdx) => {
      if (rIdx < 2) {
        html += `<th contenteditable="true" onblur="updateCSVCell(${rIdx}, ${cIdx}, this.innerText)">${escapeHtml(cell)}</th>`;
      } else {
        html += `<td contenteditable="true" onblur="updateCSVCell(${rIdx}, ${cIdx}, this.innerText)">${escapeHtml(cell)}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</table>';
  document.getElementById('tableWrapper').innerHTML = html;
  panel.scrollIntoView({ behavior: 'smooth' });
}

function getFormattedCSVString() {
  if (!currentCSVData) return "";
  return currentCSVData.map(row => row.map(cell => {
    const str = String(cell || '').trim();
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }).join(',')).join('\n');
}

function exportCSVLocal() {
  const csvStr = getFormattedCSVString();
  if (!csvStr) return;
  const blob = new Blob([csvStr], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'proshipping_test_data.csv';
  a.click();
}

// COSS MODULE: single-stage COSS File Generation Agent (no ProShipper API / label stage)
let cossHistory = [];
let cossFiles = [];

async function sendCossMessage() {
  const token = getToken();
  if (!token) return;

  const inputEl = document.getElementById('cossChatInput');
  const prompt = inputEl.value.trim();
  if (!prompt) return;

  inputEl.value = '';
  appendUserChatMessage('cossChatTimeline', prompt);
  appendAgentThinkingMessage('cossChatTimeline', 'C');
  cossHistory.push({ role: 'user', content: prompt });

  try {
    const res = await fetch('/api/coss/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        history: cossHistory,
        token: token,
        endpoint: currentConfig.endpoint,
        agentName: currentConfig.cossAgentName,
        agentVersion: currentConfig.cossAgentVersion
      })
    });

    removeThinkingMessage('cossChatTimeline');
    const data = await res.json();

    if (!res.ok || !data.success) {
      cossHistory.pop();
      renderUserFriendlyErrorCard('cossChatTimeline', 'C', data.error ? `${data.error}\n${JSON.stringify(data.details || '', null, 2)}` : JSON.stringify(data));
      return;
    }

    const agentOutput = extractOutputText(data.result);
    cossHistory.push({ role: 'assistant', content: agentOutput });
    appendAgentChatMessage('cossChatTimeline', 'C', agentOutput);

    let files = data.files || [];
    // Fall back to an inline COSS CSV (fenced block or raw "00"... header line) when no file was attached
    if (!files.length) {
      const inline = extractInlineCossCsv(agentOutput);
      if (inline) files = [{ filename: `COSS_${Date.now()}.csv`, content: inline }];
    }
    if (files.length) {
      renderCossReviewPanel(files);
    } else if ((data.missingFiles || []).length) {
      appendAgentChatMessage('cossChatTimeline', 'C', `⚠️ The agent generated ${data.missingFiles.join(', ')}, but the file could not be downloaded from the agent's container. Check the server logs ([CONTAINER FILE FETCH]) for the HTTP status.`);
    }
  } catch (e) {
    removeThinkingMessage('cossChatTimeline');
    cossHistory.pop();
    renderUserFriendlyErrorCard('cossChatTimeline', 'C', 'Network or Server Communication Failure: ' + e.message);
  }
}

function resetCossConversation() {
  cossHistory = [];
  cossFiles = [];
  document.getElementById('cossReviewPanel').style.display = 'none';
  appendAgentChatMessage('cossChatTimeline', 'C', 'Started a new conversation. Previous context has been cleared.');
}

// COSS record types as seen in the PreAdvice file layout (first field of each row)
const COSS_RECORD_TYPES = {
  '00': 'Header',
  '01': 'Sender',
  '02': 'Consignment',
  '03': 'Contact',
  '06': 'Customs',
  '07': 'Item',
  '09': 'Trailer'
};

let cossView = 'table';

function isCossCsv(text) {
  return /^\s*"?00"?,/.test(text || '');
}

function extractInlineCossCsv(text) {
  const fenced = text.match(/```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n```/);
  if (fenced && isCossCsv(fenced[1])) return fenced[1].trim();
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => isCossCsv(l));
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^\s*"?09"?,/.test(l));
  return lines.slice(start, end === -1 ? undefined : end + 1).join('\n').trim();
}

// Quote-aware CSV parser; COSS rows have a variable number of fields per record type
function parseCossCsv(text) {
  return String(text || '').split(/\r?\n/).filter(l => l.trim().length > 0).map(line => {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  });
}

// Every field is double-quoted, matching the COSS sample output
function serializeCossCsv(rows) {
  return rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
}

function getSelectedCossFile() {
  return cossFiles[document.getElementById('cossFileSelect').value || 0];
}

function renderCossReviewPanel(files) {
  // Server already prefers COSS files; keep that preference for inline fallbacks too
  const cossOnly = files.filter(f => isCossCsv(f.content));
  cossFiles = (cossOnly.length ? cossOnly : files).map(f => ({
    filename: /\.csv$/i.test(f.filename) ? f.filename : f.filename.replace(/\.[^.]*$/, '') + '.csv',
    rows: parseCossCsv(f.content)
  }));
  const select = document.getElementById('cossFileSelect');
  select.innerHTML = cossFiles.map((f, i) => `<option value="${i}">${escapeHtml(f.filename)}</option>`).join('');
  select.style.display = cossFiles.length > 1 ? '' : 'none';
  showCossFile(0);
  const panel = document.getElementById('cossReviewPanel');
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });
}

function showCossFile(index) {
  const file = cossFiles[index];
  if (!file) return;
  document.getElementById('cossFileSelect').value = index;
  renderCossTable(file);
  document.getElementById('cossFileContent').value = serializeCossCsv(file.rows);
  updateCossSummary(file);
}

function renderCossTable(file) {
  const maxCols = Math.max(...file.rows.map(r => r.length));
  let html = '<table><tr><th>Record</th>';
  for (let c = 1; c <= maxCols; c++) html += `<th>${c}</th>`;
  html += '</tr>';
  file.rows.forEach((row, rIdx) => {
    const label = COSS_RECORD_TYPES[row[0]] || 'Unknown';
    html += `<tr><th style="white-space:nowrap;">${escapeHtml(row[0])} · ${label}</th>`;
    for (let c = 0; c < maxCols; c++) {
      if (c < row.length) {
        html += `<td contenteditable="true" onblur="updateCossCell(${rIdx}, ${c}, this.innerText)">${escapeHtml(row[c])}</td>`;
      } else {
        html += '<td style="background:#f1f5f9;"></td>';
      }
    }
    html += '</tr>';
  });
  html += '</table>';
  document.getElementById('cossTableWrapper').innerHTML = html;
}

function updateCossSummary(file) {
  const counts = {};
  file.rows.forEach(r => { counts[r[0]] = (counts[r[0]] || 0) + 1; });
  const summary = Object.entries(counts).map(([t, n]) => `${t} ${COSS_RECORD_TYPES[t] || 'Unknown'}: ${n}`).join(' • ');
  document.getElementById('cossSummary').innerText = `${file.rows.length} records • ${summary}`;
}

function updateCossCell(r, c, val) {
  const file = getSelectedCossFile();
  if (file && file.rows[r]) {
    file.rows[r][c] = val;
    document.getElementById('cossFileContent').value = serializeCossCsv(file.rows);
  }
}

function updateCossFileContent(val) {
  const file = getSelectedCossFile();
  if (file) file.rows = parseCossCsv(val);
}

function setCossView(view) {
  cossView = view;
  const file = getSelectedCossFile();
  if (view === 'table' && file) {
    renderCossTable(file);
    updateCossSummary(file);
  }
  document.getElementById('cossTableWrapper').style.display = view === 'table' ? '' : 'none';
  document.getElementById('cossFileContent').style.display = view === 'raw' ? '' : 'none';
  document.getElementById('cossViewTableBtn').classList.toggle('btn-secondary', view !== 'table');
  document.getElementById('cossViewRawBtn').classList.toggle('btn-secondary', view !== 'raw');
}

// e.g. COSSW705_PreAdvice3_20261103.csv (local date at download time)
function getCossDownloadFilename() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `COSSW705_PreAdvice3_${stamp}.csv`;
}

function downloadCossFile() {
  const file = getSelectedCossFile();
  if (!file) return;
  const blob = new Blob([serializeCossCsv(file.rows)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = getCossDownloadFilename();
  a.click();
  URL.revokeObjectURL(url);
}

let agent2History = [];

// STAGE 2: Agent 2 Handoff & Conversational Panel
async function approveAndSendToAgent2() {
  const token = getToken();
  if (!token) return;

  const csvContent = getFormattedCSVString();
  if (!csvContent) {
    alert('No CSV content available to send.');
    return;
  }

  // Force reset history array so old 140-column strings are never resent
  agent2History = []; 
  appendUserChatMessage('chatTimeline', `Approved CSV test data. Sending to Agent 2 to replace ${githubTargetLabel()}...`);

  // Scroll to Stage 2
  scrollToStage(2);

  await triggerAgent2Call({ csvContent: csvContent });
}

async function sendAgent2Message() {
  const input = document.getElementById('agent2ChatInput');
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  appendUserChatMessage('chatTimeline', msg);
  await triggerAgent2Call({ message: msg });
}

// Handle direct local CSV file upload to Agent 2
async function handleDirectCSVUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();
  appendUserChatMessage('chatTimeline', `📁 Uploaded CSV file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  await triggerAgent2Call({ csvContent: text });
  event.target.value = '';
}

async function sendCheckNowMessage() {
  appendUserChatMessage('chatTimeline', 'check now');
  await triggerAgent2Call({ message: 'check now' });
}

async function triggerAgent2Call(payloadObj) {
  const token = getToken();
  if (!token) return;

  appendAgentThinkingMessage('chatTimeline', 'A2');

  // Push user message to history
  if (payloadObj.csvContent) {
    agent2History.push({ role: 'user', content: payloadObj.csvContent });
  } else if (payloadObj.message) {
    agent2History.push({ role: 'user', content: payloadObj.message });
  }

  const ghToken = localStorage.getItem('rmg_github_token') || '';

  try {
    const res = await fetch('/api/agent2/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        githubToken: ghToken,
        endpoint: currentConfig.endpoint,
        agentName: currentConfig.agent2Name,
        agentVersion: currentConfig.agent2Version,
        githubRepo: currentConfig.githubRepo,
        githubBranch: currentConfig.githubBranch,
        githubFilePath: currentConfig.githubFilePath,
        history: agent2History,
        ...payloadObj
      })
    });

    const data = await res.json();
    removeThinkingMessage('chatTimeline');
    if (data.githubCommit) renderGithubCommitStatus(data.githubCommit);

    if (!res.ok || !data.success) {
      const errorContent = data.error || JSON.stringify(data);
      renderUserFriendlyErrorCard('chatTimeline', 'A2', errorContent);
      return;
    }

    const agentText = extractOutputText(data.result);
    // Push assistant response to history
    agent2History.push({ role: 'assistant', content: agentText });

    // Check if assistant text indicates execution failure
    if (agentText.toLowerCase().includes('execution failed') || agentText.toLowerCase().includes('error invoking')) {
      renderUserFriendlyErrorCard('chatTimeline', 'A2', agentText);
    } else {
      appendAgentChatMessage('chatTimeline', 'A2', agentText);
    }
  } catch (e) {
    removeThinkingMessage('chatTimeline');
    renderUserFriendlyErrorCard('chatTimeline', 'A2', 'Network or Server Communication Failure: ' + e.message);
  }
}

function githubTargetLabel() {
  const path = currentConfig.githubFilePath || 'src/input.csv';
  const branch = currentConfig.githubBranch || 'feat/proshipping';
  const repo = currentConfig.githubRepo || 'royalmail/devops-ms-foundry-setup';
  return `${path} on ${branch} (${repo})`;
}

// Shows whether the backend committed the approved CSV to GitHub, which is what triggers the pipeline
function renderGithubCommitStatus(commit) {
  const timeline = document.getElementById('chatTimeline');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message agent';
  const target = `${escapeHtml(commit.path)} on ${escapeHtml(commit.branch)} in ${escapeHtml(commit.repo)}`;
  const styles = {
    committed: 'background:#ecfdf5; border:1px solid #10b981; color:#065f46;',
    failed: 'background:#fff1f2; border:1px solid #fecdd3; color:#9f1239;',
    skipped: 'background:#fffbeb; border:1px solid #f59e0b; color:#92400e;'
  };
  let body;
  if (commit.status === 'committed') {
    const link = commit.url ? ` <a href="${escapeHtml(commit.url)}" target="_blank">View commit ${escapeHtml(commit.sha.slice(0, 7))}</a>` : '';
    body = `✅ <strong>GitHub commit done:</strong> ${target}.${link}`;
  } else if (commit.status === 'failed') {
    body = `⚠️ <strong>GitHub commit failed:</strong> ${target}.<br>${escapeHtml(commit.error || '')}`;
  } else {
    body = `ℹ️ <strong>GitHub commit skipped:</strong> ${escapeHtml(commit.error || '')} Add a GitHub token in "Configure Credentials" to commit directly.`;
  }
  msgDiv.innerHTML = `
    <div class="avatar agent-avatar">GH</div>
    <div class="message-body" style="${styles[commit.status] || styles.skipped} padding:12px 16px; border-radius:8px; font-size:0.85rem;">${body}</div>
  `;
  timeline.appendChild(msgDiv);
  timeline.scrollTop = timeline.scrollHeight;
}

// User-Friendly Error Analysis Card Helper
function renderUserFriendlyErrorCard(timelineId, avatarLabel, rawErrorText) {
  const timeline = document.getElementById(timelineId);
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message agent';

  let title = "Agent Execution Error";
  let explanation = "An error occurred while communicating with Azure AI Foundry or GitHub.";
  let recommendedContact = "Azure DevOps Pipeline Developer / System Administrator";
  let actionSuggestion = "Please inspect the downloadable error log for details.";

  const errLower = String(rawErrorText).toLowerCase();

  if (errLower.includes('522') || errLower.includes('preprod.proshipping.net') || errLower.includes('connect/token')) {
    title = "ProShipping Preprod Auth Endpoint Timeout (HTTP 522)";
    explanation = "The Azure DevOps pipeline attempted to call https://authentication.preprod.proshipping.net/connect/token, but the ProShipping preprod server timed out or was unreachable.";
    recommendedContact = "Azure DevOps Pipeline Developer / Network Admin";
    actionSuggestion = "Verify if preprod.proshipping.net is online and accessible from self-hosted ADO runner IPs.";
  } else if (errLower.includes('403') || errLower.includes('forbidden') || errLower.includes('unauthorized')) {
    title = "Azure Entra ID Access Token Expired (HTTP 403)";
    explanation = "Your Azure Entra ID access token has expired (Azure tokens expire every 60–90 minutes).";
    recommendedContact = "User (Self-Service Fix)";
    actionSuggestion = "Click 'Configure Credentials' (top right), generate a new token via `az account get-access-token`, paste it, and save.";
  } else if (errLower.includes('sha mismatch') || errLower.includes('stale')) {
    title = "GitHub Commit SHA Mismatch";
    explanation = `The file ${githubTargetLabel()} was modified while Agent 2 was attempting to commit.`;
    recommendedContact = "GitHub Repository Maintainer / User";
    actionSuggestion = "Click 'Check Now' again or re-upload the CSV file. The backend will fetch the updated SHA automatically.";
  } else if (errLower.includes('424') || errLower.includes('failed dependency')) {
    title = "Azure AI Agent MCP Plugin Timeout (HTTP 424)";
    explanation = "Azure AI Foundry's GitHub MCP plugin execution timed out or experienced connection drops.";
    recommendedContact = "Azure AI Foundry Administrator";
    actionSuggestion = "Retry the operation shortly or re-upload the CSV file.";
  }

  // Create downloadable plain text file blob
  const logContent = `==================================================\nROYAL MAIL PROSHIPPER APP - ERROR DIAGNOSTIC LOG\n==================================================\nTimestamp: ${new Date().toLocaleString()}\nError Title: ${title}\nExplanation: ${explanation}\nRecommended Contact: ${recommendedContact}\nAction Required: ${actionSuggestion}\n\n------------------- RAW LOG DETAILS -------------------\n${rawErrorText}\n==================================================`;
  
  const blob = new Blob([logContent], { type: 'text/plain' });
  const downloadUrl = URL.createObjectURL(blob);

  msgDiv.innerHTML = `
    <div class="avatar agent-avatar">${avatarLabel}</div>
    <div class="message-body" style="background:#fff1f2; border:1px solid #fecdd3; padding:16px; border-radius:12px; width:100%;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <span style="font-size:1.1rem;">⚠️</span>
        <strong style="color:#9f1239; font-size:0.95rem;">${escapeHtml(title)}</strong>
      </div>
      
      <p style="font-size:0.85rem; color:#881337; margin-bottom:10px; line-height:1.4;">
        ${escapeHtml(explanation)}
      </p>

      <div style="background:#ffffff; border:1px solid #ffe4e6; padding:10px 12px; border-radius:8px; margin-bottom:12px; font-size:0.82rem; color:#4c0519;">
        <strong>👤 Who to Contact:</strong> <span style="color:#be123c; font-weight:600;">${escapeHtml(recommendedContact)}</span><br>
        <strong style="display:inline-block; margin-top:4px;">💡 Action Required:</strong> ${escapeHtml(actionSuggestion)}
      </div>

      <div style="display:flex; gap:10px; align-items:center;">
        <a href="${downloadUrl}" download="Agent2_Error_Log_${Date.now()}.txt" class="btn" style="background:#be123c; color:white; padding:6px 14px; font-size:0.8rem; text-decoration:none; border-radius:6px; display:inline-flex; align-items:center; gap:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download Error Log (.txt)
        </a>
      </div>
    </div>
  `;
  timeline.appendChild(msgDiv);
  timeline.scrollTop = timeline.scrollHeight;
}

// Generic Timeline Helpers
function appendUserChatMessage(timelineId, text) {
  const timeline = document.getElementById(timelineId);
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message user';
  msgDiv.innerHTML = `
    <div class="avatar user-avatar">You</div>
    <div class="message-body">${escapeHtml(text)}</div>
  `;
  timeline.appendChild(msgDiv);
  timeline.scrollTop = timeline.scrollHeight;
}

function appendAgentChatMessage(timelineId, avatarLabel, text) {
  const timeline = document.getElementById(timelineId);
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message agent';

  let formattedText = escapeHtml(text);
  
  // Interactive Check Now Button
  let checkNowBox = "";
  if (text.toLowerCase().includes('check now') || text.toLowerCase().includes('wait 2 minutes')) {
    checkNowBox = `
      <div class="action-box">
        <div>
          <strong style="color:var(--text-light); font-size:0.85rem;">Pipeline Status Verification Required</strong>
          <p style="font-size:0.8rem; color:var(--text-muted);">Click below to verify if ADO pipeline has completed generating PDF labels.</p>
        </div>
        <button class="check-now-btn" onclick="triggerCheckNowAction(this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Check Now
        </button>
      </div>
    `;
  }

  // ADO Artifact ZIP Link
  let artifactBox = "";
  const zipMatch = text.match(/(https:\/\/dev\.azure\.com\/[^\s]+format=zip)/i) || text.match(/(https:\/\/[^\s]+artifacts[^\s]+)/i);
  if (zipMatch) {
    artifactBox = `
      <div class="action-box" style="background:#ecfdf5; border:1px solid #10b981;">
        <div>
          <strong style="color:#065f46; font-size:0.9rem;">Shipping Labels Ready! (.zip)</strong>
          <p style="font-size:0.8rem; color:#047857;">Artifact 'drop' contains generated PDF labels.</p>
        </div>
        <a href="${zipMatch[1]}" target="_blank" class="btn btn-success" style="padding:6px 12px; font-size:0.8rem; text-decoration:none;">
          Download PDF Labels ZIP
        </a>
      </div>
    `;
  }

  msgDiv.innerHTML = `
    <div class="avatar agent-avatar">${avatarLabel}</div>
    <div class="message-body">
      <div>${formattedText.replace(/\n/g, '<br>')}</div>
      ${checkNowBox}
      ${artifactBox}
    </div>
  `;
  timeline.appendChild(msgDiv);
  timeline.scrollTop = timeline.scrollHeight;
}

function triggerCheckNowAction(btnEl) {
  if (btnEl) btnEl.disabled = true;
  appendUserChatMessage('chatTimeline', "check now");
  triggerAgent2Call({ message: "check now" });
}

let thinkingInterval = null;
let thinkingSeconds = 0;

function appendAgentThinkingMessage(timelineId, avatarLabel) {
  removeThinkingMessage(timelineId);
  const timeline = document.getElementById(timelineId);
  const msgDiv = document.createElement('div');
  msgDiv.id = `${timelineId}-thinking`;
  msgDiv.className = 'chat-message agent';
  
  thinkingSeconds = 0;
  msgDiv.innerHTML = `
    <div class="avatar agent-avatar">${avatarLabel}</div>
    <div class="message-body" style="background:#f8fafc; border:1px dashed #94a3b8; padding:12px 16px; border-radius:8px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="spinner" style="display:inline-block; width:14px; height:14px; border:2px solid #2563eb; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite;"></span>
        <strong style="color:var(--text-main); font-size:0.85rem;" id="${timelineId}-timer-text">Agent ${avatarLabel} Working... (0s)</strong>
      </div>
      <p style="margin:4px 0 0 22px; font-size:0.8rem; color:#475569;" id="${timelineId}-step-text">🔍 Validating CSV headers against schema...</p>
    </div>
  `;
  timeline.appendChild(msgDiv);
  timeline.scrollTop = timeline.scrollHeight;

  clearInterval(thinkingInterval);
  thinkingInterval = setInterval(() => {
    thinkingSeconds++;
    const timerText = document.getElementById(`${timelineId}-timer-text`);
    const stepText = document.getElementById(`${timelineId}-step-text`);
    if (timerText) {
      timerText.innerText = `Agent ${avatarLabel} Working... (${thinkingSeconds}s)`;
    }
    if (stepText) {
      if (avatarLabel === 'C') {
        if (thinkingSeconds < 5) {
          stepText.innerText = '🔍 Parsing prompt & configuring COSS file parameters...';
        } else if (thinkingSeconds < 20) {
          stepText.innerText = '⚡ Generating COSS file records...';
        } else {
          stepText.innerText = '✨ Formatting output & preparing file for review...';
        }
      } else if (avatarLabel === 'A1') {
        if (thinkingSeconds < 5) {
          stepText.innerText = '🔍 Parsing prompt & configuring shipment parameters...';
        } else if (thinkingSeconds < 15) {
          stepText.innerText = '⚡ Running Python ProShipping data engine...';
        } else if (thinkingSeconds < 30) {
          stepText.innerText = '📋 Generating 140-column CSV & resolving GB postcodes...';
        } else {
          stepText.innerText = '✨ Formatting output & preparing Human Review table...';
        }
      } else {
        if (thinkingSeconds < 5) {
          stepText.innerText = '🔍 Validating CSV headers against schema...';
        } else if (thinkingSeconds < 15) {
          stepText.innerText = `📁 Fetching current SHA & committing ${githubTargetLabel()}...`;
        } else if (thinkingSeconds < 40) {
          stepText.innerText = '⚙️ Polling Azure DevOps Pipeline run status...';
        } else {
          stepText.innerText = '📦 Finalizing shipping label artifacts & PDF links...';
        }
      }
    }
  }, 1000);
}

function removeThinkingMessage(timelineId) {
  clearInterval(thinkingInterval);
  const el = document.getElementById(`${timelineId}-thinking`);
  if (el) el.remove();
}

function scrollToStage(stageNum) {
  const el = document.getElementById(`stage${stageNum}`);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
