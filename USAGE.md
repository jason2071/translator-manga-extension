# คู่มือใช้งาน — Manga Realtime Translator

แปล manga / webtoon เป็นไทยแบบ realtime ตอน scroll.
Flow: **build → โหลดเข้า Chrome → เลือก provider+model → วาดกรอบ → scroll แปลอัตโนมัติ**

## Prereqs

- **Node.js** (ไว้ build) — <https://nodejs.org>
- **Chrome**
- **API key** ของ provider สัก 1 เจ้า — เลือกอย่างใดอย่างหนึ่ง:
  - OpenRouter (ง่ายสุด, model เยอะ) — <https://openrouter.ai/keys>
  - Google Gemini — <https://aistudio.google.com/apikey>
  - หรือ **Ollama** (ฟรี รันในเครื่อง ไม่ส่งรูปออกเน็ต) — ดูหัวข้อ "ใช้ Ollama" ล่าง

## ติดตั้ง + ใช้ครั้งแรก

1. build extension

```
npm install
npm run build
```

ได้: โฟลเดอร์ `dist/`

2. โหลดเข้า Chrome — เปิด `chrome://extensions` → เปิด **Developer mode** (มุมขวาบน) → **Load unpacked** → เลือกโฟลเดอร์ `dist/`

ได้: icon extension บน toolbar

3. คลิก icon → ตั้งค่าใน popup

```
Provider : OpenRouter
API key  : sk-or-v1-...   (วาง key ของคุณ)
Model    : google/gemini-2.5-flash
Enabled  : ✓
```

ได้: status ล่างขึ้น "N models available" = key ใช้ได้

4. เปิดหน้า manga → วาดกรอบพื้นที่แปล — กด **`Alt+Shift+S`** → ลากกรอบชมพูครอบพื้นที่อ่าน → กด `Alt+Shift+S` อีกครั้งเพื่อปิด

ได้: กรอบถูกจำไว้ต่อเว็บ (domain) ใช้ซ้ำได้

5. scroll อ่านตามปกติ

ได้: กล่องคำแปลไทยทับ bubble ในกรอบ. footer popup นับ `API calls · cache hits` (re-scroll = cache hit ไม่ยิงซ้ำ)

## ใช้ Ollama (local, ฟรี)

รันใน **terminal ของคุณ**:

1. โหลด vision model

```
ollama pull llama3.2-vision
```

2. อนุญาต extension เข้าถึง (ไม่ตั้ง = โดน 403)

```
setx OLLAMA_ORIGINS "*"
```

แล้ว **ปิด Ollama ที่ system tray → เปิดใหม่** (ให้อ่าน env ใหม่)

3. popup → Provider = **Ollama (local)** → Model เลือกจาก dropdown (โชว์เฉพาะ vision model ที่ install ในเครื่อง) → API key เว้นว่าง

> ⚡ model local ตัวใหญ่ช้า (เช่น 12B ~24s/รูป). อยากเร็ว → cloud `google/gemini-2.5-flash-lite` หรือ Ollama `gemini-3-flash-preview:cloud`

## ปุ่มใน popup

- **Draw scope** — เปิด/ปิด mode วาดกรอบ (เท่ากับ `Alt+Shift+S`)
- **Reset scope** — รีเซ็ตกรอบกลับค่าเริ่มต้น
- **Re-translate** — ล้าง overlay แล้วแปลใหม่ทั้งหน้า (ใช้ตอนเปลี่ยน model)
- **Show / hide** — ซ่อน/โชว์ คำแปล (แอบดูต้นฉบับใต้กล่อง)
- **Clear cache** — ล้าง cache ทั้งหมด แปลใหม่จากศูนย์

## Gotchas (เจอจริง)

- **reload extension แล้วปุ่มกดไม่ได้ / error "Extension context invalidated"** → **F5 หน้าเว็บ**. content script เก่าหลุดไปกับ extension เดิม ต้องโหลดหน้าใหม่ทุกครั้งหลัง reload extension
- **Ollama 403** → `OLLAMA_ORIGINS` ไม่ได้ตั้ง → ทำตามหัวข้อ "ใช้ Ollama" + **restart Ollama** จริงๆ (ปิด tray แล้วเปิด)
- **`Malformed JSON from model`** → model เล็กออก JSON ไม่ดี → ใช้ model แรงกว่าหรือ cloud (`gemini-2.5-flash`)
- **กรอบชมพูใหญ่บังภาพ** → กด `Alt+Shift+S` แล้วลากจุดมุมย่อ. กรอบโชว์เฉพาะตอน draw mode ปกติซ่อนอยู่
- **ปุ่มไม่ทำงานบน `chrome://` / New Tab / Web Store** → เปิดหน้าเว็บจริงก่อน
- **แปลไม่ขึ้นเลย** → เช็ค: กรอบครอบรูปจริงไหม · Enabled ✓ · key ถูก · footer API calls เพิ่มไหม. ดู error ละเอียด: `chrome://extensions` → คลิก **"service worker"** → Console
