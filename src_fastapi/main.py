"""Royal Mail ProShipping Dual Agent Test Data & Label Generator + COSS File Generation (FastAPI).

Python port of src/server.js. Routes and request/response shapes are unchanged so the
existing frontend in public/ works as-is.

Run locally:   python main.py                      (PORT env var, default 3000)
App Service:   gunicorn -k uvicorn.workers.UvicornWorker --bind=0.0.0.0:$PORT main:app
"""

import asyncio
import base64
import json
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import httpx
from azure.identity import DefaultAzureCredential
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", 3000))

app = FastAPI(title="Royal Mail ProShipper App")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

credential = None


def strip_bearer(token):
    token = token.strip()
    return token[7:].strip() if token.startswith("Bearer ") else token


async def get_or_fetch_token(user_token):
    global credential
    if user_token and user_token.strip():
        return strip_bearer(user_token)
    try:
        if credential is None:
            credential = DefaultAzureCredential()
        token_obj = await asyncio.to_thread(credential.get_token, "https://ai.azure.com/.default")
        valid_until = datetime.fromtimestamp(token_obj.expires_on).strftime("%H:%M:%S")
        print(f"[Managed Identity Token Acquired] Valid until: {valid_until}", flush=True)
        return token_obj.token
    except Exception as err:
        print(f"[Managed Identity Auth Fallback Error] {err}", flush=True)
        return None


def to_json(data):
    # Compact form, matching JSON.stringify, so regex scans see the same text as the Node version
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def parse_csv_line(line):
    cells = []
    current = ""
    in_quotes = False
    i = 0
    while i < len(line):
        char = line[i]
        if char == '"':
            if in_quotes and i + 1 < len(line) and line[i + 1] == '"':
                current += '"'
                i += 1
            else:
                in_quotes = not in_quotes
        elif char == "," and not in_quotes:
            cells.append(current.strip())
            current = ""
        else:
            current += char
        i += 1
    cells.append(current.strip())
    return [c[1:-1].replace('""', '"') if c.startswith('"') and c.endswith('"') else c for c in cells]


UK_DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", re.ASCII)


def strip_double_quotes_from_csv(csv_content):
    if not csv_content or not isinstance(csv_content, str):
        return csv_content
    lines = [l.strip() for l in re.split(r"\r?\n", csv_content)]
    lines = [l for l in lines if l]
    if len(lines) < 3:
        return csv_content

    row1_cells = parse_csv_line(lines[0])
    row2_cells = parse_csv_line(lines[1])

    # Find column indices for SMS and Email Notifications under Carrier Specifics
    sms_idx = -1
    email_idx = -1
    for i in range(max(len(row1_cells), len(row2_cells))):
        field = re.sub(r'^"|"$', "", row2_cells[i] if i < len(row2_cells) else "").strip()
        if field == "SMS Notifications":
            sms_idx = i
        if field == "Email Notifications":
            email_idx = i

    out_lines = []
    for r_idx, line in enumerate(lines):
        processed = []
        for cell in parse_csv_line(line):
            trimmed = (cell or "").strip()
            # Convert DD/MM/YYYY dates to ISO YYYY-MM-DD format required by createLabels.py
            uk_date = UK_DATE_RE.match(trimmed)
            if uk_date:
                trimmed = f"{uk_date.group(3)}-{uk_date.group(2).zfill(2)}-{uk_date.group(1).zfill(2)}"
            processed.append(trimmed)

        # For data rows (index >= 2), inject mandatory 'Y' flags for SMS and Email notifications if blank
        if r_idx >= 2:
            for idx in (sms_idx, email_idx):
                if idx != -1 and idx < len(processed) and (not processed[idx] or processed[idx] == '""'):
                    processed[idx] = "Y"

        out_lines.append(",".join(
            '"' + val.replace('"', '""') + '"' if ("," in val or "\n" in val) else val
            for val in processed
        ))
    return "\n".join(out_lines)


def normalize_to_71_column_csv(csv_content):
    # Strip double quotes without altering column count or structure
    return strip_double_quotes_from_csv(csv_content)


# DEFAULT AGENT CONFIGURATIONS
DEFAULT_CONFIG = {
    "endpoint": "https://rmg-asc-etp-ssp-c-aifoundry02.services.ai.azure.com/api/projects/rmg-asc-ai-test-transformation-project01",
    "agent1Name": "proshipper-csv-generation-RN",
    "agent1Version": "5",
    "agent2Name": "test-proshipperapi-call",
    "agent2Version": "21",
    "cossAgentName": "COSS-File-Generation-Agent",
    "cossAgentVersion": "1",
    # Stage 2 commit target; the ADO pipeline is triggered by commits to this file
    "githubRepo": os.environ.get("GITHUB_REPO", "royalmail/devops-ms-foundry-setup"),
    "githubBranch": os.environ.get("GITHUB_BRANCH", "feat/proshipping"),
    "githubFilePath": os.environ.get("GITHUB_FILE_PATH", "src/input.csv"),
}


async def read_body(request):
    try:
        body = await request.json()
        return body if isinstance(body, dict) else {}
    except Exception:
        return {}


@app.get("/health")
async def health():
    return {"status": "ok"}


# Return current runtime config
@app.get("/api/config")
async def get_config():
    return DEFAULT_CONFIG


# Update runtime config
@app.post("/api/config")
async def update_config(request: Request):
    body = await read_body(request)
    for key in ("endpoint", "agent1Name", "agent2Name", "cossAgentName", "githubRepo", "githubBranch", "githubFilePath"):
        if body.get(key):
            DEFAULT_CONFIG[key] = body[key]
    for key in ("agent1Version", "agent2Version", "cossAgentVersion"):
        if body.get(key):
            DEFAULT_CONFIG[key] = str(body[key])
    return {"success": True, "config": DEFAULT_CONFIG}


# Generic Azure AI Foundry Responses Protocol Handler
async def call_foundry_agent(endpoint, token, agent_name, agent_version, input_messages):
    clean_token = strip_bearer(token)
    clean_endpoint = endpoint.strip()

    target_url = f"{clean_endpoint}/agents/{agent_name}/endpoint/protocols/openai/responses?api-version=v1"

    payload = {
        "input": [{"role": "user", "content": input_messages}] if isinstance(input_messages, str) else input_messages,
        "agent_reference": {
            "name": agent_name,
            "version": str(agent_version),
            "type": "agent_reference",
        },
    }

    print(f"[AGENT CALL] POST {target_url} (Agent: {agent_name}, Version: {agent_version})", flush=True)
    print(f"[AGENT PAYLOAD] {to_json(payload)}", flush=True)

    # Extended timeout (5 minutes) and Connection: close to prevent ECONNRESET
    async with httpx.AsyncClient(timeout=300) as client:
        response = await client.post(
            target_url,
            headers={
                "Authorization": f"Bearer {clean_token}",
                "Content-Type": "application/json",
                "Connection": "close",
            },
            content=to_json(payload),
        )

    text = response.text
    try:
        data = json.loads(text)
    except ValueError:
        data = {"rawText": text}
    print(f"[AGENT RESPONSE] Status: {response.status_code} (ok: {response.is_success}) {to_json(data)[:300]}", flush=True)
    return {"status": response.status_code, "ok": response.is_success, "data": data}


SHA_MISMATCH_RE = re.compile(r"Current file SHA is ([a-f0-9]{40})", re.IGNORECASE)


# Retry wrapper around call_foundry_agent with automatic SHA mismatch resolution
async def call_foundry_agent_with_retry(params, retries=3):
    current = dict(params)
    github_target = current.pop("github_target", None) or default_github_target()
    if isinstance(current["input_messages"], list):
        current["input_messages"] = [dict(m) for m in current["input_messages"]]

    for attempt in range(1, retries + 1):
        try:
            res = await call_foundry_agent(**current)

            # Check if response contains SHA mismatch error with live SHA
            sha_match = SHA_MISMATCH_RE.search(to_json(res["data"] or {}))
            if sha_match and attempt < retries:
                correct_sha = sha_match.group(1)
                print(f"[SERVER SHA AUTO-FIX] Intercepted SHA mismatch! Extracted live SHA: {correct_sha}. Retrying attempt {attempt + 1}/{retries}...", flush=True)

                path, branch = github_target["path"], github_target["branch"]
                sha_hint = f'\n\n[MANDATORY GITHUB SHA PARAMETER: The exact current file SHA for {path} on {branch} is "{correct_sha}". You MUST pass sha: "{correct_sha}", path: "{path}", and branch: "{branch}" when invoking create_or_update_file.]'

                if isinstance(current["input_messages"], str):
                    current["input_messages"] += sha_hint
                elif current["input_messages"]:
                    current["input_messages"][-1]["content"] += sha_hint
                await asyncio.sleep(1)
                continue

            return res
        except Exception as err:
            print(f"[AGENT CALL RETRY] Attempt {attempt}/{retries} failed: {err!r}", flush=True)
            if attempt == retries:
                raise
            await asyncio.sleep(1.5)


# Helper to download generated file content from Azure Files API
async def fetch_file_content_from_azure(endpoint, token, file_id):
    clean_token = strip_bearer(token)
    file_url = f"{endpoint.strip()}/files/{file_id}/content?api-version=v1"
    print(f"[FILES API FETCH] Downloading file {file_id} from {file_url}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(file_url, headers={"Authorization": f"Bearer {clean_token}"})
        if response.is_success:
            text = response.text
            print(f"[FILES API FETCH SUCCESS] Downloaded {len(text)} bytes", flush=True)
            return text
    except Exception as err:
        print(f"[FILES API FETCH ERR] {err!r}", flush=True)
    return None


def extract_text_from_agent_result(data):
    if not data:
        return ""
    if isinstance(data, str):
        return data
    output = data.get("output") if isinstance(data, dict) else None
    if output:
        if isinstance(output, list):
            return "\n".join(
                (o.get("text") or (o.get("content") if isinstance(o.get("content"), str) else "") or "")
                if isinstance(o, dict) else ""
                for o in output
            )
        if isinstance(output, dict) and output.get("text"):
            return output["text"]
    return to_json(data)


AGENT1_FILE_ID_RE = re.compile(r"(assistant-[A-Za-z0-9_-]+|file-[A-Za-z0-9_-]+|cfile-[A-Za-z0-9_-]+)")


# ROUTE 1: Call Agent 1 (Test Data Generation Agent)
@app.post("/api/agent1/generate")
async def agent1_generate(request: Request):
    body = await read_body(request)
    prompt = body.get("prompt")

    if not prompt:
        return JSONResponse(status_code=400, content={"error": "Prompt is required."})

    auth_token = await get_or_fetch_token(body.get("token"))
    if not auth_token:
        return JSONResponse(status_code=401, content={"error": "Authentication failed. Please provide an Access Token or assign Managed Identity."})

    try:
        target_endpoint = body.get("endpoint") or DEFAULT_CONFIG["endpoint"]
        target_name = body.get("agentName") or DEFAULT_CONFIG["agent1Name"]
        target_version = body.get("agentVersion") or DEFAULT_CONFIG["agent1Version"]

        result = await call_foundry_agent_with_retry({
            "endpoint": target_endpoint,
            "token": auth_token,
            "agent_name": target_name,
            "agent_version": target_version,
            "input_messages": prompt,
        })

        if not result["ok"]:
            return JSONResponse(status_code=result["status"], content={"error": "Agent 1 Execution Failed", "details": result["data"]})

        # Inspect result for generated file_id attachments or annotations (file- or assistant- prefix)
        fetched_csv_text = None
        file_id_matches = AGENT1_FILE_ID_RE.findall(to_json(result["data"]))

        if file_id_matches:
            # Reverse so newly created output files from Code Interpreter are checked first
            unique_file_ids = list(dict.fromkeys(file_id_matches))[::-1]
            print(f"[Agent 1 Output File IDs Found (Reversed)] {unique_file_ids}", flush=True)
            for fid in unique_file_ids:
                file_content = await fetch_file_content_from_azure(target_endpoint, auth_token, fid)
                if file_content:
                    lines = re.split(r"\r?\n", file_content)
                    first_two_lines = (lines[0] if lines else "") + (lines[1] if len(lines) > 1 else "")
                    if "Label Filename" in first_two_lines and ("Carrier Specifics" in first_two_lines or "ebayVtn" in first_two_lines or "SMS Notifications" in first_two_lines):
                        print(f"[Agent 1 Valid CSV File Downloaded] {fid} ({len(file_content)} bytes)", flush=True)
                        fetched_csv_text = normalize_to_71_column_csv(file_content)
                        break

        # Extract inline CSV text if file fetch wasn't available
        if not fetched_csv_text and result["data"]:
            extracted_text = extract_text_from_agent_result(result["data"])
            if extracted_text and "Label Filename" in extracted_text:
                fetched_csv_text = normalize_to_71_column_csv(extracted_text)

        return {"success": True, "result": result["data"], "fetchedCsvText": fetched_csv_text}
    except Exception as err:
        print(f"[Agent 1 Exception] {err!r}", flush=True)
        return JSONResponse(status_code=500, content={"error": str(err)})


# Upload CSV file helper for Agent 2 Code Interpreter attachment
async def upload_csv_file_to_azure(endpoint, token, csv_content, filename="input.csv"):
    clean_token = strip_bearer(token)
    files_url = f"{endpoint.strip()}/files?api-version=v1"
    print(f"[FILES API] Uploading {filename} to {files_url}", flush=True)

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            files_url,
            headers={"Authorization": f"Bearer {clean_token}"},
            data={"purpose": "assistants"},
            files={"file": (filename, csv_content.encode("utf-8"), "text/csv")},
        )

    try:
        data = response.json()
    except ValueError:
        data = None
    print(f"[FILES API RESPONSE] Status: {response.status_code} {data}", flush=True)
    if response.is_success and data and data.get("id"):
        return data["id"]
    return None


def default_github_target():
    return {"repo": DEFAULT_CONFIG["githubRepo"], "branch": DEFAULT_CONFIG["githubBranch"], "path": DEFAULT_CONFIG["githubFilePath"]}


def resolve_github_target(body):
    return {
        "repo": (body.get("githubRepo") or DEFAULT_CONFIG["githubRepo"]).strip().strip("/"),
        "branch": (body.get("githubBranch") or DEFAULT_CONFIG["githubBranch"]).strip(),
        "path": (body.get("githubFilePath") or DEFAULT_CONFIG["githubFilePath"]).strip().strip("/"),
    }


def github_contents_url(target):
    return f"https://api.github.com/repos/{target['repo']}/contents/{quote(target['path'])}"


def github_headers(gh_token=None):
    headers = {"User-Agent": "RoyalMail-ProShipper-App", "Accept": "application/vnd.github.v3+json"}
    if gh_token:
        headers["Authorization"] = f"Bearer {gh_token}"
    return headers


def resolve_github_token(github_token):
    return github_token or os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")


# Helper to fetch live file SHA from GitHub (authenticated when a token is available, so private repos work)
async def fetch_github_current_sha(target, gh_token=None):
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.get(github_contents_url(target), params={"ref": target["branch"]}, headers=github_headers(gh_token))
        if res.is_success:
            sha = res.json().get("sha")
            print(f"[GitHub SHA Fetch Success] Live {target['path']} SHA: {sha}", flush=True)
            return sha
        print(f"[GitHub SHA Fetch] Status: {res.status_code} for {target['repo']}@{target['branch']}:{target['path']}", flush=True)
    except Exception as err:
        print(f"[GitHub SHA Fetch Err] {err}", flush=True)
    return None


GITHUB_ERROR_HINTS = {
    401: "GitHub token is invalid or expired.",
    403: "GitHub token does not have write access to this repository (needs Contents: Read and write).",
    404: "Repository or branch not found, or the token cannot see this repository.",
    409: "File changed while committing (SHA conflict). Please retry.",
    422: "GitHub rejected the commit; check that the branch exists.",
}


# Returns the commit outcome so the UI can show it: status is committed, failed or skipped
async def commit_csv_direct_to_github(csv_content, github_token, target):
    result = {"status": "skipped", **target}
    gh_token = resolve_github_token(github_token)
    if not gh_token:
        result["error"] = "No GitHub token provided; Agent 2 will attempt the commit through its own GitHub connection."
        return result

    try:
        current_sha = await fetch_github_current_sha(target, gh_token)
        async with httpx.AsyncClient(timeout=60) as client:
            put_res = await client.put(
                github_contents_url(target),
                headers={**github_headers(gh_token), "Content-Type": "application/json"},
                content=json.dumps({
                    "message": f"chore: replace {target['path']} from user upload (via Royal Mail App)",
                    "content": base64.b64encode(csv_content.encode("utf-8")).decode("ascii"),
                    "branch": target["branch"],
                    "sha": current_sha,
                }),
            )

        if put_res.is_success:
            commit = put_res.json()["commit"]
            print(f"[DIRECT GITHUB COMMIT SUCCESS] Commit SHA: {commit['sha']}", flush=True)
            return {**result, "status": "committed", "sha": commit["sha"], "url": commit.get("html_url")}
        print(f"[DIRECT GITHUB COMMIT ERR] Status: {put_res.status_code} {put_res.text}", flush=True)
        try:
            gh_message = put_res.json().get("message", "")
        except ValueError:
            gh_message = put_res.text[:200]
        hint = GITHUB_ERROR_HINTS.get(put_res.status_code, "GitHub commit failed.")
        return {**result, "status": "failed", "error": f"HTTP {put_res.status_code}: {hint} ({gh_message})"}
    except Exception as err:
        print(f"[DIRECT GITHUB COMMIT EXCEPTION] {err}", flush=True)
        return {**result, "status": "failed", "error": str(err)}


# ROUTE 2: Call Agent 2 (ProShipper API & ADO Pipeline Agent)
@app.post("/api/agent2/chat")
async def agent2_chat(request: Request):
    body = await read_body(request)
    message = body.get("message")
    csv_content = body.get("csvContent")
    history = body.get("history")

    auth_token = await get_or_fetch_token(body.get("token"))
    if not auth_token:
        return JSONResponse(status_code=401, content={"error": "Authentication failed. Please provide an Access Token or assign Managed Identity."})

    try:
        target_endpoint = body.get("endpoint") or DEFAULT_CONFIG["endpoint"]
        target_name = body.get("agentName") or DEFAULT_CONFIG["agent2Name"]
        target_version = body.get("agentVersion") or DEFAULT_CONFIG["agent2Version"]

        normalized_csv = normalize_to_71_column_csv(csv_content) if csv_content else None
        github_target = resolve_github_target(body)
        repo, branch, path = github_target["repo"], github_target["branch"], github_target["path"]

        github_commit = None
        direct_commit_sha = None
        if normalized_csv:
            github_commit = await commit_csv_direct_to_github(normalized_csv, body.get("githubToken"), github_target)
            direct_commit_sha = github_commit.get("sha")

        # Pre-fetch live GitHub SHA to guarantee commit precision
        live_sha = await fetch_github_current_sha(github_target, resolve_github_token(body.get("githubToken")))
        sha_prompt_hint = (
            f"\n\n[MANDATORY GITHUB COMMIT INSTRUCTION: You MUST pass the EXACT full 71-column CSV text above as the 'content' argument when calling create_or_update_file. Do NOT modify, truncate, or leave 'content' empty. Pass sha: \"{live_sha}\", repository: \"{repo}\", path: \"{path}\", and branch: \"{branch}\".]"
            if live_sha else ""
        )

        uploaded_file_id = None

        if direct_commit_sha:
            input_messages = f"Replaced {path} in {repo} on {branch} via direct backend commit. Commit: {direct_commit_sha[:7]}. Please poll the Azure DevOps pipeline for definition 10516 on {branch}."
        elif history:
            # Send history cleanly without mutating content
            input_messages = []
            for index, h in enumerate(history):
                content = h.get("content")
                if index == len(history) - 1 and h.get("role") == "user" and sha_prompt_hint:
                    content = f"{content}{sha_prompt_hint}"
                input_messages.append({"role": h.get("role"), "content": content})
        elif normalized_csv:
            # Upload CSV to Azure Files API
            uploaded_file_id = await upload_csv_file_to_azure(target_endpoint, auth_token, normalized_csv, "input.csv")
            print(f"[Agent 2] Uploaded File ID: {uploaded_file_id}", flush=True)
            input_messages = normalized_csv + sha_prompt_hint
        else:
            input_messages = (message or "check now") + sha_prompt_hint

        result = await call_foundry_agent_with_retry({
            "endpoint": target_endpoint,
            "token": auth_token,
            "agent_name": target_name,
            "agent_version": target_version,
            "input_messages": input_messages,
            "github_target": github_target,
        })

        if not result["ok"]:
            return JSONResponse(status_code=result["status"], content={"error": "Agent 2 Execution Failed", "details": result["data"], "githubCommit": github_commit})

        data = result["data"] if isinstance(result["data"], dict) else {}
        thread_id_returned = (data.get("thread_id") or data.get("id")) or body.get("threadId")
        print(f"[Agent 2 Thread ID] {thread_id_returned}", flush=True)

        return {
            "success": True,
            "fileId": uploaded_file_id,
            "threadId": thread_id_returned,
            "result": result["data"],
            "githubCommit": github_commit,
        }
    except Exception as err:
        print(f"[Agent 2 Exception] {err!r}", flush=True)
        return JSONResponse(status_code=500, content={"error": str(err)})


# Collect only the files the agent produced in its reply (container_file_citation / file_path annotations
# on output messages). The response also echoes the agent's own input files (templates, rules) in its
# tool configuration, so the payload must not be scanned wholesale for file ids.
def collect_coss_output_files(data):
    found = {}
    output = data.get("output") if isinstance(data, dict) else None
    for item in output if isinstance(output, list) else []:
        if not isinstance(item, dict) or item.get("type") != "message" or not isinstance(item.get("content"), list):
            continue
        for part in item["content"]:
            for ann in (part.get("annotations") if isinstance(part, dict) else None) or []:
                if not isinstance(ann, dict) or not isinstance(ann.get("file_id"), str):
                    continue
                if ann.get("type") not in ("container_file_citation", "file_path"):
                    continue
                found.setdefault(ann["file_id"], {"filename": ann.get("filename") or None, "container_id": ann.get("container_id") or None})
    return found


# Code interpreter output files live in the agent's container, not in the project Files store
async def fetch_container_file_content(endpoint, token, agent_name, container_id, file_id):
    clean_token = strip_bearer(token)
    clean_endpoint = endpoint.strip().rstrip("/")
    file_path = f"containers/{quote(container_id, safe='')}/files/{quote(file_id, safe='')}/content"
    candidates = [
        f"{clean_endpoint}/openai/v1/{file_path}",
        f"{clean_endpoint}/agents/{agent_name}/endpoint/protocols/openai/{file_path}?api-version=v1",
        f"{clean_endpoint}/{file_path}?api-version=v1",
    ]
    for url in candidates:
        try:
            print(f"[CONTAINER FILE FETCH] Downloading {file_id} from {url}", flush=True)
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(url, headers={"Authorization": f"Bearer {clean_token}"})
            if response.is_success:
                text = response.text
                print(f"[CONTAINER FILE FETCH SUCCESS] Downloaded {len(text)} bytes", flush=True)
                return text
            print(f"[CONTAINER FILE FETCH] HTTP {response.status_code} from {url}", flush=True)
        except Exception as err:
            print(f"[CONTAINER FILE FETCH ERR] {url} {err!r}", flush=True)
    return None


COSS_HEADER_RE = re.compile(r'^\s*"?00"?,')


# ROUTE 3: Call COSS File Generation Agent (single stage, no ProShipper API / label step)
@app.post("/api/coss/generate")
async def coss_generate(request: Request):
    body = await read_body(request)
    prompt = body.get("prompt")
    history = body.get("history")

    if not prompt and not history:
        return JSONResponse(status_code=400, content={"error": "Prompt is required."})

    auth_token = await get_or_fetch_token(body.get("token"))
    if not auth_token:
        return JSONResponse(status_code=401, content={"error": "Authentication failed. Please provide an Access Token or assign Managed Identity."})

    try:
        target_endpoint = body.get("endpoint") or DEFAULT_CONFIG["endpoint"]
        target_name = body.get("agentName") or DEFAULT_CONFIG["cossAgentName"]
        target_version = body.get("agentVersion") or DEFAULT_CONFIG["cossAgentVersion"]

        input_messages = [{"role": h.get("role"), "content": h.get("content")} for h in history] if history else prompt

        result = await call_foundry_agent_with_retry({
            "endpoint": target_endpoint,
            "token": auth_token,
            "agent_name": target_name,
            "agent_version": target_version,
            "input_messages": input_messages,
        })

        if not result["ok"]:
            return JSONResponse(status_code=result["status"], content={"error": "COSS Agent Execution Failed", "details": result["data"]})

        # Only files the agent attached to its reply count as output; turns where it is still asking for
        # barcode details carry none, so no file is shown until the agent has actually generated one
        file_map = collect_coss_output_files(result["data"])

        files = []
        missing_files = []
        for fid, info in file_map.items():
            filename, container_id = info["filename"], info["container_id"]
            if container_id:
                content = await fetch_container_file_content(target_endpoint, auth_token, target_name, container_id, fid)
            else:
                content = await fetch_file_content_from_azure(target_endpoint, auth_token, fid)
            if content:
                files.append({"fileId": fid, "filename": filename or f"COSS_{fid}.csv", "content": content})
            else:
                missing_files.append(filename or fid)

        # COSS CSV files start with the "00" header record; drop unrelated attachments when one is present
        coss_files = [f for f in files if COSS_HEADER_RE.match(f["content"])]
        if coss_files:
            files = coss_files

        # The same generated file is often referenced under several file ids; keep one copy per distinct content
        seen_content = set()
        unique_files = []
        for f in files:
            key = f["content"].replace("\r\n", "\n").strip()
            if key not in seen_content:
                seen_content.add(key)
                unique_files.append(f)
        files = unique_files
        print(f"[COSS Agent] Downloaded {len(files)} output file(s) ({len(coss_files)} COSS CSV), {len(missing_files)} not downloadable", flush=True)

        return {"success": True, "result": result["data"], "files": files, "missingFiles": missing_files}
    except Exception as err:
        print(f"[COSS Agent Exception] {err!r}", flush=True)
        return JSONResponse(status_code=500, content={"error": str(err)})


# Static frontend last, so /api routes take precedence
app.mount("/", StaticFiles(directory=BASE_DIR / "public", html=True), name="public")


if __name__ == "__main__":
    import uvicorn

    print(f"Royal Mail ProShipper App running at http://localhost:{PORT}", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
