# 9Router Fix for Claude Desktop (Cowork & Code) & Claude Code CLI

Bộ công cụ hotfix & tối ưu hóa toàn diện cho gateway **9Router** khi sử dụng với **Claude Desktop (chế độ Cowork & Code 3p)** và **Claude Code CLI**.

---

## 🚀 Cài đặt nhanh trên máy mới (1 Lệnh)

```bash
git clone https://github.com/letinhminh/9router-fix.git ~/.9router/patches
cd ~/.9router/patches
chmod +x *.sh *.py
./setup.sh
```

*(Mặc định `setup.sh` sẽ dùng model combo `claude-free`. Nếu máy bạn dùng combo khác, chạy `./setup.sh <tên-combo>`)*.

---

## 🛠️ Danh sách các bản vá (Patches 1 → 14)

| Patch | Tệp chunk vá | Lỗi giải quyết |
| :--- | :--- | :--- |
| **#1, #1b** | Next.js chunks | **Clamp `max_output_tokens` [16, 65536]**: Ngăn lỗi 400 Bad Request do tràn context khi hội thoại dài. |
| **#2** | `318.js` / `5330.js` | **Tool conditional skip bug**: Sửa lỗi bỏ qua công cụ khi route qua Responses API. |
| **#3** | `318.js` / `5330.js` / `8499.js` | **Tool Quartet Schemas & Bidirectional Mapping**: Cung cấp schema chuẩn cho bộ tứ `[shell, glob, grep, read]` với `strict: false`. Tự động dịch `bash` $\leftrightarrow$ `shell` giữa Claude và OpenCode. |
| **#4** | `318.js` / `5330.js` | **ForceStream for OpenCode**: Ép chế độ stream cho provider OpenCode. |
| **#5** | `5330.js` | **Fallback on 400**: Cho phép Combo tự động fallback khi gặp lỗi tham số upstream (400 Invalid Parameter). |
| **#6** | `8910.js` | **Combo Runner Loop Index Shadow**: Sửa lỗi biến loop index `_ci` bị biến response `b` ghi đè khiến 9Router ngắt fallback sớm dù còn model. |
| **#7, 7b, 7c** | `318.js` / `5330.js` | **OpenCode Sanitizer & Debug Dumper**: Chuẩn hóa tên tool (`^[a-zA-Z0-9_-]+$`), ghép cặp function call & output, ghi log debug nếu lỗi (hỗ trợ cả 0.5.91 và 0.5.95). |
| **#8** | `8499.js` | **Thinking Disabled Mapping**: Map `thinking: disabled` thành `minimal` thay vì `none` (OpenAI format không nhận `none`). |
| **#9** | `8895.js` | **OpenAI → Anthropic non-stream for forceStream**: Chuyển đổi body về định dạng Anthropic cho auto-mode classifier của OpenCode. |
| **#10** | `8895.js` | **Responses → Claude accumulator**: Hỗ trợ chuyển đổi stream accumulator của OpenAI Responses sang Claude. |
| **#11** | `8895.js` (module 5016) | **Gemini/Antigravity/Vertex → Anthropic non-stream**: Sửa lỗi 9Router trả object `chat.completion` của OpenAI cho request `/v1/messages` non-stream khiến Claude Code classifier fail. |
| **#12** | `8499.js` & `8895.js` | **Tool Call Argument Normalizer (Fix `Bash: missing command`)**: Tự động map `cmd`, `script`, `command_line`, `input`, `code` $\rightarrow$ `command` cho tool `Bash`; map `path` $\rightarrow$ `file_path` cho `Read/Edit/Write`; map `query` $\rightarrow$ `pattern` cho `Glob/Grep`. Ngăn chặn `InputValidationError`. |
| **#13** | `318.js` / `5330.js` | **OpenCode Timestamp Encoding**: Sửa thuật toán sinh session ID `ses_<12-hex><14-base62>` theo descending bitwise timestamp `~(4096n * BigInt(now) + BigInt(counter))` chuẩn OpenCode 2.0. |
| **#14** | `5330.js` / `8499.js` | **OpenCode Upstream Routing to Official `/inference/v1/responses`, Header Cleanup & `prompt_cache_key`**: Định tuyến sang endpoint chính thức `/inference/v1/responses` (thay vì `/zen/v1` bị chặn), loại bỏ header cấm `x-opencode-request` (chỉ dùng `x-opencode-request-id`), bổ sung `prompt_cache_key` trùng Session ID, cập nhật User-Agent `opencode/latest/2.0.29/cli`. Hoàn toàn không cần CLI/daemon, đổi IP VPN reset quota bình thường! |

---

## 📋 Hướng dẫn Combo Model Đề Xuất (Trong 9Router Dashboard / SQLite)

Nên cấu hình combo (ví dụ `claude-free`) với thứ tự ưu tiên đa tầng:

1. `oc/muse-spark-1.3-contributor-free` *(OpenCode Zen 1M context — đi qua Cloudflare proxy của OpenCode nên không bị Meta geo-block tại VN)*
2. `oc/muse-spark-1.2-contributor-free` *(OpenCode Free dự phòng)*
3. `tt/DeepSeek-V4.1-Flash` / `an/free/deepseek-v4-pro-0813`
4. `an/free/glm-5.3-flash`
5. `an/free/kimi-k3`

---

## 🖥️ Cấu hình Claude Desktop (Cowork & Code 3p)

Đường dẫn cấu hình:
`~/Library/Application Support/Claude-3p/configLibrary/<UUID>.json`

Mẫu cấu hình tham khảo tại [`claude-desktop-3p.sample.json`](claude-desktop-3p.sample.json).

Sau khi sửa file config, nhấn **Cmd + Q** để thoát Claude Desktop và mở lại.

---

## 🔄 Khi 9Router được cập nhật (`npm update -g 9router`)

Khi bạn cập nhật 9Router qua npm, các file chunk sẽ bị ghi đè. Chỉ cần chạy lại:
```bash
node ~/.9router/patches/apply-patch.js
launchctl kickstart -k gui/501/com.9router.autostart
```
Kiểm tra sức khỏe hệ thống:
```bash
bash ~/.9router/patches/verify.sh
```
