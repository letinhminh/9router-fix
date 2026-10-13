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

*(Mặc định `setup.sh` sẽ dùng model combo `claude-1M-free`. Nếu máy bạn dùng combo khác, chạy `./setup.sh <tên-combo>`)*.

---

## 🛠️ Danh sách các bản vá (Patches 1 → 13)

| Patch | Tệp chunk vá | Lỗi giải quyết |
| :--- | :--- | :--- |
| **#1, #1b** | Next.js chunks | **Clamp `max_output_tokens` [16, 65536]**: Ngăn lỗi 400 Bad Request do tràn context khi hội thoại dài. |
| **#2** | `318.js` / `5330.js` | **Tool conditional skip bug**: Sửa lỗi bỏ qua công cụ khi route qua Responses API. |
| **#3** | `318.js` / `5330.js` | **Fingerprint Quartet Tools**: Bổ sung đầy đủ 4 công cụ chuẩn (`bash`, `read`, `glob`, `grep`). |
| **#4** | `318.js` / `5330.js` | **ForceStream for OpenCode**: Ép chế độ stream cho provider OpenCode. |
| **#5** | `5330.js` | **Fallback on 400**: Cho phép Combo tự động fallback khi gặp lỗi tham số upstream (400 Invalid Parameter). |
| **#6** | `8910.js` | **Combo Runner Loop Index Shadow**: Sửa lỗi biến loop index `_ci` bị biến response `b` ghi đè khiến 9Router ngắt fallback sớm dù còn model. |
| **#7, 7b, 7c** | `318.js` / `5330.js` | **OpenCode Sanitizer & Debug Dumper**: Chuẩn hóa tên tool (`^[a-zA-Z0-9_-]+$`), ghép cặp function call & output, ghi log debug nếu lỗi (hỗ trợ cả 0.5.91 và 0.5.95). |
| **#8** | `8499.js` | **Thinking Disabled Mapping**: Map `thinking: disabled` thành `minimal` thay vì `none` (OpenAI format không nhận `none`). |
| **#9** | `8895.js` | **OpenAI → Anthropic non-stream for forceStream**: Chuyển đổi body về định dạng Anthropic cho auto-mode classifier của OpenCode. |
| **#10** | `8895.js` | **Responses → Claude accumulator**: Hỗ trợ chuyển đổi stream accumulator của OpenAI Responses sang Claude. |
| **#11** | `8895.js` (module 5016) | **Gemini/Antigravity/Vertex → Anthropic non-stream**: Sửa lỗi 9Router trả object `chat.completion` của OpenAI cho request `/v1/messages` non-stream khiến Claude Code classifier fail. |
| **#12** | `8499.js` & `8895.js` | **Tool Call Argument Normalizer (Fix `Bash: missing command`)**: Tự động map `cmd`, `script`, `command_line`, `input`, `code` $\rightarrow$ `command` cho tool `Bash`; map `path` $\rightarrow$ `file_path` cho `Read/Edit/Write`; map `query` $\rightarrow$ `pattern` cho `Glob/Grep`. Ngăn chặn `InputValidationError`. |
| **#13** | `318.js` / `5330.js` | **OpenCode `x-opencode-session` & `x-opencode-request` Monotonic Timestamp Validation (Fix `403 FreeTierError`)**: Sửa lỗi hàm `B(a,b)` nhét 6 byte SHA-256 thô vào phần hex timestamp của `ses_<12-hex><14-base62>` khiến OpenCode Zen proxy (từ bản `opencode 1.19.0`) từ chối với lỗi `403 FreeTierError`. Thay bằng mã hóa timestamp chuẩn `~(4096n * BigInt(Date.now()) + BigInt(y))` kèm cache theo session, cập nhật `msg_` ascending timestamp và `User-Agent: opencode/1.19.0`. |

---

## 📋 Hướng dẫn Combo Model Đề Xuất (Trong 9Router Dashboard / SQLite)

Nên cấu hình combo (ví dụ `claude-1M-free` hoặc `claude-command-code`) với thứ tự ưu tiên đa tầng để tránh bị nghẽn Quota 429 hoặc Geo-block:

1. `oc/muse-spark-1.3-contributor-free` *(OpenCode Zen 1M context — đi qua Cloudflare proxy của OpenCode nên không bị Meta geo-block tại VN)*
2. `oc/step-5-preview-free` hoặc `oc/nemotron-3.5-lightning-free` *(OpenCode Free dự phòng)*
3. `cmc/inclusionai/ling-3.1-flash:free` *(CommandCode phản hồi siêu tốc ~2s, không bị geo-block)*
4. `gemini/gemini-3.6-flash` / `gemini/gemini-3.7-flash` *(Gemini Flash 1M context)*
5. `cmc/poolside/laguna-s-2.1-free`
6. `cf/@cf/zai-org/glm-4.7-flash` *(Cloudflare Workers AI dự phòng)*

> **Lưu ý về Geo-block:** Model `cmc/meta/muse-spark-1.3-contributor` (qua CommandCode) kiểm tra IP theo chính sách vùng của Meta nên sẽ trả `403 Geographic Use Policy` nếu gọi từ IP Việt Nam không bật VPN, trong khi `oc/muse-spark-1.3-contributor-free` (qua OpenCode) hoạt động bình thường nhờ chạy qua proxy của OpenCode.

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
node ~/.9router/patches/apply-patch.js
# Khởi động lại 9router
PID=$(pgrep -f "[9]router -n --skip-update"); [ -n "$PID" ] && kill $PID
nohup 9router -n --skip-update > ~/.9router/logs/9router-restart.log 2>&1 &
```
