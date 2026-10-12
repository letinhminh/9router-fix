# 9Router OpenCode Provider — Sổ Tay Kỹ Thuật Dành Cho AI Agent (Agent Playbook)

> **Mục đích tài liệu:** Hướng dẫn bất kỳ AI Agent nào (Antigravity, Claude, Cline, Cursor, RooCode...) hiểu rõ kiến trúc, cơ chế kiểm duyệt của OpenCode upstream, cách chẩn đoán lỗi và cách hotfix bundle của 9Router khi gặp sự cố.

---

## 1. Tổng quan Kiến trúc & Vị trí Mã Nguồn Runtime

* **Đường dẫn cài đặt toàn cục (macOS Homebrew):**
  `/opt/homebrew/lib/node_modules/9router`
* **Mã nguồn thực thi (Next.js Standalone Build):**
  Toàn bộ backend chạy từ thư mục bundle:
  `/opt/homebrew/lib/node_modules/9router/app/.next-cli-build/server/chunks/`
  * Chức năng OpenCode & Responses API Executor: `318.js`
  * Chức năng Request Translator (`CLAUDE → OPENAI → RESPONSES`): `8499.js`
  * Combo Runner & Fallback Logic: `8910.js`
  * Bộ quy tắc chuyển đổi dự phòng (Fallback Rules): `3662.js`, `4572.js`, `8145.js`, `8628.js`...
* **Thư mục dữ liệu & cấu hình người dùng (Persistent across npm updates):**
  `~/.9router/`
  * CSDL SQLite: `~/.9router/db/data.sqlite`
  * Script & Backup: `~/.9router/patches/` (`apply-patch.js`, `318.js.patched`, `8910.js.patched`, `AGENT_GUIDE.md`)
* **Cổng dịch vụ mặc định:**
  * Web Dashboard & REST API: `http://localhost:20128`
  * Health check: `http://localhost:20128/api/health`
  * Chat completions: `http://localhost:20128/v1/chat/completions`
  * Anthropic Messages: `http://localhost:20128/v1/messages`

---

## 2. Bản chất các Cổng Kiểm Duyệt của OpenCode Free Tier (`Authorization: Bearer public`)

OpenCode (`https://opencode.ai/zen/v1/...`) cung cấp các model miễn phí thông qua header công khai `Authorization: Bearer public`. Để ngăn chặn các client ngoài và chống bot/proxy lạm dụng, thượng nguồn OpenCode kiểm tra nghiêm ngặt **các tiêu chí bắt buộc**:

| Tiêu chí | Yêu cầu bắt buộc | Nếu vi phạm | Cách 9Router xử lý đúng |
|---|---|---|---|
| **1. User-Agent** | Dạng `opencode/<major>.<minor>.<patch>` với version $\ge 1.17.0$ (chuẩn là `opencode/1.18.31`). | `403 FreeTierError` hoặc `426 Upgrade Required` | Chặn các User-Agent lạ/ngoài, ép gửi `opencode/1.18.31`. |
| **2. Session ID (`x-opencode-session`)** | Khớp regex `/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/` (tiền tố `ses_` + 12 ký tự hex timestamp + 14 ký tự Base62). | `403 FreeTierError` | Tự động sinh ID theo timestamp bitwise hoặc hash phiên làm việc của client thành chuẩn base62. |
| **3. Request ID (`x-opencode-request`)** | Khớp regex `/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/`. | Lỗi request không hợp lệ | Tự động sinh ID chuẩn với tiền tố `msg_`. |
| **4. Tool Fingerprint Quartet** | Request **BẮT BUỘC** phải chứa các tool chuẩn của client OpenCode: `["bash", "read", "glob", "grep"]`. | `403 FreeTierError` | 9Router **PHẢI LUÔN LUÔN MERGE** bộ 4 tool này vào body request, **KỂ CẢ KHI CLIENT ĐÃ CÓ TOOLS RIÊNG** (ví dụ Claude Code gửi 115 tools). |
| **5. Tool Naming Convention** | Tên tool chỉ được chứa `^[a-zA-Z0-9_-]+$`. MCP tools thường có dấu `:` (ví dụ `mcp:fs:read`). | `400 invalid_request_error: name must match ^[a-zA-Z0-9_-]+$` | Thay thế toàn bộ ký tự đặc biệt ngoài `[a-zA-Z0-9_-]` bằng dấu `_`. |
| **6. Tool Choice** | Responses API (`/zen/v1/responses`) **chỉ hỗ trợ duy nhất `"auto"`**. | `400 invalid_request_error: only "auto" is supported for tool_choice` | Luôn ép `tool_choice = "auto"`. |
| **7. Ghép cặp Function Call & Output** | Mọi `function_call` trong `input` **bắt buộc** phải có `function_call_output` tương ứng, và ngược lại không được có orphan output. | `400: No tool output found for function call ...` hoặc `No function call found for call_id ...` | Tự động drop orphan output và bổ sung dummy output `{}` cho các call bị ngắt quãng do context compaction. |
| **8. Định dạng Message trong Input** | `user` chỉ được chứa `input_text` hoặc `input_image`. `assistant` chỉ được chứa `output_text`. Không được có `role: "tool"` hay mảng rỗng `content: []`. | `400: content type ... is not allowed for ...` | Sanitize chuẩn hóa message sang đúng content type theo role và loại bỏ role không hợp lệ. |
| **9. Token Cap [16, 65536]** | Cận dưới $\ge 16$. Cận trên $\le 65536$ để chống tràn context 1M token trên các phiên làm việc dài. | `400: max_output_tokens must be >= 16` hoặc `The request contains invalid parameters` | Clamp cứng cả 2 đầu: `16 <= max_output_tokens <= 65536`. |
| **10. Streaming & Store** | Bắt buộc `stream: true`, `store: false`. Bật `forceStream: true` trên transport. | `403 FreeTierError` | Ép `stream: true`, `store: false` và convert SSE sang non-stream nếu client yêu cầu. |

---

## 3. Các Lỗi Logic Lớn Đã Được Khắc Phục Triệt Để

### Lỗi 1: Tràn Context Do Không Clamp Cận Trên `max_output_tokens`
Khi hội thoại dài (1000+ MSG, 200k+ tokens), client hoặc combo yêu cầu 1M tokens làm $250.000 + 1.048.576 > 1.048.576$. OpenCode Console trả về:
`400: The request contains invalid parameters. Check the request body for any errors or inconsistencies.`
$\rightarrow$ **Khắc phục:** Clamp `16 <= max_output_tokens <= 65536` trong `318.js`.

### Lỗi 2: Combo Bị Chết Sớm Do Không Fallback Khi Model Trả 400 (`no fallback`)
Mặc định 9Router coi mã 400 là client syntax error nên dừng hẳn combo, không gọi tiếp model 2/5, 3/5 trong danh sách fallback.
$\rightarrow$ **Khắc phục:** Trong `8910.js`, nếu model $k$ trả về lỗi và vẫn còn model tiếp theo trong combo (`b < o.length - 1`), luôn set `shouldFallback = true` để combo tiếp tục thử model kế tiếp, không bao giờ ngắt ngang dòng lệnh của người dùng!

### Lỗi 3: Lỗi Lịch Sử Tool Calls Trong Phiên Claude Code Dài (Orphan Calls / Outputs)
Khi Claude Code nén lịch sử (`/compact`) hoặc chạy subagents, các cặp `tool_use` và `tool_result` có thể bị cắt nửa hoặc sai lệch `call_id`.
$\rightarrow$ **Khắc phục:** Viết bộ lọc ghép cặp trong `318.js`: tự động loại bỏ orphan output và bù dummy output cho orphan call trước khi đẩy lên OpenCode.

### Lỗi 4: Tự Động Dump Lỗi Debug Khi Upstream Thất Bại
Khi OpenCode trả về bất kỳ mã lỗi nào ($\ne 200$), `318.js` tự động ghi lại toàn bộ request body, headers và response text vào `/tmp/last_opencode_failed_request.json` để agent kiểm tra ngay lập tức.

### Lỗi 5: Combo Không Fallback Vì Index Bị Shadow (`8910.js`)
Patch cũ dùng `if(!i&&b<o.length-1)i=!0`, nhưng biến `b` (index vòng lặp) bị **shadow** bởi `let b=await c(a,e)` (response) → điều kiện luôn false, combo chết sớm. Đã sửa: capture index vào `_ci` trước khi shadow (`let e=o[b],_ci=b`) và dùng `if(!i&&_ci<o.length-1)i=!0`.

### Lỗi 6: `reasoning_effort:"none"` Bị Provider Từ Chối (`8499.js`)
Khi Claude Code gửi `thinking:disabled`, translator map thành `reasoning_effort="none"`. Nhiều model OpenCode free (muse-spark...) chỉ nhận `[minimal,low,medium,high,xhigh,max]` → `400`. Đã đổi case `"openai"` sang `b.reasoning_effort="minimal"`.

### Lỗi 7: Response Non-stream Không Convert Sang Anthropic (`8895.js`)
Với provider `forceStream` (OpenCode), khi client yêu cầu non-stream, nhánh `!stream && forceStream` build `chat.completion` nhưng **không convert sang Anthropic**. Claude Code auto-mode classifier là client non-stream duy nhất → nhận body sai format → `TypeError ... e.filter` → "auto mode classifier unavailable" (fail closed, chặn WebSearch/Bash). Đã thêm hàm `_cc` (OpenAI→Anthropic) và áp ở cả 2 nhánh trả về (responses branch dùng `c`, chat branch dùng `p`), đồng thời cho phép convert từ `openai-responses`.

---

## 4. Quy Trình Dành Cho Agent Khi Cập Nhật Bản Mới 9Router

Khi người dùng cập nhật phiên bản mới của 9Router qua npm (`npm update -g 9router`), chỉ cần thực hiện 2 lệnh:

```bash
# 1. Chạy script hotfix tự động
node ~/.9router/patches/apply-patch.js

# 2. Khởi động lại 9Router
pkill -f "9router" || true
9router -n --skip-update &
```

`apply-patch.js` là **idempotent** (chạy lại không hỏng gì) và **portable** (tự dò chunks dir: `NINEROUTER_CHUNKS_DIR` env → `/opt/homebrew/...` → `/usr/local/...` → `npm root -g`).

---

## 5. Phía Claude Code (KHÔNG nằm trong apply-patch.js)

`apply-patch.js` chỉ vá 9Router. Phía Claude Code cấu hình riêng bằng `claude-code-setup.py`.

### 5.1 `~/.claude/settings.json` — trỏ Claude Code vào 9Router
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:20128/v1",
    "ANTHROPIC_AUTH_TOKEN": "<api key active trong ~/.9router/db/data.sqlite>",
    "ANTHROPIC_MODEL": "claude-1M-free",
    "ANTHROPIC_SMALL_FAST_MODEL": "claude-1M-free",
    "ANTHROPIC_DEFAULT_FABLE_MODEL": "claude-1M-free",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-1M-free",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-1M-free",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-1M-free",
    "CLAUDE_CODE_SUBAGENT_MODEL": "claude-1M-free"
  },
  "modelPicker": {
    "options": [{ "model": "claude-1M-free", "label": "claude-1M-free (9router)", "behavesAs": "claude-sonnet-4-6" }]
  }
}
```
- Lấy API key: `sqlite3 "file:$HOME/.9router/db/data.sqlite?mode=ro" "SELECT key FROM apiKeys WHERE isActive=1;"`
- `modelPicker.behavesAs`: để Claude Code nhận diện model lạ → hết warning `[claude-code:unrecognized_model]`.
- **Đừng gắn `[1m]`**: combo `claude-1M-free` khai `contextWindow: 200000`, ép 1M sẽ lỗi overflow khi fallback sang model 200k.

### 5.2 `~/.claude.json` — Exa MCP (web search + fetch)
```json
"mcpServers": { "exa": { "type": "http", "url": "https://mcp.exa.ai/mcp" } }
```
- Tools: `web_search_exa`, `web_fetch_exa`. Không cần API key.
- Đây chính là tính năng **"Web Search → Exa MCP"** của dashboard 9Router (nó merge entry này vào `~/.claude.json`).
- WebSearch **built-in** của Claude Code KHÔNG chạy qua 9Router (là tool server-side của Anthropic) → phải dùng MCP tool thay thế.
- Nguồn thay thế khác: `POST /v1/search` (`exa`,`tavily`,`serper`,`brave`...) và `POST /v1/web/fetch` (`exa`,`jina-reader`,`tavily`,`firecrawl`) của 9Router — dùng account provider của bạn (cần wrap thành MCP nếu muốn Claude Code gọi).

### 5.3 auto-mode classifier
Classifier gọi **non-streaming** bằng **chính model phiên** (không phải `ANTHROPIC_SMALL_FAST_MODEL`). Vì vậy **phải có patch #9 (Lỗi 7)** thì auto mode mới hoạt động. Verify: `claude -p "..." --permission-mode auto`.

### 5.4 Token cho endpoint MCP của 9Router (`/api/mcp/*`)
Header `x-9r-cli-token` = `sha256(machine-id + "9r-cli-auth" + cli-secret).hex[:16]`
- `~/.9router/machine-id` + `~/.9router/auth/cli-secret`.
- Chú ý tham số hàm là `L("9r-cli-auth")` nên chuỗi `"9r-cli-auth"` được **nhúng vào hash** (không phải salt).
- Chỉ plugin **LOCAL** (`browsermcp`) phục vụ qua `/api/mcp/<plugin>/sse`; `exa`/`tavily` là **hosted MCP** (đi thẳng `mcp.exa.ai`, `mcp.tavily.com`).

---

## 6. Reproduce nhanh trên máy khác

```bash
# 0. Cài đặt
npm install -g 9router @anthropic-ai/claude-code

# 1. Chạy 9router lần đầu rồi cấu hình provider/model qua dashboard (http://localhost:20128)
9router -n --skip-update &

# 2. Vá 9router (idempotent) + restart
node ~/.9router/patches/apply-patch.js
kill $(lsof -ti tcp:20128 -sTCP:LISTEN) 2>/dev/null; 9router -n --skip-update &

# 3. Cấu hình Claude Code (env + modelPicker + exa MCP)
python3 ~/.9router/patches/claude-code-setup.py

# 4. Verify
bash ~/.9router/patches/verify.sh
```

> Máy khác: chỉ cần copy nguyên thư mục `~/.9router/patches/` (gồm `apply-patch.js`, `claude-code-setup.py`, `verify.sh`, `AGENT_GUIDE.md`, `backup/`) sang cùng vị trí. 9router sẽ dùng đúng bộ này.

---

## 7. Bản đồ file trong `~/.9router/patches/`
| File | Vai trò |
|---|---|
| `apply-patch.js` | Patcher 9Router (idempotent, portable — tự dò chunks dir) |
| `claude-code-setup.py` | Cấu hình Claude Code (`~/.claude/settings.json` + `~/.claude.json`) |
| `ninerouter_key.py` | In API key active từ sqlite (WAL-safe: ro → fallback copy) |
| `verify.sh` | Kiểm tra sau khi cài (health, format, classifier, MCP) |
| `AGENT_GUIDE.md` | Tài liệu này |
| `backup/` | Backup các chunk gốc trước khi vá |
