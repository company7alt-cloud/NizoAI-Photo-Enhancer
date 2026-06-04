#!/usr/bin/env python3
# patch3_index.py — Applies PATCH 3A, 3B, 3C to src/index.ts
import re, sys

filepath = r'c:\NizoAI-Bot\src\index.ts'

with open(filepath, 'rb') as f:
    raw = f.read()

# Detect encoding
try:
    text = raw.decode('utf-8')
    enc = 'utf-8'
except UnicodeDecodeError:
    text = raw.decode('cp1256')
    enc = 'cp1256'

lines = text.splitlines(keepends=True)
print(f"Total lines: {len(lines)}, encoding: {enc}")

# ── PATCH 3A: Replace processingMsg (lines 1215-1218, 0-indexed 1214-1217) ──
# Find the block: const processingMsg = await ctx.reply(
patch3a_old = [
    "    const processingMsg = await ctx.reply(\r\n",
    "      '\U0001f4e6 <b>\u062c\u0627\u0631\u064a \u0641\u062d\u0635 \u0627\u0644\u0631\u0627\u0628\u0637 \u0648\u0627\u0644\u0628\u062d\u062b \u0639\u0646 \u0627\u0644\u0635\u0648\u0631\u0629...</b>',\r\n",
    "      { parse_mode: 'HTML' }\r\n",
    "    );\r\n",
]

patch3a_new = (
    "    const processingMsg = await ctx.reply(\r\n"
    "      '\U0001f310 <b>\u062c\u0627\u0631\u064a \u0645\u0639\u0627\u0644\u062c\u0629 \u0627\u0644\u0631\u0627\u0628\u0637...</b>\\n\\n' +\r\n"
    "      '\u2699\ufe0f \u064a\u062a\u0645 \u0627\u0644\u0622\u0646 \u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0648\u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0627\u0644\u0635\u0648\u0631\u0629 \u0628\u0623\u0639\u0644\u0649 \u062c\u0648\u062f\u0629 \u0645\u062a\u0627\u062d\u0629\\n' +\r\n"
    "      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\\n' +\r\n"
    "      '\u23f1 \u0642\u062f \u062a\u0633\u062a\u063a\u0631\u0642 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 30-60 \u062b\u0627\u0646\u064a\u0629...',\r\n"
    "      { parse_mode: 'HTML' }\r\n"
    "    );\r\n"
)

# Search by matching line 1215 pattern (0-indexed: 1214)
found3a = False
for i in range(len(lines) - 3):
    if ("const processingMsg = await ctx.reply(" in lines[i]
            and "parse_mode: 'HTML'" in lines[i+2]
            and lines[i+3].strip() == ');'
            and "âں" in lines[i+1]   # the garbled emoji = 📦 in cp1256
       ):
        lines[i:i+4] = patch3a_new.splitlines(keepends=True)
        found3a = True
        print(f"✅ PATCH 3A applied at line {i+1}")
        break

if not found3a:
    # fallback: try raw line content match
    for i in range(len(lines) - 3):
        if ("const processingMsg = await ctx.reply(" in lines[i]
                and "parse_mode: 'HTML'" in lines[i+2]
                and lines[i+3].strip() == ');'):
            lines[i:i+4] = patch3a_new.splitlines(keepends=True)
            found3a = True
            print(f"✅ PATCH 3A (fallback) applied at line {i+1}")
            break

if not found3a:
    print("❌ PATCH 3A: processingMsg block not found!")
    sys.exit(1)

# ── PATCH 3B: Replace caption inside replyWithDocument after fetchHighResImage ──
# Find: await ctx.replyWithDocument(new InputFile(imageBuffer, fileName), {
# Then find caption: line starting with "          caption:" and ending before reply_markup
found3b = False
for i in range(len(lines) - 8):
    if ("await ctx.replyWithDocument(new InputFile(imageBuffer, fileName), {" in lines[i]
            and "caption:" in lines[i+1]):
        # Replace caption lines (i+1 through line before parse_mode)
        j = i + 1
        while j < len(lines) and "parse_mode:" not in lines[j]:
            j += 1
        # lines[i+1 .. j-1] are the caption lines
        old_caption_block = lines[i+1:j]
        new_caption_lines = (
            "        caption:\r\n"
            "          '\u2705 <b>\u062a\u0645 \u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0627\u0644\u0635\u0648\u0631\u0629 \u0628\u0646\u062c\u0627\u062d!</b>\\n\\n' +\r\n"
            "          '\U0001f48e \u0627\u0644\u062c\u0648\u062f\u0629: \u0623\u0639\u0644\u0649 \u062f\u0642\u0629 \u0623\u0635\u0644\u064a\u0629 \u0645\u062a\u0627\u062d\u0629\\n' +\r\n"
            "          '\U0001f4c1 \u062a\u0645 \u0627\u0644\u0625\u0631\u0633\u0627\u0644 \u0643\u0645\u0644\u0641 \u0644\u0644\u062d\u0641\u0627\u0638 \u0639\u0644\u0649 \u0627\u0644\u062c\u0648\u062f\u0629 \u0627\u0644\u0643\u0627\u0645\u0644\u0629',\r\n"
        )
        lines[i+1:j] = new_caption_lines.splitlines(keepends=True)
        found3b = True
        print(f"✅ PATCH 3B applied at line {i+1}")
        break

if not found3b:
    print("❌ PATCH 3B: replyWithDocument caption block not found!")
    sys.exit(1)

# ── PATCH 3C: Replace catch block body ──
# Find: } catch (err: unknown) {
#         clearInterval(fetchInterval);
# End at: } (single closing brace followed by return;)
found3c = False
for i in range(len(lines) - 5):
    if ("} catch (err: unknown) {" in lines[i]
            and "clearInterval(fetchInterval);" in lines[i+1]):
        # Find the end of the catch block
        j = i + 1
        depth = 1
        while j < len(lines) and depth > 0:
            for ch in lines[j]:
                if ch == '{': depth += 1
                elif ch == '}': depth -= 1
            if depth > 0:
                j += 1
        # lines[i..j] is the full catch block (inclusive)
        new_catch = (
            "    } catch (err: any) {\r\n"
            "      const errMsg: string = (err?.message ?? '').toUpperCase();\r\n"
            "\r\n"
            "      clearInterval(fetchInterval);\r\n"
            "      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});\r\n"
            "      console.error('[ImageFetcher-v10]', (err as Error).message);\r\n"
            "\r\n"
            "      if (\r\n"
            "        errMsg.includes('VIP_PROXIES_EXHAUSTED') ||\r\n"
            "        errMsg.includes('CORRUPTED')             ||\r\n"
            "        errMsg.includes('HTML')\r\n"
            "      ) {\r\n"
            "        await ctx.reply(\r\n"
            "          '\u274c <b>\u062a\u0639\u0630\u0651\u0631 \u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0627\u0644\u0635\u0648\u0631\u0629 \u0645\u0646 \u0647\u0630\u0627 \u0627\u0644\u0631\u0627\u0628\u0637.</b>\\n\\n' +\r\n"
            "          '\u0642\u062f \u062a\u0643\u0648\u0646 \u0627\u0644\u0635\u0648\u0631\u0629 \u0645\u062d\u0645\u064a\u0629 \u0628\u0642\u064a\u0648\u062f \u0627\u0644\u0648\u0635\u0648\u0644\u060c \u0623\u0648 \u0623\u0646 \u0627\u0644\u0631\u0627\u0628\u0637 \u063a\u064a\u0631 \u0645\u062f\u0639\u0648\u0645 \u062d\u0627\u0644\u064a\u0627\u064b.\\n' +\r\n"
            "          '\u064a\u0631\u062c\u0649 \u062a\u062c\u0631\u0628\u0629 \u0631\u0627\u0628\u0637 \u0645\u062e\u062a\u0644\u0641 \u0623\u0648 \u0631\u0641\u0639 \u0627\u0644\u0635\u0648\u0631\u0629 \u0645\u0628\u0627\u0634\u0631\u0629 \U0001f517',\r\n"
            "          { parse_mode: 'HTML' }\r\n"
            "        );\r\n"
            "      } else if (\r\n"
            "        errMsg.includes('TIMEOUT') ||\r\n"
            "        errMsg.includes('TIME_OUT')\r\n"
            "      ) {\r\n"
            "        await ctx.reply(\r\n"
            "          '\u23f3 <b>\u0627\u0646\u062a\u0647\u062a \u0645\u0647\u0644\u0629 \u0627\u0644\u0627\u062a\u0635\u0627\u0644 \u0628\u0627\u0644\u062e\u0627\u062f\u0645.</b>\\n\\n' +\r\n"
            "          '\u0627\u0644\u0645\u0635\u062f\u0631 \u0644\u0627 \u064a\u0633\u062a\u062c\u064a\u0628 \u062d\u0627\u0644\u064a\u0627\u064b \u0623\u0648 \u0623\u0646 \u062d\u062c\u0645 \u0627\u0644\u0645\u0644\u0641 \u0643\u0628\u064a\u0631 \u062c\u062f\u0627\u064b.\\n' +\r\n"
            "          '\u064a\u0631\u062c\u0649 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0645\u062c\u062f\u062f\u0627\u064b \u0628\u0639\u062f \u0642\u0644\u064a\u0644 \u26a1',\r\n"
            "          { parse_mode: 'HTML' }\r\n"
            "        );\r\n"
            "      } else if (errMsg.includes('ALL_LAYERS_EXHAUSTED')) {\r\n"
            "        await ctx.reply(\r\n"
            "          '\u26a0\ufe0f <b>\u0644\u0645 \u064a\u062a\u0645\u0643\u0646 \u0627\u0644\u0646\u0638\u0627\u0645 \u0645\u0646 \u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0627\u0644\u0635\u0648\u0631\u0629.</b>\\n\\n' +\r\n"
            "          '\u0647\u0630\u0627 \u0627\u0644\u0631\u0627\u0628\u0637 \u0644\u0627 \u064a\u062f\u0639\u0645 \u0627\u0644\u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0627\u0644\u0645\u0628\u0627\u0634\u0631.\\n' +\r\n"
            "          '\u064a\u0631\u062c\u0649 \u0631\u0641\u0639 \u0627\u0644\u0635\u0648\u0631\u0629 \u064a\u062f\u0648\u064a\u0627\u064b \u0623\u0648 \u062a\u062c\u0631\u0628\u0629 \u0631\u0627\u0628\u0637 \u0622\u062e\u0631 \U0001f4ce',\r\n"
            "          { parse_mode: 'HTML' }\r\n"
            "        );\r\n"
            "      } else {\r\n"
            "        await ctx.reply(\r\n"
            "          '\u26a0\ufe0f <b>\u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0645\u0639\u0627\u0644\u062c\u0629 \u0627\u0644\u0631\u0627\u0628\u0637.</b>\\n\\n' +\r\n"
            "          '\u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u0623\u0643\u062f \u0645\u0646 \u0635\u062d\u0629 \u0627\u0644\u0631\u0627\u0628\u0637 \u0648\u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649 \U0001f504',\r\n"
            "          { parse_mode: 'HTML' }\r\n"
            "        );\r\n"
            "      }\r\n"
            "    }\r\n"
        )
        lines[i:j+1] = new_catch.splitlines(keepends=True)
        found3c = True
        print(f"✅ PATCH 3C applied at line {i+1}")
        break

if not found3c:
    print("❌ PATCH 3C: catch block not found!")
    sys.exit(1)

# Write back
new_text = ''.join(lines)
with open(filepath, 'wb') as f:
    f.write(new_text.encode('utf-8'))

print(f"\n✅ All patches applied. File saved as UTF-8.")
