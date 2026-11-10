import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { DefaultAzureCredential } from '@azure/identity';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

let credential = null;
async function getOrFetchToken(userToken) {
  if (userToken && userToken.trim()) {
    return userToken.startsWith('Bearer ') ? userToken.slice(7).trim() : userToken.trim();
  }
  try {
    if (!credential) {
      credential = new DefaultAzureCredential();
    }
    const tokenObj = await credential.getToken("https://ai.azure.com/.default");
    console.log(`[Managed Identity Token Acquired] Valid until: ${new Date(tokenObj.expiresOnTimestamp).toLocaleTimeString()}`);
    return tokenObj.token;
  } catch (err) {
    console.error(`[Managed Identity Auth Fallback Error]`, err.message);
    return null;
  }
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const CANONICAL_71_ROW1 = '"Label Filename","Carrier Specifics","Carrier Specifics","Carrier Specifics","Carrier Specifics","Carrier Specifics","Destination","Destination","Destination","Destination","Destination","Destination","Destination","Destination","Destination","Destination","Destination","Destination","Destination","Items","Items","Items","Items","Items","Items","Items","Items","Packages","Packages","Packages","Packages","Packages","Packages","Return To Sender","Return To Sender","Return To Sender","Return To Sender","Return To Sender","Return To Sender","Return To Sender","Return To Sender","Return To Sender","Return To Sender","Return To Sender","Shipment Information","Shipment Information","Shipment Information","Shipment Information","Shipment Information","Shipment Information","Shipment Information","Shipment Information","Shipment Information","Shipment Information","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper","Shipper"';
const CANONICAL_71_ROW2 = '"Label Filename","ebayVtn","SMS Notifications","Email Notifications","Signature Required","Service Level","Company Name","Contact Name","Contact Email","Contact Phone","Address Line 1","Address Line 2","Address Line 3","Town","County","Postcode","Country Code","EORI Number","VAT Number","Country of Origin","Description","Package Occurrence","Quantity","SKU Code","Value","Weight","HS Code","Declared Weight","Height","Width","Length","Package Occurrence","Package Type","Company Name","Contact Name","Contact Email","Contact Phone","Address Line 1","Address Line 2","Address Line 3","Town","County","Postcode","Country Code","Action","Container Id","Content Type","Currency Code","Description of Goods","Label Format","Service Code","Shipment Date","Dimensions Unit of Measure","Weight Unit of Measure","Company Name","Contact Name","Contact Email","Contact Phone","Address Line 1","Address Line 2","Address Line 3","Town","County","Postcode","Country Code","Department Number","EORI Number","VAT Number","Shipping Account Id","Shipping Location Id","Reference 1"';

function parseCsvLine(line) {
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
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells.map(c => {
    if (c.startsWith('"') && c.endsWith('"')) {
      return c.slice(1, -1).replace(/""/g, '"');
    }
    return c;
  });
}

function formatCsvCell(val) {
  if (val === undefined || val === null) return '""';
  const str = String(val).trim();
  if (str.startsWith('"') && str.endsWith('"')) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

function stripDoubleQuotesFromCsv(csvContent) {
  if (!csvContent || typeof csvContent !== 'string') return csvContent;
  const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 3) return csvContent;

  const row1Cells = parseCsvLine(lines[0]);
  const row2Cells = parseCsvLine(lines[1]);

  // Find column indices for SMS and Email Notifications under Carrier Specifics
  let smsIdx = -1;
  let emailIdx = -1;
  for (let i = 0; i < Math.max(row1Cells.length, row2Cells.length); i++) {
    const field = (row2Cells[i] || '').replace(/^"|"$/g, '').trim();
    if (field === 'SMS Notifications') smsIdx = i;
    if (field === 'Email Notifications') emailIdx = i;
  }

  return lines.map((line, rIdx) => {
    const cells = parseCsvLine(line);
    const processed = cells.map(cell => {
      let trimmed = (cell || '').trim();
      // Convert DD/MM/YYYY dates to ISO YYYY-MM-DD format required by createLabels.py
      const ukDateMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (ukDateMatch) {
        const day = ukDateMatch[1].padStart(2, '0');
        const month = ukDateMatch[2].padStart(2, '0');
        const year = ukDateMatch[3];
        trimmed = `${year}-${month}-${day}`;
      }
      return trimmed;
    });

    // For data rows (index >= 2), inject mandatory 'Y' flags for SMS and Email notifications if blank
    if (rIdx >= 2) {
      if (smsIdx !== -1 && (!processed[smsIdx] || processed[smsIdx] === '""')) processed[smsIdx] = 'Y';
      if (emailIdx !== -1 && (!processed[emailIdx] || processed[emailIdx] === '""')) processed[emailIdx] = 'Y';
    }

    return processed.map(val => {
      if (val.includes(',') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',');
  }).join('\n');
}

function normalizeTo71ColumnCsv(csvContent) {
  // Strip double quotes without altering column count or structure
  return stripDoubleQuotesFromCsv(csvContent);
}

// DEFAULT AGENT CONFIGURATIONS
let DEFAULT_CONFIG = {
  endpoint: "https://rmg-asc-etp-ssp-c-aifoundry02.services.ai.azure.com/api/projects/rmg-asc-ai-test-transformation-project01",
  agent1Name: "proshipper-csv-generation-RN",
  agent1Version: "5",
  agent2Name: "test-proshipperapi-call",
  agent2Version: "21",
  cossAgentName: "COSS-File-Generation-Agent",
  cossAgentVersion: "1",
  // Stage 2 commit target; the ADO pipeline is triggered by commits to this file
  githubRepo: process.env.GITHUB_REPO || "royalmail/devops-ms-foundry-setup",
  githubBranch: process.env.GITHUB_BRANCH || "feat/proshipping",
  githubFilePath: process.env.GITHUB_FILE_PATH || "src/input.csv"
};

// App Service health check probe (Terraform health_check_path)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Return current runtime config
app.get('/api/config', (req, res) => {
  return res.json(DEFAULT_CONFIG);
});

// Update runtime config
app.post('/api/config', (req, res) => {
  const { endpoint, agent1Name, agent1Version, agent2Name, agent2Version, cossAgentName, cossAgentVersion, githubRepo, githubBranch, githubFilePath } = req.body;
  if (endpoint) DEFAULT_CONFIG.endpoint = endpoint;
  if (agent1Name) DEFAULT_CONFIG.agent1Name = agent1Name;
  if (agent1Version) DEFAULT_CONFIG.agent1Version = String(agent1Version);
  if (agent2Name) DEFAULT_CONFIG.agent2Name = agent2Name;
  if (agent2Version) DEFAULT_CONFIG.agent2Version = String(agent2Version);
  if (cossAgentName) DEFAULT_CONFIG.cossAgentName = cossAgentName;
  if (cossAgentVersion) DEFAULT_CONFIG.cossAgentVersion = String(cossAgentVersion);
  if (githubRepo) DEFAULT_CONFIG.githubRepo = githubRepo;
  if (githubBranch) DEFAULT_CONFIG.githubBranch = githubBranch;
  if (githubFilePath) DEFAULT_CONFIG.githubFilePath = githubFilePath;
  return res.json({ success: true, config: DEFAULT_CONFIG });
});

// Generic Azure AI Foundry Responses Protocol Handler
async function callFoundryAgent({ endpoint, token, agentName, agentVersion, inputMessages, threadId }) {
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const cleanEndpoint = endpoint.trim();

  const targetUrl = `${cleanEndpoint}/agents/${agentName}/endpoint/protocols/openai/responses?api-version=v1`;

  const payload = {
    input: typeof inputMessages === 'string' ? [{ role: "user", content: inputMessages }] : inputMessages,
    agent_reference: {
      name: agentName,
      version: String(agentVersion),
      type: "agent_reference"
    }
  };

  // Single-turn or multi-turn input messages are passed inside payload.input array

  console.log(`[AGENT CALL] POST ${targetUrl} (Agent: ${agentName}, Version: ${agentVersion})`);
  console.log(`[AGENT PAYLOAD]`, JSON.stringify(payload));

  // Configure extended timeout (5 minutes) and Connection: close to prevent ECONNRESET
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cleanToken}`,
      'Content-Type': 'application/json',
      'Connection': 'close'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(300000)
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = { rawText: text };
  }
  console.log(`[AGENT RESPONSE] Status: ${response.status} (ok: ${response.ok})`, JSON.stringify(data).slice(0, 300));
  return { status: response.status, ok: response.ok, data };
}

// Retry wrapper around callFoundryAgent with automatic SHA mismatch resolution
async function callFoundryAgentWithRetry(params, retries = 3) {
  let currentParams = { ...params };
  const githubTarget = params.githubTarget || defaultGithubTarget();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await callFoundryAgent(currentParams);

      // Check if response contains SHA mismatch error with live SHA
      const resStr = JSON.stringify(res.data || {});
      const shaMatch = resStr.match(/Current file SHA is ([a-f0-9]{40})/i);

      if (shaMatch && shaMatch[1] && attempt < retries) {
        const correctSha = shaMatch[1];
        console.warn(`[SERVER SHA AUTO-FIX] Intercepted SHA mismatch! Extracted live SHA: ${correctSha}. Retrying attempt ${attempt + 1}/${retries}...`);
        
        const { path: ghPath, branch: ghBranch } = githubTarget;
        const shaHint = `\n\n[MANDATORY GITHUB SHA PARAMETER: The exact current file SHA for ${ghPath} on ${ghBranch} is "${correctSha}". You MUST pass sha: "${correctSha}", path: "${ghPath}", and branch: "${ghBranch}" when invoking create_or_update_file.]`;

        if (typeof currentParams.inputMessages === 'string') {
          currentParams.inputMessages += shaHint;
        } else if (Array.isArray(currentParams.inputMessages)) {
          const lastIndex = currentParams.inputMessages.length - 1;
          if (currentParams.inputMessages[lastIndex]) {
            currentParams.inputMessages[lastIndex].content += shaHint;
          }
        }
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      return res;
    } catch (err) {
      console.warn(`[AGENT CALL RETRY] Attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

// Helper to download generated file content from Azure Files API
async function fetchFileContentFromAzure({ endpoint, token, fileId }) {
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const cleanEndpoint = endpoint.trim();
  const fileUrl = `${cleanEndpoint}/files/${fileId}/content?api-version=v1`;
  console.log(`[FILES API FETCH] Downloading file ${fileId} from ${fileUrl}`);
  try {
    const response = await fetch(fileUrl, {
      headers: { 'Authorization': `Bearer ${cleanToken}` },
      signal: AbortSignal.timeout(30000)
    });
    if (response.ok) {
      const text = await response.text();
      console.log(`[FILES API FETCH SUCCESS] Downloaded ${text.length} bytes`);
      return text;
    }
  } catch (err) {
    console.error(`[FILES API FETCH ERR]`, err);
  }
  return null;
}

// ROUTE 1: Call Agent 1 (Test Data Generation Agent)
app.post('/api/agent1/generate', async (req, res) => {
  const { prompt, token, endpoint, agentName, agentVersion } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  const authToken = await getOrFetchToken(token);
  if (!authToken) {
    return res.status(401).json({ error: 'Authentication failed. Please provide an Access Token or assign Managed Identity.' });
  }

  try {
    const targetEndpoint = endpoint || DEFAULT_CONFIG.endpoint;
    const targetName = agentName || DEFAULT_CONFIG.agent1Name;
    const targetVersion = agentVersion || DEFAULT_CONFIG.agent1Version;

    const result = await callFoundryAgentWithRetry({
      endpoint: targetEndpoint,
      token: authToken,
      agentName: targetName,
      agentVersion: targetVersion,
      inputMessages: prompt
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: 'Agent 1 Execution Failed', details: result.data });
    }

    // Inspect result for generated file_id attachments or annotations (file- or assistant- prefix)
    let fetchedCsvText = null;
    const resultStr = JSON.stringify(result.data);
    const fileIdMatch = resultStr.match(/(assistant-[A-Za-z0-9_-]+|file-[A-Za-z0-9_-]+|cfile-[A-Za-z0-9_-]+)/g);

    if (fileIdMatch && fileIdMatch.length > 0) {
      // Reverse array so newly created output files from Code Interpreter are checked first
      const uniqueFileIds = [...new Set(fileIdMatch)].reverse();
      console.log(`[Agent 1 Output File IDs Found (Reversed)]`, uniqueFileIds);
      for (const fid of uniqueFileIds) {
        const fileContent = await fetchFileContentFromAzure({
          endpoint: targetEndpoint,
          token: authToken,
          fileId: fid
        });
        if (fileContent) {
          const lines = fileContent.split(/\r?\n/);
          const firstTwoLines = (lines[0] || '') + (lines[1] || '');
          if (firstTwoLines.includes('Label Filename') && (firstTwoLines.includes('Carrier Specifics') || firstTwoLines.includes('ebayVtn') || firstTwoLines.includes('SMS Notifications'))) {
            console.log(`[Agent 1 Valid CSV File Downloaded] ${fid} (${fileContent.length} bytes)`);
            fetchedCsvText = normalizeTo71ColumnCsv(fileContent);
            break;
          }
        }
      }
    }

function extractTextFromAgentResult(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (data.output) {
    if (Array.isArray(data.output)) {
      return data.output.map(o => o.text || (o.content && typeof o.content === 'string' ? o.content : '') || '').join('\n');
    }
    if (data.output.text) return data.output.text;
  }
  return JSON.stringify(data);
}

// Extract inline CSV text if file fetch wasn't available
    if (!fetchedCsvText && result.data) {
      const extractedText = extractTextFromAgentResult(result.data);
      if (extractedText && extractedText.includes('Label Filename')) {
        fetchedCsvText = normalizeTo71ColumnCsv(extractedText);
      }
    }

    return res.json({ success: true, result: result.data, fetchedCsvText: fetchedCsvText });
  } catch (err) {
    console.error(`[Agent 1 Exception]`, err);
    return res.status(500).json({ error: err.message });
  }
});

// Upload CSV file helper for Agent 2 Code Interpreter attachment
async function uploadCsvFileToAzure({ endpoint, token, csvContent, filename = "input.csv" }) {
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const cleanEndpoint = endpoint.trim();

  const filesUrl = `${cleanEndpoint}/files?api-version=v1`;
  console.log(`[FILES API] Uploading ${filename} to ${filesUrl}`);

  const formData = new FormData();
  const fileBlob = new Blob([csvContent], { type: 'text/csv' });
  formData.append('purpose', 'assistants');
  formData.append('file', fileBlob, filename);

  const response = await fetch(filesUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cleanToken}`
    },
    body: formData,
    signal: AbortSignal.timeout(60000)
  });

  const data = await response.json().catch(() => null);
  console.log(`[FILES API RESPONSE] Status: ${response.status}`, data);
  if (response.ok && data && data.id) {
    return data.id;
  }
  return null;
}

function defaultGithubTarget() {
  return { repo: DEFAULT_CONFIG.githubRepo, branch: DEFAULT_CONFIG.githubBranch, path: DEFAULT_CONFIG.githubFilePath };
}

function resolveGithubTarget(body) {
  return {
    repo: (body.githubRepo || DEFAULT_CONFIG.githubRepo).trim().replace(/^\/+|\/+$/g, ''),
    branch: (body.githubBranch || DEFAULT_CONFIG.githubBranch).trim(),
    path: (body.githubFilePath || DEFAULT_CONFIG.githubFilePath).trim().replace(/^\/+|\/+$/g, '')
  };
}

function githubContentsUrl(target) {
  return `https://api.github.com/repos/${target.repo}/contents/${target.path.split('/').map(encodeURIComponent).join('/')}`;
}

function githubHeaders(ghToken) {
  const headers = { 'User-Agent': 'RoyalMail-ProShipper-App', 'Accept': 'application/vnd.github.v3+json' };
  if (ghToken) headers['Authorization'] = `Bearer ${ghToken}`;
  return headers;
}

function resolveGithubToken(githubToken) {
  return githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

// Helper to fetch live file SHA from GitHub (authenticated when a token is available, so private repos work)
async function fetchGithubCurrentSha(target, ghToken) {
  try {
    const res = await fetch(`${githubContentsUrl(target)}?ref=${encodeURIComponent(target.branch)}`, {
      headers: githubHeaders(ghToken)
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`[GitHub SHA Fetch Success] Live ${target.path} SHA: ${data.sha}`);
      return data.sha;
    }
    console.log(`[GitHub SHA Fetch] Status: ${res.status} for ${target.repo}@${target.branch}:${target.path}`);
  } catch (err) {
    console.error(`[GitHub SHA Fetch Err]`, err.message);
  }
  return null;
}

const GITHUB_ERROR_HINTS = {
  401: 'GitHub token is invalid or expired.',
  403: 'GitHub token does not have write access to this repository (needs Contents: Read and write).',
  404: 'Repository or branch not found, or the token cannot see this repository.',
  409: 'File changed while committing (SHA conflict). Please retry.',
  422: 'GitHub rejected the commit; check that the branch exists.'
};

// Returns the commit outcome so the UI can show it: status is committed, failed or skipped
async function commitCsvDirectToGithub({ csvContent, githubToken, target }) {
  const result = { status: 'skipped', ...target };
  const ghToken = resolveGithubToken(githubToken);
  if (!ghToken) {
    return { ...result, error: 'No GitHub token provided; Agent 2 will attempt the commit through its own GitHub connection.' };
  }

  try {
    const currentSha = await fetchGithubCurrentSha(target, ghToken);
    const base64Content = Buffer.from(csvContent, 'utf-8').toString('base64');

    const putRes = await fetch(githubContentsUrl(target), {
      method: 'PUT',
      headers: { ...githubHeaders(ghToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `chore: replace ${target.path} from user upload (via Royal Mail App)`,
        content: base64Content,
        branch: target.branch,
        sha: currentSha
      })
    });

    if (putRes.ok) {
      const putData = await putRes.json();
      console.log(`[DIRECT GITHUB COMMIT SUCCESS] Commit SHA: ${putData.commit.sha}`);
      return { ...result, status: 'committed', sha: putData.commit.sha, url: putData.commit.html_url };
    }
    const errText = await putRes.text();
    console.warn(`[DIRECT GITHUB COMMIT ERR] Status: ${putRes.status}`, errText);
    let ghMessage = errText.slice(0, 200);
    try { ghMessage = JSON.parse(errText).message || ''; } catch (e) {}
    const hint = GITHUB_ERROR_HINTS[putRes.status] || 'GitHub commit failed.';
    return { ...result, status: 'failed', error: `HTTP ${putRes.status}: ${hint} (${ghMessage})` };
  } catch (err) {
    console.error(`[DIRECT GITHUB COMMIT EXCEPTION]`, err.message);
    return { ...result, status: 'failed', error: err.message };
  }
}

// ROUTE 2: Call Agent 2 (ProShipper API & ADO Pipeline Agent)
app.post('/api/agent2/chat', async (req, res) => {
  const { message, csvContent, history, token, githubToken, endpoint, agentName, agentVersion, threadId } = req.body;

  const authToken = await getOrFetchToken(token);
  if (!authToken) {
    return res.status(401).json({ error: 'Authentication failed. Please provide an Access Token or assign Managed Identity.' });
  }

  try {
    const targetEndpoint = endpoint || DEFAULT_CONFIG.endpoint;
    const targetName = agentName || DEFAULT_CONFIG.agent2Name;
    const targetVersion = agentVersion || DEFAULT_CONFIG.agent2Version;

    let normalizedCsv = csvContent ? normalizeTo71ColumnCsv(csvContent) : null;
    const githubTarget = resolveGithubTarget(req.body);
    const { repo: ghRepo, branch: ghBranch, path: ghPath } = githubTarget;

    let githubCommit = null;
    let directCommitSha = null;
    if (normalizedCsv) {
      githubCommit = await commitCsvDirectToGithub({ csvContent: normalizedCsv, githubToken, target: githubTarget });
      directCommitSha = githubCommit.sha || null;
    }

    // Pre-fetch live GitHub SHA to guarantee 100% commit precision
    const liveSha = await fetchGithubCurrentSha(githubTarget, resolveGithubToken(githubToken));
    const shaPromptHint = liveSha
      ? `\n\n[MANDATORY GITHUB COMMIT INSTRUCTION: You MUST pass the EXACT full 71-column CSV text above as the 'content' argument when calling create_or_update_file. Do NOT modify, truncate, or leave 'content' empty. Pass sha: "${liveSha}", repository: "${ghRepo}", path: "${ghPath}", and branch: "${ghBranch}".]`
      : "";

    let inputMessages;
    let uploadedFileId = null;

    if (directCommitSha) {
      inputMessages = `Replaced ${ghPath} in ${ghRepo} on ${ghBranch} via direct backend commit. Commit: ${directCommitSha.slice(0, 7)}. Please poll the Azure DevOps pipeline for definition 10516 on ${ghBranch}.`;
    } else if (history && history.length > 0) {
      // Send history cleanly without mutating content
      inputMessages = history.map((h, index) => {
        let content = h.content;
        if (index === history.length - 1 && h.role === 'user' && shaPromptHint) {
          content += shaPromptHint;
        }
        return { role: h.role, content: content };
      });
    } else if (normalizedCsv) {
      // 1. Upload CSV to Azure Files API
      uploadedFileId = await uploadCsvFileToAzure({
        endpoint: targetEndpoint,
        token: authToken,
        csvContent: normalizedCsv,
        filename: "input.csv"
      });

      console.log(`[Agent 2] Uploaded File ID: ${uploadedFileId}`);
      inputMessages = normalizedCsv + shaPromptHint;
    } else {
      inputMessages = (message || "check now") + shaPromptHint;
    }

    const result = await callFoundryAgentWithRetry({
      endpoint: targetEndpoint,
      token: authToken,
      agentName: targetName,
      agentVersion: targetVersion,
      inputMessages: inputMessages,
      githubTarget
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: 'Agent 2 Execution Failed', details: result.data, githubCommit });
    }

    const threadIdReturned = (result.data && (result.data.thread_id || result.data.id)) || threadId;
    console.log(`[Agent 2 Thread ID] ${threadIdReturned}`);

    return res.json({
      success: true,
      fileId: uploadedFileId,
      threadId: threadIdReturned,
      result: result.data,
      githubCommit
    });
  } catch (err) {
    console.error(`[Agent 2 Exception]`, err);
    return res.status(500).json({ error: err.message });
  }
});

// Collect only the files the agent produced in its reply (container_file_citation / file_path annotations
// on output messages). The response also echoes the agent's own input files (templates, rules) in its
// tool configuration, so the payload must not be scanned wholesale for file ids.
function collectCossOutputFiles(data) {
  const found = new Map();
  const output = Array.isArray(data && data.output) ? data.output : [];
  for (const item of output) {
    if (!item || item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      for (const ann of (part && part.annotations) || []) {
        if (!ann || typeof ann.file_id !== 'string') continue;
        if (ann.type !== 'container_file_citation' && ann.type !== 'file_path') continue;
        if (!found.has(ann.file_id)) {
          found.set(ann.file_id, { filename: ann.filename || null, containerId: ann.container_id || null });
        }
      }
    }
  }
  return found;
}

// Code interpreter output files live in the agent's container, not in the project Files store
async function fetchContainerFileContent({ endpoint, token, agentName, containerId, fileId }) {
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
  const filePath = `containers/${encodeURIComponent(containerId)}/files/${encodeURIComponent(fileId)}/content`;
  const candidates = [
    `${cleanEndpoint}/openai/v1/${filePath}`,
    `${cleanEndpoint}/agents/${agentName}/endpoint/protocols/openai/${filePath}?api-version=v1`,
    `${cleanEndpoint}/${filePath}?api-version=v1`
  ];
  for (const url of candidates) {
    try {
      console.log(`[CONTAINER FILE FETCH] Downloading ${fileId} from ${url}`);
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${cleanToken}` },
        signal: AbortSignal.timeout(30000)
      });
      if (response.ok) {
        const text = await response.text();
        console.log(`[CONTAINER FILE FETCH SUCCESS] Downloaded ${text.length} bytes`);
        return text;
      }
      console.warn(`[CONTAINER FILE FETCH] HTTP ${response.status} from ${url}`);
    } catch (err) {
      console.error(`[CONTAINER FILE FETCH ERR] ${url}`, err.message);
    }
  }
  return null;
}

// ROUTE 3: Call COSS File Generation Agent (single stage, no ProShipper API / label step)
app.post('/api/coss/generate', async (req, res) => {
  const { prompt, history, token, endpoint, agentName, agentVersion } = req.body;

  if (!prompt && !(history && history.length)) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  const authToken = await getOrFetchToken(token);
  if (!authToken) {
    return res.status(401).json({ error: 'Authentication failed. Please provide an Access Token or assign Managed Identity.' });
  }

  try {
    const targetEndpoint = endpoint || DEFAULT_CONFIG.endpoint;
    const targetName = agentName || DEFAULT_CONFIG.cossAgentName;
    const targetVersion = agentVersion || DEFAULT_CONFIG.cossAgentVersion;

    const inputMessages = history && history.length
      ? history.map(h => ({ role: h.role, content: h.content }))
      : prompt;

    const result = await callFoundryAgentWithRetry({
      endpoint: targetEndpoint,
      token: authToken,
      agentName: targetName,
      agentVersion: targetVersion,
      inputMessages
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: 'COSS Agent Execution Failed', details: result.data });
    }

    // Only files the agent attached to its reply count as output; turns where it is still asking for
    // barcode details carry none, so no file is shown until the agent has actually generated one
    const fileMap = collectCossOutputFiles(result.data);

    let files = [];
    const missingFiles = [];
    for (const [fid, { filename, containerId }] of fileMap) {
      const content = containerId
        ? await fetchContainerFileContent({ endpoint: targetEndpoint, token: authToken, agentName: targetName, containerId, fileId: fid })
        : await fetchFileContentFromAzure({ endpoint: targetEndpoint, token: authToken, fileId: fid });
      if (content) {
        files.push({ fileId: fid, filename: filename || `COSS_${fid}.csv`, content });
      } else {
        missingFiles.push(filename || fid);
      }
    }

    // COSS CSV files start with the "00" header record; drop unrelated attachments when one is present
    const cossFiles = files.filter(f => /^\s*"?00"?,/.test(f.content));
    if (cossFiles.length) files = cossFiles;

    // The same generated file is often referenced under several file ids; keep one copy per distinct content
    const seenContent = new Set();
    files = files.filter(f => {
      const key = f.content.replace(/\r\n/g, '\n').trim();
      if (seenContent.has(key)) return false;
      seenContent.add(key);
      return true;
    });
    console.log(`[COSS Agent] Downloaded ${files.length} output file(s) (${cossFiles.length} COSS CSV), ${missingFiles.length} not downloadable`);

    return res.json({ success: true, result: result.data, files, missingFiles });
  } catch (err) {
    console.error(`[COSS Agent Exception]`, err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Royal Mail ProShipper App running at http://localhost:${PORT}`);
});
