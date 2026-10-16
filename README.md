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

## 🛠️ Danh sách các bản vá (Patches 1 → 16 - Tương thích 9Router v0.5.95 → v0.5.104+)

| Patch | Tệp chunk vá | Lỗi giải quyết |
| :--- | :--- | :--- |
| **#1, #1b** | Next.js chunks | **Clamp `max_output_tokens` [16, 65536]**: Ngăn lỗi 400 Bad Request do tràn context khi hội thoại dài. |
| **#2** | `318.js` / `5330.js` | **Tool conditional skip bug**: Sửa lỗi bỏ qua công cụ khi route qua Responses API. |
| **#3** | `318.js` / `5330.js` / `8499.js` | **Tool Quartet Schemas & Bidirectional Mapping**: Cung cấp schema chuẩn cho bộ tứ `[shell, glob, grep, read]` với `strict: false`. Tự động dịch `bash` $\leftrightarrow$ `shell` giữa Claude và OpenCode. |
| **#4** | `318.js` / `5330.js` | **ForceStream for OpenCode**: Ép chế độ stream cho provider OpenCode. |
| **#5** | `5330.js` | **Fallback on 400**: Cho phép Combo tự động fallback khi gặp lỗi tham số upstream (400 Invalid Parameter). |
| **#6** | `8910.js` | **Combo Runner Loop Fallback (0.5.95 & 0.5.104)**: Sửa lỗi 9Router ngắt fallback sớm khi model gặp lỗi 400 (do biến loop index hoặc logic check `shouldFallback: false`). Đảm bảo luôn fallback sang model tiếp theo nếu chưa phải model cuối cùng. |
| **#7, 7b, 7c** | `318.js` / `5330.js` | **OpenCode Sanitizer & Debug Dumper**: Chuẩn hóa tên tool (`^[a-zA-Z0-9_-]+$`), ghép cặp function call & output, ghi log debug nếu lỗi (hỗ trợ cả 0.5.91, 0.5.95 và 0.5.104). |
| **#8** | `8499.js` / `5330.js` | **Thinking Disabled Mapping (`none` $\to$ `minimal`)**: Map `thinking: disabled` thành `minimal` thay vì `none` trong cả translator và OpenCode provider (tránh lỗi 400 Bad Request do OpenCode từ chối `reasoning_effort: "none"`). |
| **#9** | `8895.js` | **OpenAI → Anthropic non-stream for forceStream**: Chuyển đổi body về định dạng Anthropic cho auto-mode classifier của OpenCode. |
| **#10** | `8895.js` | **Responses → Claude accumulator (0.5.95 & 0.5.104)**: Hỗ trợ chuyển đổi stream accumulator của OpenAI Responses sang Claude. |
| **#11** | `8895.js` (module 5016) | **Gemini/Antigravity/Vertex → Anthropic non-stream**: Sửa lỗi 9Router trả object `chat.completion` của OpenAI cho request `/v1/messages` non-stream khiến Claude Code classifier fail. |
| **#12** | `8499.js` & `8895.js` | **Tool Call Argument Normalizer (Fix `Bash: missing command`)**: Tự động map `cmd`, `script`, `command_line`, `input`, `code` $\rightarrow$ `command` cho tool `Bash`; map `path` $\rightarrow$ `file_path` cho `Read/Edit/Write`; map `query` $\rightarrow$ `pattern` cho `Glob/Grep`. Ngăn chặn `InputValidationError`. |
| **#13** | `318.js` / `5330.js` | **OpenCode Timestamp Encoding (0.5.95 & 0.5.104)**: Sửa thuật toán sinh session ID `ses_<12-hex><14-base62>` theo descending bitwise timestamp `~(4096n * BigInt(now) + BigInt(counter))` chuẩn OpenCode 2.0 (thay vì hash SHA-256 gây 403 FreeTierError). |
| **#14** | `5330.js` / `8499.js` | **OpenCode Upstream Routing to Official `/inference/v1/responses`, Header Cleanup & `prompt_cache_key`**: Định tuyến sang endpoint chính thức `/inference/v1/responses` (thay vì `/zen/v1` bị chặn), loại bỏ header cấm `x-opencode-request` (chỉ dùng `x-opencode-request-id`), bổ sung `prompt_cache_key` trùng Session ID, cập nhật User-Agent `opencode/latest/2.0.29/cli`. |
| **#15** | `5330.js` & `rotate-ip.sh` | **Cloudflare WARP Proxy Routing & Tự động Đổi IP khi Rate Limit (429/403)**: Tích hợp proxy cục bộ (`127.0.0.1:40000`) qua Cloudflare WARP. Tự động bắt mã lỗi 429 / 403, kích hoạt `rotate-ip.sh rotate` (với 6s debounce), reset session cache và tự động retry request với IP mới. Hoàn toàn không làm ảnh hưởng mạng internet của các ứng dụng khác trên máy! |
| **#16** | `8499.js` & `8895.js` | **Claude Desktop Tool PascalCase Mapper (Fix `No such tool available: read / shell`)**: Sửa triệt để lỗi Claude Desktop app (Cowork / Code 3p) văng lỗi `No such tool available: read. Tool names are case-sensitive: call Read instead` hoặc `No such tool available: shell`. Tự động ánh xạ 2 chiều `toolNameMap` từ upstream (OpenCode dummy tools `shell`, `read`) về PascalCase chuẩn mà Claude Desktop đăng ký (`Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`) trong cả luồng SSE stream và non-stream. |

---

## 🌐 Tự Động Xoay IP Vượt Limit OpenCode Bằng Cloudflare WARP Proxy Mode

OpenCode áp dụng giới hạn request theo IP (khoảng 30-50 request/phút) và trả về HTTP 429 hoặc HTTP 403 (FreeTierError). Sử dụng VPN hệ thống (như Hotspot Shield) có nhược điểm làm rớt mạng toàn máy, ngắt kết nối Zoom/Meet/chat.

Giải pháp tích hợp sử dụng **Cloudflare WARP ở chế độ Local SOCKS5/HTTP Proxy** (`127.0.0.1:40000`):
- Toàn bộ kết nối internet của máy tính (trình duyệt, chat, game...) vẫn dùng mạng Wi-Fi/Ethernet gốc 100%.
- Chỉ riêng request từ 9Router sang OpenCode được định tuyến qua cổng proxy nội bộ 40000.
- Khi gặp 429/403, 9Router tự động đổi IP WARP mới trong ~2 giây và retry ngay lập tức.

### Cách sử dụng script `rotate-ip.sh`:

```bash
# 1. Cài đặt WARP CLI (nếu chưa có):
brew install --cask cloudflare-warp

# 2. Bật chế độ Proxy Mode và kích hoạt cho 9Router:
./rotate-ip.sh setup

# 3. Kiểm tra trạng thái IP trực tiếp vs IP WARP proxy:
./rotate-ip.sh status

# 4. Thủ công đổi IP mới bất kỳ lúc nào:
./rotate-ip.sh rotate

# 5. Tắt chế độ proxy (9Router sẽ quay về kết nối trực tiếp):
./rotate-ip.sh disable
```

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
